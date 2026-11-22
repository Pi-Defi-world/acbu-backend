'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, LogIn } from 'lucide-react';
import { errorReporter } from '@/lib/error-reporting';
import type { ErrorContext } from '@/lib/error-reporting';

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams();
  const locale = (params?.locale as string) ?? 'en';

  useEffect(() => {
    errorReporter.reportError(error, {
      level: 'page',
      context: {
        type: 'page-error',
        page: 'auth',
        digest: error.digest,
      } satisfies ErrorContext
    });
  }, [error]);

  return (
    <div className="error-state">
      <div className="error-icon-wrapper">
        <AlertTriangle className="error-icon" />
      </div>
      
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Authentication Error</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          There was an error with the authentication system. Please try signing in again.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground mt-2">
            Error ID: {error.digest}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={reset} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Try again
        </Button>
        <Link href={`/${locale}/auth/signin`}>
          <Button variant="default" size="sm">
            <LogIn className="w-4 h-4 mr-2" />
            Sign in
          </Button>
        </Link>
      </div>
    </div>
  );
}
