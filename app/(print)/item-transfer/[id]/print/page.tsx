"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Printer, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const TRACKING_LABEL: Record<string, string> = {
  created: "Item Transfer Dibuat",
  packing: "Packing",
  ready_pickup: "Siap Diambil",
  in_transit: "Dalam Pengiriman",
  delivered: "Barang Diterima",
  completed: "Selesai Final",
};

const SHIPMENT_LABEL: Record<string, string> = {
  handcarry_internal: "Handcarry Internal",
  handcarry_eksternal: "Handcarry Eksternal",
  ekspedisi: "Ekspedisi",
};

export default function ItemTransferPrintPage() {
  const { id } = useParams();
  const router = useRouter();
  const supabase = createClient();

  const [it, setIt] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [receiverSig, setReceiverSig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchData = async () => {
    setLoading(true);

    const { data: itData } = await supabase
      .from("item_transfers")
      .select(
        `id, it_kode, it_tanggal, status, tracking_status, shipment_type,
         ekspedisi, sender_name, eksternal_id, jumlah_koli, estimasi_hari,
         no_resi, pic, remarks, approvals, signature_receiver_id,
         signed_by_receiver_at,
         dari:cabang!dari_cabang_id(nama_cabang),
         tujuan:cabang!ke_cabang_id(nama_cabang)`,
      )
      .eq("id", id)
      .single();

    setIt(itData);

    const { data: itemsData } = await supabase
      .from("item_transfer_items")
      .select("id, part_number, part_name, qty, satuan")
      .eq("it_id", id)
      .order("created_at");
    setItems(itemsData || []);

    if (itData?.signature_receiver_id) {
      const { data: sig } = await supabase
        .from("user_signatures")
        .select("image_url, printed_name, label")
        .eq("id", itData.signature_receiver_id)
        .maybeSingle();
      setReceiverSig(sig);
    }

    setLoading(false);

    if (itData) {
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

  if (!it) {
    return (
      <div className="p-20 text-center">
        <h1 className="text-2xl font-bold">Dokumen Tidak Ditemukan</h1>
        <Button onClick={() => router.back()} className="mt-4">
          Kembali
        </Button>
      </div>
    );
  }

  // Penanda tangan: approvals + penerima (jika sudah konfirmasi terima)
  const signatories = [
    ...(it.approvals || []).map((a: any) => ({
      role: a.role || "Approver",
      nama: a.nama,
      status: a.status,
      signature_url: a.signature_url,
      processed_at: a.processed_at,
    })),
    ...(it.signature_receiver_id
      ? [
          {
            role: "Penerima",
            nama: receiverSig?.printed_name || receiverSig?.label || "-",
            status: "approved",
            signature_url: receiverSig?.image_url,
            processed_at: it.signed_by_receiver_at,
          },
        ]
      : []),
  ];

  const InfoRow = ({
    label,
    value,
  }: {
    label: string;
    value: React.ReactNode;
  }) => (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 text-slate-500 font-semibold uppercase text-[9px] pt-0.5">
        {label}
      </span>
      <span className="font-bold text-slate-900">{value}</span>
    </div>
  );

  return (
    <div className="bg-white min-h-screen text-slate-900 font-serif p-6 print:p-0">
      <div className="fixed top-4 left-4 print:hidden flex gap-2 z-10">
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
          <Printer className="h-4 w-4" /> Cetak Ulang
        </Button>
      </div>

      <div className="mx-auto w-full max-w-[210mm] p-[12mm] print:p-0">
        {/* Header */}
        <div className="flex justify-between items-start border-b border-slate-300 pb-5 mb-8">
          <div className="space-y-0.5">
            <h1 className="text-3xl font-black tracking-tighter">WMS-GMI</h1>
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">
              Warehouse Management System
            </p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold uppercase">Item Transfer Form</h2>
            <p className="text-xs font-medium text-slate-500">
              No. Dokumen:{" "}
              <span className="font-bold text-slate-900">{it.it_kode}</span>
            </p>
          </div>
        </div>

        {/* Info */}
        <div className="grid grid-cols-2 gap-x-12 gap-y-2.5 mb-10 text-xs">
          <InfoRow label="PIC" value={it.pic || "-"} />
          <InfoRow
            label="Tanggal"
            value={
              it.it_tanggal
                ? new Date(it.it_tanggal).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "-"
            }
          />
          <InfoRow label="Gudang Asal" value={it.dari?.nama_cabang || "-"} />
          <InfoRow
            label="Gudang Tujuan"
            value={it.tujuan?.nama_cabang || "-"}
          />
          <InfoRow
            label="Pengiriman"
            value={
              (SHIPMENT_LABEL[it.shipment_type] || it.shipment_type || "-") +
              (it.ekspedisi ? ` (${it.ekspedisi})` : "")
            }
          />
          <InfoRow
            label="Koli / Estimasi"
            value={`${it.jumlah_koli} koli / ${it.estimasi_hari} hari`}
          />
          <InfoRow
            label="Status"
            value={<span className="text-green-600 uppercase">{it.status}</span>}
          />
          <InfoRow
            label="Tracking"
            value={
              TRACKING_LABEL[it.tracking_status] || it.tracking_status || "-"
            }
          />
          {it.no_resi && <InfoRow label="No. Resi" value={it.no_resi} />}
        </div>

        {/* Items */}
        <table className="w-full text-xs mb-8">
          <thead>
            <tr className="border-b-2 border-slate-400 text-left uppercase text-[9px] text-slate-500">
              <th className="py-2 w-10 text-center font-bold">No</th>
              <th className="py-2 font-bold">Deskripsi Barang / Part Number</th>
              <th className="py-2 w-20 text-right font-bold">Qty</th>
              <th className="py-2 w-20 text-center font-bold">Satuan</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id || index} className="border-b border-slate-100">
                <td className="py-2 text-center align-top">{index + 1}</td>
                <td className="py-2 align-top">
                  <div className="font-bold">{item.part_name}</div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {item.part_number}
                  </div>
                </td>
                <td className="py-2 text-right font-bold align-top">
                  {item.qty}
                </td>
                <td className="py-2 text-center uppercase font-medium align-top">
                  {item.satuan}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td className="py-4 text-center text-slate-400" colSpan={4}>
                  Tidak ada item
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {it.remarks && (
          <div className="mb-8 text-xs">
            <p className="text-[9px] font-bold uppercase text-slate-500 mb-1">
              Keterangan
            </p>
            <p className="font-medium text-slate-800 whitespace-pre-wrap">
              {it.remarks}
            </p>
          </div>
        )}

        {/* Signatures */}
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
                    <span className="text-[9px] text-slate-300 italic">
                      Belum tanda tangan
                    </span>
                  )}
                </div>
                <div className="text-sm font-bold uppercase text-center">
                  {s.nama}
                </div>
                <div className="text-[8px] text-slate-400 font-medium">
                  {s.processed_at
                    ? new Date(s.processed_at).toLocaleString("id-ID")
                    : "Menunggu..."}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-16 pt-5 flex justify-between items-end text-[8px] font-bold text-slate-400 uppercase">
          <div className="space-y-0.5">
            <p>Dicetak: {new Date().toLocaleString("id-ID")}</p>
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
