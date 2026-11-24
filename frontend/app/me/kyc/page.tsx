'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, CheckCircle, AlertCircle, Clock, Upload, FileText } from 'lucide-react';
import { useApiOpts } from '@/hooks/use-api';
import * as kycApi from '@/lib/api/kyc';

export default function KycPage() {
  const router = useRouter();
  const opts = useApiOpts();
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    kycApi.getApplications(opts).then((data) => {
      if (!cancelled) setApplications(data.applications || []);
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [opts]);

  const kycLevel: number = applications.some((a) => a.status === 'approved') ? 2 : applications.length > 0 ? 1 : 0;
  const maxLevel = 3;

  const statusColor = (status?: string) => {
    switch (status) {
      case 'approved': return 'text-green-600';
      case 'machine_processing':
      case 'awaiting_review': return 'text-blue-600';
      case 'rejected': return 'text-destructive';
      default: return 'text-muted-foreground';
    }
  };

  const statusIcon = (status?: string) => {
    switch (status) {
      case 'approved': return <CheckCircle className="w-4 h-4" />;
      case 'machine_processing':
      case 'awaiting_review': return <Clock className="w-4 h-4" />;
      case 'rejected': return <AlertCircle className="w-4 h-4" />;
      default: return <Upload className="w-4 h-4" />;
    }
  };

  if (loading) {
    return (
      <>
        <div className="flex items-center gap-3 px-4 pt-4 pb-6 border-b border-border">
          <Link href="/me"><ArrowLeft className="w-5 h-5 text-primary" /></Link>
          <h1 className="text-xl font-bold text-foreground">KYC Verification</h1>
        </div>
        <PageContainer><div className="animate-pulse h-32 bg-muted rounded-lg" /></PageContainer>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 px-4 pt-4 pb-6 border-b border-border">
        <Link href="/me"><ArrowLeft className="w-5 h-5 text-primary hover:text-primary/80" /></Link>
        <h1 className="text-xl font-bold text-foreground">KYC Verification</h1> 
      </div>

      <PageContainer>
        {error && <p className="text-destructive text-sm mb-3">{error}</p>}     
        <Card className="border-border p-6 mb-6">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-foreground">Verification Level</h2>
              <span className="text-sm font-medium text-primary">Level {kycLevel} of {maxLevel}</span>
            </div>
            <Progress value={(kycLevel / maxLevel) * 100} className="h-2" />    
            <p className="text-xs text-muted-foreground mt-2">{kycLevel === 3 ? 'Fully verified' : `Complete level ${kycLevel + 1} for higher limits`}</p>      
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-green-600" /><span className="text-sm font-medium text-foreground">Level 1: Identity verified</span></div>
            <div className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-green-600" /><span className="text-sm font-medium text-foreground">Level 2: Address verified</span></div>
            <div className="flex items-center gap-2"><AlertCircle className="w-5 h-5 text-muted-foreground" /><span className="text-sm text-muted-foreground">Level 3: Income verification (optional)</span></div>
          </div>
        </Card>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Applications</h2>
          <Button variant="outline" size="sm" className="border-border" onClick={() => router.push('/me/kyc/start')}>Start application</Button>
        </div>
        <div className="space-y-3">
          {applications.length === 0 ? (
            <Card className="border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">No KYC applications yet.</p>
              <Button variant="outline" className="mt-3 border-border" onClick={() => router.push('/me/kyc/start')}>Start application</Button>
            </Card>
          ) : (
            applications.map((app) => (
              <Link key={app.id} href={`/me/kyc/${app.id}`}>
                <Card className="border-border p-4">
                  <div className="flex items-start gap-3">
                    <FileText className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-medium text-foreground truncate">Application {app.id.slice(0, 8)}</h3>
                        <div className={`flex items-center gap-1 text-xs font-medium flex-shrink-0 ${statusColor(app.status)}`}>{statusIcon(app.status)}<span className="capitalize">{(app.status ?? 'pending').replace(/_/g, ' ')}</span></div>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))
          )}
        </div>
        <Button variant="outline" className="w-full mt-6 border-border text-primary hover:bg-muted bg-transparent" onClick={() => router.push('/me/kyc/upload')}><Upload className="w-4 h-4 mr-2" />Upload documents</Button>
      </PageContainer>
    </>
  );
}