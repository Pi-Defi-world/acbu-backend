import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Transaction,
  FeeBumpTransaction,
} from "stellar-sdk";
import { config } from "../../config/env";
import { logger } from "../../config/logger";

const Server = Horizon.Server;

export interface StellarNetworkConfig {
  network: "testnet" | "mainnet";
  horizonUrl: string;
  networkPassphrase: string;
  secretKey?: string;
}

export type StellarServer = InstanceType<typeof Server>;

export class StellarClient {
  private server: StellarServer;
  private network: "testnet" | "mainnet";
  private networkPassphrase: string;
  private keypair: Keypair | null = null;

  constructor(cfg?: Partial<StellarNetworkConfig>) {
    const network = (cfg?.network ?? config.stellar.network) as
      | "testnet"
      | "mainnet";
    const horizonUrl = cfg?.horizonUrl ?? config.stellar.horizonUrl;
    const networkPassphrase =
      cfg?.networkPassphrase ??
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
        logger.info("Stellar keypair initialized", {
          publicKey: this.keypair.publicKey(),
          network,
        });
      } catch (error) {
        logger.error("Failed to initialize Stellar keypair", { error });
        throw new Error("Invalid Stellar secret key");
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

  /**
   * Get the keypair (if initialized)
   */
  getKeypair(): Keypair | null {
    return this.keypair;
  }

  /**
   * Get account information
   */
  async getAccount(accountId: string) {
    try {
      const account = await this.server.loadAccount(accountId);
      return account;
    } catch (error) {
      logger.error("Failed to load account", { accountId, error });
      throw error;
    }
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
      const sourceAccount = await this.getAccount(sourceAccountId);
      let fee = options?.fee;
      if (!fee) {
        if (config.stellar.useDynamicFees) {
          try {
            fee = String(await this.server.fetchBaseFee());
          } catch (err) {
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
        builder.addOperation(
          op as unknown as Parameters<typeof builder.addOperation>[0],
        ),
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
      const result = await this.server.submitTransaction(transaction);
      logger.info("Transaction submitted", {
        hash: result.hash,
        ledger: result.ledger,
      });
      return result;
    } catch (error: any) {
      logger.error("Failed to submit transaction", {
        error: error.message,
        extras: error.response?.data?.extras,
      });
      throw error;
    }
  }

  /**
   * Get transaction by hash
   */
  async getTransaction(transactionHash: string) {
    try {
      const transaction = await this.server
        .transactions()
        .transaction(transactionHash)
        .call();
      return transaction;
    } catch (error) {
      logger.error("Failed to get transaction", { transactionHash, error });
      throw error;
    }
  }

  /**
   * Get account balance for an asset
   */
  async getBalance(
    accountId: string,
    assetCode?: string,
    assetIssuer?: string,
  ) {
    try {
      const account = await this.getAccount(accountId);
      if (!assetCode || assetCode === "XLM") {
        const xlmBalance = account.balances.find(
          (b) => b.asset_type === "native",
        );
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
});
