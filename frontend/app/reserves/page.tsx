'use client';



import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Info } from 'lucide-react';
import { useApiOpts, useApiError } from '@/hooks/use-api';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import * as reservesApi from '@/lib/api/reserves';
import type { ReservesResponse } from '@/types/api';
import { formatAmount } from '@/lib/utils';

const DOCS_URL = '/docs/RESERVE_MANAGEMENT';

function MetricLabel({ label, tip }: { label: string; tip: string }) {
  const tipId = React.useId();

  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Learn more: ${label}`}
            aria-describedby={tipId}
          >
            <Info className="w-3.5 h-3.5 text-muted-foreground/60 hover:text-primary transition-colors" />
            <span id={tipId} className="sr-only">
              {tip}
            </span>
          </a>
        </TooltipTrigger>
        <TooltipContent aria-hidden="true">{tip}</TooltipContent>
      </Tooltip>
    </span>
  );
}

export default function ReservesPage() {
  const opts = useApiOpts();
  const { uiError: error, setApiError: handleError } = useApiError();
  const [data, setData] = useState<ReservesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fixed7ToNumber = (v?: string | null) => {
    if (!v) return 0;
    try {
      return Number(BigInt(v)) / 1e7;
    } catch {
      return Number(v) / 1e7;
    }
  };
  const formatPct = (bps?: number | null) => {
    if (bps == null) return '—';
    return `${(bps / 100).toFixed(2)}%`;
  };
  const formatBps = (bps?: number | null) => {
    if (bps == null) return '—';
    const sign = bps > 0 ? '+' : '';
    return `${sign}${(bps / 100).toFixed(2)}%`;
  };

  useEffect(() => {
    let cancelled = false;
    reservesApi.getReserves(opts).then((res) => {
      if (!cancelled) setData(res);
    }).catch((e) => {
      if (!cancelled) handleError(e);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [opts.token]);

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <Link href="/me" className="touch-target"><ArrowLeft className="w-5 h-5 text-primary" /></Link>
          <h1 className="page-title">Reserves</h1>
        </div>
      </div>
      <PageContainer>
        {error && <p className="text-destructive text-sm mb-3">{error.message}</p>}
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : data ? (
          <div className="space-y-4">
            <Card className="border-border p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <MetricLabel label="Total reserves (USD)" tip="On-chain USD value of all backing assets, stored as 7-decimal fixed-point integers." />
                  <span className="text-xs text-muted-foreground">USD value at 7-decimal fixed precision.</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="font-medium">
                    USD {formatAmount(fixed7ToNumber(data.total_reserve_value_usd), 2)}
                  </span>
                  <span className="text-xs text-muted-foreground">{data.source || '—'}</span>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <MetricLabel label="Total ACBU supply" tip="Total ACBU tokens in circulation, tracked by the minting contract." />
                  <span className="text-xs text-muted-foreground">ACBU tokens in circulation.</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="font-medium">
                    ACBU {formatAmount(fixed7ToNumber(data.total_acbu_supply), 2)}
                  </span>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <MetricLabel label="Collateral ratio (×)" tip="Total reserves divided by total ACBU supply in USD terms. Expressed as a multiplier." />
                  <span className="text-xs text-muted-foreground">Reserves ÷ supply, shown as a multiplier.</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="font-medium">
                    {data.effective_ratio == null ? '—' : `${data.effective_ratio.toFixed(3)}×`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    min {data.min_ratio?.toFixed(2)}× · target {data.target_ratio?.toFixed(2)}×
                  </span>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <MetricLabel label="Health" tip="Issuer-reported reserve health status. Indicates whether collateral ratio and weight compliance are within acceptable bounds." />
                  <span className="text-xs text-muted-foreground">Issuer-reported health status.</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="font-medium">{data.health || '—'}</span>
                  <span className="text-xs text-muted-foreground">
                    weight law: {data.weight_law_mode || '—'}
                  </span>
                </div>
              </div>

              {data.weight_compliance?.warnings?.length ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-foreground">Weight drift warnings</p>
                  <p className="text-xs text-muted-foreground">
                    Warn-only. Threshold: ±{formatPct(data.weight_compliance.drift_threshold_bps)}.
                  </p>
                </div>
              ) : null}
            </Card>

            <Card className="border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-foreground">Reserve composition</h2>
                <span className="text-xs text-muted-foreground">
                  {data.currencies?.length ?? 0} currencies
                </span>
              </div>

              <div className="space-y-3">
                {(data.currencies || []).map((c) => (
                  <div key={c.currency} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{c.currency}</span>
                        <span className="text-xs text-muted-foreground">
                          rate: USD {formatAmount(fixed7ToNumber(c.rate_usd), 6)} / 1 {c.currency}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="font-medium text-foreground">
                          {c.drift_warning ? 'Drift' : 'In range'}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatBps(c.drift_bps)}</span>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <div className="flex flex-col">
                        <MetricLabel label="Balance" tip="Raw on-chain amount of this currency held in the reserve pool." />
                        <span className="text-foreground">
                          {formatAmount(fixed7ToNumber(c.amount), 2)} {c.currency}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <MetricLabel label="USD value" tip="Currency balance converted to USD using the current oracle exchange rate." />
                        <span className="text-foreground">
                          USD {formatAmount(fixed7ToNumber(c.value_usd), 2)}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <MetricLabel label="Target" tip="Desired portfolio weight for this currency, expressed in basis points (÷100 = %)." />
                        <span className="text-foreground">{formatPct(c.target_weight_bps)}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <MetricLabel label="Actual" tip="Current portfolio weight, expressed in basis points. Drift from target triggers warnings beyond the allowed threshold." />
                        <span className="text-foreground">{formatPct(c.actual_weight_bps)}</span>
                      </div>
                    </div>
                  </div>
                ))}

                {!data.currencies?.length ? (
                  <p className="text-muted-foreground text-sm">No on-chain reserve entries yet.</p>
                ) : null}
              </div>
            </Card>
          </div>
        ) : (
          <Card className="border-border p-4">
            <p className="text-muted-foreground">No reserves data.</p>
          </Card>
        )}
      </PageContainer>
    </>
  );
}
