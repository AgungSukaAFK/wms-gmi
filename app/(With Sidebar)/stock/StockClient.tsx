"use client";

import React, { useState, useEffect, useRef } from "react";
import { Content } from "@/components/content";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Search,
  Loader2,
  FilterX,
  Package,
  ArrowRight,
  Warehouse,
  ArrowUpDown,
  FileSpreadsheet,
  Upload,
  Download,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import * as XLSX from "xlsx";
import {
  getStockMinMaxMeta,
  fetchStockMinMaxPage,
  stageMinMaxChunk,
  validateMinMaxBatch,
  applyMinMaxBatch,
  clearMinMaxBatch,
  type MinMaxProblemReport,
} from "@/services/stock-actions";

const TEMPLATE_SHEET = "STOCK MIN MAX";
const N = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toUpperCase();

function fmtDur(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s <= 1) return "<1 dtk";
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} mnt ${r} dtk` : `${m} mnt`;
}

/** Estimasi sisa waktu dari laju progres aktual. */
function etaText(startMs: number, done: number, total: number): string {
  if (!startMs || done <= 0 || total <= 0 || done >= total) return "";
  const elapsed = Date.now() - startMs;
  if (elapsed < 400) return ""; // tunggu data cukup agar estimasi tidak liar
  const remain = (elapsed / done) * (total - done);
  return `Estimasi ~${fmtDur(remain)}`;
}
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useDebounce } from "use-debounce";
import { useRouter, useSearchParams } from "next/navigation";
import { StockDetailSheet } from "@/components/stock/stock-detail-sheet";
import { cn } from "@/lib/utils";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface StockClientProps {
  initialData: any[];
  totalCount: number;
  cabangList: any[];
  currentPage: number;
  pageSize: number;
  initialQuery: string;
  initialCabang: string;
  initialStatus: string;
  initialSort: string;
  initialView: "table" | "grid";
  initialStockFrom: string;
  initialStockTo: string;
}

export default function StockClient({
  initialData,
  totalCount,
  cabangList,
  currentPage,
  pageSize,
  initialQuery,
  initialCabang,
  initialStatus,
  initialSort,
  initialView,
  initialStockFrom,
  initialStockTo,
}: StockClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const profile = useAuthStore((s) => s.profile);
  const isModerator = (profile?.roles || []).some(
    (r: any) => r?.name === "moderator",
  );

  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [upProgress, setUpProgress] = useState<{
    phase: string;
    done: number;
    total: number;
  } | null>(null);
  const [problems, setProblems] = useState<MinMaxProblemReport | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const dlStartRef = useRef(0);
  const stageStartRef = useRef(0);

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    setDlProgress({ done: 0, total: 0 });
    try {
      const meta = await getStockMinMaxMeta();
      if (!meta.success) {
        toast.error(meta.error);
        return;
      }
      const { cabang, total } = meta;
      setDlProgress({ done: 0, total });
      dlStartRef.current = Date.now();

      // Gabungkan per part secara case-insensitive (barang bisa punya varian
      // huruf besar/kecil untuk part yang sama → jangan jadi baris duplikat).
      const parts = new Map<
        string,
        {
          part_number: string;
          name: string;
          cab: Map<number, [number, number, number]>;
        }
      >();
      const PAGE = 1000;
      for (let off = 0; off < Math.max(total, 1); off += PAGE) {
        const res = await fetchStockMinMaxPage(off, PAGE);
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        for (const r of res.rows) {
          const key = r.part_number.trim().toUpperCase();
          let p = parts.get(key);
          if (!p) {
            p = {
              part_number: r.part_number,
              name: r.part_name,
              cab: new Map(),
            };
            parts.set(key, p);
          }
          if (!p.cab.has(r.cabang_id))
            p.cab.set(r.cabang_id, [r.qty, r.min_qty, r.max_qty]);
        }
        setDlProgress({ done: Math.min(off + PAGE, total), total });
        if (res.rows.length < PAGE) break;
      }

      const header: string[] = ["No. Barang", "Deskripsi Barang"];
      for (const c of cabang)
        header.push(
          `${c.nama_cabang} QTY`,
          `${c.nama_cabang} MIN`,
          `${c.nama_cabang} MAX`,
        );
      const aoa: (string | number)[][] = [header];
      for (const key of [...parts.keys()].sort()) {
        const p = parts.get(key)!;
        const line: (string | number)[] = [p.part_number, p.name];
        for (const c of cabang) {
          const v = p.cab.get(c.id);
          if (v) line.push(v[0], v[1], v[2]);
          else line.push("", "", "");
        }
        aoa.push(line);
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = header.map((_, i) =>
        i === 0 ? { wch: 22 } : i === 1 ? { wch: 40 } : { wch: 12 },
      );
      XLSX.utils.book_append_sheet(wb, ws, TEMPLATE_SHEET);
      const guide = XLSX.utils.aoa_to_sheet([
        ["PETUNJUK PENGISIAN MIN / MAX STOCK"],
        [""],
        [
          "1. Kolom QTY = stok saat ini, HANYA ACUAN. Tidak diubah saat import.",
        ],
        ["2. Kolom MIN / MAX = silakan diedit sesuai kebutuhan tiap cabang."],
        [
          "3. JANGAN mengubah/menghapus kolom 'No. Barang' & 'Deskripsi Barang'.",
        ],
        [
          "4. JANGAN menambah/menghapus/menggeser kolom. Isi angka bulat (>= 0).",
        ],
        ["5. Simpan tetap .xlsx, lalu upload via tombol 'Update Min/Max'."],
      ]);
      guide["!cols"] = [{ wch: 90 }];
      XLSX.utils.book_append_sheet(wb, guide, "PETUNJUK");

      const ymd = new Date().toLocaleDateString("sv-SE").replace(/-/g, "");
      XLSX.writeFile(wb, `TEMPLATE_MINMAX_STOCK_${ymd}.xlsx`);
      toast.success(`Template diunduh (${parts.size} part).`);
    } catch {
      toast.error("Gagal mengunduh template.");
    } finally {
      setDownloading(false);
      setDlProgress(null);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      toast.error("Pilih file Excel terlebih dahulu.");
      return;
    }
    setUploading(true);
    setProblems(null);
    setUploadError(null);
    let batchCode = "";
    try {
      // 1. Parse & validasi struktur (client-side)
      setUpProgress({ phase: "Membaca file", done: 0, total: 0 });
      const buf = new Uint8Array(await uploadFile.arrayBuffer());
      let wb: XLSX.WorkBook;
      try {
        wb = XLSX.read(buf, { type: "array" });
      } catch {
        toast.error("File bukan Excel yang valid.");
        return;
      }
      const ws = wb.Sheets[TEMPLATE_SHEET] || wb.Sheets[wb.SheetNames[0]];
      if (!ws) {
        toast.error("Sheet data tidak ditemukan dalam file.");
        return;
      }
      const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
        header: 1,
        blankrows: false,
      });
      if (aoa.length < 2) {
        toast.error("File kosong / tidak ada baris data.");
        return;
      }
      const header = (aoa[0] || []).map((h) => String(h ?? "").trim());
      if (
        N(header[0]) !== "NO. BARANG" ||
        N(header[1]) !== "DESKRIPSI BARANG"
      ) {
        toast.error(
          "Struktur tidak sesuai template: kolom 1 & 2 harus 'No. Barang' & 'Deskripsi Barang'.",
        );
        return;
      }
      const cols = new Map<string, { min?: number; max?: number }>();
      const colFor = (k: string) => {
        let c = cols.get(k);
        if (!c) cols.set(k, (c = {}));
        return c;
      };
      header.forEach((name, idx) => {
        const up = name.toUpperCase();
        if (up.endsWith(" MIN")) colFor(name.slice(0, -4).trim()).min = idx;
        else if (up.endsWith(" MAX"))
          colFor(name.slice(0, -4).trim()).max = idx;
      });
      const cabNames = [...cols.keys()];
      if (cabNames.length === 0) {
        toast.error(
          "Tidak ada kolom MIN/MAX cabang. File tidak sesuai template.",
        );
        return;
      }
      const valid = new Set(cabangList.map((c: any) => N(c.nama_cabang)));
      const unknown = cabNames.filter((c) => !valid.has(N(c)));
      if (unknown.length > 0) {
        toast.error(
          `Kolom cabang tidak dikenal: ${unknown.join(", ")}. File tidak sesuai template.`,
        );
        return;
      }

      // 2. Bangun baris
      const rows: {
        part_number: string;
        nama_cabang: string;
        min_qty: number;
        max_qty: number;
        source_row: number;
      }[] = [];
      for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const pn = String(row[0] ?? "").trim();
        if (!pn) continue;
        for (const [cab, c] of cols) {
          rows.push({
            part_number: pn,
            nama_cabang: cab,
            min_qty: c.min !== undefined ? (row[c.min] as number) : 0,
            max_qty: c.max !== undefined ? (row[c.max] as number) : 0,
            source_row: r + 1,
          });
        }
      }
      if (rows.length === 0) {
        toast.error("Tidak ada baris valid untuk diimport.");
        return;
      }

      // 3. Stage per chunk (progress)
      batchCode = `MINMAX_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const CHUNK = 5000;
      stageStartRef.current = Date.now();
      setUpProgress({ phase: "Mengunggah data", done: 0, total: rows.length });
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await stageMinMaxChunk(batchCode, rows.slice(i, i + CHUNK));
        if (!res.success) {
          setUploadError(res.error || "Gagal mengunggah data.");
          await clearMinMaxBatch(batchCode);
          return;
        }
        setUpProgress({
          phase: "Mengunggah data",
          done: Math.min(i + CHUNK, rows.length),
          total: rows.length,
        });
      }

      // 4. Validasi detail (server / DB)
      setUpProgress({
        phase: "Memvalidasi",
        done: rows.length,
        total: rows.length,
      });
      const val = await validateMinMaxBatch(batchCode);
      if (!val.success) {
        setUploadError(val.error);
        await clearMinMaxBatch(batchCode);
        return;
      }
      const rep = val.report;
      const blocking =
        rep.unmatched_parts_count +
        rep.unmatched_cabang_count +
        rep.negative_count +
        rep.duplicate_count;
      if (blocking > 0) {
        setProblems(rep);
        toast.error(
          "Ditemukan data yang salah — tidak ada perubahan diterapkan.",
        );
        await clearMinMaxBatch(batchCode);
        return;
      }

      // 5. Terapkan
      setUpProgress({
        phase: "Menerapkan",
        done: rows.length,
        total: rows.length,
      });
      const ap = await applyMinMaxBatch(batchCode);
      if (!ap.success) {
        setUploadError(ap.error);
        return;
      }
      toast.success(
        `Berhasil. ${ap.updatedRows} baris min/max diperbarui.` +
          (ap.minGtMax > 0
            ? ` Catatan: ${ap.minGtMax} baris MIN > MAX, mohon dicek.`
            : ""),
      );
      setUploadOpen(false);
      setUploadFile(null);
      router.refresh();
    } catch (e: any) {
      setUploadError(e?.message || "Gagal memproses file.");
      if (batchCode) await clearMinMaxBatch(batchCode);
    } finally {
      setUploading(false);
      setUpProgress(null);
    }
  };

  const [search, setSearch] = useState(initialQuery);
  const [debouncedSearch] = useDebounce(search, 500);
  const [stockFrom, setStockFrom] = useState(initialStockFrom);
  const [stockTo, setStockTo] = useState(initialStockTo);
  const [debouncedStockFrom] = useDebounce(stockFrom, 500);
  const [debouncedStockTo] = useDebounce(stockTo, 500);

  // Selected Part for Detail
  const [selectedPartId, setSelectedPartId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (debouncedSearch) params.set("q", debouncedSearch);
    else params.delete("q");

    if (debouncedStockFrom) params.set("stock_from", debouncedStockFrom);
    else params.delete("stock_from");

    if (debouncedStockTo) params.set("stock_to", debouncedStockTo);
    else params.delete("stock_to");

    params.set("page", "1");
    router.push(`/stock?${params.toString()}`);
  }, [debouncedSearch, debouncedStockFrom, debouncedStockTo]);

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", newPage.toString());
    router.push(`/stock?${params.toString()}`);
  };

  const handleSortChange = (newSort: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", newSort);
    params.set("page", "1");
    router.push(`/stock?${params.toString()}`);
  };

  const handleLimitChange = (newLimit: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("limit", newLimit);
    params.set("page", "1");
    router.push(`/stock?${params.toString()}`);
  };

  const handleRowClick = (partId: number) => {
    setSelectedPartId(partId);
    setDetailOpen(true);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <>
      {/* Section 1: Header */}
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <Warehouse className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                MONITORING STOK
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Pantau ketersediaan barang di seluruh site dan lokasi
                operasional
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isModerator && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTemplate}
                  disabled={downloading}
                  className="gap-2 border-input text-xs font-bold hover:bg-muted/40"
                >
                  {downloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5 text-success" />
                  )}
                  {dlProgress && dlProgress.total > 0
                    ? `Menyiapkan ${dlProgress.done.toLocaleString("id-ID")}/${dlProgress.total.toLocaleString("id-ID")}`
                    : "Template Min/Max"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => setUploadOpen(true)}
                  className="gap-2 text-xs font-bold uppercase shadow-sm"
                >
                  <Upload className="h-3.5 w-3.5" /> Update Min/Max
                </Button>
              </>
            )}
            <Badge
              variant="secondary"
              className="h-9 shrink-0 rounded-md px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground"
            >
              Ringkasan Part
            </Badge>
          </div>
        </div>

        {downloading && dlProgress && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Menyiapkan template…</span>
              <span>
                {dlProgress.total > 0
                  ? `${Math.min(100, Math.round((dlProgress.done / dlProgress.total) * 100))}%`
                  : ""}
                {(() => {
                  const e = etaText(
                    dlStartRef.current,
                    dlProgress.done,
                    dlProgress.total,
                  );
                  return e ? ` · ${e}` : "";
                })()}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{
                  width:
                    dlProgress.total > 0
                      ? `${Math.min(100, (dlProgress.done / dlProgress.total) * 100)}%`
                      : "10%",
                }}
              />
            </div>
          </div>
        )}
      </Content>

      {/* Section 2: Filter Bar */}
      <Content>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-70 group">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <Input
              placeholder="Cari Barang..."
              className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium text-foreground transition-all focus:bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <Select value={initialSort} onValueChange={handleSortChange}>
              <SelectTrigger className="h-9 w-full border-input bg-background text-xs font-semibold text-foreground sm:w-45">
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Urutkan" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="qty_desc">Stok Terbanyak</SelectItem>
                <SelectItem value="qty_asc">Stok Terendah</SelectItem>
                <SelectItem value="name_asc">Nama (A-Z)</SelectItem>
              </SelectContent>
            </Select>

            <Input
              type="number"
              min="0"
              placeholder="Stok min"
              className="h-9 w-full border-input bg-muted/40 text-xs font-medium text-foreground sm:w-28"
              value={stockFrom}
              onChange={(e) => setStockFrom(e.target.value)}
            />

            <Input
              type="number"
              min="0"
              placeholder="Stok max"
              className="h-9 w-full border-input bg-muted/40 text-xs font-medium text-foreground sm:w-28"
              value={stockTo}
              onChange={(e) => setStockTo(e.target.value)}
            />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStockFrom("");
                setStockTo("");
                router.push("/stock");
              }}
              className="h-9 text-xs font-bold text-muted-foreground hover:text-destructive"
            >
              <FilterX className="mr-1 h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        </div>
      </Content>

      {/* Section 3: Table + Pagination */}
      <Content className="overflow-hidden">
        <div className="overflow-x-auto text-[13px]">
          <Table className="table-fixed">
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10 border-b border-border hover:bg-transparent">
                <TableHead className="w-12.5 text-center text-[10px] font-black uppercase text-muted-foreground">
                  No
                </TableHead>
                <TableHead className="w-45 text-[10px] font-black uppercase text-muted-foreground">
                  Part Number
                </TableHead>
                <TableHead className="w-25 max-w-65 text-[10px] font-black uppercase text-muted-foreground">
                  Part Name
                </TableHead>
                <TableHead className="w-25 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Lokasi
                </TableHead>
                <TableHead className="w-27.5 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Total Stock
                </TableHead>
                <TableHead className="w-30 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Rata/Site
                </TableHead>
                <TableHead className="w-15 pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialData.length > 0 ? (
                initialData.map((part, index) => (
                  <TableRow
                    key={part.part_id}
                    className="group cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30"
                    onClick={() => handleRowClick(part.part_id)}
                  >
                    <TableCell className="text-center text-xs font-medium text-muted-foreground">
                      {(currentPage - 1) * pageSize + index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="truncate font-bold tracking-tight text-foreground transition-colors group-hover:text-primary">
                        {part.part_number}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-65">
                      <div className="truncate text-xs font-medium text-muted-foreground">
                        {part.part_name}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className="h-5 border-border bg-muted/40 text-[10px] font-bold"
                      >
                        {part.active_locations} Site
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-black text-foreground">
                        {part.total_qty}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col">
                        <span
                          className={cn(
                            "text-sm font-black",
                            part.active_locations > 0 && part.total_qty > 0
                              ? "text-foreground"
                              : "text-muted-foreground/40",
                          )}
                        >
                          {part.active_locations > 0
                            ? (part.total_qty / part.active_locations).toFixed(
                                1,
                              )
                            : "0.0"}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                          {part.part_satuan}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <ArrowRight className="h-4 w-4 text-muted-foreground/40 transition-all group-hover:translate-x-1 group-hover:text-primary" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-32 text-center text-sm italic text-muted-foreground"
                  >
                    Belum ada data stok.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="border-t border-border bg-muted/30 p-4">
          <DataTablePagination
            totalCount={totalCount}
            pageSize={pageSize}
            currentPage={currentPage}
            onPageChange={handlePageChange}
            onPageSizeChange={handleLimitChange}
            itemLabel="Part"
          />
        </div>
      </Content>

      {/* Dialog Update Min/Max via Excel */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(o) => {
          setUploadOpen(o);
          if (!o) setUploadFile(null);
        }}
      >
        <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-105 overflow-y-auto rounded-2xl p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <FileSpreadsheet className="h-5 w-5 text-success" />
              Update Min/Max
            </DialogTitle>
            <DialogDescription className="text-xs">
              Upload file Excel hasil edit. File <b>harus</b> berasal dari
              tombol <b>Template Min/Max</b> (struktur kolom tidak boleh
              diubah). Hanya kolom MIN/MAX yang diterapkan — QTY tidak disentuh.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="ml-1 text-[10px] font-black uppercase text-muted-foreground">
                File Excel (.xlsx)
              </Label>
              <Input
                type="file"
                accept=".xlsx"
                disabled={uploading}
                onChange={(e) => {
                  setUploadFile(e.target.files?.[0] ?? null);
                  setProblems(null);
                  setUploadError(null);
                }}
                className="h-10 cursor-pointer border-input bg-background text-xs file:mr-3 file:font-bold"
              />
              {uploadFile && (
                <p className="ml-1 text-[11px] font-medium text-muted-foreground">
                  {uploadFile.name}
                </p>
              )}
            </div>

            {/* Progress upload */}
            {upProgress && (
              <div>
                <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <span>{upProgress.phase}…</span>
                  <span>
                    {upProgress.total > 0
                      ? `${upProgress.done.toLocaleString("id-ID")}/${upProgress.total.toLocaleString("id-ID")}`
                      : ""}
                    {upProgress.phase === "Mengunggah data"
                      ? (() => {
                          const e = etaText(
                            stageStartRef.current,
                            upProgress.done,
                            upProgress.total,
                          );
                          return e ? ` · ${e}` : "";
                        })()
                      : ""}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{
                      width:
                        upProgress.total > 0
                          ? `${Math.min(100, (upProgress.done / upProgress.total) * 100)}%`
                          : "15%",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Error server / sistem (bisa di-scroll) */}
            {uploadError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="mb-1 text-[11px] font-bold text-destructive">
                  Gagal memproses
                </p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground">
                  {uploadError}
                </pre>
              </div>
            )}

            {/* Laporan error detail (jika ada) */}
            {problems && (
              <div className="max-h-56 space-y-3 overflow-y-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[11px] leading-relaxed">
                <p className="font-bold text-destructive">
                  Ditemukan data yang salah. Tidak ada perubahan yang diterapkan
                  — perbaiki lalu upload ulang.
                </p>
                <p className="font-semibold text-foreground">
                  Ringkasan — Part tak terdaftar:{" "}
                  {problems.unmatched_parts_count} · Cabang tak dikenal:{" "}
                  {problems.unmatched_cabang_count} · Duplikat:{" "}
                  {problems.duplicate_count} · Negatif:{" "}
                  {problems.negative_count}
                </p>

                {problems.unmatched_parts_count > 0 && (
                  <div>
                    <p className="font-bold text-foreground">
                      Part tidak terdaftar ({problems.unmatched_parts_count})
                    </p>
                    <p className="wrap-break-word text-muted-foreground">
                      {problems.unmatched_parts.join(", ")}
                      {problems.unmatched_parts_count >
                        problems.unmatched_parts.length && " …"}
                    </p>
                  </div>
                )}

                {problems.unmatched_cabang_count > 0 && (
                  <div>
                    <p className="font-bold text-foreground">
                      Cabang tidak dikenal ({problems.unmatched_cabang_count})
                    </p>
                    <p className="wrap-break-word text-muted-foreground">
                      {problems.unmatched_cabang.join(", ")}
                    </p>
                  </div>
                )}

                {problems.duplicate_count > 0 && (
                  <div>
                    <p className="font-bold text-foreground">
                      Duplikat part+cabang ({problems.duplicate_count})
                    </p>
                    <ul className="text-muted-foreground">
                      {problems.duplicates.map((d, i) => (
                        <li key={i}>
                          {d.part_number} @ {d.nama_cabang} ({d.n}×)
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {problems.negative_count > 0 && (
                  <div>
                    <p className="font-bold text-foreground">
                      Nilai negatif ({problems.negative_count})
                    </p>
                    <ul className="text-muted-foreground">
                      {problems.negatives.map((n, i) => (
                        <li key={i}>
                          Baris {n.source_row}: {n.part_number} @{" "}
                          {n.nama_cabang} (min {n.min_qty}, max {n.max_qty})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {!problems && !upProgress && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
                Proses memvalidasi part &amp; cabang. Jika ada yang tidak cocok,
                seluruh update dibatalkan (tidak ada perubahan sebagian).
              </div>
            )}
          </div>

          <DialogFooter className="mt-6 flex items-center gap-3 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 rounded-xl font-bold text-muted-foreground"
              onClick={() => setUploadOpen(false)}
              disabled={uploading}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleUpload}
              disabled={uploading || !uploadFile}
              className="flex-1 rounded-xl font-bold shadow-md shadow-primary/20"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Upload className="mr-1.5 h-4 w-4" /> Terapkan
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StockDetailSheet
        partId={selectedPartId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={() => router.refresh()}
      />
    </>
  );
}
