/**
 * MTN Mobile Money API client (RWF, UGX, etc.). Implements FintechProvider for balance and disbursement.
 * FX (convertCurrency) does not have a generic API; use getProviderById('flutterwave') for rate fallback.
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

export interface MTNMoMoConfig {
  subscriptionKey: string;
  apiUserId: string;
  apiKey: string;
  baseUrl: string;
  targetEnvironment: "sandbox" | "production";
}

export class MTNMoMoClient implements FintechProvider {
  private client: AxiosInstance;
  private subscriptionKey: string;
  private token: string | null = null;
  private tokenExpiry = 0;
  private breaker: CircuitBreaker;

  constructor(options?: Partial<MTNMoMoConfig>) {
    const mtnConfig = (config as { mtnMomo?: MTNMoMoConfig }).mtnMomo;
    const conf = options ?? mtnConfig ?? {};
    this.subscriptionKey = conf.subscriptionKey ?? "";
    const baseUrl =
      conf.baseUrl ??
      (conf.targetEnvironment === "production"
        ? "https://momodeveloper.mtn.com"
        : "https://sandbox.momodeveloper.mtn.com");

    this.client = createHttpClient({
      baseURL: baseUrl,
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": this.subscriptionKey,
      },
    });

    // REQUIREMENT 2: Create an isolated circuit breaker for MTN MoMo
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
      throw new Error("MTN MoMo service is temporarily unavailable (Circuit Open)");
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

  private async ensureToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.tokenExpiry > now + 60_000) return this.token;
    const conf = (config as { mtnMomo?: MTNMoMoConfig }).mtnMomo ?? ({} as MTNMoMoConfig);
    const apiUserId = conf.apiUserId ?? "";
    const apiKey = conf.apiKey ?? "";
    if (!apiUserId || !apiKey) {
      throw new Error("MTN MoMo apiUserId and apiKey required for auth");
    }
    const auth = Buffer.from(`${apiUserId}:${apiKey}`).toString("base64");

    // Wrap token generation request in the circuit breaker
    const response = await this.requestWrapper(() =>
      this.client.post(
        "/disbursement/token/",
        {},
        {
          headers: {
            Authorization: `Basic ${auth}`,
            "Ocp-Apim-Subscription-Key": this.subscriptionKey,
          },
        },
      ),
    );

    const accessToken = response.data?.access_token ?? "";
    this.token = accessToken;
    this.tokenExpiry = Date.now() + (response.data?.expires_in ?? 3600) * 1000;
    return accessToken;
  }

  async getBalance(currency: string): Promise<number> {
    try {
      const token = await this.ensureToken();

      // Wrap balance request in circuit breaker
      const response = await this.requestWrapper(() =>
        this.client.get("/disbursement/v1_0/account/balance", {
          headers: {
            Authorization: `Bearer ${token}`,
            "Ocp-Apim-Subscription-Key": this.subscriptionKey,
          },
        }),
      );

      const data = response.data;
      const bal = Number(data?.availableBalance ?? data?.balance ?? 0);
      return bal;
    } catch (error) {
      logger.error("Failed to get balance from MTN MoMo", { currency, error });
      throw error;
    }
  }

  async convertCurrency(
    _amount: number,
    _fromCurrency: string,
    _toCurrency: string,
  ): Promise<ConvertCurrencyResult> {
    throw new Error(
      'MTN MoMo does not provide FX; use getProviderById("flutterwave") for convertCurrency',
    );
  }

  async disburseFunds(
    amount: number,
    currency: string,
    recipient: DisburseRecipient,
  ): Promise<DisburseResult> {
    try {
      const token = await this.ensureToken();
      const crypto = require("crypto");
      const referenceId = `acbu-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const referenceId = `acbu-${crypto.randomUUID()}`;
      const body = {
        amount: String(amount),
        currency,
        externalId: referenceId,
        payee: {
          partyIdType: "MSISDN",
          partyId:
            (recipient as DisburseRecipient & { partyId?: string }).partyId ??
            recipient.accountNumber,
        },
        payerMessage: "ACBU withdrawal",
        payeeNote: "ACBU withdrawal",
      };

      // Wrap disbursements request in circuit breaker
      const response = await this.requestWrapper(() =>
        this.client.post("/disbursement/v1_0/transfer", body, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Ocp-Apim-Subscription-Key": this.subscriptionKey,
            "X-Reference-Id": referenceId,
            "X-Target-Environment":
              ((config as { mtnMomo?: MTNMoMoConfig }).mtnMomo?.targetEnvironment as string) ??
              "sandbox",
          },
        }),
      );

      const status =
        response.status === 202 ? "pending" : String(response.data?.status ?? "pending");
      return {
        transactionId: referenceId,
        status,
      };
    } catch (error) {
      logger.error("Failed to disburse funds via MTN MoMo", {
        amount,
        currency,
        recipient,
        error,
      });
      throw error;
    }
  }
}

export const mtnMoMoClient = new MTNMoMoClient();
