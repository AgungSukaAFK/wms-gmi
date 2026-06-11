"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Content } from "@/components/content";
import { createClient } from "@/lib/supabase/client";

export default function DoRegulerPrintPage() {
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
      const { data: doData } = await supabase
        .from("do_reguler")
        .select(
          "*, dari:cabang!dari_cabang_id(nama_cabang), customer:customers!customer_id(customer_name)",
        )
        .eq("id", id)
        .single();
      const { data: itemRows } = await supabase
        .from("do_reguler_items")
        .select("*")
        .eq("do_id", id)
        .order("created_at");
      setHeader(doData || null);
      setItems(itemRows || []);
      setLoading(false);
      if (doData) setTimeout(() => window.print(), 600);
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
        <p>Dokumen DO Reguler tidak ditemukan.</p>
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
          <h1 className="text-2xl font-bold">DO REGULER</h1>
          <p className="text-sm text-muted-foreground">
            Kode DO: {header.do_kode}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <p>
              Tanggal:{" "}
              {header.do_tanggal
                ? new Date(header.do_tanggal).toLocaleDateString("id-ID")
                : "-"}
            </p>
            <p>Status: {header.status || "-"}</p>
            <p>Gudang: {header.dari?.nama_cabang || "-"}</p>
            <p>Customer: {header.customer?.customer_name || "-"}</p>
            <p>Kode PO: {header.kode_po || "-"}</p>
            <p>PIC: {header.pic || "-"}</p>
          </div>
          <table className="w-full mt-6 border text-sm">
            <thead>
              <tr className="bg-muted">
                <th className="border p-2 text-left">Part Number</th>
                <th className="border p-2 text-left">Nama Part</th>
                <th className="border p-2 text-right">Qty</th>
                <th className="border p-2 text-left">Satuan</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td className="border p-2">{row.part_number}</td>
                  <td className="border p-2">{row.part_name}</td>
                  <td className="border p-2 text-right">{row.qty}</td>
                  <td className="border p-2">{row.satuan}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Content>
  );
}
