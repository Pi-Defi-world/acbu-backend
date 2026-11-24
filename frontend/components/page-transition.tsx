'use client';

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isLowPowerDevice() {
  const navigatorWithHints = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
    deviceMemory?: number;
  };

  const hasSaveDataEnabled = navigatorWithHints.connection?.saveData === true;
  const hasConstrainedNetwork = ['slow-2g', '2g'].includes(
    navigatorWithHints.connection?.effectiveType ?? '',
  );
  const hasLimitedCpu =
    typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4;
  const hasLimitedMemory =
    typeof navigatorWithHints.deviceMemory === 'number' && navigatorWithHints.deviceMemory <= 4;

  return (
    hasSaveDataEnabled || hasConstrainedNetwork || hasLimitedCpu || hasLimitedMemory
  );
}

function shouldSkipPageTransitions() {
  if (typeof window === 'undefined') {
    return true;
  }

  return prefersReducedMotion() || isLowPowerDevice();
}

interface PageTransitionProps {
  children: React.ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const [animationsDisabled, setAnimationsDisabled] = useState(true);

  useEffect(() => {
    setAnimationsDisabled(shouldSkipPageTransitions());

    if (typeof window === 'undefined') return;

    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setAnimationsDisabled(shouldSkipPageTransitions());

    reducedMotionQuery.addEventListener('change', handleChange);
    return () => reducedMotionQuery.removeEventListener('change', handleChange);
  }, []);

  const transitionKey = useMemo(() => pathname ?? 'root', [pathname]);

  if (animationsDisabled) {
    return <>{children}</>;
  }

  return (
    <div
      key={transitionKey}
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-150"
    >
      {children}
    </div>
  );
}
