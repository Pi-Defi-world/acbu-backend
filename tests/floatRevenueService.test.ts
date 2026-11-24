import Decimal from "decimal.js";
import {
  FloatRevenueService,
  PartnerSegregatedReserve,
  RevenueProjectionInputs,
  BreakevenAnalysisInputs,
} from "../src/services/treasury/floatRevenueService";

describe("FloatRevenueService (W10-S-012)", () => {
  describe("Partner Float Yield & Contractual Entitlement", () => {
    it("should return $0 protocol revenue when contractual entitlement is NOT confirmed", () => {
      // In §4.3, reserves are segregated in partner bank accounts.
      // Under banking law, interest accrues to the partner unless explicitly assigned to ACBU.
      const unentitledPartner: PartnerSegregatedReserve = {
        partnerId: "partner-ngn-01",
        partnerName: "Nigeria Custody Partner",
        currency: "NGN",
        reserveAmountLocal: new Decimal("20000000000"), // 20B NGN
        reserveAmountUsd: new Decimal("15000000"), // $15M USD
        hasContractualEntitlement: false, // No PRIA agreement
        partnerRetentionBps: 2500,
        protocolShareBps: 7500,
        annualYieldRateBps: 1000, // 10.00% APY
      };

      const result = FloatRevenueService.calculatePartnerFloatYield(unentitledPartner);

      // Gross interest is $1.5M ($15M * 10%)
      expect(result.grossInterestUsd.toString()).toBe("1500000");
      // Protocol gets $0 because interest accrues to partner
      expect(result.protocolYieldUsd.toString()).toBe("0");
      // Partner retains 100% of the yield
      expect(result.partnerYieldUsd.toString()).toBe("1500000");
    });

    it("should distribute yield according to PRIA terms when contractual entitlement is confirmed", () => {
      const entitledPartner: PartnerSegregatedReserve = {
        partnerId: "partner-kes-01",
        partnerName: "Kenya Trust Partner",
        currency: "KES",
        reserveAmountLocal: new Decimal("2600000000"), // 2.6B KES
        reserveAmountUsd: new Decimal("20000000"), // $20M USD
        hasContractualEntitlement: true,
        agreementReference: "PRIA-KES-2026-004",
        partnerRetentionBps: 2000, // 20% retained by partner for regulatory capital
        protocolShareBps: 8000, // 80% remitted to ACBU treasury
        annualYieldRateBps: 900, // 9.00% APY
      };

      const result = FloatRevenueService.calculatePartnerFloatYield(entitledPartner);

      // Gross interest: $20M * 9% = $1.8M
      expect(result.grossInterestUsd.toString()).toBe("1800000");
      // Protocol share: $1.8M * 80% = $1.44M
      expect(result.protocolYieldUsd.toString()).toBe("1440000");
      // Partner retention: $1.8M * 20% = $360,000
      expect(result.partnerYieldUsd.toString()).toBe("360000");
      // Sum matches gross
      expect(result.protocolYieldUsd.plus(result.partnerYieldUsd).toString()).toBe("1800000");
    });

    it("should accurately process a portfolio of mixed entitled and unentitled partners", () => {
      const partners: PartnerSegregatedReserve[] = [
        {
          partnerId: "ngn-partner",
          partnerName: "NGN Bank",
          currency: "NGN",
          reserveAmountLocal: new Decimal("10000000000"),
          reserveAmountUsd: new Decimal("10000000"), // $10M
          hasContractualEntitlement: false, // Uncontracted -> $0 to protocol
          partnerRetentionBps: 0,
          protocolShareBps: 10000,
          annualYieldRateBps: 1200, // 12% = $1.2M gross
        },
        {
          partnerId: "zar-partner",
          partnerName: "ZAR Custodian",
          currency: "ZAR",
          reserveAmountLocal: new Decimal("180000000"),
          reserveAmountUsd: new Decimal("10000000"), // $10M
          hasContractualEntitlement: true, // Contracted -> 70% to protocol
          agreementReference: "PRIA-ZAR-01",
          partnerRetentionBps: 3000,
          protocolShareBps: 7000,
          annualYieldRateBps: 800, // 8% = $800k gross -> $560k protocol
        },
      ];

      const projectionInputs: RevenueProjectionInputs = {
        annualizedVolumeUsd: new Decimal("100000000"), // $100M volume
        blendedTakeRateBps: 95, // 0.95%
        investmentSavingsYieldUsd: new Decimal("200000"), // $200k from investment_savings
        partnerReserves: partners,
      };

      const result = FloatRevenueService.calculateRevenueProjection(
        projectionInputs,
        "contractual",
      );

      // Fee revenue: $100M * 0.95% = $950,000
      expect(result.transactionFeeRevenueUsd.toString()).toBe("950000");
      // Gross interest: $1.2M + $0.8M = $2,000,000
      expect(result.grossPartnerFloatInterestUsd.toString()).toBe("2000000");
      // Recognized float interest: only the ZAR partner's 70% = $560,000
      expect(result.recognizedFloatInterestUsd.toString()).toBe("560000");
      // Partner retained: $1.2M (unentitled NGN) + $240k (ZAR 30%) = $1,440,000
      expect(result.partnerRetainedInterestUsd.toString()).toBe("1440000");
      // Total revenue: $950k (fees) + $200k (savings yield) + $560k (contracted float) = $1,710,000
      expect(result.totalProtocolRevenueUsd.toString()).toBe("1710000");
    });

    it("should throw RangeError when entitled partner has invalid PRIA split", () => {
      const invalidSplitPartner: PartnerSegregatedReserve = {
        partnerId: "partner-bad-split",
        partnerName: "Bad Split Partner",
        currency: "ZAR",
        reserveAmountLocal: new Decimal("10000000"),
        reserveAmountUsd: new Decimal("1000000"),
        hasContractualEntitlement: true,
        agreementReference: "PRIA-BAD-01",
        partnerRetentionBps: 1000, // 10% is below the mandatory 20%–30% policy range
        protocolShareBps: 9000,
        annualYieldRateBps: 500,
      };

      expect(() =>
        FloatRevenueService.calculatePartnerFloatYield(invalidSplitPartner),
      ).toThrow(RangeError);
    });

    it("should throw RangeError when PRIA split does not sum to 10000 bps", () => {
      const invalidSumPartner: PartnerSegregatedReserve = {
        partnerId: "partner-bad-sum",
        partnerName: "Bad Sum Partner",
        currency: "KES",
        reserveAmountLocal: new Decimal("10000000"),
        reserveAmountUsd: new Decimal("1000000"),
        hasContractualEntitlement: true,
        partnerRetentionBps: 2500,
        protocolShareBps: 7000, // Sum = 9500 !== 10000
        annualYieldRateBps: 500,
      };

      expect(() =>
        FloatRevenueService.calculatePartnerFloatYield(invalidSumPartner),
      ).toThrow(RangeError);
    });
  });

  describe("Conservative Baseline vs Flawed Model Projections", () => {
    it("should zero out all float interest by default (conservative mode) even with entitled reserves", () => {
      const partner: PartnerSegregatedReserve = {
        partnerId: "ghs-partner",
        partnerName: "Ghana Partner",
        currency: "GHS",
        reserveAmountLocal: new Decimal("150000000"),
        reserveAmountUsd: new Decimal("10000000"),
        hasContractualEntitlement: true,
        agreementReference: "PRIA-GHS-01",
        partnerRetentionBps: 2000,
        protocolShareBps: 8000,
        annualYieldRateBps: 1500, // 15%
      };

      const inputs: RevenueProjectionInputs = {
        annualizedVolumeUsd: new Decimal("200000000"),
        blendedTakeRateBps: 90,
        investmentSavingsYieldUsd: new Decimal("300000"),
        partnerReserves: [partner],
      };

      // Default (no second argument) should be conservative baseline ($0 recognized float interest)
      const baseline = FloatRevenueService.calculateRevenueProjection(inputs);

      expect(baseline.isConservativeBaseline).toBe(true);
      expect(baseline.recognizedFloatInterestUsd.toString()).toBe("0");
      expect(baseline.partnerRetainedInterestUsd.toString()).toBe("1500000");
      expect(baseline.totalProtocolRevenueUsd.toString()).toBe(
        baseline.transactionFeeRevenueUsd.plus(baseline.investmentSavingsYieldUsd).toString(),
      );
    });
  });

  describe("Breakeven Analysis & Math Rectification", () => {
    const ANNUAL_OPEX = new Decimal("4200000"); // $4.2M annual OpEx
    const TAKE_RATE_BPS = 95; // 0.95% blended fee take-rate

    it("should demonstrate how flawed float-interest assumptions artificially lowered breakeven volume", () => {
      // The flawed model assumed $3.5M in float interest without contractual backing
      const flawedInputs: BreakevenAnalysisInputs = {
        annualOperatingExpensesUsd: ANNUAL_OPEX,
        blendedTakeRateBps: TAKE_RATE_BPS,
        confirmedFloatInterestUsd: new Decimal("3500000"), // Flawed assumption
      };

      const flawedResult = FloatRevenueService.calculateBreakevenVolume(flawedInputs);

      // Net revenue needed from volume was only $700,000
      expect(flawedResult.netRevenueRequiredFromVolumeUsd.toString()).toBe("700000");
      // Required volume appeared to be only ~$73.68M
      expect(flawedResult.requiredAnnualVolumeUsd.toNumber()).toBeCloseTo(73684210.5, 0);
    });

    it("should calculate correct breakeven volume under the conservative baseline ($0 float interest)", () => {
      // Under W10-S-012 resolution, unentitled partner float interest is removed ($0)
      const auditedBaselineInputs: BreakevenAnalysisInputs = {
        annualOperatingExpensesUsd: ANNUAL_OPEX,
        blendedTakeRateBps: TAKE_RATE_BPS,
        confirmedFloatInterestUsd: new Decimal("0"), // Zeroed out
        investmentSavingsYieldUsd: new Decimal("0"), // Conservative: no investment yield assumed
      };

      const baselineResult = FloatRevenueService.calculateBreakevenVolume(auditedBaselineInputs);

      // Full $4.2M OpEx must be covered by transaction fee volume
      expect(baselineResult.netRevenueRequiredFromVolumeUsd.toString()).toBe("4200000");
      // Required volume: $4.2M / 0.0095 ≈ $442,105,263.16 (~$442M)
      expect(baselineResult.requiredAnnualVolumeUsd.toNumber()).toBeCloseTo(442105263.16, 0);
    });

    it("should handle partial funding from genuine investment_savings yield without partner float", () => {
      // If $500,000 is earned from protocol-managed investment_savings segment
      const inputs: BreakevenAnalysisInputs = {
        annualOperatingExpensesUsd: ANNUAL_OPEX,
        blendedTakeRateBps: TAKE_RATE_BPS,
        confirmedFloatInterestUsd: new Decimal("0"), // No partner float
        investmentSavingsYieldUsd: new Decimal("500000"), // Verified protocol yield
      };

      const result = FloatRevenueService.calculateBreakevenVolume(inputs);

      // Remaining OpEx: $3.7M
      expect(result.netRevenueRequiredFromVolumeUsd.toString()).toBe("3700000");
      // Required volume: $3.7M / 0.0095 ≈ $389.47M
      expect(result.requiredAnnualVolumeUsd.toNumber()).toBeCloseTo(389473684.21, 0);
    });

    it("should throw RangeError when blendedTakeRateBps is zero or negative", () => {
      expect(() =>
        FloatRevenueService.calculateBreakevenVolume({
          annualOperatingExpensesUsd: ANNUAL_OPEX,
          blendedTakeRateBps: 0,
        }),
      ).toThrow(RangeError);

      expect(() =>
        FloatRevenueService.calculateBreakevenVolume({
          annualOperatingExpensesUsd: ANNUAL_OPEX,
          blendedTakeRateBps: -50,
        }),
      ).toThrow(RangeError);
    });
  });
});

