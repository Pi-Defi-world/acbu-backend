'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useApiOpts } from '@/hooks/use-api';
import * as kycApi from '@/lib/api/kyc';
import type { KycApplication } from '@/types/api';

export default function KycDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const opts = useApiOpts();
  const [app, setApp] = useState<KycApplication & { created_at?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    kycApi.getApplication(id, opts).then((data) => {
      if (!cancelled) setApp(data);
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id, opts.token]);

  if (!id) {
    return (
      <>
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
          <div className="px-4 py-3 flex items-center gap-3">
            <Link href="/me/kyc"><ArrowLeft className="w-5 h-5 text-primary" /></Link>
            <h1 className="text-lg font-bold text-foreground">Application</h1>  
          </div>
        </div>
        <PageContainer><p className="text-muted-foreground">Invalid application.</p></PageContainer>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
          <div className="px-4 py-3 flex items-center gap-3">
            <Link href="/me/kyc"><ArrowLeft className="w-5 h-5 text-primary" /></Link>
            <h1 className="text-lg font-bold text-foreground">Application</h1>  
          </div>
        </div>
        <PageContainer><div className="animate-pulse h-24 bg-muted rounded-lg" /></PageContainer>
      </>
    );
  }

  if (error || !app) {
    return (
      <>
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
          <div className="px-4 py-3 flex items-center gap-3">
            <Link href="/me/kyc"><ArrowLeft className="w-5 h-5 text-primary" /></Link>
            <h1 className="text-lg font-bold text-foreground">Application</h1>  
          </div>
        </div>
        <PageContainer><p className="text-destructive">{error || 'Not found'}</p></PageContainer>
      </>
    );
  }

  const status = (app as { status?: string }).status ?? app.status ?? '—';    
  const created_at = (app as { created_at?: string }).created_at;

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="px-4 py-3 flex items-center gap-3">
          <Link href="/me/kyc"><ArrowLeft className="w-5 h-5 text-primary" /></Link>
          <h1 className="text-lg font-bold text-foreground truncate">Application</h1>
        </div>
      </div>
      <PageContainer>
        <Card className="border-border p-4 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Status</span>
            <Badge variant="outline">{status}</Badge>
          </div>
          {created_at && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Created</span>
              <span>{new Date(created_at).toLocaleString()}</span>
            </div>
          )}
          <Button variant="outline" className="w-full border-border" onClick={() => router.push(`/me/kyc/upload?applicationId=${id}`)}>
            Upload documents
          </Button>
        </Card>
      </PageContainer>
    </>
  );
}