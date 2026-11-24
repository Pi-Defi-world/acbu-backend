import { AxiosInstance } from "axios";
import { config } from "../../config/env";
import { logger } from "../../config/logger";
import { CircuitBreaker } from "../../utils/circuitBreaker";
import { createHttpClient } from "../http/client";
import type {
  FintechProvider,
  DisburseRecipient,
  ConvertCurrencyResult,
  DisburseResult,
} from "../fintech/types";

export class FlutterwaveClient implements FintechProvider {
  private client: AxiosInstance;
  private breaker: CircuitBreaker;

  constructor() {
    this.client = createHttpClient({
      baseURL: config.flutterwave.baseUrl,
      headers: {
        Authorization: `Bearer ${config.flutterwave.secretKey}`,
        "Content-Type": "application/json",
      },
    });

    // REQUIREMENT 2: Create a dedicated circuit breaker for Flutterwave
    this.breaker = new CircuitBreaker({
      failureThreshold: 5,
      cooldownMs: 30000, // 30 seconds cooldown
      successThreshold: 2,
    });

    // Request interceptor (kept exactly as you have it)
    this.client.interceptors.request.use(
      (requestConfig) => {
        logger.debug("Flutterwave API Request", {
          method: requestConfig.method,
          url: requestConfig.url,
        });
        return requestConfig;
      },
      (error) => {
        logger.error("Flutterwave API Request Error", error);
        return Promise.reject(error);
      },
    );

    // Response interceptor (kept exactly as you have it)
    this.client.interceptors.response.use(
      (response) => {
        logger.debug("Flutterwave API Response", {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        logger.error("Flutterwave API Response Error", {
          status: error.response?.status,
          message: error.response?.data?.message || error.message,
          url: error.config?.url,
        });
        return Promise.reject(error);
      },
    );
  }

  /**
   * Execute a request through the circuit breaker.
   * Retry-After-aware retries are handled by the shared HTTP client interceptor.
   */
  private async requestWrapper<T>(requestFn: () => Promise<T>): Promise<T> {
    if (!this.breaker.canExecute()) {
      throw new Error("Flutterwave service is temporarily unavailable (Circuit Open)");
    }
    try {
      const result = await requestFn();
      this.breaker.recordSuccess();
      return result;
    } catch (error) {
      this.breaker.recordFailure();
      throw error;
    }
  }

  /**
   * Get account balance for a specific currency
   */
  async getBalance(currency: string): Promise<number> {
    try {
      const response = await this.requestWrapper(() => this.client.get(`/balances/${currency}`));
      return parseFloat(response.data.data.balance);
    } catch (error) {
      logger.error("Failed to get balance from Flutterwave", {
        currency,
        error,
      });
      throw error;
    }
  }

  /**
   * Convert currency using Flutterwave FX API
   */
  async convertCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<ConvertCurrencyResult> {
    try {
      const response = await this.requestWrapper(() =>
        this.client.post("/currency/conversions", {
          amount,
          from: fromCurrency,
          to: toCurrency,
        }),
      );
      return {
        amount: parseFloat(response.data.data.amount),
        rate: parseFloat(response.data.data.rate),
      };
    } catch (error) {
      logger.error("Failed to convert currency via Flutterwave", {
        amount,
        fromCurrency,
        toCurrency,
        error,
      });
      throw error;
    }
  }

  /**
   * Disburse funds to a recipient
   */
  async disburseFunds(
    amount: number,
    currency: string,
    recipient: DisburseRecipient,
  ): Promise<DisburseResult> {
    try {
      const response = await this.requestWrapper(() =>
        this.client.post("/transfers", {
          account_bank: recipient.bankCode,
          account_number: recipient.accountNumber,
          amount,
          currency,
          narration: "ACBU withdrawal",
          beneficiary_name: recipient.accountName,
        }),
      );

      return {
        transactionId: response.data.data.id,
        status: response.data.data.status,
      };
    } catch (error) {
      logger.error("Failed to disburse funds via Flutterwave", {
        amount,
        currency,
        recipient,
        error,
      });
      throw error;
    }
  }
}

const client = new FlutterwaveClient();
export const flutterwaveClient = client;
export const flutterwaveProvider: FintechProvider = client;
