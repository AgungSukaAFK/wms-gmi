"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate, toYmdLocal } from "@/lib/utils";
import * as XLSX from "xlsx";
import { jsonToSheetWithDates, toExcelDate } from "@/lib/excel";
import { canCreateMR } from "@/lib/mr-permissions";
import { MR_KATEGORI_OPTIONS } from "@/lib/mr-options";
import { MultiSelect } from "@/components/ui/multi-select";
import { Input } from "@/components/ui/input";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Eye,
  Calendar as CalendarIcon,
  MapPin,
  ClipboardList,
  Navigation2,
  Clock,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Content } from "@/components/content";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { MRDetailSheet } from "@/components/mr/mr-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";
import { completedFilterStatuses } from "@/lib/document-status";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteMR } from "@/services/procurement-actions";
import { toast } from "@/lib/toast";
import { MrLevelBadge } from "@/components/mr/mr-level-badge";
import {
  MrLevelAutoRules,
  DEFAULT_MR_LEVEL_AUTO_RULES,
} from "@/lib/mr-level";
import {
  ColumnOrderReset,
  ReorderableHeaderRow,
  ReorderableTableHead,
  type ReorderableColumn,
} from "@/components/reorderable-table-head";
import { useColumnOrder } from "@/hooks/use-column-order";
import { StatusBadge } from "@/components/status-badge";
import { useUrlListState } from "@/hooks/use-url-list-state";
import {
  type ActiveFilter,
  FilterField,
  FilterFields,
  FilterPanel,
  FilterRange,
  FilterRangeFields,
  filterOptionLabel,
  formatFilterDate,
  formatFilterRange,
} from "@/components/filter-panel";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import {
  ExcelDownloadMenu,
  type ExcelDownloadMode,
} from "@/components/excel-download-menu";
import { ListSearchInput } from "@/components/list-search-input";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { StickyHeaderTable } from "@/components/sticky-header-table";
import { TablePaginationFooter } from "@/components/table-pagination-footer";
import { orIlikePattern } from "@/lib/supabase/search-filter";

const MR_SORT_COLUMNS: Record<string, string> = {
  mr_kode: "mr_kode",
  mr_tanggal: "mr_tanggal",
  mr_status: "mr_status",
};

// Harus sama dengan kolom yang dicari di buildFilteredQuery.
const MR_SEARCH_FIELDS = ["Kode MR", "PIC"];

const MR_PRIORITY_OPTIONS = [
  { label: "P1 - EMERGENCY", value: "P1" },
  { label: "P2 - HIGH", value: "P2" },
  { label: "P3 - NORMAL", value: "P3" },
  { label: "P4 - LOW", value: "P4" },
];

const MR_STATUS_OPTIONS = [
  { label: "Open (Pending)", value: "open" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Completed", value: "completed" },
];

const KATEGORI_KOSONG = "kosong";

const MR_KATEGORI_FILTER_OPTIONS = [
  ...MR_KATEGORI_OPTIONS.map((k) => ({ label: k, value: k })),
  { label: "Belum diisi", value: KATEGORI_KOSONG },
];

const MR_KONVERSI_OPTIONS = [
  { label: "Belum PR", value: "pending" },
  { label: "Sebagian PR", value: "partial" },
  { label: "Sudah PR", value: "complete" },
];

const MR_JENIS_OPTIONS = [
  { label: "Standard", value: "standard" },
  { label: "Scheduled", value: "scheduled" },
];

const MR_ASAL_OPTIONS = [
  { label: "Input Web", value: "web" },
  { label: "Import", value: "import" },
];

const MR_KONDISI_OPTIONS = [
  { label: "Frozen", value: "frozen" },
  { label: "Lewat Due Date", value: "lewat_due" },
  { label: "Ada Item Ditolak", value: "item_ditolak" },
];

const MR_HEAD_CLASS = "font-bold text-[10px] uppercase text-muted-foreground";

// Kolom di antara "No" & "Aksi". Id kolom yang bisa di-sort = key di
// MR_SORT_COLUMNS. ACCURATE_HIDDEN: kolom Accurate sengaja tidak ditampilkan;
// untuk menampilkan lagi tambah di sini & di renderCell.
const MR_COLUMNS = [
  { id: "urgency", label: "Urgency", className: `w-24 text-center ${MR_HEAD_CLASS}` },
  { id: "mr_kode", label: "Kode MR", sortDirection: "asc", className: `w-45 ${MR_HEAD_CLASS}` },
  { id: "pic", label: "PIC & Lokasi", className: MR_HEAD_CLASS },
  { id: "mr_tanggal", label: "Tanggal", sortDirection: "desc", className: `w-32.5 text-center ${MR_HEAD_CLASS}` },
  { id: "mr_status", label: "Status", sortDirection: "asc", className: `w-[170px] text-center ${MR_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type MrColumnId = (typeof MR_COLUMNS)[number]["id"];

export default function MaterialRequestPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [mrs, setMrs] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [levelExtraByMrId, setLevelExtraByMrId] = useState<
    Record<
      number,
      { hasPo: boolean; qtyRequestTotal: number; qtyReceivedTotal: number }
    >
  >({});
  const [userProfile, setUserProfile] = useState<any>(null);
  const [exporting, setExporting] = useState(false);
  const [mrLevelAutoRules, setMrLevelAutoRules] = useState<MrLevelAutoRules>(
    DEFAULT_MR_LEVEL_AUTO_RULES,
  );

  // Pagination & Filters - disimpan di URL (hooks/use-url-list-state.ts),
  // jadi bisa di-share & tombol Back browser bekerja. Setter di bawah tetap
  // bernama seperti useState lama.
  const columnOrder = useColumnOrder("wms:table-column-order:mr", MR_COLUMNS);
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusFilters = urlState.list("status");
  const setStatusFilters = (v: string[]) =>
    urlState.set({ status: v }, { resetPage: true });
  const priorityFilters = urlState.list("prioritas");
  const setPriorityFilters = (v: string[]) =>
    urlState.set({ prioritas: v }, { resetPage: true });
  // ACCURATE_HIDDEN: filter Accurate tidak ditampilkan, tapi ?accurate=yes|no
  // tetap dibaca. Untuk menampilkan lagi: tambah field di FilterPanel yang
  // memanggil urlState.set({ accurate }, { resetPage: true }).
  const accurateFilter = urlState.get("accurate", "all");
  const sortOrder = urlState.get("sort", "newest");
  const setSortOrder = (v: string) =>
    urlState.set({ sort: v === "newest" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  // Advanced Filters
  const locationFilters = urlState.list("lokasi");
  const setLocationFilters = (v: string[]) =>
    urlState.set({ lokasi: v }, { resetPage: true });
  const dateFrom = urlState.get("dari");
  const setDateFrom = (v: string) =>
    urlState.set({ dari: v }, { resetPage: true });
  const dateTo = urlState.get("sampai");
  const setDateTo = (v: string) =>
    urlState.set({ sampai: v }, { resetPage: true });
  const dueFrom = urlState.get("due_dari");
  const setDueFrom = (v: string) =>
    urlState.set({ due_dari: v }, { resetPage: true });
  const dueTo = urlState.get("due_sampai");
  const setDueTo = (v: string) =>
    urlState.set({ due_sampai: v }, { resetPage: true });
  const kategoriFilters = urlState.list("kategori");
  const setKategoriFilters = (v: string[]) =>
    urlState.set({ kategori: v }, { resetPage: true });
  const konversiFilters = urlState.list("konversi");
  const setKonversiFilters = (v: string[]) =>
    urlState.set({ konversi: v }, { resetPage: true });
  const jenisFilters = urlState.list("jenis");
  const setJenisFilters = (v: string[]) =>
    urlState.set({ jenis: v }, { resetPage: true });
  const asalFilters = urlState.list("asal");
  const setAsalFilters = (v: string[]) =>
    urlState.set({ asal: v }, { resetPage: true });
  const kondisiFilters = urlState.list("kondisi");
  const setKondisiFilters = (v: string[]) =>
    urlState.set({ kondisi: v }, { resetPage: true });
  const barangFilter = urlState.get("barang");
  const [barangInput, setBarangInput, resetBarangInput] = useUrlSearchInput(
    barangFilter,
    (value) => urlState.set({ barang: value }, { resetPage: true }),
  );
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  // Selected MR for Detail
  const [selectedMrId, setSelectedMrId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*, roles:user_roles(roles(name))")
        .eq("id", user.id)
        .single();

      if (profile) {
        setUserProfile({
          ...profile,
          isAdmin: (profile.roles as any[]).some(
            (r) => r.roles.name === "admin",
          ),
          isModerator: (profile.roles as any[]).some(
            (r) => r.roles.name === "moderator",
          ),
        });
      }
    }

    const { data: cabangData } = await supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang");

    setAvailableCabang(cabangData || []);

    const { data: rulesData } = await supabase
      .from("mr_level_auto_rules")
      .select("*")
      .eq("id", 1)
      .single();
    if (rulesData) {
      setMrLevelAutoRules({
        pendingConvertStatuses: rulesData.pending_convert_statuses || ["pending"],
        closeStartMinReceivedPct: Number(rulesData.close_start_min_received_pct),
        closeDoneMinReceivedPct: Number(rulesData.close_done_min_received_pct),
      });
    }
  };

  // Query dasar dengan seluruh filter aktif diterapkan (tanpa order/range),
  // dipakai bersama oleh fetchData (list berpaginasi) dan exportExcel (semua baris).
  // Mode "all" melepas seluruh filter (export "Semua data").
  const buildFilteredQuery = (mode: ExcelDownloadMode = "filtered") => {
    const filtered = mode === "filtered";
    // Prioritas sekarang per-item (mr_items.item_priority). Kalau filter
    // prioritas aktif, embed mr_items pakai !inner supaya MR yang tidak
    // punya item dengan prioritas itu ikut tersaring keluar (bukan cuma
    // menyaring nested array-nya) — mengikuti pola yang sudah dipakai
    // share-stock/page.tsx.
    const mrItemsEmbed =
      filtered && priorityFilters.length > 0
        ? "mr_items!inner(item_priority)"
        : "mr_items(item_priority)";
    // Filter isi item lewat embed alias, supaya mr_items di atas tetap utuh
    // (badge Urgency tidak ikut tersaring).
    const itemDitolak = filtered && kondisiFilters.includes("item_ditolak");
    const filterEmbeds = [
      filtered && barangFilter ? ", barang_cocok:mr_items!inner(id)" : "",
      itemDitolak ? ", item_ditolak:mr_items!inner(id)" : "",
    ].join("");
    let query = supabase.from("mrs").select(
      `*, cabang(nama_cabang), manual_level_setter:profiles!manual_level_set_by(nama), ${mrItemsEmbed}${filterEmbeds}`,
      { count: "exact" },
    );

    if (!filtered) return query;

    if (debouncedSearch) {
      query = query.or(
        `mr_kode.ilike.${orIlikePattern(debouncedSearch)},mr_pic.ilike.${orIlikePattern(debouncedSearch)}`,
      );
    }

    if (statusFilters.length > 0) {
      // "completed" adalah status virtual yang diekspansi ke beberapa status nyata.
      const expanded = statusFilters.flatMap((s) =>
        s === "completed" ? completedFilterStatuses() : [s],
      );
      query = query.in("mr_status", Array.from(new Set(expanded)));
    }

    if (priorityFilters.length > 0) {
      query = query.in("mr_items.item_priority", priorityFilters);
    }

    if (accurateFilter !== "all") {
      query = query.eq("accurate", accurateFilter === "yes");
    }

    if (locationFilters.length > 0) {
      query = query.in("cabang_id", locationFilters);
    }

    if (dateFrom) {
      query = query.gte("mr_tanggal", dateFrom);
    }
    if (dateTo) {
      query = query.lte("mr_tanggal", dateTo);
    }

    if (dueFrom) {
      query = query.gte("mr_due_date", dueFrom);
    }
    if (dueTo) {
      query = query.lte("mr_due_date", dueTo);
    }

    if (kategoriFilters.length > 0) {
      const kategori = kategoriFilters.filter((k) => k !== KATEGORI_KOSONG);
      if (kategori.length === kategoriFilters.length) {
        query = query.in("kategori", kategori);
      } else if (kategori.length === 0) {
        query = query.is("kategori", null);
      } else {
        const values = kategori.map((k) => `"${k}"`).join(",");
        query = query.or(`kategori.is.null,kategori.in.(${values})`);
      }
    }

    if (konversiFilters.length > 0) {
      query = query.in("mr_convert_status", konversiFilters);
    }

    if (jenisFilters.length > 0) {
      query = query.in("mr_type", jenisFilters);
    }

    if (asalFilters.length === 1) {
      query = query.eq("mr_is_import", asalFilters[0] === "import");
    }

    if (kondisiFilters.includes("frozen")) {
      query = query.eq("is_frozen", true);
    }
    if (kondisiFilters.includes("lewat_due")) {
      query = query
        .lt("mr_due_date", toYmdLocal(new Date()))
        .in("mr_status", ["open", "approved"]);
    }
    if (itemDitolak) {
      query = query.eq("item_ditolak.item_status", "rejected");
    }

    if (barangFilter) {
      query = query.or(
        `part_number.ilike.${orIlikePattern(barangFilter)},part_name.ilike.${orIlikePattern(barangFilter)}`,
        { referencedTable: "barang_cocok" },
      );
    }

    return query;
  };

  // Data pendukung level MR (PR/PO/qty) untuk sekumpulan MR yang sedang
  // ditampilkan di halaman ini, murni derivasi dari data yang sudah ada
  // (tidak ada kolom/tabel baru) — level akhirnya dihitung oleh <MrLevelBadge>.
  const fetchLevelExtras = async (mrRows: any[]) => {
    const mrIds = mrRows.map((mr) => mr.id);
    if (mrIds.length === 0) {
      setLevelExtraByMrId({});
      return;
    }

    const { data: mrItemsData } = await supabase
      .from("mr_items")
      .select("mr_id, qty_request, qty_received, item_status")
      .in("mr_id", mrIds);

    const qtyByMr = new Map<number, { req: number; recv: number }>();
    for (const item of mrItemsData || []) {
      if (item.item_status === "rejected") continue;
      const cur = qtyByMr.get(item.mr_id) || { req: 0, recv: 0 };
      cur.req += item.qty_request || 0;
      cur.recv += item.qty_received || 0;
      qtyByMr.set(item.mr_id, cur);
    }

    const { data: prItemsData } = await supabase
      .from("pr_items")
      .select("id, mr_id")
      .in("mr_id", mrIds);

    const prItemIdToMrId = new Map<number, number>();
    for (const pri of prItemsData || []) {
      prItemIdToMrId.set(pri.id, pri.mr_id);
    }

    const hasPoByMr = new Set<number>();
    const prItemIds = Array.from(prItemIdToMrId.keys());
    for (let i = 0; i < prItemIds.length; i += 1000) {
      const chunk = prItemIds.slice(i, i + 1000);
      const { data: poItemsData } = await supabase
        .from("po_items")
        .select("pr_item_id")
        .in("pr_item_id", chunk);
      for (const poi of poItemsData || []) {
        const mrId = prItemIdToMrId.get(poi.pr_item_id);
        if (mrId) hasPoByMr.add(mrId);
      }
    }

    const extras: Record<
      number,
      { hasPo: boolean; qtyRequestTotal: number; qtyReceivedTotal: number }
    > = {};
    for (const mr of mrRows) {
      const qty = qtyByMr.get(mr.id) || { req: 0, recv: 0 };
      extras[mr.id] = {
        hasPo: hasPoByMr.has(mr.id),
        qtyRequestTotal: qty.req,
        qtyReceivedTotal: qty.recv,
      };
    }
    setLevelExtraByMrId(extras);
  };

  const fetchData = async () => {
    setLoading(true);
    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = MR_SORT_COLUMNS[sortKeyRaw];
    const sortField = sortColumn || "created_at";
    const ascending = sortColumn
      ? sortDirRaw === "asc"
      : sortOrder === "oldest";
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await buildFilteredQuery()
      .order(sortField, { ascending })
      .range(from, to);

    if (error) {
      console.error("Error fetching MRS:", error);
    } else {
      setMrs(data || []);
      setTotalCount(count || 0);
      fetchLevelExtras(data || []);
    }
    setLoading(false);
  };

  const fetchAllCount = async () => {
    const { count, error } = await supabase
      .from("mrs")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return count || 0;
  };

  const exportExcel = async (mode: ExcelDownloadMode) => {
    setExporting(true);
    const toastId = toast.loading("Menyiapkan data MR...");
    try {
      const pageSize = 1000;
      const allRows: any[] = [];
      for (let pageIndex = 0; ; pageIndex += 1) {
        const from = pageIndex * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await buildFilteredQuery(mode)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (error) {
          toast.error(error.message || "Gagal mengambil data untuk export.", {
            id: toastId,
          });
          return;
        }

        allRows.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }

      if (allRows.length === 0) {
        toast.warning("Tidak ada data untuk diekspor.", { id: toastId });
        return;
      }

      const mrById = new Map(allRows.map((mr) => [mr.id, mr]));
      const mrIds = allRows.map((mr) => mr.id);

      // Ambil semua item per MR, batch 1000.
      const mrItems: any[] = [];
      for (let i = 0; i < mrIds.length; i += 1000) {
        const chunk = mrIds.slice(i, i + 1000);
        const { data } = await supabase
          .from("mr_items")
          .select("*")
          .in("mr_id", chunk);
        mrItems.push(...(data || []));
      }

      const mrItemIds = mrItems.map((i) => i.id);

      // Trace: PR yang menarik item ini (via pr_items.mr_item_id).
      const prCodesByMrItem = new Map<number, string[]>();
      const prItemIdToMrItemId = new Map<number, number>();
      for (let i = 0; i < mrItemIds.length; i += 1000) {
        const chunk = mrItemIds.slice(i, i + 1000);
        const { data } = await supabase
          .from("pr_items")
          .select("id, mr_item_id, prs(pr_kode)")
          .in("mr_item_id", chunk);
        for (const row of data || []) {
          if (!row.mr_item_id) continue;
          prItemIdToMrItemId.set(row.id, row.mr_item_id);
          const kode = Array.isArray(row.prs)
            ? row.prs[0]?.pr_kode
            : (row.prs as any)?.pr_kode;
          if (!kode) continue;
          const list = prCodesByMrItem.get(row.mr_item_id) || [];
          list.push(kode);
          prCodesByMrItem.set(row.mr_item_id, list);
        }
      }

      // Trace: PO yang menarik item ini (via po_items.pr_item_id -> pr_items.mr_item_id).
      const poCodesByMrItem = new Map<number, string[]>();
      const prItemIds = Array.from(prItemIdToMrItemId.keys());
      for (let i = 0; i < prItemIds.length; i += 1000) {
        const chunk = prItemIds.slice(i, i + 1000);
        const { data } = await supabase
          .from("po_items")
          .select("pr_item_id, pos(po_kode)")
          .in("pr_item_id", chunk);
        for (const row of data || []) {
          const mrItemId = prItemIdToMrItemId.get(row.pr_item_id);
          if (!mrItemId) continue;
          const kode = Array.isArray(row.pos)
            ? row.pos[0]?.po_kode
            : (row.pos as any)?.po_kode;
          if (!kode) continue;
          const list = poCodesByMrItem.get(mrItemId) || [];
          list.push(kode);
          poCodesByMrItem.set(mrItemId, list);
        }
      }

      // Trace: Delivery (share stock) langsung via delivery_items.mr_item_id.
      // Ikut ambil status delivery-nya buat derive STATUS BARANG di bawah.
      const dlvCodesByMrItem = new Map<number, string[]>();
      const dlvStatusesByMrItem = new Map<number, string[]>();
      for (let i = 0; i < mrItemIds.length; i += 1000) {
        const chunk = mrItemIds.slice(i, i + 1000);
        const { data } = await supabase
          .from("delivery_items")
          .select("mr_item_id, deliveries(dlv_kode, status)")
          .in("mr_item_id", chunk);
        for (const row of data || []) {
          if (!row.mr_item_id) continue;
          const dlv = Array.isArray(row.deliveries)
            ? row.deliveries[0]
            : (row.deliveries as any);
          if (!dlv?.dlv_kode) continue;
          const codeList = dlvCodesByMrItem.get(row.mr_item_id) || [];
          codeList.push(dlv.dlv_kode);
          dlvCodesByMrItem.set(row.mr_item_id, codeList);
          const statusList = dlvStatusesByMrItem.get(row.mr_item_id) || [];
          statusList.push(dlv.status);
          dlvStatusesByMrItem.set(row.mr_item_id, statusList);
        }
      }

      const cabangNameById = new Map(
        availableCabang.map((c: any) => [c.id, c.nama_cabang]),
      );

      // Status Barang per item — heuristik dari data yang sudah ada (tanpa
      // kolom status baru), mengikuti vocabulary referensi sistem GA
      // (Menunggu/Proses PO/Sudah PO) ditambah "Selesai" karena di sini kita
      // bisa lacak sampai barang diterima (GA tidak).
      const deriveStatusBarang = (item: any) => {
        if (item.item_status === "rejected") return "Ditolak";
        if (!item.qty_request) return "-";
        const hasPr = (prCodesByMrItem.get(item.id) || []).length > 0;
        const hasPo = (poCodesByMrItem.get(item.id) || []).length > 0;
        const dlvStatuses = dlvStatusesByMrItem.get(item.id) || [];
        const hasDelivery = dlvStatuses.length > 0;

        const poFullyReceived =
          (item.qty_pr ?? 0) > 0 && (item.qty_received ?? 0) >= item.qty_pr;
        const deliveryFullyDone =
          (item.qty_sharestock_total ?? 0) === 0 ||
          (hasDelivery &&
            dlvStatuses.every((s) => s === "done" || s === "closed"));

        const poPortionDone = (item.qty_pr ?? 0) === 0 || poFullyReceived;

        if (poPortionDone && deliveryFullyDone && (hasPr || hasDelivery)) {
          return "Selesai";
        }
        if (hasPo || hasDelivery) return "Dalam Pengiriman";
        if (hasPr) return "Proses PO";
        return "Menunggu";
      };

      const uniq = (arr: string[]) => Array.from(new Set(arr));

      const sheetData = mrItems.map((item, index) => {
        const mr = mrById.get(item.mr_id);
        return {
          NO: index + 1,
          "KODE MR": mr?.mr_kode || "-",
          KATEGORI: mr?.kategori || "-",
          COMPANY: "GMI",
          PRIORITAS: item?.item_priority || "-",
          PIC: mr?.mr_pic || "-",
          LOKASI: mr?.cabang?.nama_cabang || "-",
          "TUJUAN SITE":
            cabangNameById.get(item.item_site_cabang_id) ||
            mr?.cabang?.nama_cabang ||
            "-",
          "TANGGAL REQUEST": toExcelDate(mr?.mr_tanggal),
          "DUE DATE": toExcelDate(mr?.mr_due_date),
          STATUS: mr?.mr_status || "-",
          FROZEN: mr?.is_frozen ? "YA" : "-",
          "PART NUMBER": item.part_number || "-",
          "NAMA BARANG": item.part_name || "-",
          SATUAN: item.satuan || "-",
          "QTY REQUEST": item.qty_request ?? 0,
          "QTY PR": item.qty_pr ?? 0,
          "QTY SHARE STOCK": item.qty_sharestock_total ?? 0,
          "STATUS BARANG": deriveStatusBarang(item),
          CATATAN: item.remarks || "-",
          "KETERANGAN TOLAK": item.item_reject_reason || "-",
          "KODE PR": uniq(prCodesByMrItem.get(item.id) || []).join(", ") || "-",
          "KODE PO": uniq(poCodesByMrItem.get(item.id) || []).join(", ") || "-",
          "KODE DELIVERY":
            uniq(dlvCodesByMrItem.get(item.id) || []).join(", ") || "-",
        };
      });

      const ws = jsonToSheetWithDates(sheetData, [
        "TANGGAL REQUEST",
        "DUE DATE",
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Material Request");
      XLSX.writeFile(
        wb,
        `MATERIAL_REQUEST_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success(`Export Excel berhasil (${sheetData.length} baris item).`, {
        id: toastId,
      });
    } catch (err: any) {
      toast.error(`Gagal export Excel: ${err?.message || err}`, { id: toastId });
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  useEffect(() => {
    fetchData();
  }, [
    debouncedSearch,
    statusFilters,
    priorityFilters,
    accurateFilter,
    locationFilters,
    dateFrom,
    dateTo,
    dueFrom,
    dueTo,
    kategoriFilters,
    konversiFilters,
    jenisFilters,
    asalFilters,
    kondisiFilters,
    barangFilter,
    sortOrder,
    page,
    limit,
  ]);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const resetFilters = () => {
    resetSearchQuery();
    resetBarangInput();
    urlState.reset();
  };

  const setMyLocationFilter = () => {
    if (userProfile?.cabang_id) {
      setLocationFilters([userProfile.cabang_id.toString()]);
    }
  };

  const locationOptions = availableCabang.map((c) => ({
    label: c.nama_cabang,
    value: c.id.toString(),
  }));

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const optionLabels = (
    options: { label: string; value: string }[],
    values: string[],
  ) => values.map((v) => filterOptionLabel(options, v)).join(", ");
  const activeFilters: ActiveFilter[] = [];
  if (locationFilters.length > 0)
    activeFilters.push({
      key: "lokasi",
      label: "Lokasi",
      value: optionLabels(locationOptions, locationFilters),
      onRemove: () => setLocationFilters([]),
    });
  if (priorityFilters.length > 0)
    activeFilters.push({
      key: "prioritas",
      label: "Prioritas",
      value: priorityFilters.join(", "),
      onRemove: () => setPriorityFilters([]),
    });
  if (statusFilters.length > 0)
    activeFilters.push({
      key: "status",
      label: "Status",
      value: optionLabels(MR_STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
    });
  if (dateFrom || dateTo)
    activeFilters.push({
      key: "tanggal",
      label: "Tanggal",
      value: formatFilterRange(dateFrom, dateTo, formatFilterDate),
      onRemove: () => urlState.set({ dari: "", sampai: "" }, { resetPage: true }),
    });
  if (dueFrom || dueTo)
    activeFilters.push({
      key: "due",
      label: "Due Date",
      value: formatFilterRange(dueFrom, dueTo, formatFilterDate),
      onRemove: () =>
        urlState.set({ due_dari: "", due_sampai: "" }, { resetPage: true }),
    });
  if (kategoriFilters.length > 0)
    activeFilters.push({
      key: "kategori",
      label: "Kategori",
      value: optionLabels(MR_KATEGORI_FILTER_OPTIONS, kategoriFilters),
      onRemove: () => setKategoriFilters([]),
    });
  if (konversiFilters.length > 0)
    activeFilters.push({
      key: "konversi",
      label: "Konversi PR",
      value: optionLabels(MR_KONVERSI_OPTIONS, konversiFilters),
      onRemove: () => setKonversiFilters([]),
    });
  if (jenisFilters.length > 0)
    activeFilters.push({
      key: "jenis",
      label: "Jenis MR",
      value: optionLabels(MR_JENIS_OPTIONS, jenisFilters),
      onRemove: () => setJenisFilters([]),
    });
  if (asalFilters.length > 0)
    activeFilters.push({
      key: "asal",
      label: "Asal Data",
      value: optionLabels(MR_ASAL_OPTIONS, asalFilters),
      onRemove: () => setAsalFilters([]),
    });
  if (kondisiFilters.length > 0)
    activeFilters.push({
      key: "kondisi",
      label: "Kondisi",
      value: optionLabels(MR_KONDISI_OPTIONS, kondisiFilters),
      onRemove: () => setKondisiFilters([]),
    });
  if (barangFilter)
    activeFilters.push({
      key: "barang",
      label: "Barang",
      value: barangFilter,
      onRemove: () => {
        resetBarangInput();
        urlState.set({ barang: "" }, { resetPage: true });
      },
    });

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case "P1":
        return (
          <Badge
            variant="destructive"
            className="text-[9px] font-bold px-1.5 h-4 min-w-8 justify-center"
          >
            P1
          </Badge>
        );
      case "P2":
        return (
          <Badge className="bg-warning text-warning-foreground text-[9px] font-bold px-1.5 h-4 min-w-8 justify-center">
            P2
          </Badge>
        );
      case "P3":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 text-[9px] font-bold px-1.5 h-4 min-w-8 justify-center"
          >
            P3
          </Badge>
        );
      case "P4":
        return (
          <Badge
            variant="secondary"
            className="text-muted-foreground text-[9px] font-bold px-1.5 h-4 min-w-8 justify-center"
          >
            P4
          </Badge>
        );
      default:
        return null;
    }
  };

  const getNextApprover = (mr: any) => {
    if (mr.mr_status !== "open") return null;
    const nextStep = mr.approvals?.find((a: any) => a.status === "pending");
    return nextStep ? nextStep.nama : null;
  };

  const [mrToDelete, setMrToDelete] = useState<{ id: number; kode: string } | null>(null);

  const handleRowClick = (id: number) => {
    setSelectedMrId(id);
    setDetailOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!mrToDelete) return;
    const res = await deleteMR(mrToDelete.id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`MR ${mrToDelete.kode} berhasil dihapus.`);
    fetchData();
  };

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (mr: any, id: MrColumnId) => {
    const nextApprover = getNextApprover(mr);

    switch (id) {
      case "urgency":
        return (
          <TableCell className="text-center">
            <div className="flex flex-wrap items-center justify-center gap-0.5">
              {Array.from(
                new Set(
                  (mr.mr_items || [])
                    .map((i: any) => i.item_priority)
                    .filter(Boolean),
                ),
              ).map((p: any) => (
                <React.Fragment key={p}>
                  {getPriorityBadge(p)}
                </React.Fragment>
              ))}
            </div>
          </TableCell>
        );
      case "mr_kode":
        return (
          <TableCell>
            <span className="font-bold text-foreground text-sm group-hover:text-primary transition-colors">
              {mr.mr_kode}
            </span>
          </TableCell>
        );
      case "pic":
        return (
          <TableCell>
            <div className="flex flex-col py-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-foreground uppercase tracking-tight">
                  {mr.mr_pic}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <MapPin className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">
                  {mr.cabang?.nama_cabang || "Unknown Site"}
                </span>
              </div>
            </div>
          </TableCell>
        );
      case "mr_tanggal":
        return (
          <TableCell className="text-center">
            <div className="flex flex-col items-center gap-0.5">
              <div className="flex items-center gap-1 text-xs font-bold text-foreground">
                <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                {formatDate(mr.mr_tanggal)}
              </div>
              <div className="flex items-center gap-1 opacity-60">
                <span className="text-[8px] text-destructive font-bold uppercase">
                  DUE:
                </span>
                <span className="text-[8px] text-muted-foreground font-bold">
                  {formatDate(mr.mr_due_date)}
                </span>
              </div>
            </div>
          </TableCell>
        );
      case "mr_status":
        return (
          <TableCell className="text-center">
            <div className="flex flex-col items-center gap-1.5">
              <StatusBadge status={mr.mr_status} />
              {mr.mr_status !== "open" &&
                mr.mr_status !== "rejected" &&
                levelExtraByMrId[mr.id] && (
                  <MrLevelBadge
                    mrId={mr.id}
                    mrConvertStatus={mr.mr_convert_status}
                    hasPo={levelExtraByMrId[mr.id].hasPo}
                    qtyRequestTotal={
                      levelExtraByMrId[mr.id].qtyRequestTotal
                    }
                    qtyReceivedTotal={
                      levelExtraByMrId[mr.id].qtyReceivedTotal
                    }
                    manualLevel={mr.manual_level}
                    manualNote={mr.manual_level_note}
                    manualSetByName={mr.manual_level_setter?.nama}
                    manualSetAt={mr.manual_level_set_at}
                    autoRules={mrLevelAutoRules}
                    canEdit={!!userProfile?.isModerator}
                    size="xs"
                    onChanged={(patch) =>
                      setMrs((prev) =>
                        prev.map((m) =>
                          m.id === mr.id ? { ...m, ...patch } : m,
                        ),
                      )
                    }
                  />
                )}
              {mr.is_frozen && (
                <Badge className="bg-sky-500 text-white border-none text-[9px] font-bold uppercase">
                  Frozen
                </Badge>
              )}
              {nextApprover && (
                <div className="flex items-center gap-1 text-[9px] font-bold text-muted-foreground uppercase tracking-tighter">
                  <Clock className="h-2.5 w-2.5" />
                  Menunggu:{" "}
                  <span className="text-foreground">
                    {nextApprover}
                  </span>
                </div>
              )}
            </div>
          </TableCell>
        );
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                MATERIAL REQUEST
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Manajemen Permintaan Barang Internal
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canCreateMR(
              (userProfile?.roles as any[])?.map((r: any) => r.roles?.name),
            ) && (
              <Link href="/mr/create">
                <Button className="gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase transition-all">
                  <Plus className="h-4 w-4" /> BUAT MR BARU
                </Button>
              </Link>
            )}
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <div className="flex flex-col gap-4 md:flex-row">
            <ListSearchInput
              placeholder="Cari Kode MR atau PIC..."
              value={searchQuery}
              onChange={setSearchQuery}
              searchableFields={MR_SEARCH_FIELDS}
            />
            <ExcelDownloadMenu
              itemLabel="MR"
              filteredCount={totalCount}
              fetchAllCount={fetchAllCount}
              onDownload={exportExcel}
              isExporting={exporting}
            />
          </div>

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField
                label="Lokasi"
                action={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50"
                    onClick={setMyLocationFilter}
                    disabled={!userProfile?.cabang_id}
                  >
                    <Navigation2 className="h-3 w-3" />
                    Lokasi saya
                  </button>
                }
              >
                <MultiSelect
                  placeholder="Semua Lokasi"
                  icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
                  searchable
                  selected={locationFilters}
                  onChange={setLocationFilters}
                  options={locationOptions}
                />
              </FilterField>

              <FilterField label="Prioritas">
                <MultiSelect
                  placeholder="Semua Prioritas"
                  icon={<AlertTriangle className="h-3 w-3 text-muted-foreground" />}
                  selected={priorityFilters}
                  onChange={setPriorityFilters}
                  options={MR_PRIORITY_OPTIONS}
                />
              </FilterField>

              <FilterField label="Status">
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={MR_STATUS_OPTIONS}
                />
              </FilterField>

              <FilterField label="Kategori">
                <MultiSelect
                  placeholder="Semua Kategori"
                  selected={kategoriFilters}
                  onChange={setKategoriFilters}
                  options={MR_KATEGORI_FILTER_OPTIONS}
                />
              </FilterField>

              <FilterField label="Konversi PR">
                <MultiSelect
                  placeholder="Semua"
                  selected={konversiFilters}
                  onChange={setKonversiFilters}
                  options={MR_KONVERSI_OPTIONS}
                />
              </FilterField>

              <FilterField label="Jenis MR">
                <MultiSelect
                  placeholder="Semua Jenis"
                  selected={jenisFilters}
                  onChange={setJenisFilters}
                  options={MR_JENIS_OPTIONS}
                />
              </FilterField>

              <FilterField label="Asal Data">
                <MultiSelect
                  placeholder="Semua Asal"
                  selected={asalFilters}
                  onChange={setAsalFilters}
                  options={MR_ASAL_OPTIONS}
                />
              </FilterField>

              <FilterField label="Kondisi">
                <MultiSelect
                  placeholder="Semua Kondisi"
                  selected={kondisiFilters}
                  onChange={setKondisiFilters}
                  options={MR_KONDISI_OPTIONS}
                />
              </FilterField>

              <FilterField label="Barang">
                <Input
                  placeholder="Part number / nama"
                  value={barangInput}
                  onChange={(e) => setBarangInput(e.target.value)}
                  className="h-9 text-xs font-medium"
                />
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tanggal MR">
                <FilterRange
                  from={
                    <DatePickerString
                      value={dateFrom}
                      onChange={setDateFrom}
                      placeholder="Dari"
                      className="h-9 w-full text-xs font-medium"
                    />
                  }
                  to={
                    <DatePickerString
                      value={dateTo}
                      onChange={setDateTo}
                      placeholder="Sampai"
                      className="h-9 w-full text-xs font-medium"
                    />
                  }
                />
              </FilterField>
              <FilterField label="Due Date">
                <FilterRange
                  from={
                    <DatePickerString
                      value={dueFrom}
                      onChange={setDueFrom}
                      placeholder="Dari"
                      className="h-9 w-full text-xs font-medium"
                    />
                  }
                  to={
                    <DatePickerString
                      value={dueTo}
                      onChange={setDueTo}
                      placeholder="Sampai"
                      className="h-9 w-full text-xs font-medium"
                    />
                  }
                />
              </FilterField>
            </FilterRangeFields>
          </FilterPanel>
        </div>
      </Content>

      <Content>
        {columnOrder.isCustomOrder && (
          <ColumnOrderReset onReset={columnOrder.resetOrder} />
        )}
        <StickyHeaderTable
          className="min-w-[900px]"
          containerClassName="rounded-md border"
          header={
            <ReorderableHeaderRow
              order={columnOrder.order}
              onMove={columnOrder.moveColumn}
              className="hover:bg-transparent h-10 text-foreground"
            >
              <TableHead className="w-12.5 text-center font-bold text-[10px] uppercase text-muted-foreground">
                No
              </TableHead>
              {columnOrder.orderedColumns.map((column) => (
                <ReorderableTableHead
                  key={column.id}
                  column={column}
                  sort={{ currentSort: sortOrder, onSort: handleSortChange }}
                />
              ))}
              <TableHead className="text-right w-24 pr-4 font-bold text-[10px] uppercase text-muted-foreground">
                Aksi
              </TableHead>
            </ReorderableHeaderRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: limit }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : mrs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-40 text-center text-muted-foreground italic text-sm"
                >
                  {activeFilters.length > 0 || accurateFilter !== "all"
                    ? "Tidak ada data yang sesuai filter."
                    : "Tidak ada permintaan barang yang ditemukan."}
                </TableCell>
              </TableRow>
            ) : (
              mrs.map((mr, index) => {
                return (
                  <TableRow
                    key={mr.id}
                    className="hover:bg-muted/40 transition-colors group border-b border-border/40 last:border-0 h-16 cursor-pointer"
                    onClick={() => handleRowClick(mr.id)}
                  >
                    <TableCell className="text-center text-muted-foreground text-[10px] font-semibold font-mono">
                      {(page - 1) * limit + index + 1}
                    </TableCell>
                    {columnOrder.order.map((id) => (
                      <React.Fragment key={id}>{renderCell(mr, id)}</React.Fragment>
                    ))}
                    <TableCell
                      className="text-right pr-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <RowActionsMenu>
                        <DropdownMenuItem onSelect={() => handleRowClick(mr.id)}>
                          <Eye className="mr-2 h-4 w-4" /> Lihat Detail
                        </DropdownMenuItem>
                        {userProfile?.isModerator && (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() =>
                              setMrToDelete({ id: mr.id, kode: mr.mr_kode })
                            }
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Hapus
                          </DropdownMenuItem>
                        )}
                      </RowActionsMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          currentPage={page}
          totalItems={totalCount}
          limit={limit}
          itemLabel="MR"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <MRDetailSheet
        mrId={selectedMrId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        isModerator={!!userProfile?.isModerator}
      />

      <ConfirmDialog
        destructive
        open={!!mrToDelete}
        onOpenChange={(open) => !open && setMrToDelete(null)}
        title="Hapus Material Request?"
        description={
          <>
            MR <span className="font-bold text-foreground">{mrToDelete?.kode}</span> akan dihapus permanen.
            Tindakan ini tidak dapat dibatalkan.
          </>
        }
        confirmText="Ya, Hapus"
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
}
