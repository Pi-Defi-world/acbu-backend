import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, Clock, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KycBadgeProps {
  status?: string;
  className?: string;
}

export function KycBadge({ status, className }: KycBadgeProps) {
  const s = status?.toLowerCase();

  if (s === 'approved') {
    return (
      <Badge className={cn("bg-accent/10 text-accent border-accent/20 hover:bg-accent/20 gap-1 px-2 py-0.5 h-auto text-xs font-bold whitespace-nowrap", className)}>
        <CheckCircle2 className="w-3 h-3" /> VERIFIED
      </Badge>
    );
  }

  if (s === 'pending') {
    return (
      <Badge variant="outline" className={cn("bg-yellow-500/10 text-yellow-600 border-yellow-500/20 hover:bg-yellow-500/20 gap-1 px-2 py-0.5 h-auto text-xs font-bold whitespace-nowrap", className)}>
        <Clock className="w-3 h-3" /> PENDING
      </Badge>
    );
  }

  if (s === 'rejected') {
    return (
      <Badge variant="destructive" className={cn("gap-1 px-2 py-0.5 h-auto text-xs font-bold whitespace-nowrap", className)}>
        <XCircle className="w-3 h-3" /> REJECTED
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className={cn("bg-muted text-muted-foreground border-border hover:bg-muted/80 gap-1 px-2 py-0.5 h-auto text-xs font-bold whitespace-nowrap", className)}>
      <AlertCircle className="w-3 h-3" /> UNVERIFIED
    </Badge>
  );
}
