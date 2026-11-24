'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FileQuestion, Home } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  const t = useTranslations('not_found');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <Image
        src="/placeholder-logo.svg"
        alt="ACBU logo"
        width={120}
        height={27}
        priority
        className="dark:invert"
        sizes="(max-width: 768px) 100px, 120px"
      />

      <div className="rounded-full bg-primary/10 p-4">
        <FileQuestion className="h-10 w-10 text-primary" aria-hidden="true" />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">
          {t('label')}
        </p>
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {t('description')}
        </p>
      </div>

      <Button asChild>
        <Link href="/">
          <Home className="w-4 h-4 mr-2" aria-hidden="true" />
          {t('cta')}
        </Link>
      </Button>
    </div>
  );
}
