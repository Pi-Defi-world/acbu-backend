'use client';

import React, { useState, useEffect } from 'react';

import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SkeletonList } from '@/components/ui/skeleton-list';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowLeft, Clock } from 'lucide-react';
import { useApiOpts } from '@/hooks/use-api';
import { useLocale } from 'next-intl';
import { useScrollRestoration } from '@/hooks/use-scroll-restoration';
import * as transactionsApi from '@/lib/api/transactions';
import type { TransactionListItem } from '@/types/api';
import { formatAcbu, formatAmount, parseUtcDate } from '@/lib/utils';

function formatDate(iso: string, locale: string) {
  return parseUtcDate(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Activity feed page displaying a list of all transactions.
 */
export default function ActivityPage() {
  const opts = useApiOpts();
  const locale = useLocale();
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useScrollRestoration('/activity', !loading);

  useEffect(() => {
    let cancelled = false;
    transactionsApi.listTransactions(undefined, opts).then((data) => {
      if (!cancelled) setTransactions(data.transactions ?? []);
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [opts.token]);

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <Link href="/me" aria-label="Back" className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><ArrowLeft className="w-5 h-5 text-primary" aria-hidden="true" /></Link>
          <h1 className="page-title">Activity</h1>
        </div>
      </div>
      <PageContainer>
        {error && <p className="text-destructive text-sm mb-3">{error}</p>}
        {loading ? (
          <SkeletonList count={5} />
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={<Clock className="w-10 h-10" />}
            title="No transactions yet"
            description="Mint, burn, and transfer history will appear here."
          />
        ) : (
          <div className="space-y-2">
            {transactions.map((t) => (
             <Link key={t.transaction_id} href={`/transactions/${t.transaction_id}`} className="block">
                <Card className="border-border p-4 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">
                      {t.type === 'mint' ? 'Mint' : t.type === 'burn' ? 'Burn' : 'Transfer'}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDate(t.created_at, locale)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-semibold text-foreground">
                      {t.type === 'burn'
                        ? `- ACBU ${formatAcbu(t.acbu_amount_burned ?? t.amount_acbu)}`
                        : t.type === 'mint'
                          ? t.amount_acbu != null
                            ? `+ ACBU ${formatAcbu(t.amount_acbu)}`
                            : t.local_currency && t.local_amount
                              ? `+ ${t.local_currency} ${formatAmount(t.local_amount)}`
                              : '—'
                          : `ACBU ${formatAcbu(t.amount_acbu)}`}
                    </p>
                    <Badge variant="outline" className="text-xs mt-1">{t.status}</Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </PageContainer>
    </>
  );
}
