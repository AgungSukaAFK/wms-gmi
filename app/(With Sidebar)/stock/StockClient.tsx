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
  RefreshCw,
  CalendarIcon,
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
import { Checkbox } from "@/components/ui/checkbox";
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
  stageSohChunk,
  applySohBatch,
  clearSohBatch,
  type SohStageRow,
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
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { DatePickerString } from "@/components/date-picker-string";

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
  initialUpdatedFrom: string;
  initialUpdatedTo: string;
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
  initialUpdatedFrom,
  initialUpdatedTo,
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
  const [siteSelectOpen, setSiteSelectOpen] = useState(false);
  const [templateKind, setTemplateKind] = useState<"minmax" | "soh">(
    "minmax",
  );
  const [selectedCabangIds, setSelectedCabangIds] = useState<number[]>(
    cabangList.map((c: any) => c.id),
  );
  const dlStartRef = useRef(0);
  const stageStartRef = useRef(0);

  const [sohUploadOpen, setSohUploadOpen] = useState(false);
  const [sohUploadFile, setSohUploadFile] = useState<File | null>(null);
  const [sohUploading, setSohUploading] = useState(false);
  const [sohUpProgress, setSohUpProgress] = useState<{
    phase: string;
    done: number;
    total: number;
  } | null>(null);
  const [sohUploadError, setSohUploadError] = useState<string | null>(null);
  const [sohSummary, setSohSummary] = useState<{
    updatedRows: number;
    maxDefaultedRows: number;
    newPartsCreated: number;
    newStockRows: number;
    skippedNegativeQty: number;
    negativeSamples: {
      source_row: number;
      part_number: string;
      nama_cabang: string;
      qty: number;
    }[];
  } | null>(null);
  const sohStageStartRef = useRef(0);

  const handleDownloadTemplate = async (cabangIds: number[]) => {
    if (cabangIds.length === 0) {
      toast.error("Pilih minimal 1 site terlebih dahulu.");
      return;
    }
    setDownloading(true);
    setDlProgress({ done: 0, total: 0 });
    try {
      const meta = await getStockMinMaxMeta(cabangIds);
      if (!meta.success) {
        toast.error(meta.error);
        return;
      }
      const cabang = meta.cabang.filter((c: any) => cabangIds.includes(c.id));
      const { total } = meta;
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
        const res = await fetchStockMinMaxPage(off, PAGE, cabangIds);
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
          "3. JANGAN mengubah isi/header kolom 'No. Barang' & 'Deskripsi Barang'.",
        ],
        [
          "4. Hanya part & site yang mau diubah yang perlu diisi. Baris part " +
            "boleh dihapus kalau tidak ingin diubah. Kelompok kolom cabang " +
            "(QTY/MIN/MAX) boleh dihapus kalau site itu tidak ingin diubah.",
        ],
        [
          "5. Cell MIN/MAX yang dikosongkan (blank) TIDAK akan mengubah data " +
            "site tsb untuk part itu. Isi angka bulat (>= 0) hanya untuk yang " +
            "benar-benar mau diubah.",
        ],
        ["6. Simpan tetap .xlsx, lalu upload via tombol 'Update Min/Max'."],
      ]);
      guide["!cols"] = [{ wch: 90 }];
      XLSX.utils.book_append_sheet(wb, guide, "PETUNJUK");

      const ymd = new Date().toLocaleDateString("sv-SE").replace(/-/g, "");
      const siteSuffix =
        cabangIds.length === cabangList.length
          ? "SEMUA_SITE"
          : cabang
              .map((c: any) => c.nama_cabang)
              .join("-")
              .replace(/[^a-zA-Z0-9-]/g, "");
      XLSX.writeFile(wb, `TEMPLATE_MINMAX_STOCK_${siteSuffix}_${ymd}.xlsx`);
      toast.success(`Template diunduh (${parts.size} part).`);
    } catch {
      toast.error("Gagal mengunduh template.");
    } finally {
      setDownloading(false);
      setDlProgress(null);
    }
  };

  /**
   * Template SOH: format wide persis seperti file SOH yang dipakai fitur
   * Update SOH (No. Barang, Deskripsi Barang, satu kolom qty per cabang,
   * SUM SOH) -- diisi qty stok saat ini, supaya hasil download ini bisa
   * langsung diupload lagi lewat "Update SOH" tanpa perlu diubah strukturnya.
   * Reuse data fetching yang sama dengan Template Min/Max (qty saja yang
   * dipakai, min/max diabaikan).
   */
  const handleDownloadSohTemplate = async (cabangIds: number[]) => {
    if (cabangIds.length === 0) {
      toast.error("Pilih minimal 1 site terlebih dahulu.");
      return;
    }
    setDownloading(true);
    setDlProgress({ done: 0, total: 0 });
    try {
      const meta = await getStockMinMaxMeta(cabangIds);
      if (!meta.success) {
        toast.error(meta.error);
        return;
      }
      const cabang = meta.cabang.filter((c: any) => cabangIds.includes(c.id));
      const { total } = meta;
      setDlProgress({ done: 0, total });
      dlStartRef.current = Date.now();

      const parts = new Map<
        string,
        { part_number: string; name: string; cab: Map<number, number> }
      >();
      const PAGE = 1000;
      for (let off = 0; off < Math.max(total, 1); off += PAGE) {
        const res = await fetchStockMinMaxPage(off, PAGE, cabangIds);
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        for (const r of res.rows) {
          const key = r.part_number.trim().toUpperCase();
          let p = parts.get(key);
          if (!p) {
            p = { part_number: r.part_number, name: r.part_name, cab: new Map() };
            parts.set(key, p);
          }
          if (!p.cab.has(r.cabang_id)) p.cab.set(r.cabang_id, r.qty);
        }
        setDlProgress({ done: Math.min(off + PAGE, total), total });
        if (res.rows.length < PAGE) break;
      }

      const header: string[] = [
        "No. Barang",
        "Deskripsi Barang",
        ...cabang.map((c: any) => c.nama_cabang),
        "SUM SOH",
      ];
      const aoa: (string | number)[][] = [header];
      for (const key of [...parts.keys()].sort()) {
        const p = parts.get(key)!;
        const qtys = cabang.map((c: any) => p.cab.get(c.id) ?? 0);
        const sum = qtys.reduce((a, b) => a + b, 0);
        aoa.push([p.part_number, p.name, ...qtys, sum]);
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = header.map((_, i) =>
        i === 0 ? { wch: 22 } : i === 1 ? { wch: 40 } : { wch: 12 },
      );
      XLSX.utils.book_append_sheet(wb, ws, "SOH");
      const guide = XLSX.utils.aoa_to_sheet([
        ["PETUNJUK PENGISIAN SOH"],
        [""],
        [
          "1. Kolom per cabang berisi qty stok saat ini -- edit angkanya sesuai " +
            "hasil stock opname / SOH terbaru.",
        ],
        [
          "2. JANGAN mengubah isi/header kolom 'No. Barang' & 'Deskripsi Barang'.",
        ],
        [
          "3. Kolom SUM SOH cuma referensi (tidak diproses saat upload), boleh " +
            "dibiarkan tidak sinkron kalau lupa update.",
        ],
        [
          "4. Part yang tidak ada di file ini tidak akan berubah datanya. Part " +
            "baru yang belum terdaftar akan otomatis dibuat sebagai barang baru.",
        ],
        ["5. Simpan tetap .xlsx, lalu upload via tombol 'Update SOH'."],
      ]);
      guide["!cols"] = [{ wch: 90 }];
      XLSX.utils.book_append_sheet(wb, guide, "PETUNJUK");

      const ymd = new Date().toLocaleDateString("sv-SE").replace(/-/g, "");
      const siteSuffix =
        cabangIds.length === cabangList.length
          ? "SEMUA_SITE"
          : cabang
              .map((c: any) => c.nama_cabang)
              .join("-")
              .replace(/[^a-zA-Z0-9-]/g, "");
      XLSX.writeFile(wb, `TEMPLATE_SOH_STOCK_${siteSuffix}_${ymd}.xlsx`);
      toast.success(`Template SOH diunduh (${parts.size} part).`);
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
      const isBlank = (v: unknown) =>
        v === undefined || v === null || String(v).trim() === "";
      for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const pn = String(row[0] ?? "").trim();
        if (!pn) continue;
        for (const [cab, c] of cols) {
          const minVal = c.min !== undefined ? row[c.min] : undefined;
          const maxVal = c.max !== undefined ? row[c.max] : undefined;
          // Cell kosong = site ini TIDAK ingin diubah untuk part ini -- jangan
          // di-stage sama sekali, biar tidak ketimpa jadi 0 di database.
          if (isBlank(minVal) && isBlank(maxVal)) continue;
          rows.push({
            part_number: pn,
            nama_cabang: cab,
            min_qty: isBlank(minVal) ? 0 : (minVal as number),
            max_qty: isBlank(maxVal) ? 0 : (maxVal as number),
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

  /** Angka bisa berupa number (sel numerik xlsx) atau string gaya ID "1.234,00". */
  const parseQtyCell = (v: unknown): number => {
    if (v === undefined || v === null || v === "") return 0;
    if (typeof v === "number") return Math.round(v);
    const normalized = String(v).trim().replace(/\./g, "").replace(",", ".");
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? Math.round(n) : 0;
  };

  const handleSohUpload = async () => {
    if (!sohUploadFile) {
      toast.error("Pilih file Excel terlebih dahulu.");
      return;
    }
    setSohUploading(true);
    setSohUploadError(null);
    setSohSummary(null);
    let batchCode = "";
    try {
      // 1. Parse & validasi struktur (client-side) -- format wide: No. Barang,
      // Deskripsi Barang, <kolom per cabang>, SUM SOH.
      setSohUpProgress({ phase: "Membaca file", done: 0, total: 0 });
      const buf = new Uint8Array(await sohUploadFile.arrayBuffer());
      let wb: XLSX.WorkBook;
      try {
        wb = XLSX.read(buf, { type: "array" });
      } catch {
        toast.error("File bukan Excel yang valid.");
        return;
      }
      const ws = wb.Sheets[wb.SheetNames[0]];
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
      const headerCol0 = N(header[0]);
      const headerCol1 = N(header[1]);
      const validCol0 = new Set(["NO. BARANG", "PART_NUMBER", "PART NUMBER"]);
      const validCol1 = new Set([
        "DESKRIPSI BARANG",
        "PART_NAME",
        "PART NAME",
      ]);
      if (!validCol0.has(headerCol0) || !validCol1.has(headerCol1)) {
        toast.error(
          "Struktur tidak sesuai: kolom 1 & 2 harus 'No. Barang' & 'Deskripsi Barang'.",
        );
        return;
      }

      // Kolom cabang: dari index 2 sampai sebelum kolom "SUM ...". Kolom yang
      // namanya tidak dikenal sebagai cabang aktif (mis. GMI-HO, GMI-PIK,
      // GMI-BIB BAWAH yang tidak ada di master cabang) otomatis dilewati.
      const validCabang = new Set(
        cabangList.map((c: any) => N(c.nama_cabang)),
      );
      const branchCols: { idx: number; name: string }[] = [];
      for (let idx = 2; idx < header.length; idx++) {
        const name = (header[idx] || "").trim();
        if (!name) continue;
        if (N(name).startsWith("SUM")) break;
        if (validCabang.has(N(name))) branchCols.push({ idx, name });
      }
      if (branchCols.length === 0) {
        toast.error("Tidak ada kolom cabang yang dikenali dalam file.");
        return;
      }

      // 2. Bangun baris, digabung per part+cabang case-insensitive (part bisa
      // muncul dengan variasi huruf besar/kecil untuk part yang sama).
      const merged = new Map<string, SohStageRow>();
      for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const pn = String(row[0] ?? "").trim();
        if (!pn) continue;
        const partName = String(row[1] ?? "").trim();
        for (const { idx, name } of branchCols) {
          const qty = parseQtyCell(row[idx]);
          const key = `${N(pn)}|${N(name)}`;
          const existing = merged.get(key);
          if (existing) existing.qty += qty;
          else
            merged.set(key, {
              part_number: pn,
              part_name: partName,
              nama_cabang: name,
              qty,
              source_row: r + 1,
            });
        }
      }
      const rows = [...merged.values()];
      if (rows.length === 0) {
        toast.error("Tidak ada baris valid untuk diimport.");
        return;
      }

      // 3. Stage per chunk, beberapa chunk sekaligus (paralel) supaya cepat
      // untuk ratusan ribu baris -- staging saja tidak perlu urut.
      batchCode = `SOH_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const CHUNK = 10000;
      const CONCURRENCY = 6;
      const chunks: SohStageRow[][] = [];
      for (let i = 0; i < rows.length; i += CHUNK)
        chunks.push(rows.slice(i, i + CHUNK));

      sohStageStartRef.current = Date.now();
      setSohUpProgress({
        phase: "Mengunggah data",
        done: 0,
        total: rows.length,
      });
      let doneRows = 0;
      let stageError: string | null = null;
      let nextChunk = 0;
      const worker = async () => {
        while (nextChunk < chunks.length && !stageError) {
          const my = nextChunk++;
          const res = await stageSohChunk(batchCode, chunks[my]);
          if (!res.success) {
            stageError = res.error || "Gagal mengunggah data.";
            return;
          }
          doneRows += chunks[my].length;
          setSohUpProgress({
            phase: "Mengunggah data",
            done: doneRows,
            total: rows.length,
          });
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker),
      );
      if (stageError) {
        setSohUploadError(stageError);
        await clearSohBatch(batchCode);
        return;
      }

      // 4. Terapkan langsung (skip validasi terpisah -- part baru & qty
      // negatif ditangani oleh applySohBatch sendiri, bukan pemblokir;
      // duplikat/pecahan pada dasarnya mustahil dari data yang sudah
      // di-dedupe di atas, kalau tetap terjadi akan raise error di sini).
      setSohUpProgress({
        phase: "Menerapkan",
        done: rows.length,
        total: rows.length,
      });
      const ap = await applySohBatch(batchCode);
      if (!ap.success) {
        setSohUploadError(ap.error);
        return;
      }
      setSohSummary({
        updatedRows: ap.updatedRows,
        maxDefaultedRows: ap.maxDefaultedRows,
        newPartsCreated: ap.newPartsCreated,
        newStockRows: ap.newStockRows,
        skippedNegativeQty: ap.skippedNegativeQty,
        negativeSamples: ap.negativeSamples,
      });
      toast.success(
        `Berhasil. ${ap.updatedRows} baris qty diperbarui, ${ap.newPartsCreated} part baru dibuat, ${ap.maxDefaultedRows} max stock di-default ke 999999.`,
      );
      router.refresh();
    } catch (e: any) {
      setSohUploadError(e?.message || "Gagal memproses file.");
      if (batchCode) await clearSohBatch(batchCode);
    } finally {
      setSohUploading(false);
      setSohUpProgress(null);
    }
  };

  const [search, setSearch] = useState(initialQuery);
  const [debouncedSearch] = useDebounce(search, 500);
  const [stockFrom, setStockFrom] = useState(initialStockFrom);
  const [stockTo, setStockTo] = useState(initialStockTo);
  const [debouncedStockFrom] = useDebounce(stockFrom, 500);
  const [debouncedStockTo] = useDebounce(stockTo, 500);
  const [updatedFrom, setUpdatedFrom] = useState(initialUpdatedFrom);
  const [updatedTo, setUpdatedTo] = useState(initialUpdatedTo);

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

    if (updatedFrom) params.set("updated_from", updatedFrom);
    else params.delete("updated_from");

    if (updatedTo) params.set("updated_to", updatedTo);
    else params.delete("updated_to");

    params.set("page", "1");
    router.push(`/stock?${params.toString()}`);
  }, [
    debouncedSearch,
    debouncedStockFrom,
    debouncedStockTo,
    updatedFrom,
    updatedTo,
  ]);

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
                  onClick={() => {
                    setTemplateKind("minmax");
                    setSiteSelectOpen(true);
                  }}
                  disabled={downloading}
                  className="gap-2 border-input text-xs font-bold hover:bg-muted/40"
                >
                  {downloading && templateKind === "minmax" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5 text-success" />
                  )}
                  {downloading && templateKind === "minmax" && dlProgress && dlProgress.total > 0
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTemplateKind("soh");
                    setSiteSelectOpen(true);
                  }}
                  disabled={downloading}
                  className="gap-2 border-input text-xs font-bold hover:bg-muted/40"
                >
                  {downloading && templateKind === "soh" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5 text-success" />
                  )}
                  {downloading && templateKind === "soh" && dlProgress && dlProgress.total > 0
                    ? `Menyiapkan ${dlProgress.done.toLocaleString("id-ID")}/${dlProgress.total.toLocaleString("id-ID")}`
                    : "Template SOH"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSohUploadOpen(true)}
                  className="gap-2 border-input text-xs font-bold uppercase hover:bg-muted/40"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-success" /> Update SOH
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
                <SelectItem value="part_name_asc">Nama (A-Z)</SelectItem>
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

            <div className="flex w-full items-center gap-2 sm:w-auto">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <DatePickerString
                value={updatedFrom}
                onChange={setUpdatedFrom}
                placeholder="Diubah dari"
                className="h-9 w-full text-xs font-medium sm:w-38"
              />
            </div>

            <DatePickerString
              value={updatedTo}
              onChange={setUpdatedTo}
              placeholder="Diubah sampai"
              className="h-9 w-full text-xs font-medium sm:w-38"
            />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStockFrom("");
                setStockTo("");
                setUpdatedFrom("");
                setUpdatedTo("");
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
                <SortableTableHead
                  sortKey="no"
                  currentSort={initialSort}
                  onSort={handleSortChange}
                  className="w-12.5 justify-center text-center text-[10px] font-black uppercase text-muted-foreground"
                >
                  No
                </SortableTableHead>
                <SortableTableHead
                  sortKey="part_number"
                  currentSort={initialSort}
                  onSort={handleSortChange}
                  className="w-45 text-[10px] font-black uppercase text-muted-foreground"
                >
                  Part Number
                </SortableTableHead>
                <SortableTableHead
                  sortKey="part_name"
                  currentSort={initialSort}
                  onSort={handleSortChange}
                  className="w-25 max-w-65 text-[10px] font-black uppercase text-muted-foreground"
                >
                  Part Name
                </SortableTableHead>
                <SortableTableHead
                  sortKey="active_locations"
                  currentSort={initialSort}
                  onSort={handleSortChange}
                  className="w-25 text-center text-[10px] font-black uppercase text-muted-foreground"
                >
                  Lokasi
                </SortableTableHead>
                <SortableTableHead
                  sortKey="qty"
                  currentSort={initialSort}
                  onSort={handleSortChange}
                  defaultDir="desc"
                  className="w-27.5 text-center text-[10px] font-black uppercase text-muted-foreground"
                >
                  Total Stock
                </SortableTableHead>
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

      {/* Dialog Pilih Site untuk Template (Min/Max atau SOH) */}
      <Dialog open={siteSelectOpen} onOpenChange={setSiteSelectOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-105 overflow-y-auto rounded-2xl p-6">
          <DialogHeader className="mb-2">
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Download className="h-5 w-5 text-success" />
              Pilih Site untuk Template{" "}
              {templateKind === "soh" ? "SOH" : "Min/Max"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Cuma site yang dicentang yang ditarik datanya — makin sedikit
              site, makin cepat download & upload-nya. Site yang tidak dicentang
              tidak akan ada di file, jadi otomatis tidak akan ikut berubah saat
              di-upload nanti.
              {templateKind === "soh" &&
                " File yang dihasilkan formatnya kompatibel langsung dengan tombol \"Update SOH\"."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Checkbox
                id="site-select-all"
                checked={selectedCabangIds.length === cabangList.length}
                onCheckedChange={(checked) =>
                  setSelectedCabangIds(
                    checked ? cabangList.map((c: any) => c.id) : [],
                  )
                }
              />
              <label
                htmlFor="site-select-all"
                className="cursor-pointer text-xs font-bold uppercase"
              >
                Pilih Semua ({cabangList.length} site)
              </label>
            </div>

            <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {cabangList.map((c: any) => {
                const checked = selectedCabangIds.includes(c.id);
                return (
                  <div key={c.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`site-${c.id}`}
                      checked={checked}
                      onCheckedChange={(v) =>
                        setSelectedCabangIds((prev) =>
                          v
                            ? [...prev, c.id]
                            : prev.filter((id) => id !== c.id),
                        )
                      }
                    />
                    <label
                      htmlFor={`site-${c.id}`}
                      className="cursor-pointer text-xs font-medium"
                    >
                      {c.nama_cabang}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="mt-6 flex items-center gap-3 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 rounded-xl font-bold text-muted-foreground"
              onClick={() => setSiteSelectOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={selectedCabangIds.length === 0 || downloading}
              className="flex-1 gap-2 rounded-xl font-bold shadow-md shadow-primary/20"
              onClick={() => {
                setSiteSelectOpen(false);
                if (templateKind === "soh")
                  handleDownloadSohTemplate(selectedCabangIds);
                else handleDownloadTemplate(selectedCabangIds);
              }}
            >
              <Download className="h-4 w-4" />
              Download ({selectedCabangIds.length} site)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              tombol <b>Template Min/Max</b>. Boleh hanya berisi sebagian part
              (baris lain dihapus) dan/atau sebagian site (kelompok kolom cabang
              lain dihapus/dikosongkan) — yang tidak ada di file tidak akan
              tersentuh. Hanya kolom MIN/MAX yang diterapkan — QTY tidak
              disentuh.
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

      {/* Dialog Update SOH via Excel */}
      <Dialog
        open={sohUploadOpen}
        onOpenChange={(o) => {
          setSohUploadOpen(o);
          if (!o) {
            setSohUploadFile(null);
            setSohUploadError(null);
            setSohSummary(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-105 overflow-y-auto rounded-2xl p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <RefreshCw className="h-5 w-5 text-success" />
              Update SOH
            </DialogTitle>
            <DialogDescription className="text-xs">
              Upload file SOH format wide (kolom: No. Barang, Deskripsi
              Barang, lalu satu kolom per cabang, opsional diakhiri SUM SOH).
              Hanya cabang yang terdaftar di master yang diproses — kolom
              cabang lain otomatis dilewati. Qty akan diperbarui, max stock
              yang belum pernah diset (masih 0) otomatis dibuat 999999, dan
              part yang belum terdaftar otomatis dibuat sebagai barang baru
              (satuan default &ldquo;UNIT&rdquo; — cek &amp; perbaiki manual di halaman
              Barang kalau perlu). Baris qty negatif dilewati.
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
                disabled={sohUploading}
                onChange={(e) => {
                  setSohUploadFile(e.target.files?.[0] ?? null);
                  setSohUploadError(null);
                  setSohSummary(null);
                }}
                className="h-10 cursor-pointer border-input bg-background text-xs file:mr-3 file:font-bold"
              />
              {sohUploadFile && (
                <p className="ml-1 text-[11px] font-medium text-muted-foreground">
                  {sohUploadFile.name}
                </p>
              )}
            </div>

            {/* Progress upload */}
            {sohUpProgress && (
              <div>
                <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <span>{sohUpProgress.phase}…</span>
                  <span>
                    {sohUpProgress.total > 0
                      ? `${sohUpProgress.done.toLocaleString("id-ID")}/${sohUpProgress.total.toLocaleString("id-ID")}`
                      : ""}
                    {sohUpProgress.phase === "Mengunggah data"
                      ? (() => {
                          const e = etaText(
                            sohStageStartRef.current,
                            sohUpProgress.done,
                            sohUpProgress.total,
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
                        sohUpProgress.total > 0
                          ? `${Math.min(100, (sohUpProgress.done / sohUpProgress.total) * 100)}%`
                          : "15%",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Ringkasan sukses */}
            {sohSummary && (
              <div className="space-y-3">
                <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-[11px] leading-relaxed">
                  <p className="font-bold text-success">Berhasil diterapkan</p>
                  <p className="text-muted-foreground">
                    {sohSummary.updatedRows} baris qty diperbarui ·{" "}
                    {sohSummary.maxDefaultedRows} max stock di-default ke
                    999999 · {sohSummary.newPartsCreated} part baru dibuat
                    ({sohSummary.newStockRows} baris stock)
                    {sohSummary.skippedNegativeQty > 0 &&
                      ` · ${sohSummary.skippedNegativeQty} baris qty negatif dilewati`}
                  </p>
                </div>

                {sohSummary.negativeSamples.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-warning/30 bg-warning/5 p-3 text-[11px] leading-relaxed">
                    <p className="font-bold text-foreground">
                      Baris qty negatif yang dilewati (
                      {sohSummary.skippedNegativeQty}) — cek data sumbernya
                    </p>
                    <ul className="text-muted-foreground">
                      {sohSummary.negativeSamples.map((n, i) => (
                        <li key={i}>
                          Baris {n.source_row}: {n.part_number} @{" "}
                          {n.nama_cabang} (qty {n.qty})
                        </li>
                      ))}
                      {sohSummary.skippedNegativeQty >
                        sohSummary.negativeSamples.length && <li>…</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Error server / sistem */}
            {sohUploadError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="mb-1 text-[11px] font-bold text-destructive">
                  Gagal memproses
                </p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground">
                  {sohUploadError}
                </pre>
              </div>
            )}

            {!sohUpProgress && !sohSummary && !sohUploadError && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
                Part yang belum terdaftar otomatis dibuat sebagai barang baru
                (bukan pemblokir); baris qty negatif dilewati & dilaporkan.
                Kalau ada duplikat part+cabang atau qty pecahan (seharusnya
                tidak pernah terjadi), seluruh update dibatalkan.
              </div>
            )}
          </div>

          <DialogFooter className="mt-6 flex items-center gap-3 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 rounded-xl font-bold text-muted-foreground"
              onClick={() => setSohUploadOpen(false)}
              disabled={sohUploading}
            >
              {sohSummary ? "Tutup" : "Batal"}
            </Button>
            {!sohSummary && (
              <Button
                type="button"
                onClick={handleSohUpload}
                disabled={sohUploading || !sohUploadFile}
                className="flex-1 rounded-xl font-bold shadow-md shadow-primary/20"
              >
                {sohUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Upload className="mr-1.5 h-4 w-4" /> Terapkan
                  </>
                )}
              </Button>
            )}
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
