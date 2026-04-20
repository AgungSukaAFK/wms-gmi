"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Printer, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Content } from "@/components/content";

export default function PRPrintPage() {
  const { id } = useParams();
  const router = useRouter();
  const supabase = createClient();

  const [pr, setPr] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) fetchData();
  }, [id]);

  const fetchData = async () => {
    setLoading(true);

    const { data: prData } = await supabase
      .from("prs")
      .select(
        `
        id, pr_kode, pr_tanggal, pr_status, accurate, approvals,
        cabang(nama_cabang),
        profiles(nama)
      `,
      )
      .eq("id", id)
      .single();

    setPr(prData);

    const { data: itemsData } = await supabase
      .from("pr_items")
      .select("id, part_number, part_name, qty, satuan, status")
      .eq("pr_id", id)
      .order("created_at");

    setItems(itemsData || []);
    setLoading(false);

    if (prData) {
      setTimeout(() => {
        window.print();
      }, 800);
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

  if (!pr) {
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.back()}
            className="gap-2"
          >
            <ChevronLeft className="h-4 w-4" /> Kembali
          </Button>
          <Button
            size="sm"
            onClick={() => window.print()}
            className="gap-2 bg-blue-600 text-white"
          >
            <Printer className="h-4 w-4" /> Re-Print
          </Button>
        </div>

        <div className="max-w-[210mm] mx-auto bg-white p-[15mm] border-0 sm:border shadow-none sm:shadow-lg relative">
          <div className="flex justify-between items-start border-b-2 border-slate-900 pb-6 mb-8">
            <div className="space-y-1">
              <h1 className="text-3xl font-black tracking-tighter text-slate-900">
                WMS-GMI
              </h1>
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">
                Warehouse Management System
              </p>
            </div>
            <div className="text-right">
              <h2 className="text-xl font-bold text-slate-900 uppercase">
                Purchase Request Form
              </h2>
              <p className="text-xs font-medium text-slate-500">
                No. Dokumen:{" "}
                <span className="font-bold text-slate-900">{pr.pr_kode}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-6 mb-10 text-xs">
            <div className="space-y-3">
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  PIC PR
                </span>
                <span className="font-bold text-slate-900">
                  : {pr?.profiles?.nama || "-"}
                </span>
              </div>
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Cabang
                </span>
                <span className="font-bold text-slate-900">
                  : {pr?.cabang?.nama_cabang || "-"}
                </span>
              </div>
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Accurate
                </span>
                <span className="font-bold text-slate-900">
                  : {pr?.accurate ? "Sudah" : "Belum"}
                </span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Tanggal PR
                </span>
                <span className="font-bold text-slate-900">
                  :{" "}
                  {pr.pr_tanggal
                    ? new Date(pr.pr_tanggal).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : "-"}
                </span>
              </div>
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Status
                </span>
                <span className="font-bold text-green-600 uppercase">
                  : {pr.pr_status}
                </span>
              </div>
            </div>
          </div>

          <div className="mb-8">
            <table className="w-full border-collapse border border-slate-900 text-xs">
              <thead>
                <tr className="bg-slate-900 text-white font-bold uppercase text-[9px]">
                  <th className="border border-slate-900 p-2 text-center w-12">
                    No
                  </th>
                  <th className="border border-slate-900 p-2 text-left">
                    Deskripsi Barang / Part Number
                  </th>
                  <th className="border border-slate-900 p-2 text-right w-24">
                    Qty
                  </th>
                  <th className="border border-slate-900 p-2 text-center w-20">
                    Satuan
                  </th>
                  <th className="border border-slate-900 p-2 text-center w-28">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr
                    key={item.id || index}
                    className="border-b border-slate-200"
                  >
                    <td className="border border-slate-900 p-2 text-center">
                      {index + 1}
                    </td>
                    <td className="border border-slate-900 p-2">
                      <div className="font-bold">{item.part_name}</div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        {item.part_number}
                      </div>
                    </td>
                    <td className="border border-slate-900 p-2 text-right font-bold">
                      {item.qty}
                    </td>
                    <td className="border border-slate-900 p-2 text-center uppercase font-medium">
                      {item.satuan}
                    </td>
                    <td className="border border-slate-900 p-2 text-center uppercase font-bold">
                      {item.status || "open"}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td
                      className="border border-slate-900 p-4 text-center"
                      colSpan={5}
                    >
                      Tidak ada item
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-16">
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-6 text-center tracking-[0.2em]">
              Dokumen ini ditandatangani secara digital oleh:
            </p>
            <div className="grid grid-cols-3 gap-y-12 gap-x-8">
              {(pr.approvals || []).map((app: any, idx: number) => (
                <div key={idx} className="flex flex-col items-center">
                  <div className="text-[9px] font-bold text-slate-500 uppercase mb-2 h-4">
                    {app.type || app.role || "Approver"}
                  </div>
                  <div className="h-24 w-full border-b border-slate-900 flex items-center justify-center relative mb-2 p-2">
                    {app.status === "approved" && app.signature_url ? (
                      <img
                        src={app.signature_url}
                        className="max-h-full max-w-full object-contain mix-blend-multiply"
                        alt="signature"
                      />
                    ) : (
                      <span className="text-[9px] text-slate-200 italic">
                        BELUM TANDA TANGAN
                      </span>
                    )}

                    {app.status === "approved" && (
                      <div className="absolute bottom-1 right-1">
                        <div className="text-[7px] bg-green-50 text-green-700 px-1 border border-green-200 font-bold rounded uppercase">
                          Digitally Verified
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-sm font-bold text-slate-900 uppercase">
                    {app.nama}
                  </div>
                  <div className="text-[8px] text-slate-400 font-medium">
                    {app.processed_at
                      ? new Date(app.processed_at).toLocaleString("id-ID")
                      : "Waiting..."}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-20 border-t border-slate-100 pt-6 flex justify-between items-end grayscale opacity-50">
            <div className="text-[8px] font-bold text-slate-400 uppercase space-y-1">
              <p>Printed on: {new Date().toLocaleString("id-ID")}</p>
              <p>WMS-GMI System Documentation - Secure Record</p>
            </div>
            <div className="text-[8px] font-bold text-slate-400 flex gap-2">
              <div className="border border-slate-200 p-1 px-2 rounded tracking-widest">
                ORIGINAL DOCUMENT
              </div>
            </div>
          </div>
        </div>

        <style jsx global>{`
          @media print {
            body {
              background-color: white !important;
              padding: 0 !important;
              margin: 0 !important;
            }
            .fixed {
              display: none !important;
            }
            @page {
              size: A4;
              margin: 10mm;
            }
            .shadow-lg {
              box-shadow: none !important;
            }
            .border {
              border: 1px solid #111 !important;
            }
            .border-slate-900 {
              border-color: #000 !important;
            }
          }
        `}</style>
      </div>
    </Content>
  );
}
