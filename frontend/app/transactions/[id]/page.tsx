"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Share2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useApiOpts } from "@/hooks/use-api";
import { useFormatter } from "next-intl";
import * as transactionsApi from "@/lib/api/transactions";
import type { TransactionDetail } from "@/types/api";
import { formatAmount, parseUtcDate } from "@/lib/utils";

function formatDate(iso: string, formatter: ReturnType<typeof useFormatter>) {
  return formatter.dateTime(parseUtcDate(iso), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function shareTransaction(
  data: TransactionDetail,
  formatter: ReturnType<typeof useFormatter>,
) {
  const amount = data.amount_acbu != null
    ? `ACBA ${formatAmount(data.amount_acbu)}`
    : data.local_amount != null
    ? `${data.currency ?? ""} ${formatAmount(data.local_amount)}`
    : "—";
  const date = data.created_at ? formatDate(data.created_at, formatter) : "—";
  const hash = data.blockchain_tx_hash ?? "—";
  const url = window.location.href;

  const shareData = {
    title: "Transaction Receipt",
    text: `Amount: ${amount} | Date: ${date} | Hash: ${hash}`,
    url,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch {
      // User dismissed or share failed — no-op
    }
  } else {
    await navigator.clipboard.writeText(url);
  }
}

/**
 * Detailed view of a specific transaction by id.
 */
export default function TransactionDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const opts = useApiOpts();
  const format = useFormatter();
  const [data, setData] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    if (!data) return;
    await shareTransaction(data, format);
    if (!navigator.share) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [data, format]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    transactionsApi
      .getTransaction(id, opts)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, opts.token]);

  if (!id) {
    return (
      <>
        <div className="page-header">
          <div className="page-header-row">
            <Link
              href="/activity"
              aria-label="Back to activity"
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-md text-primary transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </Link>
            <h1 className="page-title">Transaction</h1>
          </div>
        </div>
        <PageContainer>
          <p className="text-muted-foreground">Invalid transaction ID.</p>
        </PageContainer>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <div className="page-header">
          <div className="page-header-row">
            <Link
              href="/activity"
              aria-label="Back to activity"
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-md text-primary transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </Link>
            <h1 className="page-title">Transaction</h1>
          </div>
        </div>
        <PageContainer>
          <Skeleton className="h-32 w-full" />
        </PageContainer>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <div className="page-header">
          <div className="page-header-row">
            <Link
              href="/activity"
              aria-label="Back to activity"
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-md text-primary transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </Link>
            <h1 className="page-title">Transaction</h1>
          </div>
        </div>
        <PageContainer>
          <p className="text-destructive">{error || "Not found"}</p>
        </PageContainer>
      </>
    );
  }

  const type = data.type ?? "—";
  const status = data.status ?? "—";
  const isFiat = type === "mint" && data.currency && data.local_amount != null;

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <Link
            href="/activity"
            aria-label="Back to activity"
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-md text-primary transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </Link>
          <h1 className="page-title truncate" title="Transaction">
            Transaction
          </h1>
          <button
            type="button"
            onClick={handleShare}
            aria-label="Share transaction receipt"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 shrink-0 rounded-md border border-border px-3 h-8 text-sm font-medium text-foreground bg-transparent transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Share2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{copied ? "Copied!" : "Share"}</span>
          </button>
        </div>
      </div>
      <PageContainer>
        <Card className="border-border p-4 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Type</span>
            <Badge variant="secondary">{type}</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Status</span>
            <Badge variant="outline">{status}</Badge>
          </div>
          {isFiat ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold">
                {data.currency} {formatAmount(data.local_amount)}
              </span>
            </div>
          ) : data.amount_acbu != null ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold">
                ACBA {formatAmount(data.amount_acbu)}
              </span>
            </div>
          ) : null}
          {data.usdc_amount != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">USDC</span>
              <span>{formatAmount(data.usdc_amount)}</span>
            </div>
          )}
          {data.created_at && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(data.created_at, format)}</span>
            </div>
          )}
          {data.completed_at && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Completed</span>
              <span>{formatDate(data.completed_at, format)}</span>
            </div>
          )}
          {data.note && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1">Note</p>
              <p className="text-sm text-foreground break-words">{data.note}</p>
            </div>
          )}
          {data.blockchain_tx_hash && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1">
                Transaction hash
              </p>
              <p className="text-xs font-mono break-all">
                {data.blockchain_tx_hash}
              </p>
            </div>
          )}
        </Card>
      </PageContainer>
    </>
  );
}
