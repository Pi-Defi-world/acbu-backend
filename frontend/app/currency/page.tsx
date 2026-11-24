"use client";

import React, { useEffect, useMemo, useState } from "react";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowDown, ArrowUp, TrendingUp } from "lucide-react";
import { formatAmount } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { useApiOpts } from "@/hooks/use-api";
import { useBalance } from "@/hooks/use-balance";
import { useToast } from "@/hooks/use-toast";
import * as ratesApi from "@/lib/api/rates";
import type { RatesResponse } from "@/types/api";
import { useApiError } from "@/hooks/use-api-error";
import { ApiErrorDisplay } from "@/components/ui/api-error-display";
import { RetryErrorBlock } from "@/components/ui/retry-error-block";
import * as mintApi from "@/lib/api/mint";
import * as burnApi from "@/lib/api/burn";
import type { MintResponse, BurnResponse, CurrencyPreference, QuoteResponse } from "@/types/api";
import { logger } from "@/lib/logger";
import { useAuth } from "@/contexts/auth-context";
import { submitBurnRedeemSingleClient } from "@/lib/stellar/burning";
import { useWalletSetup } from "@/hooks/use-wallet-setup";
import { useConfig } from "@/hooks/use-config";
import { getBurnFeeText, getMintFeeText } from "@/lib/fee-text";

/** Local currency units per 1 ACBU from the `/rates` oracle, or null if missing. */
function localPerAcbu(currency: string, rates: RatesResponse | null): number | null {
  if (!rates || !currency) return null;
  const key = `acbu_${currency.trim().toLowerCase()}` as keyof RatesResponse;
  const raw = rates[key];
  if (raw == null || raw === "") return null;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ACBU received when minting `usd` dollars: usd / (USD per ACBU). */
function estimateAcbuFromUsd(usd: number, rates: RatesResponse | null): number | null {
  const perAcbu = localPerAcbu("USD", rates);
  if (perAcbu == null || !(usd > 0)) return null;
  return usd / perAcbu;
}

/** Local currency received when burning `acbu` units to `currency`. */
function estimateLocalFromAcbu(
  acbu: number,
  currency: string,
  rates: RatesResponse | null,
): number | null {
  const perAcbu = localPerAcbu(currency, rates);
  if (perAcbu == null || !(acbu > 0)) return null;
  return acbu * perAcbu;
}

/**
 * Currency management hub.
 */
export default function CurrencyPage() {
  const opts = useApiOpts();
  const { uiError, setApiError, clearError, isSubmitDisabled } = useApiError();
  const { userId, stellarAddress } = useAuth();
  const { getWalletSigner } = useWalletSetup();
  const { config } = useConfig();
  const { toast } = useToast();
  const {
    balance,
    loading: balanceLoading,
    error: balanceError,
    refetch: refetchBalance,
  } = useBalance();

  const [activeTab, setActiveTab] = useState<"mint" | "burn" | "international">(
    "mint",
  );
  const [step, setStep] = useState<"input" | "confirm" | "success">("input");
  const [submitting, setSubmitting] = useState(false);
  const [lastTxId, setLastTxId] = useState("");
  const [lastResponse, setLastResponse] = useState<
    MintResponse | BurnResponse | null
  >(null);

  const [rates, setRates] = useState<RatesResponse | null>(null);

  // Mint state
  const [mintAmount, setMintAmount] = useState("");
  const debouncedMintAmount = useDebounce(mintAmount, 300);
  const [mintSource, setMintSource] = useState("stellar");
  const [mintWalletAddress, setMintWalletAddress] = useState("");

  // Burn state
  const [burnAmount, setBurnAmount] = useState("");
  const debouncedBurnAmount = useDebounce(burnAmount, 300);
  const [burnDestination, setBurnDestination] = useState("bank");
  const [burnAccountNumber, setBurnAccountNumber] = useState("");
  const [burnBankCode, setBurnBankCode] = useState("");
  const [burnAccountName, setBurnAccountName] = useState("");

  // International state
  const [intlAmount, setIntlAmount] = useState("");
  const debouncedIntlAmount = useDebounce(intlAmount, 300);
  const [intlCurrency, setIntlCurrency] = useState("USD");
  const [intlCountry, setIntlCountry] = useState("US");
  const [intlAccountNumber, setIntlAccountNumber] = useState("");
  const [intlBankCode, setIntlBankCode] = useState("");
  const [intlAccountName, setIntlAccountName] = useState("");
  const [intlQuote, setIntlQuote] = useState<QuoteResponse | null>(null);
  const [intlQuoteLoading, setIntlQuoteLoading] = useState(false);
  const [intlQuoteError, setIntlQuoteError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ratesApi
      .getRates(opts)
      .then((data) => {
        if (!cancelled) setRates(data);
      })
      .catch(() => {
        if (!cancelled) setRates(null);
      });
    return () => {
      cancelled = true;
    };
  }, [opts.token]);

  useEffect(() => {
    let cancelled = false;
    const amount = parseFloat(debouncedIntlAmount || "0");

    if (!(amount > 0)) {
      setIntlQuote(null);
      setIntlQuoteLoading(false);
      setIntlQuoteError(false);
      return () => {
        cancelled = true;
      };
    }

    setIntlQuoteLoading(true);
    setIntlQuoteError(false);

    ratesApi
      .getQuote(debouncedIntlAmount, intlCurrency, opts)
      .then((data) => {
        if (!cancelled) {
          setIntlQuote(data);
          setIntlQuoteLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIntlQuote(null);
          setIntlQuoteError(true);
          setIntlQuoteLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedIntlAmount, intlCurrency, opts.token]);

  const usdPerAcbu = useMemo(() => localPerAcbu("USD", rates), [rates]);
  const ngnPerAcbu = useMemo(() => localPerAcbu("NGN", rates), [rates]);

  const availableBalance = balance ?? 0;
  const burnNumeric = parseFloat(debouncedBurnAmount || "0");
  const mintNumeric = parseFloat(debouncedMintAmount || "0");

  const estimatedMintAcbu = estimateAcbuFromUsd(mintNumeric, rates);
  const estimatedBurnNgn = estimateLocalFromAcbu(burnNumeric, "NGN", rates);
  const mintFeeText = getMintFeeText(config, mintNumeric, "USD");
  const burnFeeText = getBurnFeeText(config, burnNumeric);
  const intlPayoutAmount =
    intlQuote?.payout_amount ??
    intlQuote?.receive_amount ??
    intlQuote?.local_amount ??
    null;
  const intlFeeAmount =
    intlQuote?.total_fee ?? intlQuote?.fee_amount ?? intlQuote?.fee ?? null;
  const payoutFormatted =
    intlPayoutAmount != null
      ? `${intlCurrency} ${formatAmount(intlPayoutAmount)}`
      : `${intlCurrency} —`;

  const handleMintConfirm = () => setStep("confirm");
  const handleBurnConfirm = () => setStep("confirm");

  const handleExecute = async () => {
    clearError();
    setSubmitting(true);
    logger.info(`Starting ${activeTab} operation`); // <-- ADD LOGGER

    try {
      if (activeTab === "mint") {
        logger.info("Minting ACBU", { amount: mintAmount }); // <-- ADD LOGGER
        const res: MintResponse = await mintApi.mintFromUsdc(
          mintAmount,
          mintWalletAddress.trim(),
          mintSource as CurrencyPreference,
          opts,
        );
        setLastTxId(res.transaction_id);
        setLastResponse(res);
        toast({
          title: "Mint submitted",
          description: `Transaction ${res.transaction_id} · status ${res.status}`,
        });
      } else if (activeTab === "burn") {
        logger.info("Burning ACBU", { amount: burnAmount, destination: burnDestination }); // <-- ADD LOGGER
        
        // Generate blockchain proof before submission
        if (!userId) throw new Error("Not signed in");
        if (!stellarAddress) throw new Error("No linked Stellar wallet address.");
        
        const signer = await getWalletSigner();
        const submit = await submitBurnRedeemSingleClient({
          userAddress: stellarAddress,
          amountAcbu: burnAmount,
          currency: "NGN",
          userSecret: signer.userSecret,
          external: signer.external,
        });
        const burnTxHash = submit.transactionHash;
        
        // Submit burn with blockchain proof
        const recipientType =
          burnDestination === "bank"
            ? "bank"
            : burnDestination === "mobile"
              ? "mobile_money"
              : undefined;
        const res = await burnApi.burnAcbu(
          burnAmount,
          "NGN",
          {
            type: recipientType as "bank" | "mobile_money" | undefined,
            account_number: burnAccountNumber.trim(),
            bank_code: burnBankCode.trim(),
            account_name: burnAccountName.trim(),
          },
          opts,
          burnTxHash,
        );
        setLastTxId(res.transaction_id);
        setLastResponse(res);
        toast({
          title: "Burn submitted",
          description: `Transaction ${res.transaction_id} · status ${res.status}`,
        });
      } else {
        logger.info("International transfer", { amount: intlAmount, country: intlCountry });
        
        // Generate blockchain proof before submission
        const signer = await getWalletSigner();
        const submit = await submitBurnRedeemSingleClient({
          userAddress: signer.address,
          amountAcbu: intlAmount,
          currency: intlCurrency,
          userSecret: signer.userSecret,
          external: signer.external,
        });
        const burnTxHash = submit.transactionHash;
        
        // Submit international transfer with blockchain proof
        const res: BurnResponse = await burnApi.burnAcbu(
          intlAmount,
          intlCurrency,
          {
            account_number: intlAccountNumber.trim(),
            bank_code: intlBankCode.trim(),
            account_name: intlAccountName.trim(),
          },
          opts,
          burnTxHash,
        );
        setLastTxId(res.transaction_id);
        setLastResponse(res);
        toast({
          title: "International transfer submitted",
          description: `Transaction ${res.transaction_id} · status ${res.status}`,
        });
      }
      setStep("success");
      refetchBalance();
    } catch (e) {
      logger.error(`Currency operation failed: ${activeTab}`, e); // <-- ADD LOGGER
      setApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep("input");
    setMintAmount("");
    setMintWalletAddress("");
    setBurnAmount("");
    setBurnAccountNumber("");
    setBurnBankCode("");
    setBurnAccountName("");
    setIntlAmount("");
    setIntlAccountNumber("");
    setIntlBankCode("");
    setIntlAccountName("");
    clearError();
    setLastTxId("");
    setLastResponse(null);
  };

  return (
    <>
      <div className="border-b border-border">
        <div className="px-4 pt-6 pb-6">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Currency Operations
          </h1>
          <p className="text-sm text-muted-foreground">
            Convert, mint, and manage your digital assets
          </p>
        </div>
      </div>

      <PageContainer>
        {/* Balance Card */}
        <div className="mb-6">
          <Card className="border-border bg-gradient-to-br from-primary to-secondary p-6 text-primary-foreground">
            <p className="text-sm font-medium opacity-90">ACBU Balance</p>
            <p className="text-3xl font-bold mb-2">
              {balanceLoading || balance == null
                ? "ACBU —"
                : `ACBU ${formatAmount(balance)}`}
            </p>
            <p className="text-xs opacity-75">
              {balanceLoading || balance == null || ngnPerAcbu == null
                ? "≈ ₦ —"
                : `≈ ₦${formatAmount(balance * ngnPerAcbu, 0)}`}
            </p>
            <RetryErrorBlock
              message={balanceError}
              onRetry={refetchBalance}
              className="mt-3 bg-destructive/10 text-xs"
            />
          </Card>
        </div>

        {/* Tabs */}
        <div className="w-full">
          <div className="grid w-full grid-cols-3 px-4 gap-2 bg-transparent border-b border-border">
            <button
              onClick={() => setActiveTab("mint")}
              className={`py-4 rounded-none border-b-2 text-sm font-medium transition-colors ${
                activeTab === "mint"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Mint
            </button>
            <button
              onClick={() => setActiveTab("burn")}
              className={`py-4 rounded-none border-b-2 text-sm font-medium transition-colors ${
                activeTab === "burn"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Burn
            </button>
            <button
              onClick={() => setActiveTab("international")}
              className={`py-4 rounded-none border-b-2 text-sm font-medium transition-colors ${
                activeTab === "international"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              International
            </button>
          </div>

          {/* Mint Tab */}
          <div className={activeTab === "mint" ? "block" : "hidden"} aria-hidden={activeTab !== "mint"}>
            <div className="px-4 py-6 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  Convert USDC to ACBU on Stellar
                </p>
              <Card className="border-border p-4 mb-4">
                <p className="text-xs text-muted-foreground mb-1">Source</p>
                <select
                  value={mintSource}
                  onChange={(e) => setMintSource(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm font-medium bg-background"
                >
                  <option value="stellar">USDC (Stellar)</option>
                </select>
              </Card>

              <div className="mb-4">
                <Label className="form-label">
                  Amount to Mint
                </Label>
                <div className="flex gap-2">
                  <span className="flex items-center text-muted-foreground">
                    $
                  </span>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={mintAmount}
                    onChange={(e) => setMintAmount(e.target.value)}
                    className="border-border text-lg font-semibold"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2 break-words">
                  You'll receive:{" "}
                  {estimatedMintAcbu != null
                    ? `ACBU ${formatAmount(estimatedMintAcbu)}`
                    : mintNumeric > 0
                      ? "ACBU — (rate unavailable)"
                      : "ACBU 0.00"}
                </p>
              </div>

              <div>
                <Label className="form-label">
                  Destination Wallet Address
                </Label>
                <Input
                  type="text"
                  placeholder="GXXXXXXXX... (Stellar address)"
                  value={mintWalletAddress}
                  onChange={(e) => setMintWalletAddress(e.target.value)}
                  className="border-border"
                />
              </div>

              <Card className="border-border bg-muted p-3 mt-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Mint fee</span>
                  <span className="font-medium text-foreground">
                    {mintFeeText}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Rate (ACBU per USD)
                  </span>
                  <span className="font-medium text-foreground">
                    {usdPerAcbu != null
                      ? formatAmount(1 / usdPerAcbu, 4)
                      : "—"}
                  </span>
                </div>
              </Card>

              <Button
                onClick={handleMintConfirm}
                disabled={
                  !debouncedMintAmount ||
                  parseFloat(debouncedMintAmount) <= 0 ||
                  !mintWalletAddress.trim()
                }
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 mt-6"
              >
                <ArrowDown className="w-4 h-4 mr-2" />
                Mint ACBU
              </Button>
            </div>
          </div>
        </div>

          {/* Burn Tab */}
          <div className={activeTab === "burn" ? "block" : "hidden"} aria-hidden={activeTab !== "burn"}>
            <div className="px-4 py-6 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  Convert ACBU to fiat and withdraw
                </p>
              <Card className="border-border p-4 mb-4">
                <p className="text-xs text-muted-foreground mb-1">
                  Destination
                </p>
                <select
                  value={burnDestination}
                  onChange={(e) => setBurnDestination(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm font-medium bg-background"
                >
                  <option value="bank">Bank Transfer</option>
                  <option value="mobile">Mobile Money</option>
                  <option value="wallet">Digital Wallet</option>
                </select>
              </Card>

              <div>
                <Label className="form-label">
                  Amount to Burn
                </Label>
                <div className="flex gap-2">
                  <span className="flex items-center text-muted-foreground">
                    ACBU
                  </span>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={burnAmount}
                    onChange={(e) => setBurnAmount(e.target.value)}
                    className="border-border text-lg font-semibold"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Available:{" "}
                  {balanceLoading || balance == null
                    ? "—"
                    : `ACBU ${formatAmount(balance)}`}
                </p>
                {balance != null && burnNumeric > availableBalance && (
                  <p className="text-xs text-destructive mt-1">
                    Insufficient balance
                  </p>
                )}
              </div>

              <Card className="border-border p-4 mt-4 space-y-3">
                <p className="text-xs text-muted-foreground font-medium">
                  Recipient Account
                </p>
                <div>
                  <Label className="text-sm font-medium text-foreground mb-1 block">
                    Account Number
                  </Label>
                  <Input
                    type="text"
                    placeholder="0123456789"
                    value={burnAccountNumber}
                    onChange={(e) => setBurnAccountNumber(e.target.value)}
                    className="border-border"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium text-foreground mb-1 block">
                    Bank Code
                  </Label>
                  <Input
                    type="text"
                    placeholder="044"
                    value={burnBankCode}
                    onChange={(e) => setBurnBankCode(e.target.value)}
                    className="border-border"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium text-foreground mb-1 block">
                    Account Name
                  </Label>
                  <Input
                    type="text"
                    placeholder="John Doe"
                    value={burnAccountName}
                    onChange={(e) => setBurnAccountName(e.target.value)}
                    className="border-border"
                  />
                </div>
              </Card>

              <Card className="border-border bg-muted p-3 mt-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">You'll receive</span>
                  <span className="font-medium text-foreground">
                    {estimatedBurnNgn != null
                      ? `₦${formatAmount(estimatedBurnNgn, 2)}`
                      : burnNumeric > 0
                        ? "₦ — (rate unavailable)"
                        : "₦0.00"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Burn fee</span>
                  <span className="font-medium text-foreground">
                    {burnFeeText}
                  </span>
                </div>
              </Card>

              <Button
                onClick={handleBurnConfirm}
                disabled={
                  !debouncedBurnAmount ||
                  burnNumeric <= 0 ||
                  (balance != null && burnNumeric > availableBalance) ||
                  !burnAccountNumber.trim() ||
                  !burnBankCode.trim() ||
                  !burnAccountName.trim()
                }
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 mt-6"
              >
                <ArrowUp className="w-4 h-4 mr-2" />
                Burn & Withdraw
              </Button>
            </div>
          </div>
        </div>

          {/* International Tab */}
          <div className={activeTab === "international" ? "block" : "hidden"} aria-hidden={activeTab !== "international"}>
            <div className="px-4 py-6 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  Send money internationally with real-time rates
                </p>

              <div className="space-y-4">
                <div>
                  <label className="form-label">
                    Recipient Country
                  </label>
                  <select
                    value={intlCountry}
                    onChange={(e) => setIntlCountry(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm font-medium bg-background"
                  >
                    <option value="US">United States</option>
                    <option value="UK">United Kingdom</option>
                    <option value="NG">Nigeria</option>
                    <option value="KE">Kenya</option>
                    <option value="GH">Ghana</option>
                  </select>
                </div>

                <div>
                  <label className="form-label">
                    Currency
                  </label>
                  <select
                    value={intlCurrency}
                    onChange={(e) => setIntlCurrency(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm font-medium bg-background"
                  >
                    <option value="USD">USD (US Dollar)</option>
                    <option value="GBP">GBP (British Pound)</option>
                    <option value="NGN">NGN (Nigerian Naira)</option>
                    <option value="KES">KES (Kenyan Shilling)</option>
                    <option value="GHS">GHS (Ghanaian Cedi)</option>
                  </select>
                </div>

                <div>
                  <label className="form-label">
                    Amount (ACBU)
                  </label>
                  <div className="flex gap-2">
                    <span className="flex items-center text-muted-foreground">
                      ACBU
                    </span>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={intlAmount}
                      onChange={(e) => setIntlAmount(e.target.value)}
                      className="border-border text-lg font-semibold"
                    />
                  </div>
                </div>

                <Card className="border-border p-4 space-y-3">
                  <p className="text-xs text-muted-foreground font-medium">
                    Recipient Account
                  </p>
                  <div>
                    <Label className="text-sm font-medium text-foreground mb-1 block">
                      Account Number
                    </Label>
                    <Input
                      type="text"
                      placeholder="0123456789"
                      value={intlAccountNumber}
                      onChange={(e) => setIntlAccountNumber(e.target.value)}
                      className="border-border"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-foreground mb-1 block">
                      Bank Code / SWIFT
                    </Label>
                    <Input
                      type="text"
                      placeholder="BOFAUS3N"
                      value={intlBankCode}
                      onChange={(e) => setIntlBankCode(e.target.value)}
                      className="border-border"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-foreground mb-1 block">
                      Account Name
                    </Label>
                    <Input
                      type="text"
                      placeholder="John Doe"
                      value={intlAccountName}
                      onChange={(e) => setIntlAccountName(e.target.value)}
                      className="border-border"
                    />
                  </div>
                </Card>

                <Card className="border-border bg-muted p-3">
                  <div className="flex items-start gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-foreground">
                        {intlQuoteLoading
                          ? "Fetching live quote..."
                          : intlQuoteError
                            ? "Quote unavailable — try again"
                            : intlPayoutAmount != null
                              ? `Recipient gets: ${intlCurrency} ${formatAmount(intlPayoutAmount)}`
                              : `Recipient gets: ${intlCurrency} 0.00`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Includes all fees: ACBU{" "}
                        {intlFeeAmount != null ? formatAmount(intlFeeAmount) : "—"}
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Live quote from backend — includes intermediary & settlement fees
                  </div>
                </Card>

                <Button
                  onClick={() => setStep("confirm")}
                  disabled={
                    !debouncedIntlAmount ||
                    parseFloat(debouncedIntlAmount) <= 0 ||
                    !intlAccountNumber.trim() ||
                    !intlBankCode.trim() ||
                    !intlAccountName.trim()
                  }
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Continue
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </PageContainer>

      {/* Confirmation Dialog */}
      <AlertDialog open={step === "confirm"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {activeTab === "mint" && "Confirm Mint"}
              {activeTab === "burn" && "Confirm Burn & Withdrawal"}
              {activeTab === "international" && "Confirm Transfer"}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {activeTab === 'mint' &&
                (estimatedMintAcbu != null
                  ? `Mint ACBU ${formatAmount(estimatedMintAcbu)} from USDC`
                  : `Mint from $${mintAmount || '0'} USDC (ACBU amount calculated by backend)`)}
              {activeTab === 'burn' &&
                `Burn ACBU ${formatAmount(burnAmount)} and withdraw to ${burnDestination}`}
              {activeTab === 'international' &&
                `Send ACBU ${formatAmount(intlAmount)} to ${intlCountry}. Recipient receives ${payoutFormatted} after all fees.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Amount:</span>
              <span className="font-medium text-foreground break-words">
                {activeTab === 'mint' && `$${mintAmount}`}
                {activeTab === 'burn' && `ACBU ${formatAmount(burnAmount)}`}
                {activeTab === 'international' && `ACBU ${formatAmount(intlAmount)}`}
              </span>
            </div>
            <div className="flex justify-between text-sm border-t border-border pt-2">
              <span className="text-muted-foreground">
                {activeTab === 'mint' && 'Mint fee:'}
                {activeTab === 'burn' && 'Burn fee:'}
                {activeTab === 'international' && 'Fees:'}
              </span>
              <span className="font-medium text-foreground">
                {activeTab === 'mint' && mintFeeText}
                {activeTab === 'burn' && burnFeeText}
                {activeTab === 'international' &&
                  (intlFeeAmount != null ? `ACBU ${formatAmount(intlFeeAmount)}` : 'Included in quote')}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <AlertDialogCancel
              onClick={() => setStep("input")}
              disabled={submitting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleExecute}
              disabled={submitting || isSubmitDisabled}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? "Processing..." : "Confirm"}
            </AlertDialogAction>
          </div>
          {uiError && (
            <ApiErrorDisplay error={uiError} onDismiss={clearError} className="mt-2" />
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Success Dialog */}
      <AlertDialog open={step === "success"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Operation Submitted</AlertDialogTitle>
            <AlertDialogDescription>
              The backend accepted your {activeTab} request.
              {lastResponse?.status &&
                ` Current status: ${lastResponse.status}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Transaction ID:</span>
              <span className="font-mono text-foreground truncate max-w-[60%]" title={lastTxId}>
                    {lastTxId}
                  </span>
            </div>
            {lastResponse && "fee" in lastResponse && lastResponse.fee && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fee:</span>
                <span className="font-medium text-foreground">
                  {lastResponse.fee}
                </span>
              </div>
            )}
            {lastResponse &&
              "acbu_amount" in lastResponse &&
              lastResponse.acbu_amount && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ACBU received:</span>
                  <span className="font-medium text-foreground">
                    ACBU {formatAmount(lastResponse.acbu_amount)}
                  </span>
                </div>
              )}
            {lastResponse &&
              "local_amount" in lastResponse &&
              lastResponse.local_amount && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">You'll receive:</span>
                  <span className="font-medium text-foreground">
                    {lastResponse.currency} {lastResponse.local_amount}
                  </span>
                </div>
              )}
          </div>
          <AlertDialogAction
            onClick={resetForm}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Done
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
