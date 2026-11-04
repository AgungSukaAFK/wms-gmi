"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { ListSearchInput } from "@/components/list-search-input";
import {
  ColumnOrderReset,
  ReorderableHeaderRow,
  ReorderableTableHead,
  type ReorderableColumn,
} from "@/components/reorderable-table-head";
import { StickyHeaderTable } from "@/components/sticky-header-table";
import { TablePaginationFooter } from "@/components/table-pagination-footer";
import { Skeleton } from "@/components/ui/skeleton";
import { useColumnOrder } from "@/hooks/use-column-order";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import { sortRows } from "@/lib/client-sort";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import { Eye, Wrench } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import {
  fetchPoItemJcUsage,
  JC_PROGRESS_LABEL,
  jcProgressStatus,
  type JcProgressStatus,
  type PoItemJcUsage,
} from "@/lib/po-non-pr";
import { JC_PROGRESS_BADGE_CLASS } from "@/components/po/po-non-pr-panel";
import { orIlikePattern } from "@/lib/supabase/search-filter";

// Daftar item PO Non-PR vs pemakaiannya di Job Costing -- supaya barang yang
// sudah diterima di GMI-JAKARTA tapi belum dikonversi ke PN PR (lewat Job
// Costing) tidak menumpuk/terlupa.

const STATUS_FILTERS: { value: JcProgressStatus | "outstanding" | "all"; label: string }[] = [
  { value: "outstanding", label: "Perlu Job Costing" },
  { value: "belum_terima", label: "Belum Diterima" },
  { value: "selesai", label: "Selesai" },
  { value: "all", label: "Semua" },
];

// Harus sama dengan kolom yang dicari di query.
const NON_PR_SEARCH_FIELDS = ["Part Number", "Nama Barang"];

const NONPR_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di getNonPrSortValue.
const NONPR_COLUMNS = [
  { id: "po", label: "PO", sortDirection: "asc", className: NONPR_HEAD_CLASS },
  { id: "ref_pr", label: "Ref. PR", className: NONPR_HEAD_CLASS },
  { id: "part", label: "Part", sortDirection: "asc", className: NONPR_HEAD_CLASS },
  { id: "qty", label: "Qty PO", sortDirection: "desc", className: `text-center ${NONPR_HEAD_CLASS}` },
  { id: "qty_received", label: "Diterima", sortDirection: "desc", className: `text-center ${NONPR_HEAD_CLASS}` },
  { id: "used", label: "Dipakai JC", sortDirection: "desc", className: `text-center ${NONPR_HEAD_CLASS}` },
  { id: "sisa", label: "Sisa", sortDirection: "desc", className: `text-center ${NONPR_HEAD_CLASS}` },
  { id: "status", label: "Status", sortDirection: "asc", className: NONPR_HEAD_CLASS },
] as const satisfies readonly ReorderableColumn[];
type NonPrColumnId = (typeof NONPR_COLUMNS)[number]["id"];

const getNonPrSortValue = (r: any, key: string) => {
  if (key === "po") return r.po?.po_kode;
  if (key === "part") return r.part_number;
  return r[key];
};

export default function PoNonPrListPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<any[]>([]);
  const [usage, setUsage] = useState<Map<number, PoItemJcUsage>>(new Map());
  const [loading, setLoading] = useState(true);
  const columnOrder = useColumnOrder("wms:table-column-order:po-non-pr", NONPR_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusParam = urlState.get("status");
  const statusFilter =
    STATUS_FILTERS.find((f) => f.value === statusParam)?.value ?? "outstanding";
  const setStatusFilter = (v: string) =>
    urlState.set({ status: v === "outstanding" ? "" : v }, { resetPage: true });
  const sortOrder = urlState.get("sort", "");
  const setSortOrder = (v: string) => urlState.set({ sort: v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

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
          `part_number.ilike.${orIlikePattern(debouncedSearch)},part_name.ilike.${orIlikePattern(debouncedSearch)}`,
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

  const sorted = sortRows(filtered, sortOrder, getNonPrSortValue);
  const totalCount = sorted.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(totalCount / limit)));
  const pageRows = sorted.slice((safePage - 1) * limit, safePage * limit);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (r: any, id: NonPrColumnId) => {
    switch (id) {
      case "po":
        return (
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
        );
      case "ref_pr":
        return (
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
        );
      case "part":
        return (
          <TableCell className="py-2">
            <p className="text-[11px] font-black font-mono uppercase">
              {r.part_number}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">
              {r.part_name}
            </p>
          </TableCell>
        );
      case "qty":
        return (
          <TableCell className="py-2 text-center text-xs font-bold">
            {r.qty} <span className="text-[10px] font-medium text-muted-foreground">{r.satuan}</span>
          </TableCell>
        );
      case "qty_received":
        return (
          <TableCell className="py-2 text-center text-xs font-bold">
            {r.qty_received || 0}
          </TableCell>
        );
      case "used":
        return (
          <TableCell className="py-2 text-center text-xs font-bold">
            {r.used}
            {usage.get(r.id)?.jobs.map((j) => (
              <p key={j.id} className="text-[9px] font-mono font-medium text-muted-foreground">
                {j.job_kode}
              </p>
            ))}
          </TableCell>
        );
      case "sisa":
        return (
          <TableCell className="py-2 text-center text-xs font-black text-primary">
            {r.sisa}
          </TableCell>
        );
      case "status":
        return (
          <TableCell className="py-2">
            <Badge
              variant="outline"
              className={cn("text-[9px] font-bold uppercase", JC_PROGRESS_BADGE_CLASS[r.status as JcProgressStatus])}
            >
              {JC_PROGRESS_LABEL[r.status as JcProgressStatus]}
            </Badge>
          </TableCell>
        );
    }
  };

  return (
    <>
      <Content
        title="PO Non-PR → Job Costing"
        description="Item PO Non-PR yang sudah diterima di GMI-JAKARTA dan perlu dikonversi ke PN PR lewat Job Costing."
      >
        <div className="space-y-3">
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
          <ListSearchInput
            placeholder="Cari part number / nama..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={NON_PR_SEARCH_FIELDS}
          />
        </div>
      </Content>

      <Content>
        {columnOrder.isCustomOrder && (
          <ColumnOrderReset onReset={columnOrder.resetOrder} />
        )}
        <StickyHeaderTable
          className="min-w-[1200px]"
          containerClassName="rounded-md border"
          header={
            <ReorderableHeaderRow
              order={columnOrder.order}
              onMove={columnOrder.moveColumn}
              className="hover:bg-transparent h-10"
            >
              {columnOrder.orderedColumns.map((column) => (
                <ReorderableTableHead
                  key={column.id}
                  column={column}
                  sort={{ currentSort: sortOrder, onSort: handleSortChange }}
                />
              ))}
              <TableHead className="w-20 text-right pr-4 text-[10px] font-black uppercase text-muted-foreground">
                Aksi
              </TableHead>
            </ReorderableHeaderRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(limit, 25) }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={9}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {debouncedSearch
                    ? "Tidak ada data yang sesuai filter"
                    : "Tidak ada item PO Non-PR untuk filter ini"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((r) => (
                <TableRow key={r.id}>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(r, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem asChild>
                        <Link href={`/po/${r.po.id}`}>
                          <Eye className="mr-2 h-4 w-4" /> Buka PO
                        </Link>
                      </DropdownMenuItem>
                      {r.sisa > 0 && (
                        <DropdownMenuItem asChild>
                          <Link href={`/job-costing/create?po_id=${r.po.id}`}>
                            <Wrench className="mr-2 h-4 w-4" /> Buat JC
                          </Link>
                        </DropdownMenuItem>
                      )}
                    </RowActionsMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          currentPage={safePage}
          totalItems={totalCount}
          limit={limit}
          itemLabel="Item"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
        <p className="mt-3 text-[10px] text-muted-foreground">
          Menampilkan maks. 500 item PO Non-PR terbaru (PO rejected tidak
          ditampilkan). &quot;Dipakai JC&quot; menghitung semua Job Costing
          yang tidak rejected.
        </p>
      </Content>
    </>
  );
}
