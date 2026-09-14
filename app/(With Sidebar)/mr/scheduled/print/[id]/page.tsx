"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Printer, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateDocument, formatDateTime } from "@/lib/utils";

export default function ScheduledMRPrintPage() {
  const { id } = useParams();
  const router = useRouter();
  const supabase = createClient();

  const [mr, setMr] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchData = async () => {
    setLoading(true);
    const { data: mrData } = await supabase
      .from("mrs")
      .select("*, cabang(nama_cabang)")
      .eq("id", id)
      .single();
    setMr(mrData);

    const { data: itemsData } = await supabase
      .from("mr_items")
      .select("*, item_site_cabang:cabang!mr_items_item_site_cabang_id_fkey(nama_cabang)")
      .eq("mr_id", id)
      .order("item_due_date");
    setItems(itemsData || []);

    setLoading(false);
    if (mrData) {
      setTimeout(() => window.print(), 800);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-slate-300" />
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">
          Generating Document...
        </p>
      </div>
    );
  }

  if (!mr) {
    return (
      <div className="p-20 text-center">
        <h1 className="text-2xl font-bold">Dokumen Tidak Ditemukan</h1>
        <Button onClick={() => router.back()} className="mt-4">
          Kembali
        </Button>
      </div>
    );
  }

  const signatories = (mr.approvals || []).map((a: any) => ({
    role: a.role || "Approver",
    nama: a.nama,
    status: a.status,
    signature_url: a.signature_url,
    processed_at: a.processed_at,
  }));

  return (
    <div className="bg-white min-h-screen text-slate-900 font-serif p-6 print:p-0">
      <div className="fixed top-4 left-4 print:hidden flex gap-2 z-10">
        <Button variant="outline" size="sm" onClick={() => router.back()} className="gap-2">
          <ChevronLeft className="h-4 w-4" /> Kembali
        </Button>
        <Button size="sm" onClick={() => window.print()} className="gap-2 bg-blue-600 text-white">
          <Printer className="h-4 w-4" /> Cetak Ulang
        </Button>
      </div>

      <div className="mx-auto w-full max-w-[210mm] p-[12mm] print:p-0">
        <div className="flex justify-between items-start border-b border-slate-300 pb-5 mb-8">
          <div className="space-y-0.5">
            <h1 className="text-3xl font-black tracking-tighter">WMS-GMI</h1>
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">
              Warehouse Management System
            </p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold uppercase">Scheduled Material Request</h2>
            <p className="text-xs font-medium text-slate-500">
              No. Dokumen: <span className="font-bold text-slate-900">{mr.mr_kode}</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-12 gap-y-2.5 mb-10 text-xs">
          <div className="flex gap-2">
            <span className="w-32 shrink-0 text-slate-500 font-semibold uppercase text-[9px] pt-0.5">Requester</span>
            <span className="font-bold text-slate-900">{mr.mr_pic}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-32 shrink-0 text-slate-500 font-semibold uppercase text-[9px] pt-0.5">Cabang</span>
            <span className="font-bold text-slate-900">{mr.cabang?.nama_cabang || "-"}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-32 shrink-0 text-slate-500 font-semibold uppercase text-[9px] pt-0.5">Tgl Input</span>
            <span className="font-bold text-slate-900">
              {mr.mr_tanggal ? formatDateDocument(mr.mr_tanggal) : "-"}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="w-32 shrink-0 text-slate-500 font-semibold uppercase text-[9px] pt-0.5">Status</span>
            <span className="font-bold text-green-600 uppercase">{mr.mr_status}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-32 shrink-0 text-slate-500 font-semibold uppercase text-[9px] pt-0.5">Prioritas Item</span>
            <span className="font-bold text-slate-900">
              {Array.from(
                new Set(
                  items.map((i: any) => i.item_priority).filter(Boolean),
                ),
              ).join(", ") || "-"}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="w-32 shrink-0 text-slate-500 font-semibold uppercase text-[9px] pt-0.5">Rentang Due Date</span>
            <span className="font-bold text-slate-900">
              {items.length > 0
                ? `${formatDate(items[0].item_due_date)} — ${formatDate(items[items.length - 1].item_due_date)}`
                : "-"}
            </span>
          </div>
        </div>

        <table className="w-full text-[10px] mb-8">
          <thead>
            <tr className="border-b-2 border-slate-400 text-left uppercase text-[8px] text-slate-500">
              <th className="py-2 w-8 text-center font-bold">No</th>
              <th className="py-2 font-bold">Part Number / Deskripsi</th>
              <th className="py-2 w-16 text-right font-bold">Qty</th>
              <th className="py-2 w-20 text-center font-bold">Due Date</th>
              <th className="py-2 w-14 text-center font-bold">Prioritas</th>
              <th className="py-2 w-24 font-bold">Site</th>
              <th className="py-2 w-24 text-center font-bold">Alokasi</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="py-2 text-center align-top">{index + 1}</td>
                <td className="py-2 align-top">
                  <div className="font-bold">{item.part_number}</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">{item.part_name}</div>
                </td>
                <td className="py-2 text-right font-bold align-top">
                  {item.qty_request} {item.satuan}
                </td>
                <td className="py-2 text-center align-top">
                  {item.item_due_date ? formatDate(item.item_due_date) : "-"}
                </td>
                <td className="py-2 text-center align-top">{item.item_priority || "-"}</td>
                <td className="py-2 align-top">
                  {item.item_site_cabang?.nama_cabang || "-"}
                </td>
                <td className="py-2 text-center align-top">
                  PR {item.qty_pr} / SS {item.qty_sharestock_total}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td className="py-4 text-center text-slate-400" colSpan={7}>
                  Tidak ada item
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-14">
          <p className="text-[10px] font-bold uppercase text-slate-400 mb-6 text-center tracking-[0.2em]">
            Dokumen ini ditandatangani secara digital oleh:
          </p>
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-10">
            {signatories.map((s: any, idx: number) => (
              <div key={idx} className="flex w-44 flex-col items-center">
                <div className="text-[9px] font-bold text-slate-500 uppercase mb-2 h-4">
                  {s.role}
                </div>
                <div className="h-20 w-full border-b border-slate-400 flex items-center justify-center relative mb-2">
                  {s.status === "approved" && s.signature_url ? (
                    <img
                      src={s.signature_url}
                      className="max-h-14 max-w-28 object-contain mix-blend-multiply"
                      alt="signature"
                    />
                  ) : (
                    <span className="text-[9px] text-slate-300 italic">Belum tanda tangan</span>
                  )}
                </div>
                <div className="text-sm font-bold uppercase text-center">{s.nama}</div>
                <div className="text-[8px] text-slate-400 font-medium">
                  {s.processed_at ? formatDateTime(s.processed_at) : "Menunggu..."}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 pt-5 flex justify-between items-end text-[8px] font-bold text-slate-400 uppercase">
          <div className="space-y-0.5">
            <p>Dicetak: {formatDateTime(new Date())}</p>
            <p>WMS-GMI System Documentation</p>
          </div>
          <span className="tracking-widest">Original Document</span>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body {
            background: #fff !important;
          }
          @page {
            size: A4;
            margin: 12mm;
          }
        }
      `}</style>
    </div>
  );
}
