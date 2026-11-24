'use client';

import { useEffect, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { errorReporter } from '@/lib/error-reporting';
import type { ErrorContext } from '@/lib/error-reporting';

function getUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem('acbu_user_id');
  } catch {
    return null;
  }
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    errorReporter.reportError(error, {
      level: 'page',
      context: {
        type: 'route-error',
        route: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
        digest: error.digest,
        userId: getUserId() ?? undefined,
      } satisfies ErrorContext,
    });
  }, [error]);

  const handleGoHome = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  const handleReset = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <div className="error-state">
      <div className="error-icon-wrapper">
        <AlertTriangle className="error-icon" />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Page Error</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          This page encountered an unexpected error. You can try again or return to the home page.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground mt-2">
            Error ID: {error.digest}
          </p>
        )}

        {process.env.NODE_ENV === 'development' && (
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Error Details (Development)
            </summary>
            <div className="mt-2 p-3 bg-muted rounded-md text-xs font-mono text-left overflow-auto max-h-32">
              <div className="text-red-600 dark:text-red-400 font-semibold">
                {error.name}: {error.message}
              </div>
              {error.stack && (
                <pre className="mt-2 text-muted-foreground whitespace-pre-wrap">
                  {error.stack}
                </pre>
              )}
            </div>
          </details>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={handleReset} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Try again
        </Button>
        <Button onClick={handleGoHome} variant="default" size="sm">
          <Home className="w-4 h-4 mr-2" />
          Go home
        </Button>
      </div>
    </div>
  );
}
