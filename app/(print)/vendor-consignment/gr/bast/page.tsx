"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Content } from "@/components/content";
import { createClient } from "@/lib/supabase/client";
import { formatDateDocument } from "@/lib/utils";

// BAST serah terima barang konsinyasi bulanan GMI - Supplier: rekap semua
// GR Konsinyasi satu vendor dalam satu bulan (note #6 flowchart).
function BastBulananContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();
  const vendorId = Number(searchParams.get("vendor"));
  const bulan = searchParams.get("bulan") || ""; // YYYY-MM
  const [loading, setLoading] = useState(true);
  const [vendor, setVendor] = useState<any>(null);
  const [grs, setGrs] = useState<any[]>([]);

  useEffect(() => {
    const run = async () => {
      if (!vendorId || !/^\d{4}-\d{2}$/.test(bulan)) {
        setLoading(false);
        return;
      }
      const [y, m] = bulan.split("-").map(Number);
      const awal = `${bulan}-01`;
      const akhir = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      const [{ data: v }, { data: rows }] = await Promise.all([
        supabase.from("vendors").select("vendor_name, vendor_no, pic_name, contact_name").eq("id", vendorId).maybeSingle(),
        supabase
          .from("vendor_consignment_gr")
          .select("id, gr_kode, gr_tanggal, no_surat_jalan, prs(pr_kode), cabang(nama_cabang), vendor_consignment_gr_items(*)")
          .eq("vendor_id", vendorId)
          .gte("gr_tanggal", awal)
          .lt("gr_tanggal", akhir)
          .order("gr_tanggal")
          .order("id"),
      ]);
      setVendor(v);
      setGrs(rows || []);
      setLoading(false);
      if (v) setTimeout(() => window.print(), 600);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, bulan]);

  const lines = useMemo(
    () =>
      grs.flatMap((gr) =>
        (gr.vendor_consignment_gr_items || []).map((i: any) => ({ ...i, gr })),
      ),
    [grs],
  );

  if (loading)
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  if (!vendor)
    return (
      <div className="p-8 text-center">
        <p>Vendor / bulan tidak valid.</p>
      </div>
    );

  const bulanLabel = new Date(`${bulan}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

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
            <h1 className="text-lg font-bold uppercase">Berita Acara Serah Terima Barang Konsinyasi</h1>
            <p className="font-semibold">PT. Garuda Mart Indonesia</p>
            <p className="mt-1">Periode {bulanLabel}</p>
          </div>
          <p className="mt-5">
            Supplier: <span className="font-semibold">{vendor.vendor_name}</span> ({vendor.vendor_no})
          </p>
          <p className="mt-2">
            Dengan ini GMI dan supplier menyatakan telah melakukan serah terima barang konsinyasi dengan rincian:
          </p>

          <table className="w-full mt-3 border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black p-1.5 text-left w-8">No</th>
                <th className="border border-black p-1.5 text-left">Tgl</th>
                <th className="border border-black p-1.5 text-left">GR / PR</th>
                <th className="border border-black p-1.5 text-left">Surat Jalan</th>
                <th className="border border-black p-1.5 text-left">Gudang</th>
                <th className="border border-black p-1.5 text-left">Part</th>
                <th className="border border-black p-1.5 text-right">Kirim</th>
                <th className="border border-black p-1.5 text-right">Diterima</th>
                <th className="border border-black p-1.5 text-left">Ket.</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="border border-black p-3 text-center">
                    Tidak ada penerimaan di periode ini.
                  </td>
                </tr>
              ) : (
                lines.map((l, idx) => (
                  <tr key={l.id}>
                    <td className="border border-black p-1.5">{idx + 1}</td>
                    <td className="border border-black p-1.5 whitespace-nowrap">{formatDateDocument(l.gr.gr_tanggal)}</td>
                    <td className="border border-black p-1.5">
                      {l.gr.gr_kode}
                      <span className="block text-[10px]">{l.gr.prs?.pr_kode}</span>
                    </td>
                    <td className="border border-black p-1.5">{l.gr.no_surat_jalan}</td>
                    <td className="border border-black p-1.5">{l.gr.cabang?.nama_cabang}</td>
                    <td className="border border-black p-1.5">
                      {l.part_number}
                      <span className="block text-[10px]">{l.part_name}</span>
                    </td>
                    <td className="border border-black p-1.5 text-right">{l.qty_kirim}</td>
                    <td className="border border-black p-1.5 text-right font-bold">{l.qty_terima}</td>
                    <td className="border border-black p-1.5 text-[10px]">
                      {l.status === "komplain" ? `Komplain: ${l.catatan_komplain || "-"}` : "Sesuai"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="mt-12 grid grid-cols-2 gap-10 text-center">
            <div>
              <p>Diserahkan oleh,</p>
              <div className="h-20" />
              <p className="border-t border-black pt-1 font-semibold">
                {vendor.pic_name || vendor.contact_name || "(..............................)"}
              </p>
              <p className="text-[11px]">Supplier</p>
            </div>
            <div>
              <p>Diterima oleh,</p>
              <div className="h-20" />
              <p className="border-t border-black pt-1 font-semibold">(..............................)</p>
              <p className="text-[11px]">Warehouse GMI</p>
            </div>
          </div>
        </div>
      </div>
    </Content>
  );
}

export default function BastBulananPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <BastBulananContent />
    </Suspense>
  );
}
