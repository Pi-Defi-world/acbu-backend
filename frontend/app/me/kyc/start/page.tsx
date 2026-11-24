'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft } from 'lucide-react';
import { useApiOpts } from '@/hooks/use-api';
import * as kycApi from '@/lib/api/kyc';

export default function KycStartPage() {
  const router = useRouter();
  const opts = useApiOpts();
  const [countryCode, setCountryCode] = useState('');
  const [feeTxHash, setFeeTxHash] = useState('');
  const [mintTransactionId, setMintTransactionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!countryCode || countryCode.length !== 3) {
      setError('Country code must be 3 letters (e.g. NGA, USA)');
      return;
    }
    if (!feeTxHash.trim() && !mintTransactionId.trim()) {
      setError('Provide either fee_tx_hash (Stellar payment) or mint_transaction_id (your mint to pay KYC fee)');
      return;
    }
    setLoading(true);
    try {
      const body: kycApi.CreateKycApplicationBody = {
        country_code: countryCode.toUpperCase().slice(0, 3),
      };
      if (feeTxHash.trim()) body.fee_tx_hash = feeTxHash.trim();
      if (mintTransactionId.trim()) body.mint_transaction_id = mintTransactionId.trim();
      const res = await kycApi.createApplication(body, opts);
      router.push(`/me/kyc/${res.application_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create application');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="px-4 py-3 flex items-center gap-3">
          <Link href="/me/kyc" className="flex items-center justify-center min-w-[44px] min-h-[44px] -m-2"><ArrowLeft className="w-5 h-5 text-primary" /></Link>
          <h1 className="text-lg font-bold text-foreground">Start KYC</h1>      
        </div>
      </div>
      <PageContainer>
        <Card className="border-border p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            KYC is linked to wallet creation. Provide your country and proof of fee payment (Stellar tx hash or a mint transaction ID where you paid the KYC fee).
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}        
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Country code (3 letters)</label>
              <Input
                placeholder="e.g. NGA, USA"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.toUpperCase().slice(0, 3))}
                className="border-border"
                maxLength={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Fee Stellar transaction hash (optional if you use mint below)</label>
              <Input
                placeholder="Stellar tx hash"
                value={feeTxHash}
                onChange={(e) => setFeeTxHash(e.target.value)}
                className="border-border font-mono text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Or: Mint transaction ID (optional if you used Stellar fee above)</label>        
              <Input
                placeholder="Mint transaction UUID"
                value={mintTransactionId}
                onChange={(e) => setMintTransactionId(e.target.value)}
                className="border-border font-mono text-sm"
              />
            </div>
            <Button type="submit" disabled={loading}>Create application</Button>
          </form>
        </Card>
      </PageContainer>
    </>
  );
}