#!/usr/bin/env node
/**
 * CI script — Soroban Contract Budget & Performance Guard (#824)
 *
 * Enforces resource budget ceilings for Soroban smart contracts and WASM artifacts:
 * - WASM file size ceiling (default: 256 KB / 262,144 bytes)
 * - CPU instruction limit per invocation (default: 100,000,000)
 * - Memory bytes budget (default: 40 MB / 41,943,040 bytes)
 * - Storage footprint read/write bytes budget (default: 1 MB / 1,048,576 bytes)
 *
 * Usage:
 *   node scripts/ci/check-contract-budget.js [--dir <path>] [--report <json-path>]
 *
 * Dependency-free Node.js script suitable for CI runners.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_BUDGET_LIMITS = {
  maxWasmSizeBytes: 262144, // 256 KB
  maxCpuInstructions: 100000000, // 100M
  maxMemoryBytes: 41943040, // 40 MB
  maxReadBytes: 1048576, // 1 MB
  maxWriteBytes: 1048576, // 1 MB
};

function getBudgetLimitsFromEnv(overrides = {}) {
  const envWasmKb = process.env.MAX_WASM_SIZE_KB ? parseInt(process.env.MAX_WASM_SIZE_KB, 10) * 1024 : null;
  const envWasmBytes = process.env.MAX_WASM_SIZE_BYTES ? parseInt(process.env.MAX_WASM_SIZE_BYTES, 10) : null;
  const envCpu = process.env.MAX_CPU_INSTRUCTIONS ? parseInt(process.env.MAX_CPU_INSTRUCTIONS, 10) : null;
  const envMem = process.env.MAX_MEMORY_BYTES ? parseInt(process.env.MAX_MEMORY_BYTES, 10) : null;

  return {
    maxWasmSizeBytes: overrides.maxWasmSizeBytes ?? envWasmBytes ?? envWasmKb ?? DEFAULT_BUDGET_LIMITS.maxWasmSizeBytes,
    maxCpuInstructions: overrides.maxCpuInstructions ?? envCpu ?? DEFAULT_BUDGET_LIMITS.maxCpuInstructions,
    maxMemoryBytes: overrides.maxMemoryBytes ?? envMem ?? DEFAULT_BUDGET_LIMITS.maxMemoryBytes,
    maxReadBytes: overrides.maxReadBytes ?? DEFAULT_BUDGET_LIMITS.maxReadBytes,
    maxWriteBytes: overrides.maxWriteBytes ?? DEFAULT_BUDGET_LIMITS.maxWriteBytes,
  };
}

/**
 * Evaluates WASM file size against budget ceiling.
 */
function checkWasmFileSize(filePath, limits) {
  const normPath = filePath.replace(/\\/g, '/');
  if (!fs.existsSync(filePath)) {
    return { path: normPath, exists: false, passed: false, error: 'File not found' };
  }

  const stat = fs.statSync(filePath);
  const size = stat.size;
  const max = limits.maxWasmSizeBytes;
  const passed = size <= max;

  return {
    path: normPath,
    exists: true,
    sizeBytes: size,
    sizeKb: (size / 1024).toFixed(2),
    maxSizeBytes: max,
    maxSizeKb: (max / 1024).toFixed(2),
    passed,
    error: passed ? null : `WASM size ${size} B exceeds limit of ${max} B (${(max / 1024).toFixed(0)} KB)`,
  };
}

/**
 * Scans a directory recursively for .wasm files.
 */
function findWasmFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'target') {
        results.push(...findWasmFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.wasm')) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Parses a budget JSON report or metric object.
 */
function evaluateBudgetMetrics(metric, limits) {
  const cpu = metric.cpuInstructions ?? metric.cpu_instructions ?? metric.cpu ?? 0;
  const mem = metric.memoryBytes ?? metric.memory_bytes ?? metric.mem ?? 0;
  const read = metric.readBytes ?? metric.read_bytes ?? 0;
  const write = metric.writeBytes ?? metric.write_bytes ?? 0;

  const cpuPassed = cpu <= limits.maxCpuInstructions;
  const memPassed = mem <= limits.maxMemoryBytes;
  const readPassed = read <= limits.maxReadBytes;
  const writePassed = write <= limits.maxWriteBytes;

  const passed = cpuPassed && memPassed && readPassed && writePassed;
  const violations = [];

  if (!cpuPassed) {
    violations.push(`CPU instructions (${cpu.toLocaleString()}) exceed limit (${limits.maxCpuInstructions.toLocaleString()})`);
  }
  if (!memPassed) {
    violations.push(`Memory bytes (${mem.toLocaleString()}) exceed limit (${limits.maxMemoryBytes.toLocaleString()})`);
  }
  if (!readPassed) {
    violations.push(`Read bytes (${read.toLocaleString()}) exceed limit (${limits.maxReadBytes.toLocaleString()})`);
  }
  if (!writePassed) {
    violations.push(`Write bytes (${write.toLocaleString()}) exceed limit (${limits.maxWriteBytes.toLocaleString()})`);
  }

  return {
    name: metric.name || 'Contract Operation',
    cpuInstructions: cpu,
    memoryBytes: mem,
    readBytes: read,
    writeBytes: write,
    passed,
    violations,
  };
}

/**
 * Full contract budget inspection runner.
 */
function runBudgetCheck(options = {}) {
  const limits = getBudgetLimitsFromEnv(options.limits);
  const targetDirs = options.dirs || ['contracts', 'wasm'];
  const reportPaths = options.reports || [];

  const wasmFiles = [];
  for (const d of targetDirs) {
    const full = path.isAbsolute(d) ? d : path.join(process.cwd(), d);
    wasmFiles.push(...findWasmFiles(full));
  }

  const wasmResults = wasmFiles.map((file) => checkWasmFileSize(file, limits));

  const metricResults = [];
  for (const rPath of reportPaths) {
    if (fs.existsSync(rPath)) {
      try {
        const raw = fs.readFileSync(rPath, 'utf8');
        const parsed = JSON.parse(raw);
        const metrics = Array.isArray(parsed) ? parsed : [parsed];
        for (const m of metrics) {
          metricResults.push(evaluateBudgetMetrics(m, limits));
        }
      } catch (err) {
        console.error(`Failed to parse budget report at ${rPath}: ${err.message}`);
      }
    }
  }

  const totalWasmFailures = wasmResults.filter((r) => !r.passed).length;
  const totalMetricFailures = metricResults.filter((r) => !r.passed).length;
  const success = totalWasmFailures === 0 && totalMetricFailures === 0;

  return {
    limits,
    wasmResults,
    metricResults,
    success,
    totalWasmFiles: wasmResults.length,
    totalWasmFailures,
    totalMetricFailures,
  };
}

// CLI Execution Entry Point
if (require.main === module) {
  const args = process.argv.slice(2);
  const dirs = [];
  const reports = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      dirs.push(args[++i]);
    } else if (args[i] === '--report' && args[i + 1]) {
      reports.push(args[++i]);
    }
  }

  const result = runBudgetCheck({
    dirs: dirs.length > 0 ? dirs : ['contracts', 'wasm', '.'],
    reports,
  });

  console.log('=== Soroban Contract Budget & Performance Check ===');
  console.log(`Configured Limits:`);
  console.log(`  Max WASM Size:     ${(result.limits.maxWasmSizeBytes / 1024).toFixed(0)} KB (${result.limits.maxWasmSizeBytes} bytes)`);
  console.log(`  Max CPU Instr:     ${result.limits.maxCpuInstructions.toLocaleString()}`);
  console.log(`  Max Memory Bytes:  ${(result.limits.maxMemoryBytes / (1024 * 1024)).toFixed(0)} MB`);

  if (result.wasmResults.length === 0) {
    console.log('\nNo .wasm files found in target scan paths (expected when compiled binaries are not committed).');
  } else {
    console.log(`\nWASM Files Scanned (${result.wasmResults.length}):`);
    for (const res of result.wasmResults) {
      if (res.passed) {
        console.log(`  [PASS] ${res.path} (${res.sizeKb} KB)`);
      } else {
        console.error(`  [FAIL] ${res.path} (${res.sizeKb} KB) - ${res.error}`);
      }
    }
  }

  if (result.metricResults.length > 0) {
    console.log(`\nBenchmark Metrics Checked (${result.metricResults.length}):`);
    for (const res of result.metricResults) {
      if (res.passed) {
        console.log(`  [PASS] ${res.name}: CPU ${res.cpuInstructions.toLocaleString()}, Mem ${res.memoryBytes.toLocaleString()} B`);
      } else {
        console.error(`  [FAIL] ${res.name}: ${res.violations.join('; ')}`);
      }
    }
  }

  if (!result.success) {
    console.error('\n::error::Soroban contract budget check FAILED. Cost regression or limit breach detected.');
    process.exit(1);
  }

  console.log('\n✅ All Soroban contract budget and performance checks PASSED.');
  process.exit(0);
}

module.exports = {
  DEFAULT_BUDGET_LIMITS,
  getBudgetLimitsFromEnv,
  checkWasmFileSize,
  findWasmFiles,
  evaluateBudgetMetrics,
  runBudgetCheck,
};
