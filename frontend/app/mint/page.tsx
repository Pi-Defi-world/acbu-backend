"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowDown, ArrowUp, ArrowLeft } from 'lucide-react';
import { useApiOpts } from '@/hooks/use-api';
import { useBalance } from '@/hooks/use-balance';
import { useAuth } from '@/contexts/auth-context';
import { getWalletSecretAnyLocal } from '@/lib/wallet-storage';
import { ensureAcbuTrustlineClient } from '@/lib/stellar/trustlines';
import { useStellarWalletsKit } from '@/lib/stellar-wallets-kit';
import { submitBurnRedeemSingleClient } from '@/lib/stellar/burning';
import { Keypair } from '@stellar/stellar-sdk';
import * as ratesApi from '@/lib/api/rates';
import * as fiatApi from '@/lib/api/fiat';
import type { RatesResponse } from '@/types/api';
import { formatAmount } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import { logger } from '@/lib/logger';
import { useConfig } from '@/hooks/use-config';
import { getBurnFeeText, getMintFeeText } from '@/lib/fee-text';

/** `acbu_*` from API = local currency units per 1 ACBU → ACBU = fiat / localPerAcbu. */
function estimateAcbuFromFiat(
  fiatAmount: string,
  currency: string,
  rates: RatesResponse | null,
): number | null {
  if (!rates || !currency || !fiatAmount) return null;
  const n = parseFloat(fiatAmount);
  if (!(n > 0)) return null;
  const key = `acbu_${currency.toLowerCase()}` as keyof RatesResponse;
  const raw = rates[key];
  if (raw == null || raw === "") return null;
  const localPerAcbu = parseFloat(String(raw));
  if (!(localPerAcbu > 0)) return null;
  return n / localPerAcbu;
}

/**
 * Mint and Burn page for ACBU tokens.
 */
export default function MintPage() {
  const opts = useApiOpts();
  const { config } = useConfig();
  const { userId, stellarAddress } = useAuth();
  const { balance, balanceSource, loading: balanceLoading, refresh: refreshBalance } = useBalance();
  const kit = useStellarWalletsKit();
  const [activeTab, setActiveTab] = useState<'mint' | 'burn' | 'rates'>('mint');
  const [step, setStep] = useState<'input' | 'confirm' | 'success'>('input');
  const [burnAmount, setBurnAmount] = useState('');
  const [burnError, setBurnError] = useState('');
  const [rates, setRates] = useState<RatesResponse | null>(null);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [mintError, setMintError] = useState('');
  const [txId, setTxId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [fiatAccounts, setFiatAccounts] = useState<fiatApi.FiatAccount[]>([]);
  const [selectedFiatCurrency, setSelectedFiatCurrency] = useState('');
  const [fiatAmount, setFiatAmount] = useState('');
  const debouncedFiatAmount = useDebounce(fiatAmount, 300);
  const debouncedBurnAmount = useDebounce(burnAmount, 300);
  const mintFeeText = getMintFeeText(config, debouncedFiatAmount, selectedFiatCurrency);
  const burnFeeText = getBurnFeeText(config, debouncedBurnAmount);
  const [mintQuoteRates, setMintQuoteRates] = useState<RatesResponse | null>(null);
  const [mintAcbuReceived, setMintAcbuReceived] = useState<number | null>(null);
  const rateRows = Array.isArray((rates as { rates?: Array<{ currency?: string; rate?: number }> } | null)?.rates)
    ? ((rates as { rates?: Array<{ currency?: string; rate?: number }> }).rates ?? [])
    : [];

  const estimatedMintAcbu = useMemo(
    () => estimateAcbuFromFiat(debouncedFiatAmount, selectedFiatCurrency, mintQuoteRates),
    [debouncedFiatAmount, selectedFiatCurrency, mintQuoteRates],
  );

  useEffect(() => {
    let cancelled = false;
    ratesApi
      .getRates(opts)
      .then((data) => {
        if (!cancelled) setMintQuoteRates(data);
      })
      .catch(() => {
        if (!cancelled) setMintQuoteRates(null);
      });
    return () => {
      cancelled = true;
    };
  }, [opts.token]);

  useEffect(() => {
    fiatApi
      .getFiatAccounts(opts)
      .then((res) => {
        setFiatAccounts(res.accounts || []);
        if (res.accounts?.length > 0) {
          setSelectedFiatCurrency(res.accounts[0].currency);
        }
      })
      .catch((e) => logger.error('Failed to get fiat accounts', e));
  }, [opts.token]);

    useEffect(() => {
        if (activeTab !== "rates") return;
        setRatesLoading(true);
        ratesApi
            .getRates(opts)
            .then(setRates)
            .catch(() => setRates(null))
            .finally(() => setRatesLoading(false));
    }, [activeTab, opts.token]);

    const handleMintConfirm = () => {
        if (!debouncedFiatAmount || parseFloat(debouncedFiatAmount) <= 0 || !selectedFiatCurrency) return;
        setMintError("");
        setStep("confirm");
    };
    const handleBurnConfirm = () => {
        if (!debouncedBurnAmount || parseFloat(debouncedBurnAmount) <= 0 || !selectedFiatCurrency) return;
        setStep("confirm");
    };
    const handleExecuteMint = async () => {
        if (!fiatAmount || parseFloat(fiatAmount) <= 0 || !selectedFiatCurrency)
            return;
        setMintError("");
        setExecuting(true);
        try {
            // Default setup: make sure the recipient trusts the ACBU asset
            // before the backend tries to mint. Without this the minting
            // contract fails with "trustline entry is missing for account".
            // We add it client-side using the local wallet seed and then
            // wait for Horizon to confirm the trustline before calling the
            // backend — Soroban simulation reads the ledger's current state,
            // so an unconfirmed trustline would still fail the mint.
            if (!userId) {
                throw new Error(
                    "Not signed in — refresh and try again.",
                );
            }
            const secret = await getWalletSecretAnyLocal(userId, stellarAddress);

            let accountId: string;
            let trust:
              | Awaited<ReturnType<typeof ensureAcbuTrustlineClient>>
              | null = null;

            if (secret) {
              // Guard: the locally stored seed MUST derive to the public key the
              // backend treats as this user's Stellar account, otherwise we'd
              // keep adding trustlines to the wrong account forever while the
              // mint contract tries to deposit into the real recipient.
              accountId = Keypair.fromSecret(secret).publicKey();
              if (stellarAddress && accountId !== stellarAddress) {
                  throw new Error(
                      `Local wallet (${accountId.slice(0, 6)}…${accountId.slice(-4)}) doesn't match the account on record (${stellarAddress.slice(0, 6)}…${stellarAddress.slice(-4)}). Re-import the correct seed from Settings, or update the wallet address, then retry.`,
                  );
              }
              trust = await ensureAcbuTrustlineClient({ userSecret: secret });
            } else {
              if (!kit) {
                throw new Error(
                  "Your wallet secret isn't available on this device and the wallet connector isn't ready yet. Please wait a moment and retry.",
                );
              }
              accountId = await new Promise<string>((resolve, reject) => {
                kit
                  .openModal({
                    onWalletSelected: async (selectedOption: { id: string }) => {
                      try {
                        kit.setWallet(selectedOption.id);
                        const { address } = await kit.getAddress();
                        resolve(address);
                      } catch (err) {
                        reject(err);
                      }
                    },
                  })
                  .catch(reject);
              });

              if (stellarAddress && accountId !== stellarAddress) {
                throw new Error(
                  `Connected wallet (${accountId.slice(0, 6)}…${accountId.slice(-4)}) doesn't match the account on record (${stellarAddress.slice(0, 6)}…${stellarAddress.slice(-4)}). Connect the correct wallet (or update your linked wallet), then retry.`,
                );
              }

              trust = await ensureAcbuTrustlineClient({
                external: { kit, address: accountId },
              });
            }

            logger.info("[mint] ACBU trustline ensured", {
                account: accountId,
                added: trust?.added,
                visible: trust?.visible,
                txHash: trust?.txHash,
            });
            if (trust?.added && !trust.visible) {
                throw new Error(
                    "ACBU trustline was submitted but hasn't appeared on Horizon yet. Please retry the mint in a few seconds.",
                );
            }

            const res = await fiatApi.postOnRamp(
                fiatAmount,
                selectedFiatCurrency,
                opts,
            );
            setTxId(
                res.blockchain_tx_hash ||
                    res.transaction_id ||
                    res.transactionId ||
                    null,
            );
            const acbu =
                res.acbuAmount ??
                (typeof res.acbu_amount === "number" ? res.acbu_amount : undefined);
            setMintAcbuReceived(
                typeof acbu === "number" && Number.isFinite(acbu) ? acbu : null,
            );
            refreshBalance();
            setStep("success");
        } catch (e) {
            setMintError(e instanceof Error ? e.message : "Mint failed");
        } finally {
            setExecuting(false);
        }
    };
    const handleExecuteBurn = async () => {
        if (!burnAmount || parseFloat(burnAmount) <= 0 || !selectedFiatCurrency)
            return;
        setBurnError("");
        setExecuting(true);
        try {
            if (!userId) {
                throw new Error("Not signed in — refresh and try again.");
            }
            if (!stellarAddress) {
                throw new Error("No linked Stellar wallet address.");
            }
            const secret = await getWalletSecretAnyLocal(userId, stellarAddress);
            let burnTxHash: string;
            if (secret) {
                const localPubKey = Keypair.fromSecret(secret).publicKey();
                if (stellarAddress && localPubKey !== stellarAddress) {
                    throw new Error(
                        `Local wallet (${localPubKey.slice(0, 6)}…${localPubKey.slice(-4)}) doesn't match the account on record (${stellarAddress.slice(0, 6)}…${stellarAddress.slice(-4)}). Re-import the correct seed from Settings, or update the wallet address, then retry.`,
                    );
                }
                const submit = await submitBurnRedeemSingleClient({
                    userAddress: stellarAddress,
                    amountAcbu: burnAmount,
                    currency: selectedFiatCurrency,
                    userSecret: secret,
                });
                burnTxHash = submit.transactionHash;
            } else {
                if (!kit) {
                    throw new Error(
                        "Your wallet secret isn't available on this device and the wallet connector isn't ready yet. Please wait a moment and retry.",
                    );
                }
                const address = await new Promise<string>((resolve, reject) => {
                    kit
                        .openModal({
                            onWalletSelected: async (selectedOption: { id: string }) => {
                                try {
                                    kit.setWallet(selectedOption.id);
                                    const { address } = await kit.getAddress();
                                    resolve(address);
                                } catch (err) {
                                    reject(err);
                                }
                            },
                        })
                        .catch(reject);
                });
                if (stellarAddress && address !== stellarAddress) {
                    throw new Error(
                        `Connected wallet (${address.slice(0, 6)}…${address.slice(-4)}) doesn't match the account on record (${stellarAddress.slice(0, 6)}…${stellarAddress.slice(-4)}). Connect the correct wallet (or update your linked wallet), then retry.`,
                    );
                }
                const submit = await submitBurnRedeemSingleClient({
                    userAddress: stellarAddress,
                    amountAcbu: burnAmount,
                    currency: selectedFiatCurrency,
                    external: { kit, address },
                });
                burnTxHash = submit.transactionHash;
            }
            const res = await fiatApi.postOffRamp(
                burnAmount,
                selectedFiatCurrency,
                burnTxHash,
                opts,
            );
            setTxId(res.transaction_id || res.transactionId || null);
            setStep("success");
        } catch (e) {
            setBurnError(e instanceof Error ? e.message : "Burn failed");
        } finally {
            setExecuting(false);
        }
    };
    const handleExecute = async () => {
        if (activeTab === "mint") {
            await handleExecuteMint();
        } else {
            await handleExecuteBurn();
        }
    };
    const resetForm = () => {
        setStep("input");
        setFiatAmount("");
        setBurnAmount("");
        setBurnError("");
        setTxId(null);
        setMintAcbuReceived(null);
    };

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="px-4 py-4 flex items-center gap-3">
          <Link href="/" className="p-2 hover:bg-muted rounded transition-colors" aria-label="Go back">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Mint & Burn</h1>
            <p className="text-xs text-muted-foreground">Create and redeem ACBU</p>
          </div>
        </div>
      </header>

            <PageContainer>
                <div className="mb-6">
                    <Card className="border-border bg-gradient-to-br from-primary to-secondary p-6 text-primary-foreground">
                        <p className="text-sm font-medium opacity-90">
                            ACBU Balance
                        </p>
                        <p className="text-3xl font-bold mb-2">
                            {balanceLoading ? '...' : `ACBU ${formatAmount(balance)}`}
                        </p>
                        <p className="text-xs opacity-75">
                            {balanceSource === "stellar"
                                ? "ACBU balance from Stellar Horizon."
                                : "Link a wallet to see your on-chain ACBU balance."}
                        </p>
                    </Card>
                </div>

                <Tabs
                    defaultValue="mint"
                    className="w-full"
                    onValueChange={(v) =>
                        setActiveTab(v as "mint" | "burn" | "rates")
                    }
                >
                    <TabsList className="grid w-full grid-cols-3 gap-2 bg-transparent border-b border-border rounded-none">
                        <TabsTrigger
                            value="mint"
                            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                        >
                            Mint
                        </TabsTrigger>
                        <TabsTrigger
                            value="burn"
                            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                        >
                            Burn
                        </TabsTrigger>
                        <TabsTrigger
                            value="rates"
                            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                        >
                            Rates
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="mint" className="py-6 space-y-4">
                        <div>
                            <p className="text-sm text-muted-foreground mb-3">
                                Mint ACBU via custodial on-ramp (demo basket fiat held on the minting
                                contract).
                            </p>
                            {mintError && (
                                <p className="text-sm text-destructive mb-2">
                                    {mintError}
                                </p>
                            )}
                            <div>
                                <label
                                    htmlFor="fiat-account"
                                    className="text-sm font-medium text-foreground mb-2 block"
                                >
                                    Basket currency (demo fiat path)
                                </label>
                                <select
                                    id="fiat-account"
                                    value={selectedFiatCurrency}
                                    onChange={(e) => setSelectedFiatCurrency(e.target.value)}
                                    className="w-full px-3 py-2 border border-border rounded-lg text-sm font-medium bg-background"
                                >
                                    {fiatAccounts.length === 0 ? (
                                        <option value="" disabled>Loading currencies…</option>
                                    ) : (
                                        fiatAccounts.map(acc => (
                                            <option key={acc.id} value={acc.currency}>
                                                {acc.currency} — {acc.bank_name}
                                            </option>
                                        ))
                                    )}
                                </select>
                            </div>
                            <div className="mt-4">
                                <label
                                    htmlFor="fiat-amount"
                                    className="text-sm font-medium text-foreground mb-2 block"
                                >
                                    Amount to Exchange
                                </label>
                                <div className="flex gap-2">
                                    <span className="flex items-center text-muted-foreground font-medium">
                                        {selectedFiatCurrency || "FIAT"}
                                    </span>
                                    <Input
                                        id="fiat-amount"
                                        type="number"
                                        placeholder="0.00"
                                        min="0"
                                        step="any"
                                        value={fiatAmount}
                                        onChange={(e) =>
                                            setFiatAmount(e.target.value)
                                        }
                                        className="border-border text-lg font-semibold"
                                    />
                                </div>
                            </div>
                            {estimatedMintAcbu != null && (
                                <Card className="border-border bg-muted/80 p-3 mt-3">
                                    <p className="text-xs text-muted-foreground mb-1 break-words">
                                        Estimated ACBU (from latest rates)
                                    </p>
                                    <p className="text-lg font-semibold text-foreground break-words">
                                        ≈ {formatAmount(estimatedMintAcbu)} ACBU
                                    </p>
                                </Card>
                            )}
                            <Card className="border-border bg-muted p-3 mt-4">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">
                                        Mint Fee
                                    </span>
                                    <span className="font-medium text-foreground">
                                        {mintFeeText}
                                    </span>
                                </div>
                            </Card>
                            <Button
                                onClick={handleMintConfirm}
                                disabled={
                                    !debouncedFiatAmount ||
                                    parseFloat(debouncedFiatAmount) <= 0 ||
                                    !selectedFiatCurrency
                                }
                                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 mt-6"
                            >
                                <ArrowDown className="w-4 h-4 mr-2" />
                                Mint ACBU
                            </Button>
                        </div>
                    </TabsContent>

                    <TabsContent value="burn" className="py-6 space-y-4">
                        <div>
                            <p className="text-sm text-muted-foreground mb-3">
                                Burn ACBU on-chain for the selected basket slice (no simulated bank
                                credit).
                            </p>
                            {burnError && (
                                <p className="text-sm text-destructive mb-2">
                                    {burnError}
                                </p>
                            )}
                            <div>
                                <label
                                    htmlFor="burn-fiat-account"
                                    className="text-sm font-medium text-foreground mb-2 block"
                                >
                                    Basket currency (burn slice)
                                </label>
                                <select
                                    id="burn-fiat-account"
                                    value={selectedFiatCurrency}
                                    onChange={(e) => setSelectedFiatCurrency(e.target.value)}
                                    className="w-full px-3 py-2 border border-border rounded-lg text-sm font-medium bg-background"
                                >
                                    {fiatAccounts.length === 0 ? (
                                        <option value="" disabled>Loading currencies…</option>
                                    ) : (
                                        fiatAccounts.map(acc => (
                                            <option key={acc.id} value={acc.currency}>
                                                {acc.currency} — {acc.bank_name}
                                            </option>
                                        ))
                                    )}
                                </select>
                            </div>
                            <div className="mt-4">
                                <label
                                    htmlFor="burn-amount"
                                    className="text-sm font-medium text-foreground mb-2 block"
                                >
                                    Amount to Burn
                                </label>
                                <div className="flex gap-2">
                                    <span className="flex items-center text-muted-foreground font-medium">
                                        ACBU
                                    </span>
                                    <Input
                                        id="burn-amount"
                                        type="number"
                                        placeholder="0.00"
                                        value={burnAmount}
                                        onChange={(e) =>
                                            setBurnAmount(e.target.value)
                                        }
                                        className="border-border text-lg font-semibold"
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                    Available: ACBU{" "}
                                    {balanceLoading ? '...' : formatAmount(balance)}
                                </p>
                            </div>
                            <Card className="border-border bg-muted p-3 mt-4">
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-muted-foreground">
                                        You'll receive
                                    </span>
                                    <span className="font-medium text-foreground">
                                        {burnAmount && selectedFiatCurrency
                                            ? `~ ${selectedFiatCurrency} (based on current rate)`
                                            : "—"}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">
                                        Burn Fee
                                    </span>
                                    <span className="font-medium text-foreground">
                                        {burnFeeText}
                                    </span>
                                </div>
                            </Card>
                            <Button
                                onClick={handleBurnConfirm}
                                disabled={
                                    !burnAmount ||
                                    parseFloat(burnAmount) <= 0 ||
                                    !selectedFiatCurrency
                                }
                                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 mt-6"
                            >
                                <ArrowUp className="w-4 h-4 mr-2" />
                                Burn & Redeem
                            </Button>
                        </div>
                    </TabsContent>

          <TabsContent value="rates" className="py-6 space-y-4">
            <div className="space-y-3">
              {ratesLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : rateRows.length ? (
                rateRows.map((r: { currency?: string; rate?: number }) => (
                  <Card key={r.currency ?? r.rate} className="border-border p-4">
                    <div className="flex justify-between">
                      <p className="font-semibold text-foreground">ACBU/{r.currency ?? 'Rate'}</p>
                      <p className="text-lg font-bold text-primary">{r.rate != null ? String(r.rate) : '—'}</p>
                    </div>
                  </Card>
                ))
              ) : (
                <Card className="border-border p-4"><p className="text-muted-foreground">No rates available. Use the API to load rates.</p></Card>
              )}
              <Card className="border-border bg-muted p-4 mt-6"><p className="text-sm font-semibold text-foreground mb-2">How it works</p><ul className="text-xs text-muted-foreground space-y-2"><li>• Mint converts local fiat to native ACBU</li><li>• Burn redeems ACBU for fiat</li><li>• Rates from backend</li></ul></Card>
            </div>
          </TabsContent>
        </Tabs>
      </PageContainer>

            <AlertDialog open={step === "confirm"}>
                <AlertDialogContent className="max-w-md border-border">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {activeTab === "mint"
                                ? "Confirm Mint"
                                : "Confirm Burn"}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="break-words">
                            {activeTab === "mint" &&
                                `Mint ACBU by exchanging ${selectedFiatCurrency} ${formatAmount(fiatAmount)}${
                                    estimatedMintAcbu != null
                                        ? ` (≈ ${formatAmount(estimatedMintAcbu)} ACBU at current rates)`
                                        : ""
                                }`}
                            {activeTab === "burn" &&
                                `Burn ACBU ${formatAmount(burnAmount)} and withdraw to bank account`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4 space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                                Amount:
                            </span>
                            <span className="font-medium text-foreground break-words">
                                {activeTab === "mint"
                                    ? `${selectedFiatCurrency} ${fiatAmount}`
                                    : `ACBU ${formatAmount(burnAmount)}`}
                            </span>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <AlertDialogCancel
                            onClick={() => setStep("input")}
                            disabled={executing}
                        >
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleExecute}
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                            disabled={executing}
                        >
                            {executing ? "Processing..." : "Confirm"}
                        </AlertDialogAction>
                    </div>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={step === "success"}>
                <AlertDialogContent className="max-w-md border-border">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Operation Complete</AlertDialogTitle>
                        <AlertDialogDescription>
                            Your {activeTab} operation has been submitted
                            successfully.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4 space-y-2">
                        <p className="text-sm text-muted-foreground">
                            Transaction ID: {txId ?? "—"}
                        </p>
                        {activeTab === "mint" && mintAcbuReceived != null && (
                            <p className="text-sm font-medium text-foreground">
                                ACBU credited (app ledger):{" "}
                                {formatAmount(mintAcbuReceived)} ACBU
                            </p>
                        )}
                        {activeTab === "mint" && (
                            <p className="text-xs text-muted-foreground">
                                If the Stellar mint contract errors, tokens are still
                                recorded in the app; your balance may show
                                &quot;app ledger&quot; until on-chain mint works.
                            </p>
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
