'use client';

import React, { useState, useEffect } from 'react';
import { useFormatter } from 'next-intl';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApiOpts } from '@/hooks/use-api';
import { useApiError } from '@/hooks/use-api-error';
import { useFiatAccounts } from '@/hooks/use-fiat-accounts';
import { ApiErrorDisplay } from '@/components/ui/api-error-display';
import * as fiatApi from '@/lib/api/fiat';
import { ensureDemoFiatTrustlineClient } from '@/lib/stellar/trustlines';
import { useWalletSetup } from '@/hooks/use-wallet-setup';
import { Building2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function FiatSimPage() {
  const opts = useApiOpts();
  const format = useFormatter();
  const { getWalletSigner } = useWalletSetup();
  const { uiError, setApiError, clearError, isSubmitDisabled } = useApiError();
  const { accounts, loading, error: accountsError, refetch: refetchAccounts } = useFiatAccounts();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastFaucetTx, setLastFaucetTx] = useState<string | null>(null);
  const [validationError, setValidationError] = useState("");

  const [faucetAmount, setFaucetAmount] = useState('');
  const [faucetCurrency, setFaucetCurrency] = useState('NGN');

  // Surface hook-level fetch errors through the shared API error UI.
  useEffect(() => {
    if (accountsError) {
      setApiError(new Error(accountsError));
    }
  }, [accountsError, setApiError]);

  const handleFaucet = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError("");
    if (!faucetAmount || !Number.isFinite(Number(faucetAmount)) || Number(faucetAmount) <= 0) {
      clearError();
      setValidationError("Enter an amount greater than zero.");
      return;
    }

    setActionLoading('faucet');
    clearError();
    setLastFaucetTx(null);
    try {
      const signer = await getWalletSigner();
      const recipient = signer.address;
      await ensureDemoFiatTrustlineClient({
        userSecret: signer.userSecret,
        external: signer.external,
        currency: faucetCurrency,
      });
      const res = await fiatApi.postFaucet(faucetCurrency, faucetAmount, recipient, opts);
      setLastFaucetTx(res.transaction_hash);
      setFaucetAmount('');
      refetchAccounts();
    } catch (e: unknown) {
      setApiError(e);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Demo fiat</h1>
          <p className="text-sm text-muted-foreground">
            Request test basket tokens to your linked wallet, then use Mint to convert them to
            ACBU. Balances come from the network, not this app.
          </p>
        </div>

        {uiError && (
          <div id="faucet-error">
            <ApiErrorDisplay error={uiError} onDismiss={clearError} />
          </div>
        )}
        {validationError && (
          <p
            id="faucet-validation-error"
            role="alert"
            aria-live="assertive"
            className="text-sm text-destructive"
          >
            {validationError}
          </p>
        )}

        {lastFaucetTx && (
          <Card
            role="status"
            aria-live="polite"
            className="p-4 text-sm border-primary/30 bg-primary/5"
          >
            <p className="font-medium text-foreground">Last faucet transaction</p>
            <p className="text-xs text-muted-foreground break-all mt-1">{lastFaucetTx}</p>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-2 font-semibold">
              <Plus className="w-5 h-5 text-primary" />
              <h2>Request test tokens (faucet)</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Amount is in whole units of the selected currency (e.g. 100 = one hundred).
            </p>
            <form onSubmit={handleFaucet} className="flex flex-wrap gap-2">
              <label htmlFor="faucet-currency" className="sr-only">
                Currency
              </label>
              <select
                id="faucet-currency"
                className="bg-background border rounded px-2 text-sm"
                value={faucetCurrency}
                onChange={(e) => {
                  setFaucetCurrency(e.target.value);
                  setValidationError("");
                }}
                aria-describedby={uiError ? "faucet-error" : undefined}
              >
                {['NGN', 'GHS', 'KES', 'EGP', 'ZAR', 'RWF', 'XOF', 'MAD', 'TZS', 'UGX'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <label htmlFor="faucet-amount" className="sr-only">
                Amount
              </label>
              <Input
                id="faucet-amount"
                type="number"
                min="0"
                step="any"
                placeholder="Amount"
                value={faucetAmount}
                onChange={(e) => {
                  setFaucetAmount(e.target.value);
                  setValidationError("");
                }}
                className="flex-1 min-w-[120px]"
                aria-label="Amount"
                aria-invalid={Boolean(validationError)}
                aria-describedby={
                  validationError
                    ? "faucet-validation-error"
                    : uiError
                      ? "faucet-error"
                      : undefined
                }
              />
              <Button type="submit" disabled={!!actionLoading || isSubmitDisabled}>
                {actionLoading === 'faucet' ? '...' : 'Get tokens'}
              </Button>
            </form>
          </Card>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Basket currencies
          </h2>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {accounts.map((acc) => (
                <Card
                  key={acc.id}
                  className="p-4 flex flex-col justify-between border-l-4 border-l-primary"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-xs font-bold text-primary">{acc.bank_name}</p>
                      <p className="text-xs text-muted-foreground">{acc.account_name}</p>
                      <p className="text-xs text-muted-foreground">{acc.account_number}</p>
                    </div>
                    <Badge variant="secondary">{acc.currency}</Badge>
                  </div>
                  <div className="mt-1 space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      {acc.currency} {format.number(Number(acc.balance || 0))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ≈ USD{' '}
                      {acc.usd_equivalent != null
                        ? format.number(Number(acc.usd_equivalent), {
                            maximumFractionDigits: 2,
                          })
                        : '—'}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Use the faucet for test {acc.currency}, then Mint to receive ACBU.
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
