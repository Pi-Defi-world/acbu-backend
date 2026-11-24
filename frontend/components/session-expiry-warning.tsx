'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, LogIn, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { SessionStatus } from '@/hooks/use-session-guard';

interface SessionExpiryWarningProps {
  status: SessionStatus;
  onDismiss: () => void;
  dismissed: boolean;
}

/**
 * Renders a dismissible banner when the session is about to expire,
 * and a blocking dialog when it has already expired — prompting the
 * user to re-authenticate before they lose unsaved form data.
 */
export function SessionExpiryWarning({
  status,
  onDismiss,
  dismissed,
}: SessionExpiryWarningProps) {
  const router = useRouter();

  if (status === 'expired') {
    return (
      <AlertDialog open>
        <AlertDialogContent className="max-w-md border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Session Expired
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your session has expired. Please sign in again to continue.
              Any unsaved changes on this page will be preserved until you
              navigate away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogAction
            onClick={() => router.push('/auth/signin')}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <LogIn className="mr-2 h-4 w-4" />
            Sign in again
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (status === 'expiring' && !dismissed) {
    return (
      <div
        role="alert"
        className="fixed top-0 left-0 right-0 z-50 flex items-center gap-3 border-b border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-200 animate-in fade-in slide-in-from-top-2 duration-300 md:left-64"
      >
        <AlertCircle className="h-5 w-5 shrink-0" />
        <p className="flex-1 font-medium">
          Your session may be expiring soon. Save your work or sign in again to
          avoid losing progress.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/auth/signin')}
          className="border-yellow-400 text-yellow-800 hover:bg-yellow-100 dark:border-yellow-600 dark:text-yellow-200 dark:hover:bg-yellow-900"
        >
          <LogIn className="mr-1 h-3 w-3" />
          Sign in
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss warning"
          className="shrink-0 rounded p-1 hover:bg-yellow-200 dark:hover:bg-yellow-800"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return null;
}
