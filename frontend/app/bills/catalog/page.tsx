'use client';



import React from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';

export default function BillsCatalogPage() {
  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <Link href="/bills" className="touch-target"><ArrowLeft className="w-5 h-5 text-primary" /></Link>
          <h1 className="page-title">Bill catalog</h1>
        </div>
      </div>
      <PageContainer>
        <Card className="border-border p-4">
          <p className="text-muted-foreground">Browse billers. Coming soon.</p>
        </Card>
      </PageContainer>
    </>
  );
}
