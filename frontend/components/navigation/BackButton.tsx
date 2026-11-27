'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useNavigationGuard } from '@/contexts/navigation-guard-context';

interface BackButtonProps {
  fallbackHref: string; // required — explicit in-app fallback route
  label?: string; // default: "Back"
  className?: string;
  children?: React.ReactNode;
}

/**
 * BackButton component with fallback-safe navigation.
 * 
 * Uses browser back() only when there's in-app history to go back to.
 * Otherwise navigates to the explicit fallback route, ensuring users
 * never accidentally leave the app shell when arriving via direct URL,
 * external link, or browser bookmark.
 * 
 * The ArrowLeft icon is automatically flipped for RTL locales via CSS
 * (the [dir=rtl] selector rotates it 180°, making it point right).
 * 
 * @example
 * <BackButton fallbackHref="/dashboard" />
 * @example
 * <BackButton fallbackHref="/settings" label="Back to Settings" />
 */
export function BackButton({ 
  fallbackHref, 
  label = 'Back', 
  className = '',
  children 
}: BackButtonProps) {
  const router = useRouter();
  const { confirmNavigation } = useNavigationGuard();

  const handleBack = async () => {
    const confirmed = await confirmNavigation();
    if (!confirmed) return;
    // Only use browser back if we have in-app history
    // window.history.state.idx is set by Next.js router — 0 means
    // this was the entry page (direct URL, external link, etc.)
    if (typeof window !== 'undefined' && window.history.state?.idx > 0) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };

  return (
    <button 
      onClick={handleBack} 
      className={className} 
      aria-label={label}
      type="button"
    >
      {children || (
        <>
          {/* rtl:rotate-180 flips the arrow so it points right in RTL */}
          <ArrowLeft className="w-5 h-5 text-primary rtl:rotate-180" />
          {label && <span className="sr-only">{label}</span>}
        </>
      )}
    </button>
  );
}
