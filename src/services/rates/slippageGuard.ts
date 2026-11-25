/**
 * Slippage guard for cross-border currency conversions (W11-AUD-019).
 *
 * During multi-step conversion flows the exchange rate used at quote time may
 * differ from the rate available at execution time. A large rate shift can
 * leave a transaction partially funded or result in the user receiving less
 * than expected.
 *
 * This module provides a pure utility for checking whether the observed rate
 * shift between quote and execution exceeds a configured maximum slippage
 * tolerance. It has no side-effects and no external dependencies so it can
 * be called at any point in a transaction pipeline.
 */

export interface SlippageCheckParams {
  /** Exchange rate captured at quote time (must be a positive finite number). */
  rateAtQuote: number;
  /** Exchange rate observed at execution time (must be a positive finite number). */
  rateAtExecution: number;
  /**
   * Maximum allowed slippage as a percentage (e.g. 3 means 3 %).
   * Must be a non-negative finite number. Use 0 to reject any rate change.
   */
  maxSlippagePct: number;
}

export interface SlippageCheckResult {
  /** True when the observed slippage strictly exceeds maxSlippagePct. */
  exceeded: boolean;
  /** Absolute percentage change between quote and execution rates. */
  slippagePct: number;
}

/**
 * Determine whether the rate shift between quote and execution time exceeds
 * the configured slippage bound.
 *
 * Uses absolute percentage change so it catches both favourable and
 * unfavourable shifts — an unexpectedly large favourable shift is also a
 * signal that the rate feed may be unreliable.
 *
 * @throws {Error} when rateAtQuote or rateAtExecution are not positive finite numbers,
 *   or when maxSlippagePct is negative or non-finite.
 */
export function isSlippageExceedingBound(params: SlippageCheckParams): SlippageCheckResult {
  const { rateAtQuote, rateAtExecution, maxSlippagePct } = params;

  if (!Number.isFinite(rateAtQuote) || rateAtQuote <= 0) {
    throw new Error(`rateAtQuote must be a positive finite number, got ${rateAtQuote}`);
  }
  if (!Number.isFinite(rateAtExecution) || rateAtExecution <= 0) {
    throw new Error(`rateAtExecution must be a positive finite number, got ${rateAtExecution}`);
  }
  if (!Number.isFinite(maxSlippagePct) || maxSlippagePct < 0) {
    throw new Error(`maxSlippagePct must be a non-negative finite number, got ${maxSlippagePct}`);
  }

  const slippagePct = Math.abs((rateAtExecution - rateAtQuote) / rateAtQuote) * 100;
  return {
    exceeded: slippagePct > maxSlippagePct,
    slippagePct,
  };
}
