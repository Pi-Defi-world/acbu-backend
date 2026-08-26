import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Transaction,
  FeeBumpTransaction,
} from "@stellar/stellar-sdk";
import { config } from "../../config/env";
import { logger } from "../../config/logger";
import { CircuitBreaker } from "../../utils/circuitBreaker";
import { validateOperationsForTreasuryAccount } from "./operationSecurity";

const Server = Horizon.Server;

export interface StellarNetworkConfig {
  network: "testnet" | "mainnet";
  horizonUrl: string;
  networkPassphrase: string;
  secretKey?: string;
}

export type StellarServer = InstanceType<typeof Server>;

export interface FeeBumpOptions {
  /** Secret key for the account paying the fee bump. Defaults to the configured Stellar secret key. */
  feeSourceSecretKey?: string;
  /** Fee per operation, in stroops. Defaults to 10x the configured base fee. */
  baseFee?: string;
}

export class StellarClient {
  private server: StellarServer;
  private network: "testnet" | "mainnet";
  private networkPassphrase: string;
  private keypair: Keypair | null = null;
  /** Public key of the configured treasury account, when a secret key is provided. */
  private treasuryAccountId?: string;
  readonly horizonBreaker = new CircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 30_000,
    successThreshold: 2,
  });

  constructor(cfg?: Partial<StellarNetworkConfig>) {
    const network = (cfg?.network ?? config.stellar.network) as "testnet" | "mainnet";
    const horizonUrl = cfg?.horizonUrl ?? config.stellar.horizonUrl;
    const networkPassphrase =
      cfg?.networkPassphrase ??
      config.stellar.networkPassphrase ??
      (network === "testnet"
        ? "Test SDF Network ; September 2015"
        : "Public Global Stellar Network ; September 2015");

    this.network = network;
    this.networkPassphrase = networkPassphrase;
    this.server = new Server(horizonUrl);

    // Initialize keypair if secret key is provided
    const secretKey = cfg?.secretKey ?? config.stellar.secretKey;
    if (secretKey) {
      try {
        this.keypair = Keypair.fromSecret(secretKey);
        this.treasuryAccountId = this.keypair.publicKey();
        logger.info("Stellar keypair initialized", {
          publicKey: this.keypair.publicKey(),
          network,
        });
      } catch (error) {
        logger.error("Failed to initialize Stellar keypair", { error });
      }
    }
  }

  /**
   * Get the Stellar server instance
   */
  getServer(): InstanceType<typeof Server> {
    return this.server;
  }

  /**
   * Get the current network
   */
  getNetwork(): "testnet" | "mainnet" {
    return this.network;
  }

  /**
   * Get the network passphrase
   */
  getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  /** Soroban JSON-RPC base URL for simulateTransaction / sendTransaction / getTransaction. */
  getSorobanRpcUrl(): string {
    return config.stellar.sorobanRpcUrl;
  }

  /** Horizon base URL (useful for the public config endpoint and diagnostics). */
  getHorizonUrl(): string {
    return config.stellar.horizonUrl;
  }

  /**
   * Get the keypair (if initialized)
   */
  getKeypair(): Keypair | null {
    return this.keypair;
  }

  /**
   * Get account information with retries
   */
  async getAccount(accountId: string, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        if (!this.horizonBreaker.canExecute()) {
          throw new Error("Horizon circuit breaker is OPEN — skipping request");
        }
        const account = await this.server.loadAccount(accountId);
        this.horizonBreaker.recordSuccess();
        return account;
      } catch (error: any) {
        this.horizonBreaker.recordFailure();
        if (i === retries - 1) {
          logger.error("Failed to load account after retries", {
            accountId,
            error,
          });
          throw error;
        }
        logger.warn(`Failed to load account (attempt ${i + 1}/${retries}). Retrying...`, {
          accountId,
          error: error.message,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)));
      }
    }
    throw new Error("Failed to load account");
  }

  /**
   * Build and sign a transaction
   */
  async buildTransaction(
    sourceAccountId: string,
    operations: Operation[],
    options?: {
      fee?: string;
      timebounds?: { minTime: number; maxTime: number };
    },
  ) {
    try {
      // Validate operations for treasury account security
      if (this.treasuryAccountId) {
        validateOperationsForTreasuryAccount(operations, sourceAccountId, this.treasuryAccountId);
      }

      const sourceAccount = await this.getAccount(sourceAccountId);
      let fee = options?.fee;
      if (!fee) {
        if (config.stellar.useDynamicFees) {
          try {
            if (this.horizonBreaker.canExecute()) {
              fee = String(await this.server.fetchBaseFee());
              this.horizonBreaker.recordSuccess();
            }
          } catch (err) {
            this.horizonBreaker.recordFailure();
            logger.warn(
              "Failed to fetch dynamic Stellar base fee; falling back to configured value",
              { err, fallback: config.stellar.baseFeeStroops },
            );
          }
        }
        fee = fee ?? String(config.stellar.baseFeeStroops);
      }
      const builder = new TransactionBuilder(sourceAccount, {
        fee,
        networkPassphrase: this.networkPassphrase,
        timebounds: options?.timebounds,
      });

      operations.forEach((op) =>
        builder.addOperation(op as unknown as Parameters<typeof builder.addOperation>[0]),
      );

      const transaction = builder.build();

      // Sign if keypair is available
      if (this.keypair) {
        transaction.sign(this.keypair);
      }

      return transaction;
    } catch (error) {
      logger.error("Failed to build transaction", { sourceAccountId, error });
      throw error;
    }
  }

  /**
   * Submit a transaction
   */
  async submitTransaction(transaction: Transaction | FeeBumpTransaction) {
    try {
      if (!this.horizonBreaker.canExecute()) {
        throw new Error("Horizon circuit breaker is OPEN — cannot submit transaction");
      }
      const result = await this.server.submitTransaction(transaction);
      this.horizonBreaker.recordSuccess();
      logger.info("Transaction submitted", {
        hash: result.hash,
        ledger: result.ledger,
      });
      return result;
    } catch (error: any) {
      this.horizonBreaker.recordFailure();
      logger.error("Failed to submit transaction", {
        error: error.message,
        extras: error.response?.data?.extras,
      });
      throw error;
    }
  }

  /**
   * Build a Stellar fee-bump transaction around an already-signed inner transaction.
   * This lets operators rescue mint/burn operations that are stuck because their
   * original fee was too low, without rebuilding or re-signing the inner operation.
   */
  buildFeeBumpTransaction(
    innerTransaction: Transaction,
    options?: FeeBumpOptions,
  ): FeeBumpTransaction {
    const feeSourceKeypair = options?.feeSourceSecretKey
      ? Keypair.fromSecret(options.feeSourceSecretKey)
      : this.keypair;

    if (!feeSourceKeypair) {
      throw new Error("Fee bump source keypair is required");
    }

    const baseFee = options?.baseFee ?? String(Math.max(config.stellar.baseFeeStroops * 10, 1000));

    const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
      feeSourceKeypair,
      baseFee,
      innerTransaction,
      this.networkPassphrase,
    );

    feeBumpTransaction.sign(feeSourceKeypair);
    return feeBumpTransaction;
  }

  /**
   * Build, sign, and submit a fee-bump transaction for a signed inner transaction.
   */
  async submitFeeBumpTransaction(innerTransaction: Transaction, options?: FeeBumpOptions) {
    const feeBumpTransaction = this.buildFeeBumpTransaction(innerTransaction, options);

    return this.submitTransaction(feeBumpTransaction);
  }

  /**
   * Build, sign, and submit a fee-bump transaction from an inner transaction XDR.
   */
  async submitFeeBumpTransactionXdr(innerTransactionXdr: string, options?: FeeBumpOptions) {
    const innerTransaction = new Transaction(innerTransactionXdr, this.networkPassphrase);

    return this.submitFeeBumpTransaction(innerTransaction, options);
  }

  /**
   * Build, sign, and submit a transaction with automatic retry for sequence number drift
   */
  async buildAndSubmitTransaction(
    sourceAccountId: string,
    operations: Operation[],
    options?: {
      fee?: string;
      timebounds?: { minTime: number; maxTime: number };
    },
  ) {
    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      try {
        const transaction = await this.buildTransaction(sourceAccountId, operations, options);
        const result = await this.submitTransaction(transaction);
        logger.info("Transaction submitted", {
          hash: result.hash,
          ledger: result.ledger,
          attempt: attempt + 1,
        });
        return result;
      } catch (error: any) {
        attempt++;

        // Check if this is a tx_bad_seq error
        const isBadSeqError =
          error.response?.data?.extras?.result_codes?.operations?.[0] === "tx_bad_seq" ||
          error.message?.includes("tx_bad_seq");

        if (isBadSeqError && attempt < maxAttempts) {
          logger.warn(
            "Sequence number drift detected (tx_bad_seq). Reloading account and retrying...",
            {
              sourceAccountId,
              attempt,
              maxAttempts,
            },
          );
          // Force reload the account to get fresh sequence number
          await this.getAccount(sourceAccountId);
          continue;
        }

        // Log error and throw on final attempt or non-sequence errors
        logger.error("Failed to submit transaction", {
          error: error.message,
          extras: error.response?.data?.extras,
          attempt,
          maxAttempts,
        });
        throw error;
      }
    }

    throw new Error("Failed to submit transaction after retries");
  }

  /**
   * Get transaction by hash
   */
  async getTransaction(transactionHash: string) {
    try {
      const transaction = await this.server.transactions().transaction(transactionHash).call();
      return transaction;
    } catch (error) {
      logger.error("Failed to get transaction", { transactionHash, error });
      throw error;
    }
  }

  /**
   * Get account balance for an asset
   */
  async getBalance(accountId: string, assetCode?: string, assetIssuer?: string) {
    try {
      const account = await this.getAccount(accountId);
      if (!assetCode || assetCode === "XLM") {
        const xlmBalance = account.balances.find((b) => b.asset_type === "native");
        return xlmBalance ? parseFloat(xlmBalance.balance) : 0;
      }

      const assetBalance = account.balances.find(
        (b) =>
          "asset_code" in b &&
          b.asset_code === assetCode &&
          "asset_issuer" in b &&
          b.asset_issuer === assetIssuer,
      );
      return assetBalance ? parseFloat(assetBalance.balance) : 0;
    } catch (error) {
      logger.error("Failed to get balance", { accountId, assetCode, error });
      throw error;
    }
  }

  /**
   * Create a keypair from secret
   */
  static createKeypairFromSecret(secret: string): Keypair {
    return Keypair.fromSecret(secret);
  }

  /**
   * Generate a new random keypair
   */
  static generateKeypair(): Keypair {
    return Keypair.random();
  }

  /**
   * Validate a Stellar address
   */
  static isValidAddress(address: string): boolean {
    try {
      Keypair.fromPublicKey(address);
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const stellarClient = new StellarClient({
  network: config.stellar.network as "testnet" | "mainnet",
  horizonUrl: config.stellar.horizonUrl,
  secretKey: config.stellar.secretKey,
  networkPassphrase: config.stellar.networkPassphrase,
});
