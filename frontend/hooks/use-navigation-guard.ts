'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface NavigationGuard {
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (value: boolean) => void;
  /** Confirms navigation; returns true if the user confirms or no unsaved changes */
  confirmNavigation: () => Promise<boolean>;
}

/**
 * Hook to prevent navigation when there are unsaved changes.
 * Handles browser's beforeunload and provides a way to confirm navigation.
 */
export function useNavigationGuard(): NavigationGuard {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  // Handle browser's beforeunload (page refresh, close tab, etc.)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const confirmNavigation = useCallback(async (): Promise<boolean> => {
    if (!hasUnsavedChanges) {
      return true;
    }
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setShowConfirm(true);
    });
  }, [hasUnsavedChanges]);

  return {
    hasUnsavedChanges,
    setHasUnsavedChanges,
    confirmNavigation,
  };
}
