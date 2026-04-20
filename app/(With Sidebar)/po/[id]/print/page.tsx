"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Printer, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Content } from "@/components/content";

export default function POPrintPage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [po, setPo] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [vendorLabel, setVendorLabel] = useState<string>("Semua Vendor");

  useEffect(() => {
    if (id) fetchData();
  }, [id, searchParams]);

  const fetchData = async () => {
    setLoading(true);

    const vendorParam = searchParams.get("vendor_id");

    const { data: poData } = await supabase
      .from("pos")
      .select(
        `
        id, po_kode, po_tanggal, po_estimasi, po_status, po_keterangan,
        po_payment_term, po_pic, approvals,
        prs(pr_kode, cabang(nama_cabang))
      `,
      )
      .eq("id", id)
      .single();

    setPo(poData);

    let itemsQuery = supabase
      .from("po_items")
      .select(
        "id, part_number, part_name, satuan, qty, harga, qty_received, vendor_id, vendors(vendor_name)",
      )
      .eq("po_id", id)
      .order("created_at");

    if (vendorParam) {
      if (vendorParam === "null") {
        itemsQuery = itemsQuery.is("vendor_id", null);
      } else {
        const vendorId = Number(vendorParam);
        if (!Number.isNaN(vendorId)) {
          itemsQuery = itemsQuery.eq("vendor_id", vendorId);
        }
      }
    }

    const { data: itemsData } = await itemsQuery;
    const safeItems = itemsData || [];
    setItems(safeItems);

    if (safeItems.length > 0 && safeItems[0]?.vendors?.vendor_name) {
      setVendorLabel(safeItems[0].vendors.vendor_name);
    } else if (vendorParam === "null") {
      setVendorLabel("Vendor Belum Ditentukan");
    } else {
      setVendorLabel("Semua Vendor");
    }

    setLoading(false);

    if (poData) {
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

  if (!po) {
    return (
      <div className="p-20 text-center">
        <h1 className="text-2xl font-bold">Dokumen Tidak Ditemukan</h1>
        <Button onClick={() => router.back()} className="mt-4">
          Kembali
        </Button>
      </div>
    );
  }

  const totalNominal = items.reduce(
    (sum, item) => sum + Number(item.qty || 0) * Number(item.harga || 0),
    0,
  );

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(value);

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
                Purchase Order Form
              </h2>
              <p className="text-xs font-medium text-slate-500">
                No. Dokumen:{" "}
                <span className="font-bold text-slate-900">{po.po_kode}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-6 mb-10 text-xs">
            <div className="space-y-3">
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  PIC PO
                </span>
                <span className="font-bold text-slate-900">
                  : {po.po_pic || "-"}
                </span>
              </div>
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Cabang
                </span>
                <span className="font-bold text-slate-900">
                  : {po?.prs?.cabang?.nama_cabang || "-"}
                </span>
              </div>
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Referensi PR
                </span>
                <span className="font-bold text-slate-900">
                  : {po?.prs?.pr_kode || "-"}
                </span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Tanggal PO
                </span>
                <span className="font-bold text-slate-900">
                  :{" "}
                  {po.po_tanggal
                    ? new Date(po.po_tanggal).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : "-"}
                </span>
              </div>
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Estimasi Terima
                </span>
                <span className="font-bold text-slate-900">
                  :{" "}
                  {po.po_estimasi
                    ? new Date(po.po_estimasi).toLocaleDateString("id-ID", {
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
                  : {po.po_status}
                </span>
              </div>
            </div>
          </div>

          <div className="mb-4 bg-slate-50 p-3 border rounded-md">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">
              Vendor
            </p>
            <p className="text-xs font-bold text-slate-900">{vendorLabel}</p>
          </div>

          {po.po_payment_term && (
            <div className="mb-4 bg-slate-50 p-3 border rounded-md">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                Syarat Pembayaran
              </p>
              <p className="text-xs font-bold text-slate-900">
                {po.po_payment_term}
              </p>
            </div>
          )}

          {po.po_keterangan && (
            <div className="mb-10 bg-slate-50 p-3 border rounded-md">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                Keterangan
              </p>
              <p className="text-xs font-medium text-slate-800 whitespace-pre-wrap">
                {po.po_keterangan}
              </p>
            </div>
          )}

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
                  <th className="border border-slate-900 p-2 text-right w-28">
                    Harga
                  </th>
                  <th className="border border-slate-900 p-2 text-right w-32">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const subtotal =
                    Number(item.qty || 0) * Number(item.harga || 0);
                  return (
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
                      <td className="border border-slate-900 p-2 text-right">
                        {formatCurrency(Number(item.harga || 0))}
                      </td>
                      <td className="border border-slate-900 p-2 text-right font-bold">
                        {formatCurrency(subtotal)}
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td
                      className="border border-slate-900 p-4 text-center"
                      colSpan={6}
                    >
                      Tidak ada item
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td
                    className="border border-slate-900 p-2 text-right font-bold"
                    colSpan={5}
                  >
                    Total
                  </td>
                  <td className="border border-slate-900 p-2 text-right font-black text-sm">
                    {formatCurrency(totalNominal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-16">
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-6 text-center tracking-[0.2em]">
              Dokumen ini ditandatangani secara digital oleh:
            </p>
            <div className="grid grid-cols-3 gap-y-12 gap-x-8">
              {(po.approvals || []).map((app: any, idx: number) => (
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
