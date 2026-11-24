'use client';

import React, { useState, useEffect, useMemo } from 'react';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { useTranslations, useFormatter, useLocale } from 'next-intl';
import {
  Send,
  TrendingUp,
  Eye,
  EyeOff,
  Coins,
  Clock,
  Building2,
  ArrowUpRight,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/page-container';
import { SkeletonList } from '@/components/ui/skeleton-list';
import { EmptyState } from '@/components/ui/empty-state';
import { BalanceSkeleton } from '@/components/ui/balance-skeleton';
import { RetryErrorBlock } from '@/components/ui/retry-error-block';
import { useApiOpts } from '@/hooks/use-api';
import { useBalance } from '@/hooks/use-balance';
import { useFiatAccounts } from '@/hooks/use-fiat-accounts';
import { useScrollRestoration } from '@/hooks/use-scroll-restoration';
import * as transactionsApi from '@/lib/api/transactions';
import type { FiatAccount } from '@/lib/api/fiat';
import { useRates } from '@/lib/api/rates';
import type { TransactionListItem, RatesResponse } from '@/types/api';
import { formatAcbu, formatAmount, parseUtcDate } from '@/lib/utils';

function parsePositiveNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseNonNegativeAmount(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** USD notional for one ACBU (from oracle / rates). */
function getUsdPerAcbu(rates: RatesResponse | null): number | null {
  return parsePositiveNumber(rates?.acbu_usd ?? null);
}

/** Local currency units per 1 ACBU (same convention as backend mint path). */
function getLocalPerAcbu(currency: string, rates: RatesResponse | null): number | null {
  if (!rates) return null;
  const key = `acbu_${currency.trim().toLowerCase()}` as keyof RatesResponse;
  return parsePositiveNumber(rates[key] as string | number | null | undefined);
}

function acbuBalanceToUsd(
  acbu: number | null,
  rates: RatesResponse | null,
): number | null {
  if (acbu == null) return null;
  const usdPerAcbu = getUsdPerAcbu(rates);
  if (usdPerAcbu == null) return null;
  return acbu * usdPerAcbu;
}

/** Converts each simulated bank balance (local units) to USD via ACBU cross rates. */
function sumSimulatedFiatUsd(
  accounts: FiatAccount[],
  rates: RatesResponse | null,
): { usd: number; partial: boolean } {
  const usdPerAcbu = getUsdPerAcbu(rates);
  if (!accounts.length) return { usd: 0, partial: false };
  if (usdPerAcbu == null) return { usd: 0, partial: true };

  let total = 0;
  let partial = false;
  for (const acc of accounts) {
    const bal = parseNonNegativeAmount(acc.balance);
    if (bal === 0) continue;
    const localPerAcbu = getLocalPerAcbu(acc.currency, rates);
    if (localPerAcbu == null) {
      partial = true;
      continue;
    }
    const acbuEq = bal / localPerAcbu;
    total += acbuEq * usdPerAcbu;
  }
  return { usd: total, partial };
}

function formatDate(
  iso: string,
  locale: string,
  labels: { today: string; yesterday: string },
) {
  const d = parseUtcDate(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return labels.today;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return labels.yesterday;
  return d.toLocaleDateString(locale);
}

/**
 * Home dashboard page showing balance and recent activity.
 */
export default function Home() {
  const [showBalance, setShowBalance] = useState(true);
  const {
    balance,
    loading: balanceLoading,
    error: balanceError,
    refetch: refetchBalance,
  } = useBalance();
  const opts = useApiOpts();
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const {
    accounts: fiatAccounts,
    loading: fiatLoading,
  } = useFiatAccounts();
  const {
    data: rates,
    loading: ratesLoading,
    error: ratesError,
    refetch: refetchRates,
  } = useRates(opts);

  const t = useTranslations('home');
  const locale = useLocale();
  const format = useFormatter();
  useScrollRestoration('/', !loading);

  const features = useMemo(() => [
    { title: t('features.send.title'), description: t('features.send.description'), icon: Send, href: `/${locale}/send`, color: 'bg-blue-100 dark:bg-blue-900/30', iconColor: 'text-blue-600 dark:text-blue-400' },
    { title: t('features.mint.title'), description: t('features.mint.description'), icon: Coins, href: `/${locale}/mint`, color: 'bg-purple-100 dark:bg-purple-900/30', iconColor: 'text-purple-600 dark:text-purple-400' },
    { title: t('features.simulated_bank.title'), description: t('features.simulated_bank.description'), icon: Building2, href: `/${locale}/fiat`, color: 'bg-green-100 dark:bg-green-900/30', iconColor: 'text-green-600 dark:text-green-400' },
    { title: t('features.rates.title'), description: t('features.rates.description'), icon: TrendingUp, href: `/${locale}/rates`, color: 'bg-amber-100 dark:bg-amber-900/30', iconColor: 'text-amber-600 dark:text-amber-400' }, [locale, t]);
  ], [t]);

  useEffect(() => {
    let cancelled = false;
    transactionsApi.listTransactions({ limit: 20 }, opts).then((data) => {
      if (!cancelled) setTransactions(data.transactions ?? []);
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load activity');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [opts.token]);

  const acbuUsd =
    showBalance && !balanceLoading && balance != null
      ? acbuBalanceToUsd(balance, rates)
      : null;
  const fiatUsdInfo = showBalance ? sumSimulatedFiatUsd(fiatAccounts, rates) : null;

  const acbuAmountText = !showBalance
    ? '••••••'
    : balanceLoading
      ? '...'
      : `ACBU ${balance != null ? format.number(balance, { minimumFractionDigits: 0, maximumFractionDigits: 7 }) : '—'}`;
  const acbuUsdText = !showBalance
    ? '••••••'
    : balanceLoading || ratesLoading
      ? `${t('approx_usd')} ...`
      : balance == null || acbuUsd == null
        ? `${t('approx_usd')} —`
        : `${t('approx_usd')} ${format.number(acbuUsd, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const balanceAnnouncement = !showBalance
    ? 'Balances hidden'
    : balanceLoading
      ? 'Loading balance'
      : balance != null
        ? `Balance updated to ACBU ${format.number(balance, { minimumFractionDigits: 0, maximumFractionDigits: 7 })}`
        : 'Balance unavailable';


  return (
    <>
      <header className="page-header">
        <div className="px-4 py-3 md:px-6 md:py-4 md:max-w-4xl md:mx-auto">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">
              <h1 className="text-base font-bold text-foreground md:text-lg">Welcome back</h1>
              <p className="text-xs text-muted-foreground md:text-sm">Manage your finances</p>
            </div>
            <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 md:w-12 md:h-12">
              <div className="w-7 h-7 rounded-full bg-primary md:w-10 md:h-10" />
            </div>
          </div>
        </div>
      </header>

      <PageContainer>
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-gradient-to-br from-primary/20 via-secondary/10 to-transparent p-5 relative overflow-hidden md:p-6">
            <button
              type="button"
              onClick={() => setShowBalance(!showBalance)}
              className="absolute top-4 right-4 p-1.5 hover:bg-muted rounded-full transition-colors flex-shrink-0 z-10 md:p-2 md:top-5 md:right-5"
              aria-label={showBalance ? 'Hide balances' : 'Show balances'}
            >
              {showBalance ? <Eye className="w-4 h-4 text-muted-foreground md:w-5 md:h-5" /> : <EyeOff className="w-4 h-4 text-muted-foreground md:w-5 md:h-5" />}
            </button>
            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {balanceAnnouncement}
            </div>
            <div className="flex items-start gap-3 pr-12 mb-1 md:gap-6 md:pr-16">
              <div className="flex-1 min-w-0 border-r border-border/60 pr-3 md:pr-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  {t('acbu')}
                </p>
                <p className="text-xs text-muted-foreground mb-1">{t('wallet_balance')}</p>
                <h2 className="text-2xl sm:text-3xl font-bold text-foreground tabular-nums md:text-4xl">
                  {acbuAmountText}
                </h2>
                <p className="text-sm text-muted-foreground mt-1.5 tabular-nums md:text-base">
                  {acbuUsdText}
                </p>
              </div>
              <div className="flex-1 min-w-0 text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  {t('fiat')}
                </p>
                <p className="text-xs text-muted-foreground mb-1">{t('simulated_usd_equivalent')}</p>
                <div className="text-2xl sm:text-3xl font-bold text-foreground tabular-nums space-y-1 md:text-4xl">
                  {!showBalance ? (
                    <p>••••••</p>
                  ) : fiatLoading || ratesLoading ? (
                    <p>...</p>
                  ) : (
                    <>
                      <p>
                        ≈ USD{' '}
                        {format.number(fiatUsdInfo?.usd ?? 0, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </p>
                      {fiatUsdInfo?.partial && fiatAccounts.length > 0 && (
                        <p className="text-xs font-normal text-muted-foreground">
                          {t('some_currencies_missing_rate')}
                        </p>
                      )}
                      {!fiatAccounts.length && (
                        <p className="text-sm font-normal text-muted-foreground mt-1 md:text-base">
                          <Link href={`/${locale}/fiat`} as={`/${locale}/fiat`} className="text-primary font-medium underline-offset-2 hover:underline">
                            {t('add_demo_funds')}
                          </Link>
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            {showBalance && (balanceError || ratesError) && (
              <RetryErrorBlock
                className="mt-3 text-xs"
                message={balanceError || ratesError}
                onRetry={() => {
                  if (balanceError) refetchBalance();
                  if (ratesError) refetchRates();
                }}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <Link key={feature.href} href={feature.href} className="block">
                  <div className={`${feature.color} rounded-lg border border-border/50 p-4 h-full transition-all active:scale-95 md:p-5`}>
                    <Icon className={`w-6 h-6 ${feature.iconColor} mb-2 md:w-7 md:h-7 md:mb-3`} />
                    <h3 className="text-sm font-semibold text-foreground mb-0.5 md:text-base">{feature.title}</h3>
                    <p className="text-xs text-muted-foreground md:text-sm">{feature.description}</p>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="space-y-3 md:space-y-4">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-foreground md:text-base">{t('recent_activity')}</h3>
              <Link href={`/${locale}/activity`} className="text-xs text-primary font-medium md:text-sm">{t('view_all')}</Link>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {loading ? (
              <SkeletonList count={3} itemHeight="h-20" />
            ) : transactions.length === 0 ? (
              <EmptyState
                icon={<Clock className="w-10 h-10" />}
                title={t('no_recent_activity')}
                action={
                  <Link href={`/${locale}/send`} className="text-xs text-primary font-medium">
                    {t('send_money')}
                  </Link>
                }
              />
            ) : (
              <div className="space-y-2 md:space-y-3">
                {transactions.slice(0, 5).map((tx) => (
                  <Link key={tx.transaction_id} href={`/${locale}/transactions/${tx.transaction_id}`} className="block rounded-lg border border-border bg-card p-3 transition-colors active:bg-muted md:p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div
                        className={`p-2 rounded-full flex-shrink-0 md:p-3 ${
                          tx.type === 'mint'
                            ? 'bg-green-100 dark:bg-green-900/30'
                            : tx.type === 'burn'
                              ? 'bg-red-100 dark:bg-red-900/30'
                            : 'bg-blue-100 dark:bg-blue-900/30'
                        }`}
                      >
                        <ArrowUpRight
                          className={`w-4 h-4 md:w-5 md:h-5 ${
                            tx.type === 'mint'
                              ? 'text-green-600 dark:text-green-400'
                              : tx.type === 'burn'
                                ? 'text-red-600 dark:text-red-400'
                              : 'text-blue-600 dark:text-blue-400'
                          }`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        {(() => {
                          const typeLabel =
                            tx.type === 'mint'
                              ? t('tx_type.mint')
                              : tx.type === 'burn'
                                ? t('tx_type.burn')
                                : t('tx_type.transfer');
                          return (
                            <p className="text-sm font-medium text-foreground truncate md:text-base" title={typeLabel}>
                              {typeLabel}
                            </p>
                          );
                        })()}
                        <p className="text-xs text-muted-foreground md:text-sm">
                          {formatDate(tx.created_at, locale, {
                            today: t('today'),
                            yesterday: t('yesterday'),
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pl-11 md:pl-14">
                      <p className="text-sm font-semibold text-foreground md:text-base">
                        {tx.type === 'burn'
                          ? `- ACBU ${formatAcbu(tx.acbu_amount_burned ?? tx.amount_acbu)}`
                          : tx.type === 'mint'
                            ? tx.amount_acbu != null
                              ? `+ ACBU ${formatAcbu(tx.amount_acbu)}`
                              : tx.local_currency && tx.local_amount
                                ? `+ ${tx.local_currency} ${formatAmount(tx.local_amount)}`
                                : '—'
                            : `ACBU ${formatAcbu(tx.amount_acbu)}`}
                      </p>
                      <Badge variant="outline" className="text-xs md:text-sm">
                        {tx.status === 'completed'
                          ? t('status.completed')
                          : tx.status === 'pending'
                            ? t('status.pending')
                            : tx.status === 'failed'
                              ? t('status.failed')
                              : tx.status}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageContainer>
    </>
  );
}
