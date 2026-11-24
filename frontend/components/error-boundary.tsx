'use client';

import React, { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { errorReporter } from '@/lib/error-reporting';
import type { ErrorContext } from '@/lib/error-reporting';
import { useI18n } from '@/contexts/i18n-context';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  level?: 'component' | 'page' | 'app';
  translations?: { title: string; description: string; retry: string };
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundaryImpl extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    errorReporter.reportError(error, {
      level: this.props.level ?? 'component',
      context: {
        type: 'component-error',
        componentStack: errorInfo.componentStack,
        boundary: 'ErrorBoundary',
      } satisfies ErrorContext,
    });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      const isAppLevel = this.props.level === 'app';
      const isPageLevel = this.props.level === 'page';
      return (
        <div data-testid="error-boundary-fallback" className={`flex flex-col items-center justify-center gap-4 p-6 text-center ${
          isAppLevel ? 'min-h-screen' : isPageLevel ? 'min-h-[400px]' : 'min-h-[200px]'
        }`}>
          <div className="rounded-full bg-red-100 p-3">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{this.props.translations?.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{this.props.translations?.description}</p>
          </div>
          <Button onClick={this.handleReset} variant="outline">
            {this.props.translations?.retry}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export function ErrorBoundary(props: Omit<Props, 'translations'>) {
  const { t } = useI18n();
  return (
    <ErrorBoundaryImpl
      {...props}
      translations={{
        title: t('errors.boundary.title'),
        description: t('errors.boundary.description'),
        retry: t('errors.boundary.retry'),
      }}
    />
  );
}
