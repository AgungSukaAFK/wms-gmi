"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Content } from "@/components/content";
import { createClient } from "@/lib/supabase/client";

export default function SpbPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [header, setHeader] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      const id = Number(params.id);
      const { data: spbData } = await supabase
        .from("spb")
        .select("*")
        .eq("id", id)
        .single();
      const { data: itemData } = await supabase
        .from("spb_details")
        .select("*")
        .eq("spb_id", id)
        .order("created_at");
      setHeader(spbData || null);
      setItems(itemData || []);
      setLoading(false);
      if (spbData) setTimeout(() => window.print(), 600);
    };

    run();
  }, [params.id, supabase]);

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!header) {
    return (
      <div className="p-8 text-center">
        <p>Dokumen SPB tidak ditemukan.</p>
        <Button className="mt-4" onClick={() => router.back()}>
          Kembali
        </Button>
      </div>
    );
  }

  return (
    <Content>
      <div className="bg-white min-h-screen p-0 sm:p-8 print:min-h-0 print:p-0 print-page-landscape">
        <div className="fixed top-4 left-4 print:hidden flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ChevronLeft className="h-4 w-4" /> Kembali
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Cetak Ulang
          </Button>
        </div>

        <div className="max-w-[297mm] mx-auto bg-white p-[15mm] text-black text-[11px] leading-tight">
          {/* Kop surat */}
          <div className="flex justify-between items-start border-b-2 border-black pb-2">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/gmi-lanscape-rgb.png"
                alt="PT. Garudamart Indonesia"
                className="h-9 w-auto object-contain mb-1"
              />
              <p>Sentra Niaga Sakura Regency Blok J5-8A,</p>
              <p>Jakarta Outer Ring Road - Jatiasih</p>
              <p>Bekasi 17423 - Indonesia</p>
              <p>Phone : (62-21) 8248 7309</p>
              <p>Fax : (62-21) 8248 7323</p>
              <p>Email : info@garudamart.com</p>
            </div>
            <div className="text-right">
              <p className="font-bold">CABANG {header.spb_gudang || "-"}</p>
            </div>
          </div>

          <h1 className="text-center text-lg font-bold mt-3 mb-3 underline">
            SURAT PENGELUARAN BARANG
          </h1>

          {/* Info fields */}
          <div className="grid grid-cols-2 gap-x-8 border border-black p-2 mb-4">
            <div className="space-y-1">
              <div className="flex">
                <span className="w-28 shrink-0">NO.SPB OUT</span>
                <span className="mr-1">:</span>
                <span className="font-medium">{header.spb_no}</span>
              </div>
              <div className="flex">
                <span className="w-28 shrink-0">LOKASI</span>
                <span className="mr-1">:</span>
                <span className="font-medium">{header.spb_gudang || "-"}</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex">
                <span className="w-24 shrink-0">NO. WO</span>
                <span className="mr-1">:</span>
                <span className="font-medium">{header.spb_no_wo || "-"}</span>
              </div>
              <div className="flex">
                <span className="w-24 shrink-0">TANGGAL</span>
                <span className="mr-1">:</span>
                <span className="font-medium">
                  {header.spb_tanggal
                    ? new Date(header.spb_tanggal).toLocaleDateString("id-ID")
                    : "-"}
                </span>
              </div>
              <div className="flex">
                <span className="w-24 shrink-0">NO HM</span>
                <span className="mr-1">:</span>
                <span className="font-medium">{header.spb_hm ?? "-"}</span>
              </div>
            </div>
          </div>

          {/* Tabel item */}
          <table className="w-full border-collapse border border-black">
            <thead>
              <tr className="text-center">
                <th className="border border-black p-1 w-8">NO</th>
                <th className="border border-black p-1">PART NO</th>
                <th className="border border-black p-1">DESCRIPTION</th>
                <th className="border border-black p-1 w-12">QTY</th>
                <th className="border border-black p-1 w-16">SATUAN</th>
                <th className="border border-black p-1 w-20">NO.UNIT AMM</th>
                <th className="border border-black p-1 w-32">KETERANGAN</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id}>
                  <td className="border border-black p-1 text-center">
                    {idx + 1}
                  </td>
                  <td className="border border-black p-1">
                    {item.dtl_spb_part_number}
                  </td>
                  <td className="border border-black p-1">
                    {item.dtl_spb_part_name}
                  </td>
                  <td className="border border-black p-1 text-center">
                    {item.dtl_spb_qty}
                  </td>
                  <td className="border border-black p-1 text-center">
                    {item.dtl_spb_part_satuan}
                  </td>
                  {idx === 0 && (
                    <td
                      className="border border-black p-1 text-center align-top"
                      rowSpan={items.length}
                    >
                      {header.spb_kode_unit || "-"}
                    </td>
                  )}
                  {idx === 0 && (
                    <td
                      className="border border-black p-1 align-top"
                      rowSpan={items.length}
                    >
                      {header.spb_problem_remark || "-"}
                    </td>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="border border-black p-2 text-center">
                    Tidak ada item.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Blok tanda tangan */}
          <div className="grid grid-cols-4 gap-2 mt-10 text-center">
            <div>
              <p>YANG MENYERAHKAN</p>
              <div className="h-16" />
              <p className="border-t border-black pt-1 font-medium">
                {header.spb_pic_gmi || "-"}
              </p>
              <p>Warehouse GMI</p>
            </div>
            <div>
              <p>MENGETAHUI</p>
              <div className="h-16" />
              <p className="border-t border-black pt-1">&nbsp;</p>
              <p>GL Plant</p>
            </div>
            <div>
              <p>MENGETAHUI</p>
              <div className="h-16" />
              <p className="border-t border-black pt-1">&nbsp;</p>
              <p>Planner</p>
            </div>
            <div>
              <p>MENGETAHUI</p>
              <div className="h-16" />
              <p className="border-t border-black pt-1">&nbsp;</p>
              <p>Logistics</p>
            </div>
          </div>

          {/* Catatan lembar arsip */}
          <div className="mt-8 text-[10px]">
            <p className="font-semibold">KETERANGAN:</p>
            <p>1. LEMBAR KE 1 DAN KE 3 ARSIP GMI</p>
            <p>2. LEMBAR KE 2 DAN 4 ARSIP {header.spb_gudang || "-"}</p>
          </div>
        </div>
      </div>
    </Content>
  );
}
