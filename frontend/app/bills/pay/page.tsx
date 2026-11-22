'use client';



import React from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';

export default function BillsPayPage() {
  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <Link href="/bills" className="touch-target"><ArrowLeft className="w-5 h-5 text-primary" /></Link>
          <h1 className="page-title">Pay bill</h1>
        </div>
      </div>
      <PageContainer>
        <Card className="border-border p-4">
          <p className="text-muted-foreground">Pay a bill. Coming soon.</p>
        </Card>
      </PageContainer>
    </>
  );
}
