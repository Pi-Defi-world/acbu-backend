/**
 * Pi Network / Bridge client for wallet operations.
 * Handles transactions on the Pi blockchain/bridge.
 */
import axios, { AxiosInstance } from "axios";
import { config } from "../../config/env";
import { logger } from "../../config/logger";

export interface PiNetworkConfig {
  enabled: boolean;
  secretKey: string;
  apiUrl: string;
  network: "testnet" | "mainnet";
}

export interface PiTransaction {
  id: string;
  from: string;
  to: string;
  amount: number;
  status: "pending" | "confirmed" | "failed";
  hash: string;
  timestamp: number;
}

export class PiClient {
  private apiClient: AxiosInstance;
  private secretKey: string;
  private enabled: boolean;
  private network: "testnet" | "mainnet";
  private apiUrl: string;

  constructor(cfg?: Partial<PiNetworkConfig>) {
    this.enabled = cfg?.enabled ?? config.pi.enabled;
    this.secretKey = cfg?.secretKey ?? config.pi.secretKey;
    this.apiUrl = cfg?.apiUrl ?? config.pi.apiUrl;
    this.network = cfg?.network ?? config.pi.network;

    this.apiClient = axios.create({
      baseURL: this.apiUrl,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.secretKey}`,
      },
    });

    if (this.enabled) {
      logger.info("Pi Network client initialized", {
        network: this.network,
        apiUrl: this.apiUrl,
      });
    }
  }

  /**
   * Check if Pi bridge is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the current network (testnet/mainnet)
   */
  getNetwork(): "testnet" | "mainnet" {
    return this.network;
  }

  /**
   * Get the API URL
   */
  getApiUrl(): string {
    return this.apiUrl;
  }

  /**
   * Send Pi to activate a wallet (create account on-chain).
   * Uses platform Pi wallet as source.
   */
  async sendPiToActivate(piAddress: string, amountPi: number): Promise<string> {
    if (!this.enabled) {
      throw new Error("Pi bridge is not enabled");
    }

    if (!this.secretKey) {
      throw new Error(
        "Platform Pi secret key not configured; cannot fund wallet",
      );
    }

    try {
      const response = await this.apiClient.post(
        "/v1/transactions/create-account",
        {
          destination: piAddress,
          amount: amountPi,
          network: this.network,
        },
      );

      const txHash = response.data?.hash || response.data?.id;

      if (!txHash) {
        throw new Error("No transaction hash returned from Pi API");
      }

      logger.info("Wallet activated with Pi", {
        piAddress: piAddress.slice(0, 8) + "…",
        amountPi,
        hash: txHash,
        network: this.network,
      });

      return txHash;
    } catch (err: unknown) {
      const e = err as {
        response?: {
          status?: number;
          data?: {
            error?: string;
            message?: string;
            code?: string;
          };
        };
        message?: string;
      };

      const errorMsg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        String(err);
      const errorCode = e?.response?.data?.code || "";

      if (
        errorMsg.includes("account_exists") ||
        errorMsg.includes("ACCOUNT_ALREADY_EXISTS") ||
        errorCode.includes("account_exists")
      ) {
        logger.info("Wallet already funded, skip activation", {
          piAddress: piAddress.slice(0, 8) + "…",
        });
        return "already_exists";
      }

      logger.error("Pi wallet activation failed", {
        piAddress: piAddress.slice(0, 8) + "…",
        error: errorMsg,
        code: errorCode,
      });

      throw err;
    }
  }

  /**
   * Verify transaction status on Pi network
   */
  async getTransactionStatus(txHash: string): Promise<PiTransaction | null> {
    if (!this.enabled) {
      throw new Error("Pi bridge is not enabled");
    }

    try {
      const response = await this.apiClient.get(`/v1/transactions/${txHash}`);
      return response.data as PiTransaction;
    } catch (err) {
      logger.error("Failed to get Pi transaction status", {
        txHash,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Get account balance on Pi network
   */
  async getBalance(piAddress: string): Promise<number> {
    if (!this.enabled) {
      throw new Error("Pi bridge is not enabled");
    }

    try {
      const response = await this.apiClient.get(
        `/v1/accounts/${piAddress}/balance`,
      );
      return response.data?.balance ?? 0;
    } catch (err) {
      logger.error("Failed to get Pi account balance", {
        piAddress: piAddress.slice(0, 8) + "…",
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }
}

// Export singleton instance
export const piClient = new PiClient();
