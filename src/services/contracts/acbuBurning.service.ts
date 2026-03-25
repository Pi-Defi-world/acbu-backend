import { contractClient, ContractClient } from "../stellar/contractClient";
import { stellarClient } from "../stellar/client";
import { logger } from "../../config/logger";

export interface BurnForCurrencyParams {
  acbuAmount: string; // Amount in smallest unit (7 decimals)
  currency: string; // Currency code (NGN, KES, RWF)
  recipientAccount: {
    accountNumber: string;
    bankCode: string;
    accountName: string;
  };
}

export interface BurnForBasketParams {
  acbuAmount: string;
  recipientAccounts: Array<{
    accountNumber: string;
    bankCode: string;
    accountName: string;
    currency: string;
  }>;
}

export class BurningService {
  private contractId: string;
  private contractClient: ContractClient;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.contractClient = contractClient;
  }

  /**
   * Burn ACBU for single currency redemption
   */
  async burnForCurrency(params: BurnForCurrencyParams): Promise<{
    transactionHash: string;
    localAmount: string;
  }> {
    try {
      logger.info("Burning ACBU for currency", params);

      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      // Build function arguments
      const args = [
        ContractClient.toScVal(params.acbuAmount),
        ContractClient.toScVal(params.currency),
        ContractClient.toScVal({
          account_number: params.recipientAccount.accountNumber,
          bank_code: params.recipientAccount.bankCode,
          account_name: params.recipientAccount.accountName,
          currency: params.currency,
        }),
      ];

      // Invoke contract
      const result = await this.contractClient.invokeContract({
        contractId: this.contractId,
        functionName: "burn_for_currency",
        args,
        sourceAccount,
      });

      // Parse result (local currency amount)
      const localAmount = ContractClient.fromScVal(result.result);

      logger.info("Burning successful", {
        transactionHash: result.transactionHash,
        localAmount: localAmount.toString(),
      });

      return {
        transactionHash: result.transactionHash,
        localAmount: localAmount.toString(),
      };
    } catch (error) {
      logger.error("Failed to burn for currency", { params, error });
      throw error;
    }
  }

  /**
   * Burn ACBU for basket redemption
   */
  async burnForBasket(params: BurnForBasketParams): Promise<{
    transactionHash: string;
    localAmounts: string[];
  }> {
    try {
      logger.info("Burning ACBU for basket", params);

      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      // Build recipient accounts array
      const recipientAccounts = params.recipientAccounts.map((acc) => ({
        account_number: acc.accountNumber,
        bank_code: acc.bankCode,
        account_name: acc.accountName,
        currency: acc.currency,
      }));

      // Build function arguments
      const args = [
        ContractClient.toScVal(params.acbuAmount),
        ContractClient.toScVal(recipientAccounts),
      ];

      // Invoke contract
      const result = await this.contractClient.invokeContract({
        contractId: this.contractId,
        functionName: "burn_for_basket",
        args,
        sourceAccount,
      });

      // Parse result (array of local amounts)
      const parsedResult = ContractClient.fromScVal(result.result);
      if (!Array.isArray(parsedResult)) {
        throw new Error("Invalid burn_for_basket result: expected array");
      }
      const localAmounts = parsedResult.map((amount: unknown) =>
        String(amount),
      );

      logger.info("Basket burning successful", {
        transactionHash: result.transactionHash,
        localAmounts,
      });

      return {
        transactionHash: result.transactionHash,
        localAmounts,
      };
    } catch (error) {
      logger.error("Failed to burn for basket", { params, error });
      throw error;
    }
  }

  /**
   * Get current fee rate
   */
  async getFeeRate(): Promise<number> {
    try {
      const result = await this.contractClient.readContract(
        this.contractId,
        "get_fee_rate",
        [],
      );

      const feeRate = ContractClient.fromScVal(result);
      return Number(feeRate);
    } catch (error) {
      logger.error("Failed to get fee rate", { error });
      throw error;
    }
  }

  /**
   * Check if contract is paused
   */
  async isPaused(): Promise<boolean> {
    try {
      const result = await this.contractClient.readContract(
        this.contractId,
        "is_paused",
        [],
      );

      return ContractClient.fromScVal(result) as boolean;
    } catch (error) {
      logger.error("Failed to check pause status", { error });
      throw error;
    }
  }
}
