"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Content } from "@/components/content";
import { createClient } from "@/lib/supabase/client";

export default function ReturnSpbPrintPage() {
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
      const { data: returnData } = await supabase
        .from("return_spb")
        .select("*, spb:spb_id(spb_no)")
        .eq("id", id)
        .single();
      const { data: detailRows } = await supabase
        .from("return_spb_details")
        .select(
          "id, dtl_rtn_qty_return, spb_detail:spb_dtl_id(dtl_spb_part_number, dtl_spb_part_name, dtl_spb_part_satuan)",
        )
        .eq("rtn_id", id)
        .order("created_at");
      setHeader(returnData || null);
      setItems(detailRows || []);
      setLoading(false);
      if (returnData) setTimeout(() => window.print(), 600);
    };

    run();
  }, [params.id, supabase]);

  if (loading)
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  if (!header)
    return (
      <div className="p-8 text-center">
        <p>Dokumen Return SPB tidak ditemukan.</p>
      </div>
    );

  return (
    <Content>
      <div className="bg-white min-h-screen p-0 sm:p-8">
        <div className="fixed top-4 left-4 print:hidden flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ChevronLeft className="h-4 w-4" /> Kembali
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Cetak Ulang
          </Button>
        </div>
        <div className="max-w-[210mm] mx-auto bg-white p-[15mm]">
          <h1 className="text-2xl font-bold">RETURN SPB</h1>
          <p className="text-sm text-muted-foreground">
            Kode Return: {header.rtn_kode}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <p>No SPB: {header.spb?.spb_no || "-"}</p>
            <p>
              Tanggal Return:{" "}
              {header.rtn_tanggal
                ? new Date(header.rtn_tanggal).toLocaleDateString("id-ID")
                : "-"}
            </p>
            <p>Status: {header.rtn_status || "-"}</p>
            <p>Catatan: {header.rtn_note || "-"}</p>
          </div>
          <table className="w-full mt-6 border text-sm">
            <thead>
              <tr className="bg-muted">
                <th className="border p-2 text-left">Part Number</th>
                <th className="border p-2 text-left">Nama Part</th>
                <th className="border p-2 text-right">Qty Return</th>
                <th className="border p-2 text-left">Satuan</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td className="border p-2">
                    {row.spb_detail?.dtl_spb_part_number || "-"}
                  </td>
                  <td className="border p-2">
                    {row.spb_detail?.dtl_spb_part_name || "-"}
                  </td>
                  <td className="border p-2 text-right">
                    {row.dtl_rtn_qty_return}
                  </td>
                  <td className="border p-2">
                    {row.spb_detail?.dtl_spb_part_satuan || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Content>
  );
}
