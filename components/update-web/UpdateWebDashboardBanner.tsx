// Widget kecil di Dashboard kalau ada post Update Web baru (sumber "baru"
// sama dengan titik merah sidebar, lihat hooks/use-update-web-badge.ts).
// Hilang sendiri setelah halaman /update-web dibuka atau lewat 7 hari.

"use client";

import Link from "next/link";
import { ArrowRight, Megaphone } from "lucide-react";
import { useUpdateWebBadge } from "@/hooks/use-update-web-badge";

export function UpdateWebDashboardBanner({ userId }: { userId: string | null }) {
  const { latestPost, isNew, loading } = useUpdateWebBadge(userId);

  if (loading || !isNew || !latestPost) return null;

  return (
    <div className="col-span-12 sm:col-span-6 lg:col-span-4">
      <style>{`
        @keyframes update-web-banner-attention {
          0%, 88% { transform: rotate(0deg); }
          90% { transform: rotate(-8deg); }
          92% { transform: rotate(7deg); }
          94% { transform: rotate(-5deg); }
          96% { transform: rotate(3deg); }
          98%, 100% { transform: rotate(0deg); }
        }
        @media (prefers-reduced-motion: no-preference) {
          .update-web-banner-icon {
            animation: update-web-banner-attention 4s ease-in-out infinite;
          }
        }
      `}</style>
      <Link
        href="/update-web"
        className="group flex items-center gap-3 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-3 transition-colors hover:border-primary/60 hover:from-primary/15"
      >
        <div className="update-web-banner-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Megaphone className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-primary">
            Ada update baru! v{latestPost.version}
          </p>
          <p className="truncate text-sm font-medium">{latestPost.title}</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
