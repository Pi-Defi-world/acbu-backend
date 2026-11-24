import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  /** Icon to display (optional) */
  icon?: React.ReactNode
  /** Main title text */
  title: string
  /** Description text below the title */
  description?: string | React.ReactNode
  /** Optional action button or content */
  action?: React.ReactNode
  /** Additional class name for the container */
  className?: string
}

/**
 * Standardized empty state component for list views.
 * Provides consistent messaging when no data is available.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Empty className={cn('py-12', className)}>
      <EmptyHeader>
        {icon && (
          <EmptyMedia variant="icon">
            {icon}
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {description && (
          <EmptyDescription>{description}</EmptyDescription>
        )}
      </EmptyHeader>
      {action && (
        <div className="flex gap-2 mt-4">
          {action}
        </div>
      )}
    </Empty>
  )
}
