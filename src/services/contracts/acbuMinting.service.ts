import { xdr } from "@stellar/stellar-sdk";
import { prisma } from "../../config/database";
import { contractClient, ContractClient } from "../stellar/contractClient";
import { stellarClient } from "../stellar/client";
import { logger } from "../../config/logger";

/** Soroban `CurrencyCode` — tuple struct with one string field. */
function currencyCodeToScVal(code: string): xdr.ScVal {
  const c = code.trim().toUpperCase();
  if (c.length !== 3) {
    throw new Error("currency must be a 3-letter ISO code");
  }
  // CurrencyCode is a tuple-struct with a single field:
  //   CurrencyCode(pub Vec<String>)
  // Soroban encodes contracttype structs as an ScVal::Vec of fields, so we need:
  //   vec([ vec([ string("NGN") ]) ])
  return xdr.ScVal.scvVec([xdr.ScVal.scvVec([xdr.ScVal.scvString(c)])]);
}

export interface MintFromUsdcParams {
  txId?: string;
  user: string; // The caller/payer address
  usdcAmount: string; // Amount in smallest unit (7 decimals)
  recipient: string; // Stellar address to receive ACBU
}

export interface MintFromBasketParams {
  txId?: string;
  user: string;
  recipient: string;
  acbuAmount: string;
}

export interface MintFromSingleParams {
  txId?: string;
  user: string;
  recipient: string;
  currency: string;
  sTokenAmount: string;
}

/** Custodial mint: operator key signs; pulls demo fiat from minting contract custody. */
export interface MintFromDemoFiatParams {
  txId?: string;
  operator: string;
  recipient: string;
  currency: string;
  fiatAmount: string;
}

export interface AdminDripDemoFiatParams {
  txId?: string;
  recipient: string;
  currency: string;
  amount: string;
}

export class MintingService {
  private contractId: string;
  private contractClient: ContractClient;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.contractClient = contractClient;
  }

  /**
   * Mint ACBU from USDC deposit
   */
  async mintFromUsdc(params: MintFromUsdcParams): Promise<{
    transactionHash: string;
    acbuAmount: string;
  }> {
    try {
      logger.info("Minting ACBU from USDC", params);

      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      // Build function arguments: [user, usdc_amount, recipient]
      const args = [
        ContractClient.toScVal(params.user),
        ContractClient.toScVal(BigInt(params.usdcAmount)),
        ContractClient.toScVal(params.recipient),
      ];

      // Invoke contract
      const result = await this.contractClient.invokeContract({
        contractId: this.contractId,
        functionName: "mint_from_usdc",
        args,
        sourceAccount,
      });

      // Parse result (ACBU amount minted)
      const acbuAmount = ContractClient.fromScVal(result.result);

      logger.info("Minting successful", {
        transactionHash: result.transactionHash,
        acbuAmount: acbuAmount.toString(),
      });

      return {
        transactionHash: result.transactionHash,
        acbuAmount: acbuAmount.toString(),
      };
    } catch (error) {
      if ((params as any).txId) {
        try {
          await prisma.transaction.update({
            where: { id: (params as any).txId },
            data: { status: "failed" },
          });
          logger.info(`Compensated: Marked transaction ${(params as any).txId} as FAILED`);
        } catch (dbError) {
          logger.error("CRITICAL: DB compensation failed", { txId: (params as any).txId, dbError });
        }
      }
      logger.error("Failed to mint from USDC", { params, error });
      throw error;
    }
  }

  /**
   * Mint ACBU from basket deposit
   */
  async mintFromBasket(params: MintFromBasketParams): Promise<{
    transactionHash: string;
    acbuAmount: string;
  }> {
    try {
      logger.info("Minting ACBU from basket", params);

      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      // Build function arguments: [user, recipient, acbu_amount]
      const args = [
        ContractClient.toScVal(params.user),
        ContractClient.toScVal(params.recipient),
        ContractClient.toScVal(BigInt(params.acbuAmount)),
      ];

      // Invoke contract
      const result = await this.contractClient.invokeContract({
        contractId: this.contractId,
        functionName: "mint_from_basket",
        args,
        sourceAccount,
      });

      // Parse result
      const acbuAmount = ContractClient.fromScVal(result.result);

      logger.info("Basket minting successful", {
        transactionHash: result.transactionHash,
        acbuAmount: acbuAmount.toString(),
      });

      return {
        transactionHash: result.transactionHash,
        acbuAmount: acbuAmount.toString(),
      };
    } catch (error) {
      if ((params as any).txId) {
        try {
          await prisma.transaction.update({
            where: { id: (params as any).txId },
            data: { status: "failed" },
          });
          logger.info(`Compensated: Marked transaction ${(params as any).txId} as FAILED`);
        } catch (dbError) {
          logger.error("CRITICAL: DB compensation failed", { txId: (params as any).txId, dbError });
        }
      }
      logger.error("Failed to mint from basket", { params, error });
      throw error;
    }
  }

  /**
   * Mint ACBU from single S-token deposit
   */
  async mintFromSingle(params: MintFromSingleParams): Promise<{
    transactionHash: string;
    acbuAmount: string;
  }> {
    try {
      logger.info("Minting ACBU from single S-token", params);

      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      // Build function arguments: [user, recipient, currency, s_token_amount]
      const args = [
        ContractClient.toScVal(params.user),
        ContractClient.toScVal(params.recipient),
        ContractClient.toScVal(params.currency),
        ContractClient.toScVal(BigInt(params.sTokenAmount)),
      ];

      // Invoke contract
      const result = await this.contractClient.invokeContract({
        contractId: this.contractId,
        functionName: "mint_from_single",
        args,
        sourceAccount,
      });

      // Parse result
      const acbuAmount = ContractClient.fromScVal(result.result);

      logger.info("Single minting successful", {
        transactionHash: result.transactionHash,
        acbuAmount: acbuAmount.toString(),
      });

      return {
        transactionHash: result.transactionHash,
        acbuAmount: acbuAmount.toString(),
      };
    } catch (error) {
      if ((params as any).txId) {
        try {
          await prisma.transaction.update({
            where: { id: (params as any).txId },
            data: { status: "failed" },
          });
          logger.info(`Compensated: Marked transaction ${(params as any).txId} as FAILED`);
        } catch (dbError) {
          logger.error("CRITICAL: DB compensation failed", { txId: (params as any).txId, dbError });
        }
      }
      logger.error("Failed to mint from single", { params, error });
      throw error;
    }
  }

  /**
   * Custodial path: backend `operator` signs; contract pulls demo S-token from its own balance
   * and mints ACBU to `recipient` (same pricing as `mint_from_single`).
   */
  async mintFromDemoFiat(params: MintFromDemoFiatParams): Promise<{
    transactionHash: string;
    acbuAmount: string;
  }> {
    try {
      logger.info("Minting ACBU from custodial demo fiat", params);

      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      const args = [
        ContractClient.toScVal(params.operator),
        ContractClient.toScVal(params.recipient),
        currencyCodeToScVal(params.currency),
        ContractClient.bigIntToI128(BigInt(params.fiatAmount)),
      ];

      const result = await this.contractClient.invokeContract({
        contractId: this.contractId,
        functionName: "mint_from_demo_fiat",
        args,
        sourceAccount,
      });

      const acbuAmount = ContractClient.fromScVal(result.result);

      logger.info("Custodial demo fiat mint successful", {
        transactionHash: result.transactionHash,
        acbuAmount: acbuAmount.toString(),
      });

      return {
        transactionHash: result.transactionHash,
        acbuAmount: acbuAmount.toString(),
      };
    } catch (error) {
      if ((params as any).txId) {
        try {
          await prisma.transaction.update({
            where: { id: (params as any).txId },
            data: { status: "failed" },
          });
          logger.info(`Compensated: Marked transaction ${(params as any).txId} as FAILED`);
        } catch (dbError) {
          logger.error("CRITICAL: DB compensation failed", { txId: (params as any).txId, dbError });
        }
      }
      logger.error("Failed mint_from_demo_fiat", { params, error });
      throw error;
    }
  }

  /**
   * Admin-only: send demo basket S-token from minting contract custody to a user (testnet faucet).
   */
  async adminDripDemoFiat(params: AdminDripDemoFiatParams): Promise<{
    transactionHash: string;
  }> {
    try {
      logger.info("admin_drip_demo_fiat", params);

      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      const args = [
        ContractClient.toScVal(params.recipient),
        currencyCodeToScVal(params.currency),
        ContractClient.bigIntToI128(BigInt(params.amount)),
      ];

      const result = await this.contractClient.invokeContract({
        contractId: this.contractId,
        functionName: "admin_drip_demo_fiat",
        args,
        sourceAccount,
      });

      return { transactionHash: result.transactionHash };
    } catch (error) {
      if ((params as any).txId) {
        try {
          await prisma.transaction.update({
            where: { id: (params as any).txId },
            data: { status: "failed" },
          });
          logger.info(`Compensated: Marked transaction ${(params as any).txId} as FAILED`);
        } catch (dbError) {
          logger.error("CRITICAL: DB compensation failed", { txId: (params as any).txId, dbError });
        }
      }
      logger.error("Failed admin_drip_demo_fiat", { params, error });
      throw error;
    }
  }

  /**
   * Get current fee rate
   */
  async getFeeRate(): Promise<number> {
    try {
      const result = await this.contractClient.readContract(this.contractId, "get_fee_rate", []);

      const feeRate = ContractClient.fromScVal(result);
      return Number(feeRate);
    } catch (error) {
      logger.error("Failed to get fee rate", { error });
      throw error;
    }
  }

  /**
   * Get total ACBU supply minted on-chain.
   */
  async getTotalSupply(): Promise<string> {
    try {
      const result = await this.contractClient.readContract(
        this.contractId,
        "get_total_supply",
        [],
      );

      return ContractClient.fromScVal(result).toString();
    } catch (error) {
      logger.error("Failed to get total supply", { error });
      throw error;
    }
  }

  /**
   * Check if contract is paused
   */
  async isPaused(): Promise<boolean> {
    try {
      const result = await this.contractClient.readContract(this.contractId, "is_paused", []);

      return ContractClient.fromScVal(result) as boolean;
    } catch (error) {
      logger.error("Failed to check pause status", { error });
      throw error;
    }
  }

  /**
   * Pause the contract (admin only)
   */
  async pause(): Promise<string> {
    try {
      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      const result = await this.contractClient.invokeContract({
        contractId: this.contractId,
        functionName: "pause",
        args: [],
        sourceAccount,
      });

      logger.info("Contract paused", {
        transactionHash: result.transactionHash,
      });

      return result.transactionHash;
    } catch (error) {
      logger.error("Failed to pause contract", { error });
      throw error;
    }
  }

  /**
   * Unpause the contract (admin only)
   */
  async unpause(): Promise<string> {
    try {
      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      const result = await this.contractClient.invokeContract({
        contractId: this.contractId,
        functionName: "unpause",
        args: [],
        sourceAccount,
      });

      logger.info("Contract unpaused", {
        transactionHash: result.transactionHash,
      });

      return result.transactionHash;
    } catch (error) {
      logger.error("Failed to unpause contract", { error });
      throw error;
    }
  }
}
