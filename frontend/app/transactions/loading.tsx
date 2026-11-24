import { Skeleton } from "@/components/ui/skeleton";

export default function TransactionsLoading() {
  return (
    <div className="w-full">
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="px-4 py-3 flex items-center gap-3">
          <Skeleton className="h-5 w-5 rounded-sm shrink-0" />
          <Skeleton className="h-6 w-28" />
        </div>
      </div>
      <div className="px-4 py-4 pb-24">
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}
