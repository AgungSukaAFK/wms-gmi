import {
  Activity,
  Building2,
  CheckCircle2,
  Shield,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Content } from "@/components/content";
import { Badge } from "@/components/ui/badge";

const highlights = [
  {
    icon: Workflow,
    title: "Alur Terintegrasi",
    desc: "Dari permintaan barang sampai penerimaan dan distribusi, seluruh proses saling terhubung.",
  },
  {
    icon: Shield,
    title: "Approval Terkontrol",
    desc: "Approval berjenjang dengan jejak audit, signature, dan status dokumen yang transparan.",
  },
  {
    icon: Activity,
    title: "Monitoring Real-Time",
    desc: "Pantau notifikasi, pending approval, serta progress dokumen tanpa pindah aplikasi.",
  },
];

const appInfo = [
  { label: "Nama Aplikasi", value: "WMS-GMI" },
  { label: "Tipe Sistem", value: "Warehouse Management & Procurement" },
  { label: "Arsitektur", value: "Next.js + Supabase (Self-Hosted)" },
  { label: "Target Pengguna", value: "Operasional, Logistik, Purchasing, Manajemen" },
];

export default function TentangAppPage() {
  return (
    <>
      <Content>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">TENTANG APP</h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Ringkasan Platform WMS-GMI
              </p>
            </div>
          </div>

          <Badge className="w-fit text-[10px] font-bold uppercase">Production Ready</Badge>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" />
            <p className="text-xs font-bold uppercase">Tujuan Utama</p>
          </div>
          <p className="text-sm leading-relaxed text-foreground">
            WMS-GMI dirancang untuk menyatukan proses pergudangan, procurement, dan stock out dalam satu sistem yang terstruktur.
            Fokus utamanya adalah kecepatan proses, akurasi data, dan kontrol approval lintas peran agar operasional berjalan konsisten.
          </p>
        </div>
      </Content>

      <Content>
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide">Keunggulan Sistem</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {highlights.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-lg border bg-background p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-bold">{item.title}</p>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide">Informasi Aplikasi</h2>
          <div className="divide-y rounded-lg border">
            {appInfo.map((item) => (
              <div
                key={item.label}
                className="grid grid-cols-12 gap-2 px-4 py-3 text-xs"
              >
                <p className="col-span-12 font-bold uppercase text-muted-foreground md:col-span-4">
                  {item.label}
                </p>
                <p className="col-span-12 font-semibold text-foreground md:col-span-8">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Content>

      <Content>
        <div className="rounded-lg border border-green-200 bg-green-50/50 p-4 dark:border-green-900/40 dark:bg-green-900/10">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600 dark:text-green-400" />
            <div>
              <p className="text-xs font-bold uppercase text-green-700 dark:text-green-300">
                Komitmen Produk
              </p>
              <p className="mt-1 text-xs leading-relaxed text-foreground">
                Pengembangan WMS-GMI berfokus pada stabilitas, keamanan akses berbasis peran, dan keterlacakan proses end-to-end.
                Setiap perubahan fitur dijaga melalui migration database dan validasi build agar aman untuk operasional harian.
              </p>
            </div>
          </div>
        </div>
      </Content>
    </>
  );
}
