import { contractClient, ContractClient } from "../stellar/contractClient";
import { stellarClient } from "../stellar/client";
import { logger } from "../../config/logger";
import { xdr } from "@stellar/stellar-sdk";

/** Soroban `CurrencyCode` — tuple struct with one string field. */
function currencyCodeToScVal(code: string): xdr.ScVal {
  const c = code.trim().toUpperCase();
  if (c.length !== 3) {
    throw new Error("currency must be a 3-letter ISO code");
  }
  // CurrencyCode(pub Vec<String>) encodes as vec([ vec([ string("NGN") ]) ]).
  return xdr.ScVal.scvVec([xdr.ScVal.scvVec([xdr.ScVal.scvString(c)])]);
}

export interface UpdateReserveParams {
  updater: string; // The authorized address performing the update
  currency: string; // Currency code (NGN, KES, RWF)
  amount: string; // Reserve amount in native currency (7 decimals)
  valueUsd: string; // Reserve value in USD (7 decimals)
}

export interface ReserveData {
  currency: string;
  amount: string;
  valueUsd: string;
  timestamp: number;
}

export class ReserveTrackerService {
  private contractId: string;
  private contractClient: ContractClient;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.contractClient = contractClient;
  }

  /**
   * Update reserve for a currency (backend function)
   */
  async updateReserve(params: UpdateReserveParams): Promise<string> {
    try {
      logger.info("Updating reserve", params);

      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      // Build function arguments: [updater, currency, amount, value_usd]
      const currencyScVal = currencyCodeToScVal(params.currency);
      const args = [
        ContractClient.toScVal(params.updater), // Address
        currencyScVal,
        ContractClient.toScVal(BigInt(params.amount)),
        ContractClient.toScVal(BigInt(params.valueUsd)),
      ];

      // Invoke contract
      const result = await this.contractClient.invokeContract({
        contractId: this.contractId,
        functionName: "update_reserve",
        args,
        sourceAccount,
      });

      logger.info("Reserve update successful", {
        transactionHash: result.transactionHash,
        currency: params.currency,
      });

      return result.transactionHash;
    } catch (error) {
      logger.error("Failed to update reserve", { params, error });
      throw error;
    }
  }

  /**
   * Get current reserves for all currencies (contract-authoritative).
   */
  async getAllReserves(): Promise<Record<string, ReserveData>> {
    try {
      const result = await this.contractClient.readContract(
        this.contractId,
        "get_all_reserves",
        [],
      );

      const map = ContractClient.fromScVal(result);
      const out: Record<string, ReserveData> = {};

      // `fromScVal` returns a JS Map-like for Soroban maps in most paths.
      // Support both real Map and plain object fallbacks.
      const entries: Array<[any, any]> =
        map instanceof Map
          ? Array.from(map.entries())
          : typeof map === "object" && map
            ? Object.entries(map as Record<string, any>)
            : [];

      for (const [, v] of entries) {
        const currency = v?.currency?.toString?.() ?? "";
        if (!currency) continue;
        out[currency] = {
          currency,
          amount: v?.amount?.toString?.() ?? "0",
          valueUsd: v?.value_usd?.toString?.() ?? "0",
          timestamp: Number(v?.timestamp ?? 0),
        };
      }

      return out;
    } catch (error) {
      logger.error("Failed to get all reserves", { error });
      throw error;
    }
  }

  /**
   * Verify reserves meet overcollateralization requirements
   */
  async verifyReserves(totalAcbuSupply: string): Promise<boolean> {
    try {
      const result = await this.contractClient.readContract(
        this.contractId,
        "verify_reserves",
        [ContractClient.toScVal(BigInt(totalAcbuSupply))],
      );

      return ContractClient.fromScVal(result) as boolean;
    } catch (error) {
      logger.error("Failed to verify reserves", { error });
      throw error;
    }
  }

  /**
   * Get total reserve value in USD
   */
  async getTotalReserveValue(): Promise<string> {
    try {
      const result = await this.contractClient.readContract(
        this.contractId,
        "get_total_reserve_value",
        [],
      );

      const totalValue = ContractClient.fromScVal(result);
      return totalValue.toString();
    } catch (error) {
      logger.error("Failed to get total reserve value", { error });
      throw error;
    }
  }
}
