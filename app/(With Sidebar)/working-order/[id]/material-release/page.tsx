"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Printer, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Content } from "@/components/content";
import { formatDateDocument } from "@/lib/utils";

export default function WorkingOrderMaterialReleasePage() {
  const { id } = useParams();
  const router = useRouter();
  const supabase = createClient();

  const [wo, setWo] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) void fetchData();
  }, [id]);

  const fetchData = async () => {
    setLoading(true);
    const { data: woData } = await supabase
      .from("working_orders")
      .select("id, wo_kode, wo_tanggal, departemen, cabang:gudang_cabang_id(nama_cabang), mrs(mr_kode)")
      .eq("id", id)
      .single();
    setWo(woData);

    const { data: itemsData } = await supabase
      .from("working_order_items")
      .select("id, part_number, part_name, satuan, qty, working_order_item_components(*)")
      .eq("wo_id", id)
      .order("id");
    setItems(itemsData || []);
    setLoading(false);

    if (woData) {
      setTimeout(() => window.print(), 800);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-slate-300" />
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">
          Generating Material Release...
        </p>
      </div>
    );
  }

  if (!wo) {
    return (
      <div className="p-20 text-center">
        <h1 className="text-2xl font-bold">Dokumen Tidak Ditemukan</h1>
        <Button onClick={() => router.back()} className="mt-4">
          Kembali
        </Button>
      </div>
    );
  }

  return (
    <Content>
      <div className="bg-white min-h-screen p-0 sm:p-8 font-serif">
        <div className="fixed top-4 left-4 print:hidden flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.back()} className="gap-2">
            <ChevronLeft className="h-4 w-4" /> Kembali
          </Button>
          <Button size="sm" onClick={() => window.print()} className="gap-2 bg-blue-600 text-white">
            <Printer className="h-4 w-4" /> Re-Print
          </Button>
        </div>

        {items.map((item, itemIdx) => (
          <div
            key={item.id}
            className="max-w-[210mm] mx-auto bg-white p-[15mm] border-0 sm:border shadow-none sm:shadow-lg relative"
            style={itemIdx < items.length - 1 ? { pageBreakAfter: "always" } : undefined}
          >
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-6 mb-8">
              <div className="space-y-1">
                <h1 className="text-3xl font-black tracking-tighter text-slate-900">WMS-GMI</h1>
                <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">
                  Warehouse Management System
                </p>
              </div>
              <div className="text-right">
                <h2 className="text-xl font-bold text-slate-900 uppercase">Material Release</h2>
                <p className="text-xs font-medium text-slate-500">
                  No. WO: <span className="font-bold text-slate-900">{wo.wo_kode}</span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-12 gap-y-6 mb-10 text-xs">
              <div className="space-y-3">
                <div className="flex border-b border-slate-100 pb-1.5">
                  <span className="w-32 text-slate-500 font-bold uppercase text-[9px]">MR Asal</span>
                  <span className="font-bold text-slate-900">: {wo.mrs?.mr_kode || "-"}</span>
                </div>
                <div className="flex border-b border-slate-100 pb-1.5">
                  <span className="w-32 text-slate-500 font-bold uppercase text-[9px]">Gudang WO</span>
                  <span className="font-bold text-slate-900">: {wo.cabang?.nama_cabang || "-"}</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex border-b border-slate-100 pb-1.5">
                  <span className="w-32 text-slate-500 font-bold uppercase text-[9px]">Tanggal WO</span>
                  <span className="font-bold text-slate-900">: {formatDateDocument(wo.wo_tanggal)}</span>
                </div>
                <div className="flex border-b border-slate-100 pb-1.5">
                  <span className="w-32 text-slate-500 font-bold uppercase text-[9px]">Departemen</span>
                  <span className="font-bold text-slate-900">: {wo.departemen}</span>
                </div>
              </div>
            </div>

            <div className="mb-6 p-3 border border-slate-900 bg-slate-50">
              <p className="text-[9px] uppercase font-bold text-slate-500">PN Tujuan (Diproduksi)</p>
              <p className="text-sm font-black text-slate-900">
                {item.part_number} — {item.part_name}
              </p>
              <p className="text-xs font-bold text-slate-700">
                Qty: {item.qty} {item.satuan}
              </p>
            </div>

            <div className="mb-8">
              <p className="text-[9px] uppercase font-bold text-slate-500 mb-2">
                Komponen Penyusun (Formula)
              </p>
              <table className="w-full border-collapse border border-slate-900 text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white font-bold uppercase text-[9px]">
                    <th className="border border-slate-900 p-2 text-center w-12">No</th>
                    <th className="border border-slate-900 p-2 text-left">Deskripsi Barang / Part Number</th>
                    <th className="border border-slate-900 p-2 text-right w-24">Qty</th>
                    <th className="border border-slate-900 p-2 text-center w-20">Satuan</th>
                  </tr>
                </thead>
                <tbody>
                  {(item.working_order_item_components || []).map((c: any, index: number) => (
                    <tr key={c.id} className="border-b border-slate-200">
                      <td className="border border-slate-900 p-2 text-center">{index + 1}</td>
                      <td className="border border-slate-900 p-2">
                        <div className="font-bold">{c.component_part_name}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {c.component_part_number}
                        </div>
                      </td>
                      <td className="border border-slate-900 p-2 text-right font-bold">
                        {Number(c.qty_required).toFixed(2)}
                      </td>
                      <td className="border border-slate-900 p-2 text-center uppercase font-medium">
                        {c.component_satuan}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-12 mt-16 text-xs">
              <div className="text-center">
                <div className="h-20 border-b border-slate-400 mb-2" />
                <p className="font-bold uppercase text-slate-700">Dikeluarkan Oleh</p>
              </div>
              <div className="text-center">
                <div className="h-20 border-b border-slate-400 mb-2" />
                <p className="font-bold uppercase text-slate-700">Diterima Oleh</p>
              </div>
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <div className="max-w-[210mm] mx-auto p-10 text-center text-slate-500">
            Tidak ada item pada WO ini.
          </div>
        )}
      </div>
    </Content>
  );
}
