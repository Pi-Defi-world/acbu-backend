/**
 * F-058: Significant Digits Policy
 * Formats a number to a specific precision of significant digits.
 */
export const formatSignificantRate = (value: number | string, precision: number = 4): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(num) || num === 0) return "0.0000";

  // toPrecision(4) ensures 0.000045123 becomes "0.00004512" 
  // and 1250.400 becomes "1250"
  return Number(num.toPrecision(precision)).toString();
};