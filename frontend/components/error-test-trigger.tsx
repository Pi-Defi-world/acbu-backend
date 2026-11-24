'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

/**
 * Test component to trigger errors for testing error boundaries
 * Only use in development mode
 */
export function ErrorTestTrigger() {
  const [shouldThrow, setShouldThrow] = useState(false);

  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  if (shouldThrow) {
    throw new Error('Test error triggered by ErrorTestTrigger component');
  }

  const triggerError = () => {
    setShouldThrow(true);
  };

  const triggerAsyncError = () => {
    setTimeout(() => {
      throw new Error('Test async error triggered by ErrorTestTrigger');
    }, 100);
  };

  const triggerPromiseRejection = () => {
    Promise.reject(new Error('Test promise rejection triggered by ErrorTestTrigger'));
  };

  return (
    <div className="fixed bottom-4 right-4 p-4 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded-lg shadow-lg">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
        <span className="text-sm font-semibold text-yellow-900 dark:text-yellow-100">
          Error Testing (Dev Only)
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <Button 
          onClick={triggerError} 
          variant="outline" 
          size="sm"
          className="text-xs"
        >
          Trigger Component Error
        </Button>
        <Button 
          onClick={triggerAsyncError} 
          variant="outline" 
          size="sm"
          className="text-xs"
        >
          Trigger Async Error
        </Button>
        <Button 
          onClick={triggerPromiseRejection} 
          variant="outline" 
          size="sm"
          className="text-xs"
        >
          Trigger Promise Rejection
        </Button>
      </div>
    </div>
  );
}
