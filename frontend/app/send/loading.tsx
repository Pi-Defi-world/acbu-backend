import { Skeleton } from "@/components/ui/skeleton";

export default function SendLoading() {
  return (
    <div className="w-full">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="px-4 py-3">
          <Skeleton className="h-7 w-28 mb-3" />
          <Skeleton className="h-10 w-48 rounded-lg" />
        </div>
      </header>
      <div className="px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20 rounded-md" />
          <Skeleton className="h-20 rounded-md" />
        </div>
      </div>
    </div>
  );
}
