"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UIError } from "@/types/api";

interface ApiErrorDisplayProps {
  error: UIError;
  onDismiss?: () => void;
  /** Called when the action button is clicked (in addition to action.onClick). */
  onActionClick?: () => void;
  className?: string;
}

/**
 * Renders a mapped UIError with its recovery action button/link.
 * Handles the 30-second countdown for rate-limit (429) errors automatically.
 */
export function ApiErrorDisplay({
  error,
  onDismiss,
  onActionClick,
  className,
}: ApiErrorDisplayProps) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!error.action?.disableSubmitFor) {
      setSecondsLeft(null);
      return;
    }
    const total = Math.ceil(error.action.disableSubmitFor / 1000);
    setSecondsLeft(total);
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s == null || s <= 1) {
          clearInterval(interval);
          return null;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [error]);

  const { action } = error;

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive animate-in fade-in slide-in-from-top-2 duration-300${className ? ` ${className}` : ""}`}
    >
      <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 space-y-2">
        <p className="font-medium">{error.message}</p>
        {action && (
          <div>
            {action.href ? (
              <Link
                href={action.href}
                target={action.href.startsWith("http") ? "_blank" : undefined}
                rel={
                  action.href.startsWith("http")
                    ? "noopener noreferrer"
                    : undefined
                }
                className="inline-flex items-center text-xs font-semibold underline underline-offset-2 hover:opacity-80"
                onClick={onActionClick}
              >
                {action.label}
              </Link>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={secondsLeft != null}
                onClick={() => {
                  action.onClick?.();
                  onActionClick?.();
                }}
                className="h-7 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                {secondsLeft != null
                  ? `${action.label} (${secondsLeft}s)`
                  : action.label}
              </Button>
            )}
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
