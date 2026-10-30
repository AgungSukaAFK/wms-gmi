"use client";

import { AppSidebar } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { createClient } from "@/lib/supabase/client";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { DailyResetGuard } from "@/components/daily-reset-guard";
import { useAuthStore } from "@/stores/auth-store";
import { NotificationProvider } from "@/components/providers/NotificationProvider";
import { FontSizeSync } from "@/components/font-size-sync";
import { NavigationProgress } from "@/components/navigation-progress";
import { TopbarActions } from "@/components/topbar/topbar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  function urlToBreadcrumb(pathname: string) {
    const parts = pathname.split("/").filter(Boolean);
    // Segmen UUID di akhir URL tidak ditampilkan.
    const crumbs = parts.filter(
      (part, index) =>
        !(index === parts.length - 1 && /^[0-9a-fA-F-]{36}$/.test(part)),
    );

    return crumbs.map((part, index) => {
      const isLast = index === crumbs.length - 1;
      const isPage = isLast && crumbs.length === parts.length;
      const href = `/${parts.slice(0, index + 1).join("/")}`;

      const readablePart = decodeURIComponent(
        part.replace(/-/g, " ").replace(/\b\w/g, (s) => s.toUpperCase()),
      );

      // Mobile: cukup crumb terakhir (dipotong kalau kepanjangan), crumb
      // sebelumnya baru muncul mulai md.
      return (
        <Fragment key={index}>
          <BreadcrumbItem
            className={isLast ? "min-w-0" : "hidden shrink-0 md:inline-flex"}
          >
            {isPage ? (
              <BreadcrumbPage className="truncate">{readablePart}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild className="truncate">
                <Link href={href}>{readablePart}</Link>
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
          {!isLast && <BreadcrumbSeparator className="hidden md:block" />}
        </Fragment>
      );
    });
  }

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function fetch() {
      const supabase = createClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (!user) {
        // Supabase tidak terjangkau ≠ sesi invalid — jangan tendang ke login,
        // coba lagi sebentar lagi.
        if (isAuthRetryableFetchError(error)) {
          retryTimer = setTimeout(fetch, 3000);
          return;
        }
        if (error) {
          await supabase.auth.signOut();
        }
        useAuthStore.getState().clearSession();
        // Gunakan router.push untuk navigasi client-side di dalam useEffect
        router.push("/auth/login");
        return;
      }

      setUserId(user.id);

      const profileRes = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profileRes.data && !profileRes.data.nama) {
        toast.warning("Anda belum melengkapi informasi akun.", {
          action: {
            label: "Lengkapi Profil",
            onClick: () => {
              router.push("/profile");
            },
          },
        });
      }
    }

    fetch();

    return () => clearTimeout(retryTimer);
  }, [router]);

  return (
    <NotificationProvider>
      <Toaster richColors position="bottom-right" />
      <FontSizeSync />
      <NavigationProgress />
      <SidebarProvider>
        <AppSidebar className="shadow-lg" />
        <SidebarInset className="[--app-topbar-h:3.5rem] md:[--app-topbar-h:4rem] md:group-has-data-[collapsible=icon]/sidebar-wrapper:[--app-topbar-h:3rem]">
          {/* Sticky + blur; pemisah bawah = border + garis gradien aksen
              (tanpa shadow). Blur dibuat ringan di mobile - repaint tiap
              scroll berat di HP kelas bawah. Tinggi header juga dipakai
              elemen sticky lain di halaman lewat var(--app-topbar-h). */}
          <header
            data-app-topbar
            className="no-print sticky top-0 z-40 mb-4 flex shrink-0 flex-col border-b border-border/60 bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 md:backdrop-blur-xl md:backdrop-saturate-150 md:supports-[backdrop-filter]:bg-background/60 after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-gradient-to-r after:from-transparent after:via-primary/30 after:to-transparent"
          >
            <div className="flex h-(--app-topbar-h) items-center gap-2 transition-[height] ease-linear">
              <div className="flex min-w-0 flex-1 items-center gap-2 pl-3 md:pl-4">
                <SidebarTrigger className="-ml-1 shrink-0" />
                <Separator
                  orientation="vertical"
                  className="mr-1 data-[orientation=vertical]:h-4 md:mr-2"
                />
                <Breadcrumb className="min-w-0">
                  <BreadcrumbList className="flex-nowrap overflow-hidden">
                    <BreadcrumbItem className="hidden shrink-0 md:inline-flex">
                      <BreadcrumbLink asChild>
                        <Link href="/dashboard">WMS-GMI</Link>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    {urlToBreadcrumb(pathname)}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
              <div className="shrink-0 pr-2 md:pr-3">
                <TopbarActions />
              </div>
            </div>
          </header>
          <div className="flex min-w-0 flex-1 flex-col gap-4 [overflow-x:clip] p-4 pt-0">
            {/* Guard selalu dirender (walau userId belum ada) supaya posisi
                {children} di tree tetap — kalau wrapper-nya berganti saat
                userId terisi, halaman ke-unmount lalu mount ulang dan semua
                fetch datanya jalan dua kali. */}
            <DailyResetGuard userId={userId}>
              <div className="grid min-w-0 auto-rows-auto grid-cols-12 items-start gap-4 md:gap-6">
                {children}
              </div>
            </DailyResetGuard>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </NotificationProvider>
  );
}
