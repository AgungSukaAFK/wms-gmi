import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (claims) {
    redirect("/dashboard");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.2),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(14,165,233,0.2),transparent_35%),radial-gradient(circle_at_50%_100%,rgba(34,197,94,0.15),transparent_45%)]" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-16">
        <div className="grid w-full gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="space-y-6">
            <p className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
              WMS GMI
            </p>
            <h1 className="text-4xl font-black leading-tight sm:text-5xl lg:text-6xl">
              Warehouse Management System
            </h1>
            <p className="max-w-xl text-sm text-slate-200 sm:text-base">
              Kelola material request, purchase request, purchase order,
              delivery, dan stok gudang dalam satu alur kerja yang terintegrasi.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="font-bold">
                <Link href="/auth/login">Masuk Sekarang</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="font-bold">
                <Link href="/auth/sign-up" className="text-foreground">
                  Daftar Akun
                </Link>
              </Button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/5 p-6 backdrop-blur-md sm:p-8">
            <h2 className="text-lg font-bold">Modul Inti</h2>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                "Material Request",
                "Purchase Request",
                "Purchase Order",
                "Receive Item",
                "Delivery",
                "Stock Monitoring",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm font-medium"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
