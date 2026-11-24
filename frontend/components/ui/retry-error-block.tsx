"use client";

import React from "react";
import { Button } from "@/components/ui/button";

export function RetryErrorBlock({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={`rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive${className ? ` ${className}` : ""}`}
    >
      <p className="font-medium">{message}</p>
      <div className="mt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-destructive/30 text-destructive hover:bg-destructive/10"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    </div>
  );
}

