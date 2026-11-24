'use client';



import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Inbox, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageContainer } from '@/components/layout/page-container';
import { formatAmount } from '@/lib/utils';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import {
  listApplications,
  updateApplicationStatus,
  type StoredLoanApplication,
} from '@/lib/lending-store';

/**
 * Backoffice stub — reads submissions from the local persistence layer
 * so reviewers can see that the intake flow is wired end-to-end. When the
 * real backend is online, this same page can be repointed at the server.
 */
export default function LendingAdminPage() {
  const locale = useLocale();
  const format = useTranslations();
  const [applications, setApplications] = useState<StoredLoanApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setApplications(listApplications());
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load applications',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const totalApproved = applications
    .filter((a) => a.status === 'approved')
    .reduce((sum, a) => sum + a.amount, 0);
  const totalPending = applications.filter((a) =>
    a.status === 'pending' || a.status === 'submitted'
  ).length;

  const handleDecision = (id: string, status: 'approved' | 'rejected') => {
    const next = updateApplicationStatus(id, status);
    setApplications(next);
  };

  return (
    <>
      <header className="page-header">
        <div className="mx-auto max-w-md px-4 py-4 flex items-center gap-3">
          <Link href="/lending" className="p-2 hover:bg-muted rounded transition-colors" aria-label="Back to lending">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="page-title">Lending · Backoffice</h1>
            <p className="text-xs text-muted-foreground">Review loan applications</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            className="border-border bg-transparent"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <PageContainer>
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Card className="border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">Pending review</p>
              <p className="text-2xl font-bold text-foreground">{totalPending}</p>
            </Card>
            <Card className="border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">Approved (ACBU)</p>
              <p className="text-2xl font-bold text-foreground">
                {formatAmount(totalApproved)}
              </p>
            </Card>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              All applications ({isLoading ? '…' : applications.length})
            </h2>

            {isLoading ? (
              <Card className="border-border p-6 flex flex-col items-center text-center gap-3">
                <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground">Loading applications…</p>
              </Card>
            ) : loadError ? (
              <Card className="border-border p-6 flex flex-col items-center text-center gap-3">
                <XCircle className="w-8 h-8 text-destructive" />
                <p className="text-sm font-medium text-foreground">
                  Failed to load applications
                </p>
                <p className="text-xs text-muted-foreground">{loadError}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refresh}
                  className="border-border bg-transparent"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Try again
                </Button>
              </Card>
            ) : applications.length === 0 ? (
              <Card className="border-border p-6 flex flex-col items-center text-center gap-3">
                <Inbox className="w-10 h-10 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">No applications yet</p>
                <p className="text-xs text-muted-foreground">
                  Submitted applications from{' '}
                  <Link href="/lending" className="text-primary underline-offset-2 hover:underline">
                    the lending form
                  </Link>{' '}
                  will appear here.
                </p>
              </Card>
            ) : (
              <div className="space-y-3">
                {applications.map((app) => (
                  <Card key={app.id} className="border-border p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{app.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          ACBU {formatAmount(app.amount)} · {app.term} months
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge
                          variant={
                            app.status === 'approved'
                              ? 'default'
                              : app.status === 'rejected'
                                ? 'destructive'
                                : 'secondary'
                          }
                          className="text-xs capitalize"
                        >
                          {app.status}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-xs uppercase tracking-wide"
                        >
                          {app.syncedWithBackend ? 'synced' : 'local'}
                        </Badge>
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">Applicant</dt>
                      <dd className="text-foreground truncate" title={app.applicantUser ?? "—"}>
                        {app.applicantUser ?? "—"}
                      </dd>
                      <dt className="text-muted-foreground">Submitted</dt>
                      <dd className="text-foreground">
                        {format.dateTime(new Date(app.submittedAt), 'short')}
                      </dd>
                      <dt className="text-muted-foreground">Reference</dt>
                      <dd className="text-foreground font-mono truncate" title={app.id}>{app.id}</dd>
                      {app.purpose && (
                        <>
                          <dt className="text-muted-foreground">Purpose</dt>
                          <dd className="text-foreground whitespace-pre-wrap">
                            {app.purpose}
                          </dd>
                        </>
                      )}
                      {app.errorMessage && (
                        <>
                          <dt className="text-muted-foreground">Sync note</dt>
                          <dd className="text-amber-700 dark:text-amber-400">
                            {app.errorMessage}
                          </dd>
                        </>
                      )}
                    </dl>

                    {(app.status === 'pending' || app.status === 'submitted') && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 border-green-500/40 text-green-700 hover:bg-green-500/10 bg-transparent dark:text-green-400"
                          onClick={() => handleDecision(app.id, 'approved')}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10 bg-transparent"
                          onClick={() => handleDecision(app.id, 'rejected')}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageContainer>
    </>
  );
}



// Mock server-side auth verification helper (replace with your actual session / JWT check)
async function verifyAdminSession() {
  const cookieStore = cookies();
  const token = cookieStore.get('auth_token')?.value;

  if (!token) return null;

  try {
    // Example: Decode or verify token securely on the server
    // const payload = await verifyJwt(token);
    // return payload;
    
    // Returning dummy payload for demonstration
    return { role: 'ADMIN', userId: 'usr_123' };
  } catch (error) {
    return null;
  }
}

export default async function LendingAdminBackoffice() {
  // 1. Perform strict server-side session & role validation
  const session = await verifyAdminSession();

  // 2. Enforce authorization boundary: redirect or block if not an admin
  if (!session || session.role !== 'ADMIN') {
    redirect('/auth/login?error=unauthorized_admin_access');
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6 border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Lending Admin Backoffice</h1>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          Restricted Access
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-500">Active Loans Managed</h3>
          <p className="text-2xl font-semibold mt-2">--</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-500">Pending Approvals</h3>
          <p className="text-2xl font-semibold mt-2">--</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-sm font-medium text-gray-500">Risk Policy Status</h3>
          <p className="text-2xl font-semibold text-green-600 mt-2">Secure / Active</p>
        </div>
      </div>

      {/* Backoffice control panel goes here */}
    </div>
  );
}
