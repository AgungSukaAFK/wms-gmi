// Layout modul Periodic Maintenance (sub kategori sidebar "HM Maintenance"):
// header modul + navigasi Jadwal/Unit/Forecasting AC + pemilih site (dipakai
// bersama semua halaman), footer legenda status (hm.md §9.1).
// Login/logout tidak perlu - seluruh WMS sudah di balik login.

"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, MapPin, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HmAdminProvider, useHmAdmin } from "@/components/hm-maintenance/hm-admin-context";
import { ALL_SITES, HmSiteProvider, useHmSite } from "@/components/hm-maintenance/hm-site-context";
import { StatusLegend } from "@/components/hm-maintenance/hm-status";

const NAV = [
  { href: "/maintenance", label: "Jadwal", exact: true },
  { href: "/maintenance/unit", label: "Unit", exact: false },
  { href: "/maintenance/forecast-ac", label: "Forecasting AC", exact: false },
];

function SiteSelect() {
  const { siteId, sites, ready, setSiteId } = useHmSite();
  return (
    <div className="flex items-center gap-2">
      <MapPin className="h-4 w-4 text-muted-foreground" />
      <Select
        value={siteId === null ? ALL_SITES : String(siteId)}
        onValueChange={(v) => setSiteId(v === ALL_SITES ? null : Number(v))}
        disabled={!ready}
      >
        <SelectTrigger size="sm" className="min-w-40">
          <SelectValue placeholder="Pilih site" />
        </SelectTrigger>
        <SelectContent>
          {sites.map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {s.nama_cabang}
            </SelectItem>
          ))}
          <SelectItem value={ALL_SITES}>Semua Site</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ModuleHeader() {
  const pathname = usePathname();
  const { isAdmin } = useHmAdmin();

  return (
    <div className="col-span-12 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Gauge className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="font-semibold">Panel Kontrol</div>
          <div className="text-xs text-muted-foreground">Periodic Maintenance</div>
        </div>
      </div>
      <nav className="flex items-center gap-1">
        {NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <SiteSelect />
        {isAdmin && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            Admin
          </span>
        )}
      </div>
    </div>
  );
}

export default function MaintenanceLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Legenda aman/segera/lewat cuma relevan untuk jadwal part.
  const showLegend = !pathname.startsWith("/maintenance/forecast-ac");

  return (
    <HmAdminProvider>
      <HmSiteProvider>
        <ModuleHeader />
        {children}
        {showLegend && <StatusLegend />}
      </HmSiteProvider>
    </HmAdminProvider>
  );
}
