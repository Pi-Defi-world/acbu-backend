'use client';



import React from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { ArrowLeft, CreditCard, Wallet, Users, Shield, Key } from 'lucide-react';

const items = [
  { title: 'Receive', description: 'Address & QR', href: '/me/settings/receive', icon: CreditCard },
  { title: 'Wallet', description: 'Manage wallet', href: '/wallet', icon: Wallet },
  { title: 'Contacts', description: 'Manage contacts', href: '/me/settings/contacts', icon: Users },
  { title: 'Guardians', description: 'Recovery guardians', href: '/me/settings/guardians', icon: Shield },
  { title: 'Security', description: '2FA & delete account', href: '/me/settings/security', icon: Key },
];

export default function SettingsPage() {
  return (
    <>
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="px-4 py-3 flex items-center gap-3">
          <Link href="/me" aria-label="Back to profile">
            <ArrowLeft className="w-5 h-5 text-primary" />
          </Link>
          <h1 className="text-lg font-bold text-foreground">Settings</h1>
        </div>
      </div>
      <PageContainer>
        <div className="space-y-2">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="w-full text-left"
                aria-label={`Go to ${item.title} settings - ${item.description}`}
              >
                <Card className="border-border p-4 flex items-center gap-3">
                  <Icon className="w-5 h-5 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate" title={item.title}>
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate" title={item.description}>
                      {item.description}
                    </p>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </PageContainer>
    </>
  );
}
