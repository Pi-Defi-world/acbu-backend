'use client';

import React from 'react';

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}


/**
 * Mobile-first content wrapper with tablet-optimized spacing.
 * - Mobile (< 768px): px-4 py-4 pb-24 (pb-24 clears the fixed bottom tab bar)
 * - Tablet (768px-1024px): px-6 py-6 with max-width constraint
 * - Desktop (> 1024px): Inherits tablet styles
 *
 * The extra bottom padding is only needed while the mobile tab bar is
 * visible, so it is dropped from `md` upwards where the desktop sidebar
 * takes over.
 */
export function PageContainer({ children, className = '' }: PageContainerProps) {
  return (
    <div className={`px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-0 md:max-w-4xl md:mx-auto ${className}`.trim()}>
      {children}
    </div>
  );
}
