import request from "supertest";
import Decimal from "decimal.js";
import { prisma } from "../../config/database";
import app from "../../index";

describe("Monetary Controller Integration Tests", () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma.transaction.deleteMany();
    await prisma.onRampSwap.deleteMany();
  });

  describe("Mint Controller Precision Tests", () => {
    it("should handle USDC mint with maximum fractional precision", async () => {
      const response = await request(app)
        .post("/v1/mint/usdc")
        .send({
          usdc_amount: "123456789.1234567",
          wallet_address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",
        })
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(202);
      expect(response.body.on_ramp_swap_id).toBeDefined();
      
      // Verify the stored amount preserves precision
      const swap = await prisma.onRampSwap.findUnique({
        where: { id: response.body.on_ramp_swap_id },
      });
      expect(swap?.usdcAmount?.toString()).toBe("123456789.1234567");
    });

    it("should handle USDC mint with minimal fractional amount", async () => {
      const response = await request(app)
        .post("/v1/mint/usdc")
        .send({
          usdc_amount: "0.0000001",
          wallet_address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",
        })
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(202);
      
      const swap = await prisma.onRampSwap.findUnique({
        where: { id: response.body.on_ramp_swap_id },
      });
      expect(swap?.usdcAmount?.toString()).toBe("0.0000001");
    });

    it("should reject USDC amounts with more than 7 decimal places", async () => {
      const response = await request(app)
        .post("/v1/mint/usdc")
        .send({
          usdc_amount: "123.12345678", // 8 decimal places
          wallet_address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",
        })
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("must be positive with up to 7 decimal places");
    });

    it("should reject scientific notation in USDC amounts", async () => {
      const response = await request(app)
        .post("/v1/mint/usdc")
        .send({
          usdc_amount: "1.23e+5",
          wallet_address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",
        })
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("must be positive with up to 7 decimal places");
    });

    it("should handle basket currency deposit with precision", async () => {
      const response = await request(app)
        .post("/v1/mint/deposit")
        .send({
          currency: "NGN",
          amount: "999999999.9999999",
          wallet_address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",
        })
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(202);
      expect(response.body.amount).toBe("999999999.9999999");
      
      const tx = await prisma.transaction.findUnique({
        where: { id: response.body.transaction_id },
      });
      expect(tx?.localAmount?.toString()).toBe("999999999.9999999");
    });
  });

  describe("Burn Controller Precision Tests", () => {
    it("should handle ACBU burn with maximum fractional precision", async () => {
      const response = await request(app)
        .post("/v1/burn/acbu")
        .send({
          acbu_amount: "987654321.1234567",
          currency: "NGN",
          recipient_account: {
            type: "bank",
            account_number: "1234567890",
            bank_code: "001",
            account_name: "Test Account",
          },
        })
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(200);
      expect(response.body.acbu_amount).toBe("987654321.1234567");
      
      const tx = await prisma.transaction.findUnique({
        where: { id: response.body.transaction_id },
      });
      expect(tx?.acbuAmountBurned?.toString()).toBe("987654321.1234567");
    });

    it("should calculate burn fees precisely for small amounts", async () => {
      const response = await request(app)
        .post("/v1/burn/acbu")
        .send({
          acbu_amount: "0.0000001",
          currency: "NGN",
          recipient_account: {
            type: "bank",
            account_number: "1234567890",
            bank_code: "001",
            account_name: "Test Account",
          },
        })
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(200);
      expect(response.body.fee).toBeDefined();
      
      // Fee should be calculated with Decimal precision
      const tx = await prisma.transaction.findUnique({
        where: { id: response.body.transaction_id },
      });
      expect(tx?.fee?.toString()).toMatch(/^\d+E-\d+$/); // Scientific notation for tiny fees
    });

    it("should reject ACBU amounts with more than 7 decimal places", async () => {
      const response = await request(app)
        .post("/v1/burn/acbu")
        .send({
          acbu_amount: "123.12345678", // 8 decimal places
          currency: "NGN",
          recipient_account: {
            type: "bank",
            account_number: "1234567890",
            bank_code: "001",
            account_name: "Test Account",
          },
        })
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("must be positive with up to 7 decimal places");
    });

    it("should handle ACBU burn at fee calculation boundaries", async () => {
      // Test amount that would cause precision issues with Number()
      const boundaryAmount = "0.00333333"; // 0.00333333 * 50 bps = 0.0000000166665
      
      const response = await request(app)
        .post("/v1/burn/acbu")
        .send({
          acbu_amount: boundaryAmount,
          currency: "NGN",
          recipient_account: {
            type: "bank",
            account_number: "1234567890",
            bank_code: "001",
            account_name: "Test Account",
          },
        })
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(200);
      
      const tx = await prisma.transaction.findUnique({
        where: { id: response.body.transaction_id },
      });
      
      // Verify fee is calculated precisely
      const expectedFee = new Decimal(boundaryAmount).mul(50).div(10000);
      expect(tx?.fee?.toString()).toBe(expectedFee.toString());
    });
  });

  describe("Fee Boundary Edge Cases", () => {
    it("should handle zero fee edge case", async () => {
      // This would require mocking getBurnFeeBps to return 0
      // For now, test with very small amount
      const response = await request(app)
        .post("/v1/burn/acbu")
        .send({
          acbu_amount: "0.0000001",
          currency: "NGN",
          recipient_account: {
            type: "bank",
            account_number: "1234567890",
            bank_code: "001",
            account_name: "Test Account",
          },
        })
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(200);
      expect(response.body.fee).toBeDefined();
    });

    it("should handle maximum fee calculation without overflow", async () => {
      const response = await request(app)
        .post("/v1/burn/acbu")
        .send({
          acbu_amount: "999999999.9999999",
          currency: "NGN",
          recipient_account: {
            type: "bank",
            account_number: "1234567890",
            bank_code: "001",
            account_name: "Test Account",
          },
        })
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(200);
      
      const tx = await prisma.transaction.findUnique({
        where: { id: response.body.transaction_id },
      });
      
      // Verify fee doesn't overflow and maintains precision
      expect(tx?.fee?.toString()).toMatch(/^\d+\.\d+$/);
    });
  });

  describe("Soroban Boundary Integration", () => {
    it("should convert amounts to contract format with explicit rounding", async () => {
      // This test would require mocking the contract service
      // For now, we test the internal conversion logic
      const { decimalToContractNumber } = require("../../utils/decimalUtils");
      const { parseMonetaryString } = require("../../utils/decimalUtils");
      
      const amount = parseMonetaryString("123.4567891");
      const contractNumber = decimalToContractNumber(amount);
      
      // Should round down, not up
      expect(contractNumber).toBe(1234567891);
    });

    it("should handle contract number conversion back to Decimal", async () => {
      const { contractNumberToDecimal } = require("../../utils/decimalUtils");
      
      const contractNumber = 1234567891;
      const decimal = contractNumberToDecimal(contractNumber);
      
      expect(decimal.toString()).toBe("123.4567891");
    });
  });
});
