/**
 * Paystack API client (Nigeria/NGN). Implements FintechProvider for balance and disbursement.
 * FX (convertCurrency) delegates to Flutterwave; use getProviderById('flutterwave') for rate fallback.
 */
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

export interface PaystackConfig {
  secretKey: string;
  baseUrl: string;
}

export class PaystackClient implements FintechProvider {
  private client: AxiosInstance;
  private fxFallback: FintechProvider | null;
  private breaker: CircuitBreaker;

  constructor(options?: { secretKey?: string; baseUrl?: string; fxFallback?: FintechProvider }) {
    const paystackConfig = (config as { paystack?: PaystackConfig }).paystack;
    const secretKey = options?.secretKey ?? paystackConfig?.secretKey ?? "";
    const baseUrl = options?.baseUrl ?? paystackConfig?.baseUrl ?? "https://api.paystack.co";
    this.fxFallback = options?.fxFallback ?? null;

    this.client = createHttpClient({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });

    // REQUIREMENT 2: Create an isolated circuit breaker for Paystack
    this.breaker = new CircuitBreaker({
      failureThreshold: 5,
      cooldownMs: 30000,
      successThreshold: 2,
    });
  }

  /**
   * Execute a request through the circuit breaker.
   * Retry-After-aware retries are handled by the shared HTTP client interceptor.
   */
  private async requestWrapper<T>(requestFn: () => Promise<T>): Promise<T> {
    if (!this.breaker.canExecute()) {
      throw new Error("Paystack service is temporarily unavailable (Circuit Open)");
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

  async getBalance(currency: string): Promise<number> {
    try {
      // Execute through the circuit breaker wrapper
      const response = await this.requestWrapper(() => this.client.get("/balance"));

      const data = response.data?.data;
      if (!data) throw new Error("Invalid balance response");
      // Paystack returns balance in subunits (kobo); ledger_balance or balance
      const balanceKobo = Number(data.balance ?? data.ledger_balance ?? 0);
      const balance = balanceKobo / 100;
      return balance;
    } catch (error) {
      logger.error("Failed to get balance from Paystack", { currency, error });
      throw error;
    }
  }

  async convertCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<ConvertCurrencyResult> {
    if (this.fxFallback) {
      return this.fxFallback.convertCurrency(amount, fromCurrency, toCurrency);
    }
    throw new Error(
      "Paystack does not provide FX; use Flutterwave for convertCurrency or inject fxFallback",
    );
  }

  async disburseFunds(
    amount: number,
    currency: string,
    recipient: DisburseRecipient,
  ): Promise<DisburseResult> {
    try {
      // Execute through the circuit breaker wrapper
      const response = await this.requestWrapper(() =>
        this.client.post("/transfer", {
          source: "balance",
          amount: Math.round(amount * 100),
          recipient: recipient.bankCode,
          reason: "ACBU withdrawal",
          reference: `acbu-${Date.now()}`,
        }),
      );

      const data = response.data?.data;
      return {
        transactionId: data?.transfer_code ?? data?.id ?? String(response.data?.data?.id),
        status: data?.status ?? "pending",
      };
    } catch (error) {
      logger.error("Failed to disburse funds via Paystack", {
        amount,
        currency,
        recipient,
        error,
      });
      throw error;
    }
  }
}

export const paystackClient = new PaystackClient();
