'use client';



import React, { useEffect, useState } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { ArrowRight, Briefcase, Users, PiggyBank, CreditCard, Settings, Zap } from 'lucide-react';
import { useApiOpts } from '@/hooks/use-api';
import * as businessApi from '@/lib/api/business';
import type { BusinessStatsResponse } from '@/lib/api/business';
import { logger } from '@/lib/logger';
import { useI18n } from '@/contexts/i18n-context';

const businessServices = [
  { id: 'sme', titleKey: 'sme', descKey: 'smeDesc', icon: Briefcase, badge: 'Pro', href: '/business/sme' },
  { id: 'salary', titleKey: 'payroll', descKey: 'payrollDesc', icon: Users, badge: 'New', href: '/salary' },
  { id: 'campaigns', titleKey: 'crowdfunding', descKey: 'crowdfundingDesc', icon: Zap, badge: 'Alpha', href: '/campaigns/1' },
  { id: 'enterprise', titleKey: 'enterprise', descKey: 'enterpriseDesc', icon: PiggyBank, href: '/enterprise' },
  { id: 'gateway', titleKey: 'gateway', descKey: 'gatewayDesc', icon: CreditCard, href: '/gateway' },
];

/**
 * Business overview and services page.
 * Fetches dynamic business statistics from the backend.
 */
export default function BusinessPage() {
  const router = useRouter();
  const opts = useApiOpts();
  const { t } = useI18n();
  const [stats, setStats] = useState<BusinessStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const data = await businessApi.getBusinessStats(opts);
        setStats(data);
      } catch (err) {
        // Fallback: show loading state instead of error UI
        logger.error('Business stats error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [opts.token]);

  return (
    <>
      <div className="border-b border-border">
        <div className="px-4 py-6">
          <h1 className="text-2xl font-bold text-foreground mb-2">{t('business.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('business.subtitle')}</p>
        </div>
      </div>

      <PageContainer>
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Card className="border-border p-4">
            <p className="text-xs text-muted-foreground mb-2">{t('business.monthlyVolume')}</p>
            <p className="text-2xl font-bold text-foreground">
              {loading ? '—' : stats?.monthly_volume || '—'}
            </p>
          </Card>
          <Card className="border-border p-4">
            <p className="text-xs text-muted-foreground mb-2">{t('business.employees')}</p>
            <p className="text-2xl font-bold text-foreground">
              {loading ? '—' : stats?.employees || '—'}
            </p>
          </Card>
        </div>

        <div className="space-y-3 mb-6">
          {businessServices.map((service) => {
            const Icon = service.icon;
            return (
              <button key={service.id} onClick={() => router.push(service.href)} className="w-full text-left">
                <Card className="border-border p-4 transition-all hover:border-primary hover:shadow-sm">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-secondary rounded-lg"><Icon className="w-5 h-5 text-primary" /></div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-foreground">{t(`business.services.${service.titleKey}`)}</h3>
                          {service.badge && <Badge variant="secondary" className="text-xs">{service.badge}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{t(`business.services.${service.descKey}`)}</p>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </div>
                </Card>
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{t('business.additionalTools')}</h3>
          <Button variant="outline" className="w-full justify-between border-border bg-transparent" onClick={() => router.push('/me/settings')}>
            <div className="flex items-center gap-2"><Settings className="w-4 h-4" /><span>{t('business.businessSettings')}</span></div>
            <ArrowRight className="w-4 h-4" />
          </Button>
          <Button variant="outline" className="w-full justify-between border-border bg-transparent" onClick={() => router.push('/me/settings')}>
            <div className="flex items-center gap-2"><Zap className="w-4 h-4" /><span>{t('business.apiIntegration')}</span></div>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </PageContainer>
    </>
  );
}
