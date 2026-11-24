import v8 from "v8";
import fs from "fs";
import path from "path";
import { logger } from "../config/logger";
import { heapUsedRatioGauge, heapDumpCounter } from "../config/promMetrics";
import { config } from "../config/env";

const WARN_THRESHOLD_PCT = config.memory.leakThresholdPct;
const CRITICAL_THRESHOLD_PCT = Math.min(WARN_THRESHOLD_PCT + 10, 98);
const CHECK_INTERVAL_MS = config.memory.checkIntervalMs;
const HEAP_DUMP_DIR = config.memory.heapDumpDir;

let lastDumpAt = 0;
const MIN_DUMP_INTERVAL_MS = 5 * 60 * 1000;

function getEffectiveHeapLimitBytes(): number {
  const stats = v8.getHeapStatistics();
  // heap_size_limit reflects --max-old-space-size when set, otherwise V8 default
  return stats.heap_size_limit;
}

function writeHeapSnapshot(): string | null {
  try {
    if (!fs.existsSync(HEAP_DUMP_DIR)) {
      fs.mkdirSync(HEAP_DUMP_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = path.join(HEAP_DUMP_DIR, `heap-${timestamp}.heapsnapshot`);
    v8.writeHeapSnapshot(filename);
    heapDumpCounter.inc();
    return filename;
  } catch (err) {
    logger.error("Failed to write heap snapshot", { error: (err as Error).message });
    return null;
  }
}

function checkHeap(): void {
  const mem = process.memoryUsage();
  const heapLimit = getEffectiveHeapLimitBytes();
  const usedPct = heapLimit > 0 ? (mem.heapUsed / heapLimit) * 100 : 0;

  heapUsedRatioGauge.set(usedPct / 100);

  const stats = {
    heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
    heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(1),
    heapLimitMB: (heapLimit / 1024 / 1024).toFixed(1),
    rssMB: (mem.rss / 1024 / 1024).toFixed(1),
    usedPct: usedPct.toFixed(1),
  };

  if (usedPct >= CRITICAL_THRESHOLD_PCT) {
    const now = Date.now();
    const dumpPath = now - lastDumpAt > MIN_DUMP_INTERVAL_MS ? writeHeapSnapshot() : null;
    if (dumpPath) lastDumpAt = now;

    logger.error("CRITICAL: heap usage above threshold — possible memory leak", {
      ...stats,
      criticalThresholdPct: CRITICAL_THRESHOLD_PCT,
      heapSnapshot: dumpPath ?? "skipped (too soon since last dump)",
    });
  } else if (usedPct >= WARN_THRESHOLD_PCT) {
    logger.warn("Heap usage approaching limit", {
      ...stats,
      warnThresholdPct: WARN_THRESHOLD_PCT,
    });
  }
}

export function startMemoryMonitor(): NodeJS.Timeout {
  const heapLimitMB = (getEffectiveHeapLimitBytes() / 1024 / 1024).toFixed(0);
  logger.info("Memory monitor started", {
    heapLimitMB,
    warnThresholdPct: WARN_THRESHOLD_PCT,
    criticalThresholdPct: CRITICAL_THRESHOLD_PCT,
    checkIntervalMs: CHECK_INTERVAL_MS,
    heapDumpDir: HEAP_DUMP_DIR,
  });

  checkHeap();
  return setInterval(checkHeap, CHECK_INTERVAL_MS);
}

export function stopMemoryMonitor(handle: NodeJS.Timeout): void {
  clearInterval(handle);
}
