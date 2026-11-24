import { Skeleton } from '@/components/ui/skeleton';

export interface BalanceSkeletonProps {
  /**
   * Whether to show the skeleton in a compact format (for inline/small spaces)
   * or a full format (for large display areas).
   * @default 'full'
   */
  variant?: 'full' | 'compact';
  /**
   * Optional className to override the container styling
   */
  className?: string;
}

/**
 * BalanceSkeleton is a loading placeholder for balance displays.
 * Prevents showing "—" (em dash) or "..." while balance data is being fetched.
 *
 * @example
 * ```tsx
 * const { balance, loading } = useBalance();
 *
 * if (loading) {
 *   return <BalanceSkeleton variant="full" />;
 * }
 *
 * return <div>{CURRENCY} {formatAmount(balance)}</div>;
 * ```
 */
export function BalanceSkeleton({
  variant = 'full',
  className = '',
}: BalanceSkeletonProps) {
  if (variant === 'compact') {
    return <Skeleton className={`h-6 w-24 rounded-md ${className}`} />;
  }

  // Full variant - shows two skeleton lines (main balance + USD equivalent)
  return (
    <div className={`space-y-2 ${className}`}>
      <Skeleton className="h-8 w-32 rounded-md" />
      <Skeleton className="h-5 w-24 rounded-md" />
    </div>
  );
}
