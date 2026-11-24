import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

interface SkeletonListProps {
  /** Number of skeleton items to display */
  count?: number
  /** Height of each skeleton item (default: 'h-16') */
  itemHeight?: string
  /** Gap between items (default: 'space-y-2') */
  gap?: string
  /** Additional class name for the container */
  className?: string
}

/**
 * Standardized skeleton loader for list views.
 * Provides consistent loading state across all list-based pages.
 */
export function SkeletonList({
  count = 5,
  itemHeight = 'h-16',
  gap = 'space-y-2',
  className,
}: SkeletonListProps) {
  return (
    <div className={cn(gap, className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn('w-full', itemHeight)} />
      ))}
    </div>
  )
}
