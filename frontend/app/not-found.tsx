import Image from 'next/image';
import Link from 'next/link';
import { FileQuestion, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Root-level 404 fallback — rendered when Next.js cannot match any route
 * outside the [locale] tree (e.g. bare /unknown-path with no locale prefix).
 * This component runs without next-intl context, so strings are hard-coded
 * in English. Locale-prefixed unknown routes are handled by
 * app/[locale]/not-found.tsx which has full translation support.
 */
export default function NotFound() {
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
          Error 404
        </p>
        <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
      </div>

      <Button asChild>
        <Link href="/">
          <Home className="w-4 h-4 mr-2" aria-hidden="true" />
          Go to dashboard
        </Link>
      </Button>
    </div>
  );
}
