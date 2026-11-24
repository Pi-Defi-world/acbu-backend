'use client';



import React from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Briefcase, Mail } from 'lucide-react';

export default function SmePage() {
  const smeEmail = 'sme@acbu.io';
  const subject = encodeURIComponent('SME Services Inquiry from ACBU App');
  const body = encodeURIComponent(
    'I am interested in SME services. Please contact me to start the application process.\n\nSource: /business/sme'
  );
  const mailtoLink = `mailto:${smeEmail}?subject=${subject}&body=${body}`;

  return (
    <>
      <div className="border-b border-border bg-card/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="page-header-row">
          <Link href="/business" className="text-primary">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="page-title">SME Services</h1>
            <p className="text-sm text-muted-foreground">Apply for business banking, transfers, and statements.</p>
          </div>
        </div>
      </div>

      <PageContainer>
        <Card className="border-border p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-secondary p-3">
              <Briefcase className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">SME onboarding</h2>
              <p className="text-sm text-muted-foreground">
                Get started with ACBU SME services for business accounts, transfers, and cash management.
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            <Card className="border-border p-4 bg-background">
              <h3 className="text-sm font-medium text-foreground">What you can do</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>• Open a business account</li>
                <li>• Manage SME transfers</li>
                <li>• Access statements and reporting</li>
              </ul>
            </Card>

            <Button className="w-full justify-between" asChild>
              <a href={mailtoLink} className="flex items-center justify-between gap-3">
                <span>Apply for SME services</span>
                <Mail className="w-4 h-4" />
              </a>
            </Button>

            <div className="flex items-center justify-between rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
              <span>Application route</span>
              <span className="text-foreground">mailto:{smeEmail}</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Tracking source:</span>
            <span className="font-mono text-foreground">/business/sme</span>
          </div>
        </Card>
      </PageContainer>
    </>
  );
}
