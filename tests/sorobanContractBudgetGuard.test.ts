import path from 'path';
import fs from 'fs';
import {
  DEFAULT_BUDGET_LIMITS,
  getBudgetLimitsFromEnv,
  checkWasmFileSize,
  evaluateBudgetMetrics,
  runBudgetCheck,
} from '../scripts/ci/check-contract-budget';

describe('Soroban Contract Budget & Performance Guard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Budget Limits & Environment Overrides', () => {
    it('uses default budget limits when no env vars or overrides are set', () => {
      delete process.env.MAX_WASM_SIZE_KB;
      delete process.env.MAX_WASM_SIZE_BYTES;
      delete process.env.MAX_CPU_INSTRUCTIONS;
      delete process.env.MAX_MEMORY_BYTES;

      const limits = getBudgetLimitsFromEnv();
      expect(limits.maxWasmSizeBytes).toEqual(262144); // 256 KB
      expect(limits.maxCpuInstructions).toEqual(100000000); // 100M
      expect(limits.maxMemoryBytes).toEqual(41943040); // 40 MB
    });

    it('respects environment variable overrides', () => {
      process.env.MAX_WASM_SIZE_KB = '500';
      process.env.MAX_CPU_INSTRUCTIONS = '50000000';
      process.env.MAX_MEMORY_BYTES = '20971520';

      const limits = getBudgetLimitsFromEnv();
      expect(limits.maxWasmSizeBytes).toEqual(500 * 1024);
      expect(limits.maxCpuInstructions).toEqual(50000000);
      expect(limits.maxMemoryBytes).toEqual(20971520);
    });
  });

  describe('checkWasmFileSize', () => {
    const tempDir = path.join(__dirname, '../tmp-budget-test');
    const validWasmPath = path.join(tempDir, 'valid.wasm');
    const oversizedWasmPath = path.join(tempDir, 'oversized.wasm');

    beforeAll(() => {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      // Create a 10 KB file
      fs.writeFileSync(validWasmPath, Buffer.alloc(10 * 1024));
      // Create a 300 KB file (> 256 KB limit)
      fs.writeFileSync(oversizedWasmPath, Buffer.alloc(300 * 1024));
    });

    afterAll(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('passes for WASM files within budget limit', () => {
      const result = checkWasmFileSize(validWasmPath, DEFAULT_BUDGET_LIMITS);
      expect(result.passed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.sizeBytes).toEqual(10 * 1024);
    });

    it('fails for WASM files exceeding budget limit', () => {
      const result = checkWasmFileSize(oversizedWasmPath, DEFAULT_BUDGET_LIMITS);
      expect(result.passed).toBe(false);
      expect(result.error).toContain('exceeds limit');
    });

    it('handles non-existent WASM files cleanly', () => {
      const result = checkWasmFileSize(path.join(tempDir, 'nonexistent.wasm'), DEFAULT_BUDGET_LIMITS);
      expect(result.passed).toBe(false);
      expect(result.error).toEqual('File not found');
    });
  });

  describe('evaluateBudgetMetrics', () => {
    it('passes compliant metrics', () => {
      const metric = {
        name: 'Mint Contract Invocation',
        cpuInstructions: 15000000,
        memoryBytes: 5000000,
        readBytes: 50000,
        writeBytes: 10000,
      };

      const result = evaluateBudgetMetrics(metric, DEFAULT_BUDGET_LIMITS);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('fails when CPU instruction limit is breached', () => {
      const metric = {
        name: 'Heavy Computation Contract',
        cpuInstructions: 150000000, // 150M > 100M limit
        memoryBytes: 5000000,
      };

      const result = evaluateBudgetMetrics(metric, DEFAULT_BUDGET_LIMITS);
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain('CPU instructions');
    });

    it('fails when Memory limit is breached', () => {
      const metric = {
        name: 'Memory Heavy Contract',
        cpuInstructions: 10000000,
        memoryBytes: 50000000, // 50MB > 40MB limit
      };

      const result = evaluateBudgetMetrics(metric, DEFAULT_BUDGET_LIMITS);
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain('Memory bytes');
    });
  });

  describe('runBudgetCheck', () => {
    const tempDir = path.join(__dirname, '../tmp-runner-test');
    const reportPath = path.join(tempDir, 'budget-report.json');

    beforeAll(() => {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      fs.writeFileSync(
        reportPath,
        JSON.stringify([
          { name: 'Transfer Op', cpuInstructions: 2000000, memoryBytes: 1000000 },
          { name: 'Swap Op', cpuInstructions: 5000000, memoryBytes: 2000000 },
        ])
      );
    });

    afterAll(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('executes full budget check over directories and reports', () => {
      const result = runBudgetCheck({
        dirs: [tempDir],
        reports: [reportPath],
      });

      expect(result.success).toBe(true);
      expect(result.metricResults).toHaveLength(2);
      expect(result.totalMetricFailures).toBe(0);
    });
  });
});
