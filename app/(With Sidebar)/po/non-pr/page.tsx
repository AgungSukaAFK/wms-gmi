"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Search, Wrench } from "lucide-react";
import { useDebounce } from "use-debounce";
import { cn, formatDate } from "@/lib/utils";
import {
  fetchPoItemJcUsage,
  JC_PROGRESS_LABEL,
  jcProgressStatus,
  type JcProgressStatus,
  type PoItemJcUsage,
} from "@/lib/po-non-pr";
import { JC_PROGRESS_BADGE_CLASS } from "@/components/po/po-non-pr-panel";

// Daftar item PO Non-PR vs pemakaiannya di Job Costing -- supaya barang yang
// sudah diterima di GMI-JAKARTA tapi belum dikonversi ke PN PR (lewat Job
// Costing) tidak menumpuk/terlupa.

const STATUS_FILTERS: { value: JcProgressStatus | "outstanding" | "all"; label: string }[] = [
  { value: "outstanding", label: "Perlu Job Costing" },
  { value: "belum_terima", label: "Belum Diterima" },
  { value: "selesai", label: "Selesai" },
  { value: "all", label: "Semua" },
];

export default function PoNonPrListPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<any[]>([]);
  const [usage, setUsage] = useState<Map<number, PoItemJcUsage>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] =
    useState<(typeof STATUS_FILTERS)[number]["value"]>("outstanding");

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      let q = supabase
        .from("po_items")
        .select(
          "id, part_number, part_name, satuan, qty, qty_received, pos!inner(id, po_kode, po_tanggal, po_status, po_jenis, po_pr_referensi), po_item_pr_links(id)",
        )
        .eq("pos.po_jenis", "non_pr")
        .neq("pos.po_status", "rejected")
        .order("id", { ascending: false })
        .limit(500);
      if (debouncedSearch) {
        q = q.or(
          `part_number.ilike.%${debouncedSearch}%,part_name.ilike.%${debouncedSearch}%`,
        );
      }
      const { data } = await q;
      const list = (data || []).map((r: any) => ({
        ...r,
        po: Array.isArray(r.pos) ? r.pos[0] : r.pos,
      }));
      setRows(list);
      setUsage(await fetchPoItemJcUsage(supabase, list.map((r: any) => r.id)));
      setLoading(false);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const enriched = useMemo(
    () =>
      rows.map((r) => {
        const used = usage.get(r.id)?.qtyUsed || 0;
        return {
          ...r,
          used,
          sisa: Math.max(0, (r.qty_received || 0) - used),
          status: jcProgressStatus(r.qty_received || 0, used),
        };
      }),
    [rows, usage],
  );

  const filtered = enriched.filter((r) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "outstanding")
      return r.status === "belum_jc" || r.status === "partial";
    return r.status === statusFilter;
  });

  const outstandingCount = enriched.filter(
    (r) => r.status === "belum_jc" || r.status === "partial",
  ).length;

  return (
    <Content
      title="PO Non-PR → Job Costing"
      description="Item PO Non-PR yang sudah diterima di GMI-JAKARTA dan perlu dikonversi ke PN PR lewat Job Costing."
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={statusFilter === f.value ? "default" : "outline"}
                className="h-8 text-xs font-bold"
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
                {f.value === "outstanding" && outstandingCount > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[9px]">
                    {outstandingCount}
                  </Badge>
                )}
              </Button>
            ))}
          </div>
          <div className="relative w-full md:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari part number / nama..."
              className="h-9 pl-8 text-sm"
            />
          </div>
        </div>

        <Table containerClassName="max-h-[70vh] overflow-y-auto rounded-lg border border-border">
          <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted">
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[10px] font-black uppercase">PO</TableHead>
              <TableHead className="text-[10px] font-black uppercase">Ref. PR</TableHead>
              <TableHead className="text-[10px] font-black uppercase">Part</TableHead>
              <TableHead className="text-[10px] font-black uppercase text-center">Qty PO</TableHead>
              <TableHead className="text-[10px] font-black uppercase text-center">Diterima</TableHead>
              <TableHead className="text-[10px] font-black uppercase text-center">Dipakai JC</TableHead>
              <TableHead className="text-[10px] font-black uppercase text-center">Sisa</TableHead>
              <TableHead className="text-[10px] font-black uppercase">Status</TableHead>
              <TableHead className="text-[10px] font-black uppercase text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="h-32 text-center text-xs font-bold uppercase text-muted-foreground"
                >
                  Tidak ada item PO Non-PR untuk filter ini.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="py-2">
                    <Link
                      href={`/po/${r.po.id}`}
                      className="text-xs font-bold font-mono uppercase text-primary hover:underline"
                    >
                      {r.po.po_kode}
                    </Link>
                    <p className="text-[10px] text-muted-foreground">
                      {formatDate(r.po.po_tanggal)}
                    </p>
                  </TableCell>
                  <TableCell className="py-2 max-w-48">
                    <p className="text-[11px] text-foreground wrap-break-word whitespace-normal">
                      {r.po.po_pr_referensi || "-"}
                    </p>
                    {(r.po_item_pr_links?.length || 0) > 0 && (
                      <Badge variant="outline" className="mt-0.5 text-[9px] font-bold">
                        {r.po_item_pr_links.length} link PR
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-2">
                    <p className="text-[11px] font-black font-mono uppercase">
                      {r.part_number}
                    </p>
                    <p className="text-[10px] text-muted-foreground uppercase">
                      {r.part_name}
                    </p>
                  </TableCell>
                  <TableCell className="py-2 text-center text-xs font-bold">
                    {r.qty} <span className="text-[10px] font-medium text-muted-foreground">{r.satuan}</span>
                  </TableCell>
                  <TableCell className="py-2 text-center text-xs font-bold">
                    {r.qty_received || 0}
                  </TableCell>
                  <TableCell className="py-2 text-center text-xs font-bold">
                    {r.used}
                    {usage.get(r.id)?.jobs.map((j) => (
                      <p key={j.id} className="text-[9px] font-mono font-medium text-muted-foreground">
                        {j.job_kode}
                      </p>
                    ))}
                  </TableCell>
                  <TableCell className="py-2 text-center text-xs font-black text-primary">
                    {r.sisa}
                  </TableCell>
                  <TableCell className="py-2">
                    <Badge
                      variant="outline"
                      className={cn("text-[9px] font-bold uppercase", JC_PROGRESS_BADGE_CLASS[r.status as JcProgressStatus])}
                    >
                      {JC_PROGRESS_LABEL[r.status as JcProgressStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    {r.sisa > 0 && (
                      <Link href={`/job-costing/create?po_id=${r.po.id}`}>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-[10px] font-bold">
                          <Wrench className="h-3 w-3" /> Buat JC
                        </Button>
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <p className="text-[10px] text-muted-foreground">
          Menampilkan maks. 500 item PO Non-PR terbaru (PO rejected tidak
          ditampilkan). &quot;Dipakai JC&quot; menghitung semua Job Costing
          yang tidak rejected.
        </p>
      </div>
    </Content>
  );
}
