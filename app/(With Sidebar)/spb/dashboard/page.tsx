"use client";

// Dashboard SPB: ringkasan jumlah SPB (per status & progress), SPB PO, DO,
// Invoice, Return, dan qty item sudah/belum PO -- plus rincian item per
// nomor WO. Data dari RPC get_spb_dashboard_summary / get_spb_wo_items
// (migration 20261109100000) dan get_spb_status_summary (Base & Completing
// Status, migration 20261111100000). Semua filter disimpan di URL.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import {
  ArrowRight,
  Check,
  ChevronsUpDown,
  Download,
  FileBox,
  FileWarning,
  LayoutDashboard,
  MapPin,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  Truck,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Content } from "@/components/content";
import { DatePickerString } from "@/components/date-picker-string";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { MultiSelect } from "@/components/ui/multi-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { toast } from "@/lib/toast";
import { cn, formatDate, ymdToLocalStartIso } from "@/lib/utils";
import { getCabangList } from "@/services/master-actions";
import {
  getSpbDashboardSummary,
  getSpbStatusSummary,
  getSpbWoItems,
  searchSpbWoNumbers,
  type SpbDashboardFilters,
  type SpbDashboardSummary,
  type SpbStatusSummary,
  type SpbWoItemRow,
} from "@/services/spb-actions";

type CabangOption = { id: number; nama_cabang: string };

const num = (n: number | null | undefined) => Number(n || 0).toLocaleString("id-ID");
const pct = (part: number, total: number) =>
  total > 0 ? `${Math.round((part / total) * 100)}%` : "0%";

/** "YYYY-MM-DD" -> ISO awal hari berikutnya (batas atas eksklusif). */
function nextDayStartIso(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).toISOString();
}

// Warna status dokumen; selalu didampingi teks label.
const STATUS_TONE: Record<string, string> = {
  "DONE QUOT": "bg-sky-500",
  PO_ATTACH: "bg-violet-500",
  DO_ATTACH: "bg-amber-500",
  Partial: "bg-orange-500",
  Returned: "bg-slate-500",
  CANCELLED: "bg-rose-500",
};

function SummaryTile({
  label,
  value,
  icon: Icon,
  href,
  children,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <Content size="xs" className="sm:col-span-6 lg:col-span-4 xl:col-span-2 2xl:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{num(value)}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {children && (
        <div className="mt-2 space-y-0.5 text-[10px] font-medium text-muted-foreground">
          {children}
        </div>
      )}
      <Link
        href={href}
        className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-primary hover:underline"
      >
        Lihat daftar <ArrowRight className="h-3 w-3" />
      </Link>
    </Content>
  );
}

function SubCount({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <p className="flex justify-between gap-2">
      <span>{label}</span>
      <span className={cn("font-bold tabular-nums text-foreground", className)}>{num(value)}</span>
    </p>
  );
}

function BarRow({
  label,
  value,
  total,
  tone,
  href,
}: {
  label: string;
  value: number;
  total: number;
  tone: string;
  href?: string;
}) {
  const width = total > 0 ? Math.max((value / total) * 100, value > 0 ? 2 : 0) : 0;
  const labelNode = (
    <span className="flex items-center gap-2 truncate text-xs font-semibold text-foreground">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", tone)} />
      {label}
    </span>
  );
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        {href ? (
          <Link href={href} className="min-w-0 hover:underline">
            {labelNode}
          </Link>
        ) : (
          labelNode
        )}
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          <span className="font-bold text-foreground">{num(value)}</span> · {pct(value, total)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

const COMPLETING_ROWS: {
  key: keyof SpbStatusSummary["completing"];
  label: string;
  tone: string;
}[] = [
  { key: "quotation", label: "Quotation", tone: "bg-slate-500" },
  { key: "po_customer", label: "PO Customer", tone: "bg-sky-500" },
  { key: "delivered", label: "Delivered", tone: "bg-indigo-500" },
  { key: "invoiced", label: "Invoiced", tone: "bg-violet-500" },
  { key: "paid", label: "Paid", tone: "bg-emerald-500" },
  { key: "cancelled", label: "Cancelled", tone: "bg-rose-500" },
];

function SpbStatusCards({
  summary,
  loading,
  error,
  listHref,
}: {
  summary: SpbStatusSummary | null;
  loading: boolean;
  error: string | null;
  listHref: (extra?: Record<string, string>) => string;
}) {
  const baseTotal = summary ? summary.base.lengkap + summary.base.belum_lengkap : 0;
  const completingTotal = summary
    ? Object.values(summary.completing).reduce((a, b) => a + b, 0)
    : 0;
  const missing = summary
    ? Object.entries(summary.missing).sort((a, b) => b[1] - a[1])
    : [];

  const body = (content: React.ReactNode) =>
    loading && !summary ? (
      <Skeleton className="h-40 w-full" />
    ) : !summary ? (
      <p className="text-xs text-muted-foreground">
        {error ? `Gagal memuat status SPB: ${error}` : "Data status tidak tersedia."}
      </p>
    ) : (
      content
    );

  return (
    <>
      <Content
        size="md"
        title="Base Status"
        description="Kelengkapan data awal SPB sampai PIC PPA (tanpa Cancelled)."
      >
        {body(
          <div className="space-y-3">
            <BarRow
              label="Lengkap"
              value={summary?.base.lengkap ?? 0}
              total={baseTotal}
              tone="bg-emerald-500"
              href={listHref({ base: "Lengkap" })}
            />
            <BarRow
              label="Belum Lengkap"
              value={summary?.base.belum_lengkap ?? 0}
              total={baseTotal}
              tone="bg-amber-500"
              href={listHref({ base: "Belum Lengkap" })}
            />
            {missing.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-[10px] font-bold uppercase text-muted-foreground">
                  Data yang masih kosong
                </p>
                <div className="space-y-1 text-xs">
                  {missing.map(([field, count]) => (
                    <SubCount key={field} label={field} value={count} />
                  ))}
                </div>
              </div>
            )}
          </div>,
        )}
      </Content>

      <Content
        size="md"
        title="Completing Status"
        description="Tahap proses tertinggi yang sudah dicapai tiap SPB. Klik status untuk membuka daftar SPB."
      >
        {body(
          <div className="space-y-3">
            {COMPLETING_ROWS.map((row) => (
              <BarRow
                key={row.key}
                label={row.label}
                value={summary?.completing[row.key] ?? 0}
                total={completingTotal}
                tone={row.tone}
                href={listHref({ progress: row.label })}
              />
            ))}
          </div>,
        )}
      </Content>
    </>
  );
}

function WoCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debouncedTerm] = useDebounce(term, 300);
  // Hasil disimpan bersama term-nya; "loading" = hasil belum utk term terkini.
  const [result, setResult] = useState<{ term: string; data: string[] } | null>(null);
  const options = result?.data ?? [];
  const loading = open && result?.term !== debouncedTerm;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    searchSpbWoNumbers(debouncedTerm).then((res) => {
      if (!cancelled) setResult({ term: debouncedTerm, data: res.data });
    });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedTerm]);

  const typed = term.trim();
  const showTyped =
    typed.length > 0 && !options.some((o) => o.toLowerCase() === typed.toLowerCase());

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setTerm("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between text-xs font-semibold sm:w-56"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? `WO: ${value}` : "Semua No WO"}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Cari nomor WO..." value={term} onValueChange={setTerm} />
          <CommandList>
            <CommandEmpty>{loading ? "Memuat..." : "Nomor WO tidak ditemukan."}</CommandEmpty>
            <CommandGroup>
              {showTyped && (
                <CommandItem value={`__typed__${typed}`} onSelect={() => pick(typed)}>
                  Gunakan &quot;{typed}&quot;
                </CommandItem>
              )}
              {options.map((wo) => (
                <CommandItem key={wo} value={wo} onSelect={() => pick(wo)}>
                  <span className="truncate">{wo}</span>
                  <Check
                    className={cn(
                      "ml-auto",
                      value.toLowerCase() === wo.toLowerCase() ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function SpbDashboardPage() {
  const urlState = useUrlListState();
  const locationFilters = urlState.list("lokasi");
  const dateFrom = urlState.get("dari");
  const dateTo = urlState.get("sampai");
  const noWo = urlState.get("wo");

  const [availableCabang, setAvailableCabang] = useState<CabangOption[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  // Hasil fetch disimpan bersama kunci filternya; "loading" = kunci hasil
  // belum sama dengan kunci filter saat ini (tanpa setState sinkron di effect).
  const [summaryState, setSummaryState] = useState<{
    key: string;
    data: SpbDashboardSummary | null;
  } | null>(null);
  const [woState, setWoState] = useState<{ key: string; data: SpbWoItemRow[] } | null>(null);
  const [statusState, setStatusState] = useState<{
    key: string;
    data: SpbStatusSummary | null;
    error: string | null;
  } | null>(null);

  const filters = useMemo<SpbDashboardFilters>(
    () => ({
      cabangIds: locationFilters.length ? locationFilters.map(Number) : undefined,
      dateFrom: dateFrom ? ymdToLocalStartIso(dateFrom) : undefined,
      dateTo: dateTo ? nextDayStartIso(dateTo) : undefined,
      noWo: noWo || undefined,
    }),
    [locationFilters, dateFrom, dateTo, noWo],
  );
  const requestKey = `${JSON.stringify(filters)}|${reloadKey}`;
  const summary = summaryState?.data ?? null;
  const loading = summaryState?.key !== requestKey;
  const woItems = useMemo(
    () => (noWo && woState?.key === requestKey ? woState.data : []),
    [noWo, woState, requestKey],
  );
  const woLoading = !!noWo && woState?.key !== requestKey;
  const statusSummary = statusState?.data ?? null;
  const statusLoading = statusState?.key !== requestKey;

  useEffect(() => {
    getCabangList().then((data) => setAvailableCabang((data || []) as CabangOption[]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSpbDashboardSummary(filters).then((res) => {
      if (cancelled) return;
      if (res.error) toast.error(`Gagal memuat dashboard SPB: ${res.error}`);
      setSummaryState({ key: requestKey, data: res.data });
    });
    return () => {
      cancelled = true;
    };
  }, [filters, requestKey]);

  // Terpisah dari ringkasan utama: kalau RPC status belum ada (migration
  // belum dijalankan), kartu lain tetap tampil.
  useEffect(() => {
    let cancelled = false;
    getSpbStatusSummary(filters).then((res) => {
      if (cancelled) return;
      setStatusState({ key: requestKey, data: res.data, error: res.error });
    });
    return () => {
      cancelled = true;
    };
  }, [filters, requestKey]);

  useEffect(() => {
    if (!filters.noWo) return;
    let cancelled = false;
    getSpbWoItems(filters).then((res) => {
      if (cancelled) return;
      if (res.error) toast.error(`Gagal memuat item WO: ${res.error}`);
      setWoState({ key: requestKey, data: res.data });
    });
    return () => {
      cancelled = true;
    };
  }, [filters, requestKey]);

  // Query string utk link ke halaman daftar SPB (param yang sama: lokasi/dari/sampai).
  const spbListHref = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams();
      if (locationFilters.length) params.set("lokasi", locationFilters.join(","));
      if (dateFrom) params.set("dari", dateFrom);
      if (dateTo) params.set("sampai", dateTo);
      if (noWo) params.set("search", noWo);
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
      const qs = params.toString();
      return qs ? `/spb?${qs}` : "/spb";
    },
    [locationFilters, dateFrom, dateTo, noWo],
  );

  const hasFilter = locationFilters.length > 0 || !!dateFrom || !!dateTo || !!noWo;

  const woTotals = useMemo(
    () =>
      woItems.reduce(
        (acc, r) => {
          acc.qty += r.qty || 0;
          acc.qtyPo += r.qty_po || 0;
          acc.qtyBelumPo += r.qty_belum_po || 0;
          acc.qtyReturned += r.qty_returned || 0;
          return acc;
        },
        { qty: 0, qtyPo: 0, qtyBelumPo: 0, qtyReturned: 0 },
      ),
    [woItems],
  );
  const woSpbCount = useMemo(() => new Set(woItems.map((r) => r.spb_id)).size, [woItems]);

  const exportWoItems = () => {
    const rows = woItems.map((r) => ({
      "No WO": r.spb_no_wo,
      "No SPB": r.spb_no,
      "Tanggal SPB": r.spb_tanggal ? formatDate(r.spb_tanggal) : "",
      "Status SPB": r.spb_status,
      Lokasi: r.nama_cabang,
      "Kode Unit": r.spb_kode_unit,
      "Part Number": r.part_number,
      "Part Name": r.part_name,
      Satuan: r.satuan,
      Qty: r.qty,
      "Qty Sudah PO": r.qty_po,
      "Qty Belum PO": r.qty_belum_po,
      "Qty Retur": r.qty_returned,
      "No PO": r.po_nos || "",
      "No DO": r.do_nos || "",
      "No Invoice": r.invoice_nos || "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Item WO");
    const safeWo = noWo.replace(/[^\w-]+/g, "_");
    XLSX.writeFile(wb, `Item_SPB_WO_${safeWo}.xlsx`);
  };

  const progress = summary?.progress;
  const activeSpb = progress
    ? progress.belum_po + progress.po_belum_do + progress.do_belum_invoice + progress.sudah_invoice
    : 0;

  return (
    <>
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
              <LayoutDashboard className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">DASHBOARD SPB</h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Ringkasan SPB → PO → DO → Invoice → Return
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" className="h-9 gap-2 text-xs font-bold uppercase">
              <Link href="/spb/report">
                <FileBox className="h-4 w-4" /> Report SPB
              </Link>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              title="Muat ulang data"
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <MultiSelect
            className="h-9 w-full sm:w-48"
            placeholder="Semua Lokasi"
            icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
            searchable
            selected={locationFilters}
            onChange={(vals) => urlState.set({ lokasi: vals })}
            options={availableCabang.map((c) => ({ label: c.nama_cabang, value: c.id.toString() }))}
          />
          <DatePickerString
            value={dateFrom}
            onChange={(v) => urlState.set({ dari: v })}
            placeholder="Tgl SPB dari"
            className="h-9 w-full text-xs sm:w-40"
          />
          <DatePickerString
            value={dateTo}
            onChange={(v) => urlState.set({ sampai: v })}
            placeholder="Tgl SPB sampai"
            className="h-9 w-full text-xs sm:w-40"
          />
          <WoCombobox value={noWo} onChange={(v) => urlState.set({ wo: v })} />
          {hasFilter && (
            <Button
              variant="ghost"
              className="h-9 gap-1 text-xs font-semibold"
              onClick={() => urlState.reset()}
            >
              <X className="h-3.5 w-3.5" /> Reset filter
            </Button>
          )}
        </div>
      </Content>

      {loading && !summary ? (
        Array.from({ length: 5 }).map((_, i) => (
          <Content key={i} size="xs" className="sm:col-span-6 lg:col-span-4 xl:col-span-2">
            <Skeleton className="h-28 w-full" />
          </Content>
        ))
      ) : summary ? (
        <>
          <SummaryTile label="SPB" value={summary.spb_total} icon={FileWarning} href={spbListHref()}>
            <SubCount label="Aktif" value={activeSpb} />
            <SubCount label="Cancelled" value={summary.progress.cancelled} />
          </SummaryTile>
          <SummaryTile label="Purchase Order" value={summary.po_total} icon={ShoppingCart} href="/spb/po">
            <SubCount label="SPB belum PO" value={summary.progress.belum_po} />
          </SummaryTile>
          <SummaryTile label="Delivery Order" value={summary.do_total} icon={Truck} href="/spb/do">
            <SubCount label="SPB PO belum DO" value={summary.progress.po_belum_do} />
          </SummaryTile>
          <SummaryTile label="Invoice" value={summary.invoice.total} icon={ReceiptText} href="/spb/invoice">
            <SubCount label="Paid" value={summary.invoice.paid} />
            <SubCount label="Unpaid" value={summary.invoice.unpaid} />
            <SubCount label="Menunggu approval" value={summary.invoice.open} />
          </SummaryTile>
          <SummaryTile label="Return SPB" value={summary.return.total} icon={Undo2} href="/return-spb">
            <SubCount label="Selesai" value={summary.return.completed} />
            <SubCount label="Menunggu approval" value={summary.return.open} />
            <SubCount label="Ditolak" value={summary.return.rejected} />
          </SummaryTile>
          <SummaryTile label="Item SPB" value={summary.items.total} icon={FileBox} href="/spb/report">
            <SubCount label="Qty sudah PO" value={summary.items.qty_po} />
            <SubCount label="Qty belum PO" value={summary.items.qty_belum_po} />
          </SummaryTile>

          <Content
            size="md"
            title="Status SPB"
            description="Jumlah dokumen per status SPB. Klik status untuk membuka daftar SPB."
          >
            {summary.by_status.length === 0 ? (
              <p className="text-xs text-muted-foreground">Tidak ada SPB untuk filter ini.</p>
            ) : (
              <div className="space-y-3">
                {summary.by_status.map((s) => (
                  <BarRow
                    key={s.status}
                    label={s.status}
                    value={s.count}
                    total={summary.spb_total}
                    tone={STATUS_TONE[s.status] || "bg-primary"}
                    href={spbListHref({ status: s.status })}
                  />
                ))}
              </div>
            )}
          </Content>

          <Content
            size="md"
            title="Progress Dokumen"
            description="Posisi SPB aktif (tanpa Cancelled) berdasarkan dokumen yang sudah dibuat."
          >
            <div className="space-y-3">
              <BarRow label="Belum PO" value={summary.progress.belum_po} total={activeSpb} tone="bg-rose-500" />
              <BarRow label="Sudah PO, belum DO" value={summary.progress.po_belum_do} total={activeSpb} tone="bg-amber-500" />
              <BarRow label="Sudah DO, belum Invoice" value={summary.progress.do_belum_invoice} total={activeSpb} tone="bg-sky-500" />
              <BarRow label="Sudah Invoice" value={summary.progress.sudah_invoice} total={activeSpb} tone="bg-emerald-500" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3">
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">Qty item</p>
                <p className="text-lg font-bold tabular-nums">{num(summary.items.qty_total)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">Sudah PO</p>
                <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {num(summary.items.qty_po)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">Belum PO</p>
                <p className="text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">
                  {num(summary.items.qty_belum_po)}
                </p>
              </div>
            </div>
          </Content>
        </>
      ) : (
        <Content>
          <p className="text-xs text-muted-foreground">Data dashboard tidak tersedia.</p>
        </Content>
      )}

      <SpbStatusCards
        summary={statusSummary}
        loading={statusLoading}
        error={statusState?.error ?? null}
        listHref={spbListHref}
      />

      <Content
        title={noWo ? `Item SPB untuk WO ${noWo}` : "Item per Nomor WO"}
        description={
          noWo
            ? "Semua item dari SPB (selain Cancelled) dengan nomor WO ini, beserta qty yang sudah / belum dibuatkan PO."
            : "Pilih nomor WO di filter atas untuk melihat item-itemnya dan qty yang sudah / belum di-PO."
        }
        cardAction={
          noWo && woItems.length > 0 ? (
            <Button onClick={exportWoItems} className="h-9 gap-2 text-xs font-bold uppercase">
              <Download className="h-4 w-4" /> Export Excel
            </Button>
          ) : undefined
        }
      >
        {!noWo ? (
          <div className="flex flex-col items-start gap-3">
            <WoCombobox value={noWo} onChange={(v) => urlState.set({ wo: v })} />
          </div>
        ) : woLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : woItems.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Tidak ada item SPB untuk WO ini dengan filter lokasi/tanggal yang dipilih.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{num(woSpbCount)} SPB</Badge>
              <Badge variant="outline">{num(woItems.length)} item</Badge>
              <Badge variant="outline">Qty {num(woTotals.qty)}</Badge>
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                Sudah PO {num(woTotals.qtyPo)}
              </Badge>
              <Badge className="bg-rose-600 text-white hover:bg-rose-600">
                Belum PO {num(woTotals.qtyBelumPo)}
              </Badge>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No SPB</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Part Number</TableHead>
                    <TableHead>Part Name</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Sudah PO</TableHead>
                    <TableHead className="text-right">Belum PO</TableHead>
                    <TableHead className="text-right">Retur</TableHead>
                    <TableHead>No PO</TableHead>
                    <TableHead>No DO</TableHead>
                    <TableHead>No Invoice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {woItems.map((r) => (
                    <TableRow key={r.spb_dtl_id}>
                      <TableCell className="whitespace-nowrap text-xs font-semibold">{r.spb_no}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.spb_tanggal ? formatDate(r.spb_tanggal) : "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.spb_status}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-mono">{r.part_number}</TableCell>
                      <TableCell className="min-w-48 text-xs">{r.part_name}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {num(r.qty)} <span className="text-muted-foreground">{r.satuan}</span>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {num(r.qty_po)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-xs font-bold tabular-nums",
                          r.qty_belum_po > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
                        )}
                      >
                        {num(r.qty_belum_po)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{num(r.qty_returned)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.po_nos || "-"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.do_nos || "-"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.invoice_nos || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5} className="text-xs font-bold uppercase">Total</TableCell>
                    <TableCell className="text-right text-xs font-bold tabular-nums">{num(woTotals.qty)}</TableCell>
                    <TableCell className="text-right text-xs font-bold tabular-nums">{num(woTotals.qtyPo)}</TableCell>
                    <TableCell className="text-right text-xs font-bold tabular-nums">{num(woTotals.qtyBelumPo)}</TableCell>
                    <TableCell className="text-right text-xs font-bold tabular-nums">{num(woTotals.qtyReturned)}</TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>
        )}
      </Content>
    </>
  );
}
