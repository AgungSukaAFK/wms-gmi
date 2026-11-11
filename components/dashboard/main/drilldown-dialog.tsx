"use client";

// Daftar sumber data di balik kartu/chart dashboard. Dibuka lewat
// useDashboard().openList(kind, args). Data diambil saat dibuka (server
// action -> RPC get_main_dashboard_list) dengan pencarian & paginasi server.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { ArrowUpRight, Download, Loader2 } from "lucide-react";
import { ListSearchInput } from "@/components/list-search-input";
import { StatusBadge } from "@/components/status-badge";
import { TablePaginationFooter } from "@/components/table-pagination-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AGE_BUCKETS,
  DOC_TYPE_LABEL,
  LIST_DEFS,
  MR_LEVELS,
  type ColumnKey,
} from "@/components/dashboard/main/config";
import { useDashboard } from "@/components/dashboard/main/dashboard-context";
import { formatRangeLabel, formatYmdShort } from "@/lib/dashboard/filters";
import type { ApprovalDocType, ListArgs, ListResult, ListRow } from "@/lib/dashboard/types";
import { SOFT } from "@/lib/constants/status";
import { toast } from "@/lib/toast";
import { cn, formatCurrency } from "@/lib/utils";
import { fetchDashboardList } from "@/services/dashboard-actions";

const num = (v: unknown) => Number(v || 0).toLocaleString("id-ID");
const text = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));

const TRACKING_LABEL: Record<string, string> = {
  created: "Dibuat",
  packing: "Packing",
  in_transit: "Dalam perjalanan",
  delivered: "Sampai tujuan",
  completed: "Selesai",
};
const CONVERT_LABEL: Record<string, string> = {
  pending: "Belum PO",
  partial: "Sebagian PO",
  complete: "Sudah PO",
};
const RECEIVE_LABEL: Record<string, string> = {
  pending: "Belum diterima",
  partial: "Diterima sebagian",
  complete: "Diterima penuh",
};
const SPB_STAGE_LABEL: Record<string, string> = {
  belum_po: "Belum PO",
  po_belum_do: "PO, belum DO",
  do_belum_invoice: "DO, belum invoice",
  sudah_invoice: "Sudah invoice",
};
const LEVEL_LABEL = Object.fromEntries(MR_LEVELS.map((l) => [l.key, l.label]));

type Column = {
  label: string;
  align?: "right";
  /** Nilai untuk export Excel (teks/angka polos). */
  value: (row: ListRow) => string | number;
  render?: (row: ListRow) => React.ReactNode;
};

const Dash = () => <span className="text-muted-foreground/60">-</span>;

/** URL dokumen: href berakhiran "=" = halaman daftar + pencarian kodenya. */
function rowHref(row: ListRow) {
  if (!row.href) return null;
  return row.href.endsWith("=") ? `${row.href}${encodeURIComponent(row.kode ?? "")}` : row.href;
}

function softBadge(label: string, tone: keyof typeof SOFT) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap font-medium", SOFT[tone])}>
      {label}
    </Badge>
  );
}

function lateBadge(days: unknown) {
  const n = Number(days);
  if (!days || !Number.isFinite(n) || n <= 0) return <Dash />;
  return softBadge(`${num(n)} hari`, n > 14 ? "red" : "amber");
}

const dateCol = (label: string, key: string): Column => ({
  label,
  value: (r) => text(r[key]),
  render: (r) => (r[key] ? formatYmdShort(String(r[key])) : <Dash />),
});
const textCol = (label: string, key: string, className?: string): Column => ({
  label,
  value: (r) => text(r[key]),
  render: (r) =>
    r[key] ? <span className={className}>{String(r[key])}</span> : <Dash />,
});
const numCol = (label: string, key: string): Column => ({
  label,
  align: "right",
  value: (r) => Number(r[key] || 0),
  render: (r) => num(r[key]),
});

const COLUMNS: Record<ColumnKey, Column> = {
  kode: {
    label: "Kode",
    value: (r) => text(r.kode),
    render: (r) => {
      const href = rowHref(r);
      const label = r.kode || "-";
      return href ? (
        <Link
          href={href}
          className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary underline-offset-4 hover:underline"
        >
          {label}
          <ArrowUpRight className="h-3 w-3 shrink-0 opacity-60" />
        </Link>
      ) : (
        <span className="font-mono text-xs font-semibold">{label}</span>
      );
    },
  },
  doc_type: {
    label: "Jenis",
    value: (r) => DOC_TYPE_LABEL[r.doc_type as ApprovalDocType] ?? text(r.doc_type),
    render: (r) => DOC_TYPE_LABEL[r.doc_type as ApprovalDocType] ?? text(r.doc_type),
  },
  tanggal: dateCol("Tanggal", "tanggal"),
  due_date: dateCol("Due date", "due_date"),
  estimasi: dateCol("Estimasi tiba", "estimasi"),
  deadline: dateCol("Deadline", "deadline"),
  hari_lewat: {
    label: "Terlambat",
    align: "right",
    value: (r) => Number(r.hari_lewat || 0),
    render: (r) => lateBadge(r.hari_lewat),
  },
  umur_hari: {
    label: "Umur",
    align: "right",
    value: (r) => Number(r.umur_hari || 0),
    render: (r) => {
      const n = Number(r.umur_hari || 0);
      return (
        <span className={cn("tabular-nums", n > 14 && "font-semibold text-destructive")}>
          {num(n)} hari
        </span>
      );
    },
  },
  lokasi: textCol("Lokasi", "lokasi"),
  rute: {
    label: "Dari → ke",
    value: (r) => `${text(r.dari) || "-"} → ${text(r.ke) || "-"}`,
    render: (r) => (
      <span className="whitespace-nowrap">
        {text(r.dari) || "-"} <span className="text-muted-foreground">→</span> {text(r.ke) || "-"}
      </span>
    ),
  },
  pic: textCol("PIC", "pic"),
  approver: textCol("Menunggu", "approver", "font-medium"),
  status: {
    label: "Status",
    value: (r) => text(r.status),
    render: (r) => (r.status ? <StatusBadge status={String(r.status)} /> : <Dash />),
  },
  status_po: {
    label: "Status PO",
    value: (r) => CONVERT_LABEL[String(r.status_po)] ?? text(r.status_po),
    render: (r) => {
      const v = String(r.status_po || "pending");
      return softBadge(CONVERT_LABEL[v] ?? v, v === "complete" ? "green" : v === "partial" ? "amber" : "gray");
    },
  },
  status_terima: {
    label: "Penerimaan",
    value: (r) => RECEIVE_LABEL[String(r.status_terima)] ?? text(r.status_terima),
    render: (r) => {
      const v = String(r.status_terima || "pending");
      return softBadge(RECEIVE_LABEL[v] ?? v, v === "complete" ? "green" : v === "partial" ? "amber" : "gray");
    },
  },
  level: {
    label: "Level",
    value: (r) => LEVEL_LABEL[String(r.level)] ?? text(r.level),
    render: (r) => (r.level ? softBadge(LEVEL_LABEL[String(r.level)] ?? String(r.level), "sky") : <Dash />),
  },
  kategori: textCol("Kategori", "kategori"),
  vendor: textCol("Vendor", "vendor"),
  qty_terima: {
    label: "Diterima",
    align: "right",
    value: (r) => `${num(r.qty_diterima)} / ${num(r.qty)}`,
    render: (r) => (
      <span className="whitespace-nowrap tabular-nums">
        {num(r.qty_diterima)} <span className="text-muted-foreground">/ {num(r.qty)}</span>
      </span>
    ),
  },
  nilai: {
    label: "Nilai (subtotal)",
    align: "right",
    value: (r) => Number(r.nilai || 0),
    render: (r) =>
      r.nilai === null || r.nilai === undefined ? (
        <Dash />
      ) : String(r.mata_uang || "IDR") === "IDR" ? (
        formatCurrency(Number(r.nilai))
      ) : (
        `${r.mata_uang} ${Number(r.nilai).toLocaleString("id-ID")}`
      ),
  },
  part_name: textCol("Nama barang", "part_name"),
  qty: {
    label: "Qty",
    align: "right",
    value: (r) => Number(r.qty || 0),
    render: (r) => (
      <span className="whitespace-nowrap tabular-nums">
        {num(r.qty)} {r.satuan ? <span className="text-muted-foreground">{String(r.satuan)}</span> : null}
      </span>
    ),
  },
  min_qty: numCol("Min", "min_qty"),
  max_qty: numCol("Max", "max_qty"),
  selisih: {
    label: "Selisih",
    align: "right",
    value: (r) => Number(r.selisih || 0),
    render: (r) => <span className="font-semibold tabular-nums">{num(r.selisih)}</span>,
  },
  customer: textCol("Customer", "customer"),
  tracking: {
    label: "Tracking",
    value: (r) => TRACKING_LABEL[String(r.tracking)] ?? text(r.tracking),
    render: (r) =>
      r.tracking ? softBadge(TRACKING_LABEL[String(r.tracking)] ?? String(r.tracking), "blue") : <Dash />,
  },
  catatan: {
    label: "Keterangan",
    value: (r) => text(r.catatan),
    render: (r) =>
      r.catatan ? (
        <span className="line-clamp-2 min-w-40 max-w-xs whitespace-normal" title={String(r.catatan)}>
          {String(r.catatan)}
        </span>
      ) : (
        <Dash />
      ),
  },
  alasan: textCol("Alasan", "alasan"),
  mr_kode: textCol("MR", "mr_kode", "font-mono text-xs"),
  po_kode: textCol("PO", "po_kode", "font-mono text-xs"),
  spb_no: textCol("No. SPB", "spb_no", "font-mono text-xs"),
  no_wo: textCol("No. WO", "no_wo"),
  kode_unit: textCol("Kode unit", "kode_unit"),
  tahap: {
    label: "Tahap",
    value: (r) => SPB_STAGE_LABEL[String(r.tahap)] ?? text(r.tahap),
    render: (r) => (r.tahap ? (SPB_STAGE_LABEL[String(r.tahap)] ?? String(r.tahap)) : <Dash />),
  },
  pembayaran: {
    label: "Pembayaran",
    value: (r) => text(r.pembayaran),
    render: (r) =>
      r.pembayaran === "paid" ? softBadge("Paid", "emerald") : softBadge("Unpaid", "amber"),
  },
  departemen: textCol("Departemen", "departemen"),
};

/** Keterangan tambahan di bawah judul, dari argumen drill-down. */
function describeArgs(args: ListArgs): string[] {
  const out: string[] = [];
  if (args.mine) out.push("Giliran Anda");
  if (typeof args.doc === "string")
    out.push(DOC_TYPE_LABEL[args.doc as ApprovalDocType] ?? args.doc);
  if (typeof args.age === "string") {
    const bucket = AGE_BUCKETS.find((b) => b.key === args.age);
    if (bucket) out.push(`Umur ${bucket.label}`);
  }
  if (args.stale) out.push("Menunggu lebih dari 7 hari");
  if (typeof args.bucket === "string") out.push(LEVEL_LABEL[args.bucket] ?? args.bucket);
  if (typeof args.receive === "string") out.push(RECEIVE_LABEL[args.receive] ?? args.receive);
  if (typeof args.status === "string") out.push(`Status ${args.status}`);
  return out;
}

const PERIOD_KINDS = /_period$/;
const LIMITS = [10, 20, 50, 100] as const;

export function DrilldownDialog() {
  const { detail, closeList, scope, canValue } = useDashboard();
  const open = detail !== null;

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 350);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<number>(20);
  const [exporting, setExporting] = useState(false);
  // Hasil disimpan bersama kuncinya: "loading" = kunci hasil belum sama
  // dengan kunci permintaan saat ini (tanpa setState sinkron di effect).
  const [result, setResult] = useState<{
    key: string;
    data: ListResult | null;
    error: string | null;
  } | null>(null);

  const detailKey = detail ? `${detail.kind}|${JSON.stringify(detail.args)}` : "";
  const scopeKey = JSON.stringify(scope);

  // Daftar lain dibuka / filter berubah -> mulai dari halaman 1, cari kosong.
  const [prevDetailKey, setPrevDetailKey] = useState(detailKey);
  if (prevDetailKey !== detailKey) {
    setPrevDetailKey(detailKey);
    setSearch("");
    setPage(1);
  }
  const [prevSearch, setPrevSearch] = useState(debouncedSearch);
  if (prevSearch !== debouncedSearch) {
    setPrevSearch(debouncedSearch);
    setPage(1);
  }

  const requestKey = open
    ? `${detailKey}|${scopeKey}|${debouncedSearch}|${page}|${limit}`
    : "";

  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    fetchDashboardList({
      kind: detail.kind,
      args: detail.args,
      scope,
      search: debouncedSearch,
      limit,
      offset: (page - 1) * limit,
    }).then((res) => {
      if (!cancelled) setResult({ key: requestKey, data: res.data, error: res.error });
    });
    return () => {
      cancelled = true;
    };
    // requestKey sudah mewakili detail, scope, pencarian, dan halaman.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const def = detail ? LIST_DEFS[detail.kind] : null;
  const columns = useMemo(() => {
    if (!def) return [];
    return def.columns
      .filter((key) => key !== "nilai" || canValue)
      .map((key) => ({
        key,
        ...COLUMNS[key],
        label: key === "kode" && def.kodeLabel ? def.kodeLabel : COLUMNS[key].label,
      }));
  }, [def, canValue]);

  if (!detail || !def) return null;

  const current = result?.key === requestKey ? result : null;
  const loading = !current;
  // Selama memuat halaman berikutnya, baris lama tetap tampil (diredupkan).
  const shown = current ?? (result?.key.startsWith(`${detailKey}|${scopeKey}|`) ? result : null);
  const rows = shown?.data?.rows ?? [];
  const total = shown?.data?.total ?? 0;
  const error = current?.error ?? null;

  const notes = describeArgs(detail.args);
  const isPeriod = PERIOD_KINDS.test(detail.kind);
  const pageLink = def.page?.(scope, detail.args) ?? null;

  const exportExcel = async () => {
    setExporting(true);
    try {
      const res = await fetchDashboardList({
        kind: detail.kind,
        args: detail.args,
        scope,
        search: debouncedSearch,
        limit: 5000,
        offset: 0,
      });
      if (res.error || !res.data) {
        toast.error(`Gagal menyiapkan Excel: ${res.error ?? "data kosong"}`);
        return;
      }
      const XLSX = await import("xlsx");
      const sheetRows = res.data.rows.map((row) =>
        Object.fromEntries(columns.map((c) => [c.label, c.value(row)])),
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), "Data");
      XLSX.writeFile(wb, `Dashboard_${detail.kind}_${scope.today}.xlsx`);
      if (res.data.total > res.data.rows.length) {
        toast.warning(
          `Excel berisi ${res.data.rows.length.toLocaleString("id-ID")} baris pertama dari ${res.data.total.toLocaleString("id-ID")}.`,
        );
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeList()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-hidden sm:max-w-5xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="leading-snug">{detail.title || def.title}</DialogTitle>
          <DialogDescription>
            {def.description}
            {isPeriod && ` Periode ${formatRangeLabel(scope.from, scope.to)}.`}
          </DialogDescription>
          {notes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {notes.map((n) => (
                <Badge key={n} variant="secondary" className="font-medium">
                  {n}
                </Badge>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ListSearchInput
            value={search}
            onChange={setSearch}
            placeholder={`Cari ${def.itemLabel}...`}
            searchableFields={def.searchable}
          />
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              onClick={exportExcel}
              disabled={exporting || total === 0}
              className="flex-1 sm:flex-none"
            >
              {exporting ? <Loader2 className="animate-spin" /> : <Download />}
              {exporting ? "Menyiapkan..." : "Excel"}
            </Button>
            {pageLink && (
              <Button asChild variant="outline" className="flex-1 sm:flex-none">
                <Link href={pageLink.href}>
                  {pageLink.label}
                  <ArrowUpRight />
                </Link>
              </Button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                {columns.map((c) => (
                  <TableHead
                    key={c.key}
                    className={cn("h-10 whitespace-nowrap", c.align === "right" && "text-right")}
                  >
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className={cn(loading && shown && "opacity-60 transition-opacity")}>
              {error ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center text-sm">
                    <span className="text-destructive">Gagal memuat daftar.</span>{" "}
                    <span className="text-muted-foreground">{error}</span>
                  </TableCell>
                </TableRow>
              ) : !shown ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={columns.length}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-sm text-muted-foreground"
                  >
                    {debouncedSearch
                      ? `Tidak ada ${def.itemLabel} yang cocok dengan "${debouncedSearch}".`
                      : `Tidak ada ${def.itemLabel} untuk filter ini.`}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, i) => (
                  <TableRow key={`${row.id}-${i}`}>
                    {columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={cn("py-2 text-sm", c.align === "right" && "text-right")}
                      >
                        {c.render ? c.render(row) : c.value(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Urutan: {def.order.toLowerCase()}.</p>
          <TablePaginationFooter
            currentPage={page}
            totalItems={total}
            limit={limit}
            limitOptions={LIMITS}
            itemLabel={def.itemLabel}
            onPageChange={setPage}
            onLimitChange={(v) => {
              setLimit(Number(v));
              setPage(1);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
