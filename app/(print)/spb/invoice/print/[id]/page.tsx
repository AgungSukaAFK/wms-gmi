"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Content } from "@/components/content";
import { createClient } from "@/lib/supabase/client";

export default function SpbInvoicePrintPage() {
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
      const { data: invoiceData } = await supabase
        .from("spb_invoice")
        .select(
          "*, do:spb_do_id(do_no, po:spb_po_id(po_no, spb:spb_id(spb_no)))",
        )
        .eq("id", id)
        .single();
      const { data: detailRows } = await supabase
        .from("spb_invoice_details")
        .select(
          "id, do_detail:spb_do_dtl_id(po_detail:spb_po_dtl_id(spb_detail:spb_dtl_id(dtl_spb_part_number, dtl_spb_part_name, dtl_spb_qty, dtl_spb_part_satuan)), invoice_qty)",
        )
        .eq("spb_invoice_id", id)
        .order("created_at");
      setHeader(invoiceData || null);
      setItems(detailRows || []);
      setLoading(false);
      if (invoiceData) setTimeout(() => window.print(), 600);
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
        <p>Dokumen Invoice SPB tidak ditemukan.</p>
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
          <h1 className="text-2xl font-bold">INVOICE (SPB)</h1>
          <p className="text-sm text-muted-foreground">
            No Invoice: {header.invoice_no}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <p>No SPB: {header.do?.po?.spb?.spb_no || "-"}</p>
            <p>No PO: {header.do?.po?.po_no || "-"}</p>
            <p>No DO: {header.do?.do_no || "-"}</p>
            <p>
              Tgl Invoice:{" "}
              {header.invoice_date
                ? new Date(header.invoice_date).toLocaleDateString("id-ID")
                : "-"}
            </p>
            <p>
              Tgl Email:{" "}
              {header.invoice_email_date
                ? new Date(header.invoice_email_date).toLocaleDateString(
                    "id-ID",
                  )
                : "-"}
            </p>
          </div>
          <table className="w-full mt-6 border text-sm">
            <thead>
              <tr className="bg-muted">
                <th className="border p-2 text-left">Part Number</th>
                <th className="border p-2 text-left">Nama Part</th>
                <th className="border p-2 text-right">Qty SPB</th>
                <th className="border p-2 text-right">Qty Invoice</th>
                <th className="border p-2 text-left">Satuan</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td className="border p-2">
                    {row.do_detail?.po_detail?.spb_detail
                      ?.dtl_spb_part_number || "-"}
                  </td>
                  <td className="border p-2">
                    {row.do_detail?.po_detail?.spb_detail?.dtl_spb_part_name ||
                      "-"}
                  </td>
                  <td className="border p-2 text-right">
                    {row.do_detail?.po_detail?.spb_detail?.dtl_spb_qty || "-"}
                  </td>
                  <td className="border p-2 text-right">
                    {row.invoice_qty ?? "-"}
                  </td>
                  <td className="border p-2">
                    {row.do_detail?.po_detail?.spb_detail
                      ?.dtl_spb_part_satuan || "-"}
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
