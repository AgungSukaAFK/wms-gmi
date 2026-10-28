"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Content } from "@/components/content";
import { formatDateDocument } from "@/lib/utils";
import { getRekonsilDetail } from "@/services/vendor-consignment-actions";

// BAST Rekonsil Site: rekap SPB Out konsinyasi satu periode, ditandatangani
// admin site & PJO (rekonsil site) serta supplier (dasar PO Rekonsil).
export default function RekonsilBastPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rk, setRk] = useState<any>(null);

  useEffect(() => {
    getRekonsilDetail(Number(params.id)).then((res) => {
      setRk(res.data);
      setLoading(false);
      if (res.data) setTimeout(() => window.print(), 600);
    });
  }, [params.id]);

  const items: any[] = useMemo(() => rk?.vendor_consignment_rekonsil_items || [], [rk]);
  const summary = useMemo(() => {
    const map = new Map<string, { part_number: string; part_name: string; satuan: string; qty: number }>();
    for (const i of items) {
      const cur = map.get(i.part_number) || { part_number: i.part_number, part_name: i.part_name, satuan: i.satuan, qty: 0 };
      cur.qty += i.qty;
      map.set(i.part_number, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.part_number.localeCompare(b.part_number));
  }, [items]);

  if (loading)
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  if (!rk)
    return (
      <div className="p-8 text-center">
        <p>Dokumen rekonsil tidak ditemukan.</p>
      </div>
    );

  return (
    <Content>
      <div className="bg-white min-h-screen p-0 sm:p-8 text-black">
        <div className="fixed top-4 left-4 print:hidden flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ChevronLeft className="h-4 w-4" /> Kembali
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Cetak Ulang
          </Button>
        </div>
        <div className="max-w-[210mm] mx-auto bg-white p-[12mm] text-[12px]">
          <div className="text-center">
            <h1 className="text-lg font-bold uppercase">Berita Acara Serah Terima Rekonsil Barang Konsinyasi</h1>
            <p className="font-semibold">PT. Garuda Mart Indonesia</p>
            <p className="mt-1">No. {rk.rk_kode}</p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1">
            <p>Tanggal Rekonsil: {formatDateDocument(rk.rk_tanggal)}</p>
            <p>Site: {rk.cabang?.nama_cabang || "-"}</p>
            <p>
              Periode: {formatDateDocument(rk.periode_awal)} s.d. {formatDateDocument(rk.periode_akhir)}
            </p>
            <p>Supplier: {rk.vendors?.vendor_name || "-"} ({rk.vendors?.vendor_no || "-"})</p>
            <p>Status: {rk.status === "final" ? "Final" : "Draft (menunggu validasi)"}</p>
            {rk.pos?.po_kode && <p>PO Rekonsil: {rk.pos.po_kode}</p>}
          </div>

          <p className="mt-4">
            Pada hari ini telah dilakukan rekonsil atas pengeluaran barang konsinyasi (SPB Out to Customer)
            di site tersebut dengan rincian sebagai berikut:
          </p>

          <table className="w-full mt-3 border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black p-1.5 text-left w-8">No</th>
                <th className="border border-black p-1.5 text-left">Tgl SPB</th>
                <th className="border border-black p-1.5 text-left">No. SPB</th>
                <th className="border border-black p-1.5 text-left">Part Number</th>
                <th className="border border-black p-1.5 text-left">Nama Part</th>
                <th className="border border-black p-1.5 text-right">Qty</th>
                <th className="border border-black p-1.5 text-left">Satuan</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={i.id}>
                  <td className="border border-black p-1.5">{idx + 1}</td>
                  <td className="border border-black p-1.5 whitespace-nowrap">{formatDateDocument(i.spb_tanggal)}</td>
                  <td className="border border-black p-1.5">{i.spb_no}</td>
                  <td className="border border-black p-1.5">{i.part_number}</td>
                  <td className="border border-black p-1.5">{i.part_name}</td>
                  <td className="border border-black p-1.5 text-right">{i.qty}</td>
                  <td className="border border-black p-1.5">{i.satuan}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-4 font-semibold">Rekap per Part</p>
          <table className="w-full mt-1 border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black p-1.5 text-left">Part Number</th>
                <th className="border border-black p-1.5 text-left">Nama Part</th>
                <th className="border border-black p-1.5 text-right">Total Qty</th>
                <th className="border border-black p-1.5 text-left">Satuan</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.part_number}>
                  <td className="border border-black p-1.5">{s.part_number}</td>
                  <td className="border border-black p-1.5">{s.part_name}</td>
                  <td className="border border-black p-1.5 text-right font-bold">{s.qty}</td>
                  <td className="border border-black p-1.5">{s.satuan}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {rk.catatan && <p className="mt-3">Catatan: {rk.catatan}</p>}
          <p className="mt-3 text-[11px]">
            Feedback/koreksi rekonsil paling lambat H+3 dari tanggal rekonsil. Dokumen ini wajib distempel dan
            ditandatangani.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-6 text-center">
            {[
              { label: "Dibuat oleh,", role: "Admin Site", name: rk.pic_admin },
              { label: "Diperiksa oleh,", role: "PJO", name: rk.pic_pjo },
              { label: "Disetujui oleh,", role: "Supplier", name: rk.vendors?.pic_name || rk.vendors?.contact_name },
            ].map((s) => (
              <div key={s.role}>
                <p>{s.label}</p>
                <div className="h-20" />
                <p className="border-t border-black pt-1 font-semibold">{s.name || "(..............................)"}</p>
                <p className="text-[11px]">{s.role}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Content>
  );
}
