'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { errorReporter } from '@/lib/error-reporting';
import type { ErrorContext } from '@/lib/error-reporting';

export default function WalletError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    errorReporter.reportError(error, {
      level: 'page',
      context: {
        type: 'page-error',
        page: 'wallet',
        digest: error.digest,
      } satisfies ErrorContext
    });
  }, [error]);

  const handleGoHome = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  return (
    <div className="error-state">
      <div className="error-icon-wrapper">
        <AlertTriangle className="error-icon" />
      </div>
      
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Wallet Error</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          There was an error accessing your wallet. Your funds are safe, but the interface encountered an issue.
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
        <Button onClick={handleGoHome} variant="default" size="sm">
          <Home className="w-4 h-4 mr-2" />
          Go home
        </Button>
      </div>
    </div>
  );
}