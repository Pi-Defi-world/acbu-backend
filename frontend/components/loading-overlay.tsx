'use client';

import { Loader2 } from 'lucide-react';

interface LoadingOverlayProps {
  isLoading: boolean;
  message?: string;
}

export function LoadingOverlay({ isLoading, message = 'Loading...' }: LoadingOverlayProps) {
  if (!isLoading) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      style={{ pointerEvents: 'none' }}
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className="flex flex-col items-center gap-3 rounded-lg bg-card p-6 shadow-lg"
        style={{ pointerEvents: 'none' }}
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
