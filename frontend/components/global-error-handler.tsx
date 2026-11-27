'use client';

import { useEffect } from 'react';
import { setupGlobalErrorHandling } from '@/lib/error-reporting';
import { logger } from '@/lib/logger';

/**
 * Global error handler component that sets up unhandled error and promise rejection handlers
 * This should be mounted once at the root of the application
 */
export function GlobalErrorHandler() {
  useEffect(() => {
    // Set up global error handling on mount
    setupGlobalErrorHandling();
  }, []);

  // This component doesn't render anything
  return null;
}
