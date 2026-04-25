import Decimal from "decimal.js";

/**
 * Decimal configuration for monetary calculations with high precision
 */
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_DOWN,
  modulo: Decimal.ROUND_DOWN,
  toExpNeg: -7,
  toExpPos: 21,
});

/**
 * Parse a string to Decimal with validation for monetary amounts
 * @param value - String value to parse
 * @param fieldName - Field name for error messages
 * @returns Decimal instance
 * @throws Error if value is invalid
 */
export function parseMonetaryString(value: string, fieldName = "amount"): Decimal {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }

  // Trim whitespace
  const trimmed = value.trim();
  
  // Validate format (no scientific notation, reasonable decimal places)
  if (!trimmed || !/^\d+(\.\d{1,7})?$/.test(trimmed)) {
    throw new Error(
      `${fieldName} must be a positive number with up to 7 decimal places`
    );
  }

  try {
    const decimal = new Decimal(trimmed);
    
    if (decimal.lte(0)) {
      throw new Error(`${fieldName} must be positive`);
    }

    return decimal;
  } catch (error) {
    throw new Error(`Invalid ${fieldName}: ${trimmed}`);
  }
}

/**
 * Convert Decimal to number for Soroban contract calls with explicit rounding
 * @param decimal - Decimal value
 * @param decimals - Number of decimal places for the contract (default 7)
 * @returns Number formatted for contract
 */
export function decimalToContractNumber(
  decimal: Decimal,
  decimals: number = 7
): number {
  const scaled = decimal.mul(new Decimal(10).pow(decimals));
  return scaled.toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();
}

/**
 * Convert contract number back to Decimal
 * @param contractNumber - Number from contract
 * @param decimals - Number of decimal places the contract uses (default 7)
 * @returns Decimal instance
 */
export function contractNumberToDecimal(
  contractNumber: number,
  decimals: number = 7
): Decimal {
  return new Decimal(contractNumber).div(new Decimal(10).pow(decimals));
}

/**
 * Calculate fee amount with precise decimal arithmetic
 * @param amount - Base amount as Decimal
 * @param feeBps - Fee in basis points
 * @returns Fee amount as Decimal
 */
export function calculateFee(amount: Decimal, feeBps: number): Decimal {
  return amount.mul(new Decimal(feeBps)).div(new Decimal(10000));
}

/**
 * Validate amount is within limits using Decimal precision
 * @param amount - Amount to validate
 * @param min - Minimum amount
 * @param max - Maximum amount
 * @param fieldName - Field name for error messages
 */
export function validateAmountRange(
  amount: Decimal,
  min: Decimal,
  max: Decimal,
  fieldName = "amount"
): void {
  if (amount.lt(min)) {
    throw new Error(
      `${fieldName} must be at least ${min.toString()}`
    );
  }
  
  if (amount.gt(max)) {
    throw new Error(
      `${fieldName} must be at most ${max.toString()}`
    );
  }
}
