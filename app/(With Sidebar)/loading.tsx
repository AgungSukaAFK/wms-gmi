import { Content } from "@/components/content";
import { Skeleton } from "@/components/ui/skeleton";

// Fallback instan saat pindah menu: sidebar & header tetap, area konten
// langsung diganti skeleton sambil halaman tujuan dirender di server.
export default function Loading() {
  return (
    <Content>
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Memuat halaman...</span>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-56 max-w-full" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </Content>
  );
}
