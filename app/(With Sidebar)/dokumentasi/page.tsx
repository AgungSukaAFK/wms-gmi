import Link from "next/link";
import {
  BookOpen,
  ClipboardList,
  FileSearch,
  HelpCircle,
  Layers,
  ShieldCheck,
} from "lucide-react";
import { Content } from "@/components/content";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const quickStart = [
  {
    title: "Lengkapi Data Master",
    desc: "Pastikan data Cabang, Barang, Vendor, dan Customer sudah benar sebelum transaksi dibuat.",
  },
  {
    title: "Buat Dokumen Berjenjang",
    desc: "Ikuti alur MR -> PR -> PO -> Receive agar jejak audit dan approval tetap konsisten.",
  },
  {
    title: "Pantau Approval & Notifikasi",
    desc: "Gunakan halaman Notifikasi untuk memproses dokumen pending dan meninjau riwayat aktivitas.",
  },
  {
    title: "Validasi Stock In/Out",
    desc: "Cek modul Stock, Delivery, SPB, dan Return SPB untuk menjaga akurasi pergerakan barang.",
  },
];

const modules = [
  {
    icon: Layers,
    name: "Master Data",
    detail: "Cabang, Barang, Vendor, Customer, Role & Permission, Approval Template.",
  },
  {
    icon: ClipboardList,
    name: "Procurement",
    detail: "Material Request, Purchase Request, Purchase Order, Receive Item.",
  },
  {
    icon: FileSearch,
    name: "Stock & Distribusi",
    detail: "Stock, Delivery, Share Stock, SPB, SPB PO/DO/Invoice, Return SPB.",
  },
  {
    icon: ShieldCheck,
    name: "Kontrol & Audit",
    detail: "Approval berjenjang, Signature Manager, Notifikasi, status dokumen real-time.",
  },
];

export default function DokumentasiPage() {
  return (
    <>
      <Content>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">DOKUMENTASI</h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Panduan Operasional WMS-GMI
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Link href="/pending-approval">
              <Button variant="outline" className="h-9 px-4 text-xs font-bold uppercase">
                Pending Approval
              </Button>
            </Link>
            <Link href="/notifications">
              <Button className="h-9 px-4 text-xs font-bold uppercase">Notifikasi</Button>
            </Link>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide">Quick Start</h2>
            <Badge variant="secondary" className="text-[10px] font-bold uppercase">
              Standar Alur
            </Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {quickStart.map((item, index) => (
              <div key={item.title} className="rounded-lg border bg-background p-4">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">Langkah {index + 1}</p>
                <p className="mt-1 text-sm font-bold text-foreground">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide">Peta Modul</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {modules.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.name} className="rounded-lg border p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-foreground">{item.name}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold uppercase tracking-wide">FAQ Singkat</h2>
          </div>

          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="approval">
              <AccordionTrigger className="text-xs font-bold uppercase">Kenapa dokumen tidak bisa diproses?</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground leading-relaxed">
                Pastikan status dokumen masih pending di tahap Anda, signature sudah tersimpan, dan role Anda punya akses proses dokumen tersebut.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="notif">
              <AccordionTrigger className="text-xs font-bold uppercase">Notifikasi belum masuk, apa yang dicek?</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground leading-relaxed">
                Cek approval template dokumen, akun approver, serta status pending di JSON approval. Untuk production, pastikan migration notifikasi sudah dijalankan di Supabase VPS.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="stock">
              <AccordionTrigger className="text-xs font-bold uppercase">Bagaimana menjaga stock tetap akurat?</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground leading-relaxed">
                Disiplin pada alur dokumen resmi, hindari perubahan manual di luar proses approval, dan lakukan pengecekan berkala di modul Stock dan Delivery.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </Content>
    </>
  );
}
