import { describe, it, expect } from "vitest";
import type { PublicAssetsConfig } from "../api/config";
import {
  DEFAULT_FEE_RATES,
  describePercentFee,
  formatFeeRate,
  getBurnFeeRate,
  getBurnFeeText,
  getMintFeeRate,
  getMintFeeText,
  getTransferNetworkFeeText,
} from "../fee-text";

function withFees(fees: PublicAssetsConfig["fees"]): PublicAssetsConfig {
  return {
    acbu: { code: "ACBU", issuer: null },
    demo_fiat: { issuer: null },
    stellar: { network_passphrase: "Test", horizon_url: null },
    fees,
  };
}

describe("fee-text", () => {
  it("defaults to the documented 0.3% mint/burn and free P2P schedule", () => {
    expect(DEFAULT_FEE_RATES).toEqual({ mint: 0.003, burn: 0.003 });
    expect(getMintFeeText(null)).toBe("0.3%");
    expect(getBurnFeeText(null)).toBe("0.3%");
    expect(getTransferNetworkFeeText(null)).toBe("Free");
  });

  it("never falls back to vague 'estimated'/'calculated' copy", () => {
    for (const text of [getMintFeeText(null), getBurnFeeText(null)]) {
      expect(text).not.toMatch(/estimated|calculated/i);
    }
  });

  it("includes the fee on a positive amount", () => {
    expect(getMintFeeText(null, "1000", "NGN")).toBe("0.3% (≈ NGN 3)");
    expect(getBurnFeeText(null, 250)).toBe("0.3% (≈ ACBU 0.75)");
  });

  it("ignores empty, zero and invalid amounts", () => {
    for (const amount of ["", "0", "-5", "abc", null, undefined]) {
      expect(getBurnFeeText(null, amount)).toBe("0.3%");
    }
  });

  it("uses a valid backend fee_rate and ignores invalid ones", () => {
    expect(getMintFeeRate(withFees({ mint: { fee_rate: 0.005 } }))).toBe(0.005);
    expect(getBurnFeeRate(withFees({ burn: { fee_rate: 0.001 } }))).toBe(0.001);
    expect(getMintFeeText(withFees({ mint: { fee_rate: 0.005 } }), 100, "USD")).toBe(
      "0.5% (≈ USD 0.5)",
    );
    for (const bad of [-0.1, 1, Number.NaN, null]) {
      expect(getBurnFeeRate(withFees({ burn: { fee_rate: bad } }))).toBe(0.003);
    }
  });

  it("prefers backend-provided fee text", () => {
    const config = withFees({
      mint_network_fee_text: "0.25% promo",
      burn: { processing_fee_text: "  0.3% + bank charges " },
      transfer: { fee_text: "Free (sponsored)" },
    });
    expect(getMintFeeText(config, 1000, "NGN")).toBe("0.25% promo");
    expect(getBurnFeeText(config, 1000)).toBe("0.3% + bank charges");
    expect(getTransferNetworkFeeText(config)).toBe("Free (sponsored)");
  });

  it("formats rates without float noise", () => {
    expect(formatFeeRate(0.003)).toBe("0.3%");
    expect(formatFeeRate(0.0125)).toBe("1.25%");
    expect(formatFeeRate(0)).toBe("0%");
    expect(describePercentFee(0.003, 10)).toBe("0.3% (≈ 0.03)");
  });
});
