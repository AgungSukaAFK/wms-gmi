"use client";

import Image from "next/image";
import { Headset } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AUTH_BRANDING } from "@/lib/site";
import { AuthSlideshow } from "./auth-slideshow";
import { CompanyLogos } from "./company-logos";

type AuthShellProps = {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
};

// Kerangka semua halaman auth: desktop = slideshow kiri + form kanan,
// mobile = slideshow jadi latar penuh di belakang kartu kaca.
export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <div className="relative min-h-svh w-full lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <aside className="fixed inset-0 bg-slate-950 lg:sticky lg:top-0 lg:h-svh">
        <AuthSlideshow />
        <div className="absolute inset-0 hidden flex-col justify-between p-10 text-white lg:flex xl:p-14">
          <div className="flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur">
              <Image
                src={AUTH_BRANDING.icon}
                alt=""
                width={150}
                height={150}
                className="size-10 rounded-lg bg-white object-contain p-1"
              />
            </div>
            <div>
              <p className="text-xl font-semibold tracking-tight">{AUTH_BRANDING.appName}</p>
              <p className="text-sm text-white/70">{AUTH_BRANDING.subtitle}</p>
            </div>
          </div>
          <div className="max-w-2xl space-y-3">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight text-balance xl:text-4xl">
              {AUTH_BRANDING.headline}
            </h2>
            <p className="max-w-xl text-sm leading-relaxed text-white/75 xl:text-base">
              {AUTH_BRANDING.description}
            </p>
          </div>
        </div>
      </aside>

      <main className="relative flex min-h-svh flex-col px-4 py-4 sm:px-6 lg:bg-background lg:px-10 lg:py-6">
        <div className="flex justify-end">
          <div className="rounded-lg bg-background/80 p-0.5 backdrop-blur lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="Hubungi Admin"
              aria-label="Hubungi Admin"
              onClick={() => toast.info("Layanan chat dengan admin segera hadir.")}
            >
              <Headset className="size-4 text-muted-foreground" />
            </Button>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-6">
          <div className="w-full max-w-md rounded-2xl border bg-background/90 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
            <CompanyLogos className="lg:-mx-10" />
            <div className="my-6 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            <div className="mb-6 space-y-1.5 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
            {children}
          </div>
        </div>

        <footer className="text-center text-xs text-white/70 lg:text-muted-foreground">
          © {new Date().getFullYear()} PT. Garuda Mart Indonesia · {AUTH_BRANDING.appName}
        </footer>
      </main>
    </div>
  );
}
