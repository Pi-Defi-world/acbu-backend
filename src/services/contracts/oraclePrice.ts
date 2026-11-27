/**
 * Validated oracle price handling for reserve math (W11-CAR-030).
 *
 * The acbu_reserve_tracker contract computes basket reserve sufficiency from
 * per-currency oracle prices. A zero, negative, or missing oracle price must
 * never reach that math: it either produces a false insufficiency (value = 0)
 * or a division-by-zero panic inside the contract. Every backend path that
 * reads an oracle price and feeds reserve values (custody valuation,
 * `update_reserve` writes, seeding) goes through these helpers.
 */

/** Atomic decimals used by the on-chain reserve/oracle fixed-point math. */
export const ORACLE_PRICE_SCALE = 10_000_000n; // 7 decimals

export class OraclePriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OraclePriceError";
  }
}

/**
 * Parse a raw on-chain oracle price (7-decimal atomic) and require it to be
 * strictly positive. Throws OraclePriceError on missing, non-numeric,
 * zero, or negative values.
 */
export function assertPositiveOraclePrice(
  rawPrice: bigint | string | number | null | undefined,
  currency: string,
): bigint {
  if (rawPrice === null || rawPrice === undefined) {
    throw new OraclePriceError(
      `Oracle price missing for ${currency}: refusing reserve math without a valid price`,
    );
  }

  let price: bigint;
  try {
    price = BigInt(rawPrice);
  } catch {
    throw new OraclePriceError(
      `Oracle price for ${currency} is not a valid integer: ${String(rawPrice)}`,
    );
  }

  if (price <= 0n) {
    throw new OraclePriceError(
      `Oracle price for ${currency} must be > 0 (got ${price}); refusing to compute reserve value`,
    );
  }

  return price;
}

/**
 * Compute the USD value of a custody amount using an oracle price, with
 * checked inputs: the price must be strictly positive and the amount
 * non-negative. Returns the 7-decimal atomic USD value.
 *
 * value_usd = (amount * oracle_price) / 1e7
 */
export function computeReserveValueUsd(
  amountAtomic: bigint,
  priceAtomic: bigint,
  currency: string,
): bigint {
  if (amountAtomic < 0n) {
    throw new OraclePriceError(`Reserve amount for ${currency} must be >= 0 (got ${amountAtomic})`);
  }

  const price = assertPositiveOraclePrice(priceAtomic, currency);

  return (amountAtomic * price) / ORACLE_PRICE_SCALE;
}

/**
 * Guard for `update_reserve` payloads: a currency holding a positive custody
 * amount must carry a positive USD value. A zero value alongside a positive
 * amount is the signature of a zero/missing oracle price and would corrupt
 * the contract's sufficiency check (`is_reserve_sufficient`).
 */
export function assertValidUpdateReservePayload(
  amountAtomic: bigint,
  valueUsdAtomic: bigint,
  currency: string,
): void {
  if (amountAtomic < 0n) {
    throw new OraclePriceError(
      `update_reserve amount for ${currency} must be >= 0 (got ${amountAtomic})`,
    );
  }
  if (valueUsdAtomic < 0n) {
    throw new OraclePriceError(
      `update_reserve value_usd for ${currency} must be >= 0 (got ${valueUsdAtomic})`,
    );
  }
  if (amountAtomic > 0n && valueUsdAtomic <= 0n) {
    throw new OraclePriceError(
      `update_reserve for ${currency} has amount ${amountAtomic} but value_usd ${valueUsdAtomic}: oracle price is zero or missing, refusing to overwrite reserve value`,
    );
  }
}
