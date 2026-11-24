'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n-context';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface NavigationGuardContextType {
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (value: boolean) => void;
  confirmNavigation: () => Promise<boolean>;
}

const NavigationGuardContext = createContext<NavigationGuardContextType | undefined>(undefined);

export function NavigationGuardProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
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

  const handleConfirm = useCallback(() => {
    setShowConfirm(false);
    resolveRef.current?.(true);
  }, []);

  const handleCancel = useCallback(() => {
    setShowConfirm(false);
    resolveRef.current?.(false);
  }, []);

  return (
    <NavigationGuardContext.Provider
      value={{
        hasUnsavedChanges,
        setHasUnsavedChanges,
        confirmNavigation,
      }}
    >
      {children}
      <AlertDialog open={showConfirm} onOpenChange={(open) => {
        if (!open) {
          handleCancel();
        }
      }}>
        <AlertDialogContent className="max-w-md border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('navigation.unsavedChangesTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('navigation.unsavedChangesDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2">
            <AlertDialogCancel onClick={handleCancel}>
              {t('navigation.stay')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {t('navigation.leave')}
              </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard(): NavigationGuardContextType {
  const context = useContext(NavigationGuardContext);
  if (!context) {
    throw new Error('useNavigationGuard must be used within a NavigationGuardProvider');
  }
  return context;
}
