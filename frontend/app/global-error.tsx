'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { errorReporter } from '@/lib/error-reporting';
import type { ErrorContext } from '@/lib/error-reporting';

/**
 * Global error boundary for the entire application
 * This catches errors that occur outside of the normal error boundary hierarchy
 * Note: This file must include its own <html> and <body> tags
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    errorReporter.reportError(error, {
      level: 'app',
      context: {
        type: 'global-error',
        digest: error.digest,
        critical: true,
      } satisfies ErrorContext
    });
  }, [error]);

  const handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  return (
    <html>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center bg-background">
          <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-4">
            <AlertTriangle className="h-12 w-12 text-red-600 dark:text-red-400" />
          </div>
          
          <div className="space-y-3 max-w-md">
            <h1 className="text-2xl font-bold text-foreground">
              Application Error
            </h1>
            <p className="text-base text-muted-foreground">
              The application encountered a critical error. Please try reloading the page.
            </p>
            {error.digest && (
              <p className="text-sm text-muted-foreground mt-3">
                Error ID: {error.digest}
              </p>
            )}
            
            {process.env.NODE_ENV === 'development' && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  Error Details (Development)
                </summary>
                <div className="mt-3 p-4 bg-muted rounded-md text-xs font-mono text-left overflow-auto max-h-48">
                  <div className="text-red-600 dark:text-red-400 font-semibold">
                    {error.name}: {error.message}
                  </div>
                  {error.stack && (
                    <pre className="mt-3 text-muted-foreground whitespace-pre-wrap">
                      {error.stack}
                    </pre>
                  )}
                </div>
              </details>
            )}
          </div>

          <div className="flex gap-3">
            <Button onClick={reset} variant="outline" size="default">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try again
            </Button>
            <Button onClick={handleReload} variant="default" size="default">
              Reload page
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
