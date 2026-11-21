import type { PublicAssetsConfig } from '@/lib/api/config';
import { formatAmount } from '@/lib/utils';

/**
 * Documented fee schedule (docs.md §12): 0.3% on mint and burn, P2P transfers
 * are free. The backend `/config/assets` response can override the rates or
 * the display text; these values are the fallback when it doesn't.
 */
export const DEFAULT_FEE_RATES = {
  mint: 0.003,
  burn: 0.003,
} as const;

const TRANSFER_FEE_TEXT = 'Free';

function firstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = value?.trim();
    if (text) return text;
  }
  return null;
}

function validRate(rate: number | null | undefined): number | null {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate < 1
    ? rate
    : null;
}

export function getMintFeeRate(config: PublicAssetsConfig | null): number {
  return validRate(config?.fees?.mint?.fee_rate) ?? DEFAULT_FEE_RATES.mint;
}

export function getBurnFeeRate(config: PublicAssetsConfig | null): number {
  return validRate(config?.fees?.burn?.fee_rate) ?? DEFAULT_FEE_RATES.burn;
}

/** 0.003 -> "0.3%" */
export function formatFeeRate(rate: number): string {
  return `${parseFloat((rate * 100).toFixed(4))}%`;
}

/**
 * "0.3%" or, when a positive amount is known, "0.3% (≈ NGN 3)".
 */
export function describePercentFee(
  rate: number,
  amount?: string | number | null,
  unit?: string | null,
): string {
  const pct = formatFeeRate(rate);
  const n = typeof amount === 'number' ? amount : parseFloat(amount ?? '');
  if (!(n > 0)) return pct;
  const fee = formatAmount(n * rate);
  return `${pct} (≈ ${unit ? `${unit} ` : ''}${fee})`;
}

/**
 * Mint fee text. Backend-provided text wins; otherwise the documented rate,
 * with the fee on `amount` (in `unit`, the currency being minted from).
 */
export function getMintFeeText(
  config: PublicAssetsConfig | null,
  amount?: string | number | null,
  unit?: string | null,
): string {
  return (
    firstText(
      config?.fees?.mint_network_fee_text,
      config?.fees?.mint?.network_fee_text,
      config?.fees?.mint?.fee_text,
    ) ?? describePercentFee(getMintFeeRate(config), amount, unit)
  );
}

/**
 * Burn fee text. Backend-provided text wins; otherwise the documented rate,
 * with the fee on `amount` ACBU.
 */
export function getBurnFeeText(
  config: PublicAssetsConfig | null,
  amount?: string | number | null,
): string {
  return (
    firstText(
      config?.fees?.burn_processing_fee_text,
      config?.fees?.burn?.processing_fee_text,
      config?.fees?.burn?.fee_text,
    ) ?? describePercentFee(getBurnFeeRate(config), amount, 'ACBU')
  );
}

export function getTransferNetworkFeeText(config: PublicAssetsConfig | null): string {
  return (
    firstText(
      config?.fees?.transfer_network_fee_text,
      config?.fees?.transfer?.network_fee_text,
      config?.fees?.transfer?.fee_text,
    ) ?? TRANSFER_FEE_TEXT
  );
}
