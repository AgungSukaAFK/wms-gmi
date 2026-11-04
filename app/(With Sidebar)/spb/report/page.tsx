"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileBox,
  MapPin,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useDebounce } from "use-debounce";
import { Content } from "@/components/content";
import { useColumnOrder } from "@/hooks/use-column-order";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import {
  ColumnOrderReset,
  ReorderableHeaderRow,
  ReorderableTableHead,
  type ReorderableColumn,
} from "@/components/reorderable-table-head";
import { StickyHeaderTable } from "@/components/sticky-header-table";
import { TablePaginationFooter } from "@/components/table-pagination-footer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { DatePickerString } from "@/components/date-picker-string";
import { MultiSelect } from "@/components/ui/multi-select";
import { toast } from "@/lib/toast";
import {
  getSpbReport,
  updateSpbInvoicePaymentStatus,
  type SpbReportFilters,
} from "@/services/spb-actions";
import { getCabangList } from "@/services/master-actions";
import * as XLSX from "xlsx";
import { jsonToSheetWithDates, toExcelDate } from "@/lib/excel";
import { formatDate, ymdToLocalStartIso } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type SpbReportRow = {
  spb_id?: number | string | null;
  spb_dtl_id?: number | string | null;
  spb_tanggal?: string | null;
  spb_no?: string | null;
  dtl_spb_part_number?: string | null;
  dtl_spb_part_name?: string | null;
  dtl_spb_qty?: number | null;
  dtl_spb_part_satuan?: string | null;
  spb_kode_unit?: string | null;
  spb_tipe_unit?: string | null;
  spb_brand?: string | null;
  spb_hm?: number | null;
  spb_problem_remark?: string | null;
  spb_section?: string | null;
  spb_pic_gmi?: string | null;
  spb_pic_ppa?: string | null;
  spb_no_wo?: string | null;
  spb_created_at?: string | null;
  spb_status?: string | null;
  spb_gudang?: string | null;
  po_no?: string | null;
  so_no?: string | null;
  po_created_at?: string | null;
  do_no?: string | null;
  do_created_at?: string | null;
  invoice_no?: string | null;
  invoice_date?: string | null;
  invoice_email_date?: string | null;
  invoice_id?: number | string | null;
  invoice_payment_status?: "paid" | "unpaid" | null;
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
};

type CabangOption = { id: number; nama_cabang: string };

type TextFilterColumn = keyof NonNullable<SpbReportFilters["text"]>;
type DateFilterColumn = keyof NonNullable<SpbReportFilters["dates"]>;
type NumberFilterColumn = keyof NonNullable<SpbReportFilters["numbers"]>;

type FilterField =
  | { kind: "text"; column: TextFilterColumn; label: string }
  | { kind: "date"; column: DateFilterColumn; label: string }
  | { kind: "number"; column: NumberFilterColumn; label: string }
  | { kind: "payment"; label: string };

// Urutan grup mengikuti urutan kolom tabel (SPB → PO → DO → Invoice).
const FILTER_GROUPS: { title: string; fields: FilterField[] }[] = [
  {
    title: "SPB",
    fields: [
      { kind: "date", column: "spb_tanggal", label: "TGL SPB" },
      { kind: "text", column: "spb_no", label: "NO SPB" },
      { kind: "text", column: "spb_status", label: "STATUS" },
      { kind: "date", column: "spb_created_at", label: "DATE INPUT SPB" },
      { kind: "text", column: "spb_no_wo", label: "NO WO" },
      { kind: "text", column: "spb_section", label: "SECTION" },
      { kind: "text", column: "spb_pic_gmi", label: "PIC GMI" },
      { kind: "text", column: "spb_pic_ppa", label: "PIC PPA" },
    ],
  },
  {
    title: "Part & Unit",
    fields: [
      { kind: "text", column: "dtl_spb_part_number", label: "PART NUMBER" },
      { kind: "text", column: "dtl_spb_part_name", label: "PART NAME" },
      { kind: "number", column: "dtl_spb_qty", label: "QTY" },
      { kind: "text", column: "dtl_spb_part_satuan", label: "UOM" },
      { kind: "text", column: "spb_kode_unit", label: "KODE UNIT" },
      { kind: "text", column: "spb_tipe_unit", label: "TYPE UNIT" },
      { kind: "text", column: "spb_brand", label: "BRAND" },
      { kind: "number", column: "spb_hm", label: "HM" },
      { kind: "text", column: "spb_problem_remark", label: "REMARK" },
    ],
  },
  {
    title: "PO",
    fields: [
      { kind: "text", column: "po_no", label: "NO PO" },
      { kind: "text", column: "so_no", label: "NO SO" },
      { kind: "date", column: "po_created_at", label: "DATE INPUT PO" },
    ],
  },
  {
    title: "DO",
    fields: [
      { kind: "text", column: "do_no", label: "NO DO" },
      { kind: "date", column: "do_created_at", label: "DATE INPUT DO" },
    ],
  },
  {
    title: "Invoice",
    fields: [
      { kind: "text", column: "invoice_no", label: "NO INVOICE" },
      { kind: "date", column: "invoice_date", label: "TGL INVOICE" },
      { kind: "date", column: "invoice_email_date", label: "TGL EMAIL KE SITE" },
      { kind: "payment", label: "STATUS PAYMENT" },
    ],
  },
];

// State filter disimpan flat: `<kolom>` untuk teks, `<kolom>__from/__to`
// untuk tanggal (YYYY-MM-DD), `<kolom>__min/__max` untuk angka, dan
// `payment_status` untuk status payment.
type FilterValues = Record<string, string>;

const FILTER_PANEL_STORAGE_KEY = "spb-report:show-filters";

function nextYmd(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(year, month - 1, day + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toNumber(value?: string) {
  if (!value?.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function buildFilterPayload(values: FilterValues): SpbReportFilters {
  const text: NonNullable<SpbReportFilters["text"]> = {};
  const dates: NonNullable<SpbReportFilters["dates"]> = {};
  const numbers: NonNullable<SpbReportFilters["numbers"]> = {};
  let paymentStatus: SpbReportFilters["paymentStatus"];
  for (const group of FILTER_GROUPS) {
    for (const field of group.fields) {
      if (field.kind === "text") {
        const v = values[field.column]?.trim();
        if (v) text[field.column] = v;
      } else if (field.kind === "date") {
        const from = values[`${field.column}__from`];
        const to = values[`${field.column}__to`];
        // Tanggal disimpan sebagai awal hari waktu lokal, jadi batasnya juga
        // dihitung di waktu lokal: [from 00:00, to+1 00:00).
        if (from || to) {
          dates[field.column] = {
            from: from ? ymdToLocalStartIso(from) : undefined,
            to: to ? ymdToLocalStartIso(nextYmd(to)) : undefined,
          };
        }
      } else if (field.kind === "number") {
        const min = toNumber(values[`${field.column}__min`]);
        const max = toNumber(values[`${field.column}__max`]);
        if (min !== undefined || max !== undefined) {
          numbers[field.column] = { min, max };
        }
      } else if (field.kind === "payment") {
        const v = values.payment_status;
        if (v === "paid" || v === "unpaid") paymentStatus = v;
      }
    }
  }
  return { text, dates, numbers, paymentStatus };
}

function countActiveFilters(values: FilterValues) {
  let count = 0;
  for (const group of FILTER_GROUPS) {
    for (const field of group.fields) {
      if (field.kind === "text") {
        if (values[field.column]?.trim()) count += 1;
      } else if (field.kind === "date") {
        if (values[`${field.column}__from`] || values[`${field.column}__to`]) {
          count += 1;
        }
      } else if (field.kind === "number") {
        if (
          toNumber(values[`${field.column}__min`]) !== undefined ||
          toNumber(values[`${field.column}__max`]) !== undefined
        ) {
          count += 1;
        }
      } else if (
        values.payment_status === "paid" ||
        values.payment_status === "unpaid"
      ) {
        count += 1;
      }
    }
  }
  return count;
}

// Kolom report. Id kolom yang bisa di-sort = key sort di service.
const REPORT_COLUMNS = [
  { id: "spb_tanggal", label: "TGL SPB", sortDirection: "desc" },
  { id: "spb_no", label: "NO SPB", sortDirection: "asc" },
  { id: "lokasi", label: "LOKASI" },
  { id: "part_number", label: "PART NUMBER" },
  { id: "part_name", label: "PART NAME" },
  { id: "qty", label: "QTY" },
  { id: "uom", label: "UOM" },
  { id: "kode_unit", label: "KODE UNIT" },
  { id: "type_unit", label: "TYPE UNIT" },
  { id: "brand", label: "BRAND" },
  { id: "hm", label: "HM" },
  { id: "remark", label: "REMARK" },
  { id: "section", label: "SECTION" },
  { id: "pic_gmi", label: "PIC GMI" },
  { id: "pic_ppa", label: "PIC PPA" },
  { id: "no_wo", label: "NO WO" },
  { id: "date_input_spb", label: "DATE INPUT SPB" },
  { id: "spb_status", label: "STATUS", sortDirection: "asc" },
  { id: "po_no", label: "NO PO", sortDirection: "asc" },
  { id: "so_no", label: "NO SO" },
  { id: "date_input_po", label: "DATE INPUT PO" },
  { id: "do_no", label: "NO DO", sortDirection: "asc" },
  { id: "date_input_do", label: "DATE INPUT DO" },
  { id: "invoice_no", label: "NO INVOICE", sortDirection: "asc" },
  { id: "tgl_invoice", label: "TGL INVOICE" },
  { id: "tgl_email", label: "TGL EMAIL KE SITE" },
  { id: "payment", label: "STATUS PAYMENT" },
] as const satisfies readonly ReorderableColumn[];
type ReportColumnId = (typeof REPORT_COLUMNS)[number]["id"];

export default function SpbReportPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SpbReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [canEditPayment, setCanEditPayment] = useState(false);
  const [updatingInvoiceId, setUpdatingInvoiceId] = useState<
    number | string | null
  >(null);

  const columnOrder = useColumnOrder("wms:table-column-order:spb-report", REPORT_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [search, setSearch, resetSearch] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusParam = urlState.get("status");
  const status: "all" | "no_po" | "no_do" | "no_invoice" =
    statusParam === "no_po" ||
    statusParam === "no_do" ||
    statusParam === "no_invoice"
      ? statusParam
      : "all";
  const setStatus = (v: string) =>
    urlState.set({ status: v === "all" ? "" : v }, { resetPage: true });
  const locationFilters = urlState.list("lokasi");
  const setLocationFilters = (v: string[]) =>
    urlState.set({ lokasi: v }, { resetPage: true });
  const [availableCabang, setAvailableCabang] = useState<CabangOption[]>([]);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [debouncedFilterValues] = useDebounce(filterValues, 500);
  const [showFilters, setShowFilters] = useState(false);
  const sort = urlState.get("sort", "spb_tanggal_desc");
  const setSort = (v: string) =>
    urlState.set({ sort: v === "spb_tanggal_desc" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  const cabangIds = useMemo(
    () =>
      locationFilters.length > 0 ? locationFilters.map(Number) : undefined,
    [locationFilters],
  );
  const filterPayload = useMemo(
    () => buildFilterPayload(debouncedFilterValues),
    [debouncedFilterValues],
  );
  const activeFilterCount = countActiveFilters(filterValues);

  useEffect(() => {
    getCabangList().then((data) =>
      setAvailableCabang((data || []) as CabangOption[]),
    );
  }, []);

  useEffect(() => {
    try {
      setShowFilters(
        window.localStorage.getItem(FILTER_PANEL_STORAGE_KEY) === "1",
      );
    } catch {
      // localStorage bisa diblokir browser; panel tetap default tertutup.
    }
  }, []);

  const toggleFilters = () => {
    setShowFilters((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(FILTER_PANEL_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // abaikan
      }
      return next;
    });
  };

  const setFilterValue = (key: string, value: string) => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilterValues({});
    resetSearch();
    urlState.reset();
  };

  useEffect(() => {
    const fetchRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("user_id", user.id);
      const roleNames = (roleRows || [])
        .map((r: any) => r.roles?.name)
        .filter(Boolean) as string[];
      setCanEditPayment(
        roleNames.some((r) => ["finance", "moderator"].includes(r)),
      );
    };
    fetchRole();
  }, [supabase]);

  const handlePaymentStatusChange = async (
    invoiceId: number | string,
    nextStatus: "paid" | "unpaid",
  ) => {
    setUpdatingInvoiceId(invoiceId);
    const res = await updateSpbInvoicePaymentStatus(
      Number(invoiceId),
      nextStatus,
    );
    if (res.error) {
      toast.error(res.error);
    } else {
      setRows((prev) =>
        prev.map((row) =>
          row.invoice_id === invoiceId
            ? { ...row, invoice_payment_status: nextStatus }
            : row,
        ),
      );
      toast.success("Status Payment berhasil diperbarui.");
    }
    setUpdatingInvoiceId(null);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await getSpbReport({
      search: debouncedSearch || undefined,
      status,
      cabangIds,
      filters: filterPayload,
      sort,
      page,
      limit,
    });

    if (res.error) {
      toast.error(res.error);
      setRows([]);
      setTotal(0);
    } else {
      setRows(res.data || []);
      setTotal(res.count || 0);
    }
    setLoading(false);
  }, [debouncedSearch, status, cabangIds, filterPayload, sort, page, limit]);

  const handleSortChange = (nextSort: string) => {
    setSort(nextSort);
    setPage(1);
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const first = await getSpbReport({
        search: debouncedSearch || undefined,
        status,
        cabangIds,
      filters: filterPayload,
        page: 1,
        limit: 1,
      });

      if (first.error) {
        toast.error(first.error);
        return;
      }

      const totalRows = first.count || 0;
      if (!totalRows) {
        toast.error("Data report kosong.");
        return;
      }

      const allRows: SpbReportRow[] = [];
      const pageSize = 1000;
      for (
        let pageIndex = 1;
        (pageIndex - 1) * pageSize < totalRows;
        pageIndex += 1
      ) {
        const res = await getSpbReport({
          search: debouncedSearch || undefined,
          status,
          cabangIds,
      filters: filterPayload,
          page: pageIndex,
          limit: pageSize,
        });

        if (res.error) {
          toast.error(res.error);
          return;
        }

        allRows.push(...((res.data || []) as SpbReportRow[]));
        if ((res.data || []).length < pageSize) break;
      }

      const data = allRows.map((row) => ({
        "TGL SPB": toExcelDate(row.spb_tanggal),
        "NO SPB": row.spb_no || "-",
        LOKASI: row.spb_gudang || "-",
        "PART NUMBER": row.dtl_spb_part_number || "-",
        "PART NAME": row.dtl_spb_part_name || "-",
        QTY: row.dtl_spb_qty ?? "-",
        UOM: row.dtl_spb_part_satuan || "-",
        "KODE UNIT": row.spb_kode_unit || "-",
        "TYPE UNIT": row.spb_tipe_unit || "-",
        BRAND: row.spb_brand || "-",
        HM: row.spb_hm ?? "-",
        REMARK: row.spb_problem_remark || "-",
        SECTION: row.spb_section || "-",
        "PIC GMI": row.spb_pic_gmi || "-",
        "PIC PPA": row.spb_pic_ppa || "-",
        "NO WO": row.spb_no_wo || "-",
        "DATE INPUT SPB": toExcelDate(row.spb_created_at),
        STATUS: row.spb_status || "-",
        "NO PO": row.po_no || "-",
        "NO SO": row.so_no || "-",
        "DATE INPUT PO": toExcelDate(row.po_created_at),
        "NO DO": row.do_no || "-",
        "DATE INPUT DO": toExcelDate(row.do_created_at),
        "NO INVOICE": row.invoice_no || "-",
        "TGL INVOICE": toExcelDate(row.invoice_date),
        "TGL EMAIL KE SITE": toExcelDate(row.invoice_email_date),
        "STATUS PAYMENT": row.invoice_no
          ? PAYMENT_STATUS_LABEL[row.invoice_payment_status || "unpaid"]
          : "-",
      }));

      const ws = jsonToSheetWithDates(data, [
        "TGL SPB",
        "DATE INPUT SPB",
        "DATE INPUT PO",
        "DATE INPUT DO",
        "TGL INVOICE",
        "TGL EMAIL KE SITE",
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Report SPB");
      XLSX.writeFile(
        wb,
        `REPORT_SPB_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success(`Export Excel berhasil (${allRows.length} baris).`);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (row: SpbReportRow, id: ReportColumnId) => {
    switch (id) {
      case "spb_tanggal":
        return (
          <TableCell>{formatDate(row.spb_tanggal)}</TableCell>
        );
      case "spb_no":
        return (
          <TableCell>{row.spb_no}</TableCell>
        );
      case "lokasi":
        return (
          <TableCell>{row.spb_gudang || "-"}</TableCell>
        );
      case "part_number":
        return (
          <TableCell>{row.dtl_spb_part_number}</TableCell>
        );
      case "part_name":
        return (
          <TableCell>{row.dtl_spb_part_name}</TableCell>
        );
      case "qty":
        return (
          <TableCell>{row.dtl_spb_qty}</TableCell>
        );
      case "uom":
        return (
          <TableCell>{row.dtl_spb_part_satuan}</TableCell>
        );
      case "kode_unit":
        return (
          <TableCell>{row.spb_kode_unit || "-"}</TableCell>
        );
      case "type_unit":
        return (
          <TableCell>{row.spb_tipe_unit || "-"}</TableCell>
        );
      case "brand":
        return (
          <TableCell>{row.spb_brand || "-"}</TableCell>
        );
      case "hm":
        return (
          <TableCell>{row.spb_hm ?? "-"}</TableCell>
        );
      case "remark":
        return (
          <TableCell>{row.spb_problem_remark || "-"}</TableCell>
        );
      case "section":
        return (
          <TableCell>{row.spb_section || "-"}</TableCell>
        );
      case "pic_gmi":
        return (
          <TableCell>{row.spb_pic_gmi || "-"}</TableCell>
        );
      case "pic_ppa":
        return (
          <TableCell>{row.spb_pic_ppa || "-"}</TableCell>
        );
      case "no_wo":
        return (
          <TableCell>{row.spb_no_wo || "-"}</TableCell>
        );
      case "date_input_spb":
        return (
          <TableCell>
            {formatDate(row.spb_created_at)}
          </TableCell>
        );
      case "spb_status":
        return (
          <TableCell>{row.spb_status}</TableCell>
        );
      case "po_no":
        return (
          <TableCell>{row.po_no || "-"}</TableCell>
        );
      case "so_no":
        return (
          <TableCell>{row.so_no || "-"}</TableCell>
        );
      case "date_input_po":
        return (
          <TableCell>{formatDate(row.po_created_at)}</TableCell>
        );
      case "do_no":
        return (
          <TableCell>{row.do_no || "-"}</TableCell>
        );
      case "date_input_do":
        return (
          <TableCell>{formatDate(row.do_created_at)}</TableCell>
        );
      case "invoice_no":
        return (
          <TableCell>{row.invoice_no || "-"}</TableCell>
        );
      case "tgl_invoice":
        return (
          <TableCell>{formatDate(row.invoice_date)}</TableCell>
        );
      case "tgl_email":
        return (
          <TableCell>
            {formatDate(row.invoice_email_date)}
          </TableCell>
        );
      case "payment":
        return (
          <TableCell>
            {!row.invoice_no ? (
              "-"
            ) : canEditPayment ? (
              <Select
                value={row.invoice_payment_status || "unpaid"}
                disabled={updatingInvoiceId === row.invoice_id}
                onValueChange={(v: "paid" | "unpaid") =>
                  row.invoice_id &&
                  handlePaymentStatusChange(row.invoice_id, v)
                }
              >
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge
                variant="outline"
                className={
                  row.invoice_payment_status === "paid"
                    ? "bg-success/10 text-success border-success/20"
                    : "bg-warning/10 text-warning border-warning/20"
                }
              >
                {PAYMENT_STATUS_LABEL[
                  row.invoice_payment_status || "unpaid"
                ]}
              </Badge>
            )}
          </TableCell>
        );
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <FileBox className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                REPORT SPB
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Laporan gabungan SPB → PO → DO → Invoice
              </p>
            </div>
          </div>
          <Button
            onClick={exportExcel}
            disabled={loading || exporting}
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
          >
            <Download className="h-4 w-4" />
            {exporting ? "Mengekspor..." : "Export Excel"}
          </Button>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 xl:min-w-70">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Cari SPB/Part/PO/DO/Invoice"
                className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium text-foreground transition-all focus:bg-background"
              />
            </div>

            <Select
              value={status}
              onValueChange={(v: "all" | "no_po" | "no_do" | "no_invoice") => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground sm:w-45">
                <SelectValue placeholder="Status progress" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua</SelectItem>
                <SelectItem value="no_po">Belum PO</SelectItem>
                <SelectItem value="no_do">Belum DO</SelectItem>
                <SelectItem value="no_invoice">Belum Invoice</SelectItem>
              </SelectContent>
            </Select>

            <MultiSelect
              className="h-9 w-full sm:w-45"
              placeholder="Semua Lokasi"
              icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
              searchable
              selected={locationFilters}
              onChange={(vals) => {
                setLocationFilters(vals);
                setPage(1);
              }}
              options={availableCabang.map((c) => ({
                label: c.nama_cabang,
                value: c.id.toString(),
              }))}
            />

            <Button
              type="button"
              variant={showFilters ? "secondary" : "outline"}
              onClick={toggleFilters}
              aria-expanded={showFilters}
              className="h-9 gap-2 rounded-md px-3 text-xs font-semibold"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filter Kolom
              {activeFilterCount > 0 && (
                <Badge className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]">
                  {activeFilterCount}
                </Badge>
              )}
              {showFilters ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </Button>

            {(activeFilterCount > 0 ||
              locationFilters.length > 0 ||
              search ||
              status !== "all") && (
              <Button
                type="button"
                variant="ghost"
                onClick={resetFilters}
                className="h-9 gap-1.5 rounded-md px-3 text-xs font-semibold text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {FILTER_GROUPS.map((group) => (
                <div
                  key={group.title}
                  className="space-y-2 rounded-lg border border-border bg-muted/20 p-3"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {group.title}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.fields.map((field) => (
                      <FilterFieldInput
                        key={field.kind === "payment" ? "payment" : field.column}
                        field={field}
                        values={filterValues}
                        onChange={setFilterValue}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Content>

      <Content>
        {columnOrder.isCustomOrder && (
          <ColumnOrderReset onReset={columnOrder.resetOrder} />
        )}
        <StickyHeaderTable
          className="min-w-max"
          containerClassName="rounded-md border"
          header={
            <ReorderableHeaderRow
              order={columnOrder.order}
              onMove={columnOrder.moveColumn}
            >
              {columnOrder.orderedColumns.map((column) => (
                <ReorderableTableHead
                  key={column.id}
                  column={column}
                  sort={{ currentSort: sort, onSort: handleSortChange }}
                />
              ))}
            </ReorderableHeaderRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: limit }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={27}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={27}
                  className="h-24 text-center text-muted-foreground"
                >
                  Data report kosong.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, idx) => (
                <TableRow key={`${row.spb_id}-${row.spb_dtl_id}-${idx}`}>
                  {columnOrder.order.map((id) => (
                    <Fragment key={id}>{renderCell(row, id)}</Fragment>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          currentPage={page}
          totalItems={total}
          limit={limit}
          itemLabel="Report SPB"
          onPageChange={setPage}
          onLimitChange={(v) => {
            setLimit(Number(v));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>
    </>
  );
}

function FilterFieldInput({
  field,
  values,
  onChange,
}: {
  field: FilterField;
  values: FilterValues;
  onChange: (key: string, value: string) => void;
}) {
  const inputClass =
    "h-8 border-input bg-background text-xs text-foreground";

  if (field.kind === "text") {
    return (
      <label className="space-y-1">
        <span className="text-[10px] font-semibold text-muted-foreground">
          {field.label}
        </span>
        <Input
          value={values[field.column] || ""}
          onChange={(e) => onChange(field.column, e.target.value)}
          placeholder={`Cari ${field.label.toLowerCase()}`}
          className={inputClass}
        />
      </label>
    );
  }

  if (field.kind === "number") {
    return (
      <div className="space-y-1">
        <span className="text-[10px] font-semibold text-muted-foreground">
          {field.label}
        </span>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            inputMode="decimal"
            value={values[`${field.column}__min`] || ""}
            onChange={(e) => onChange(`${field.column}__min`, e.target.value)}
            placeholder="Min"
            aria-label={`${field.label} minimum`}
            className={inputClass}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="number"
            inputMode="decimal"
            value={values[`${field.column}__max`] || ""}
            onChange={(e) => onChange(`${field.column}__max`, e.target.value)}
            placeholder="Max"
            aria-label={`${field.label} maksimum`}
            className={inputClass}
          />
        </div>
      </div>
    );
  }

  if (field.kind === "date") {
    return (
      <div className="space-y-1 sm:col-span-2">
        <span className="text-[10px] font-semibold text-muted-foreground">
          {field.label}
        </span>
        <div className="flex items-center gap-1">
          <DatePickerString
            value={values[`${field.column}__from`] || ""}
            onChange={(value) => onChange(`${field.column}__from`, value)}
            placeholder="Dari"
            className={`${inputClass} w-full`}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <DatePickerString
            value={values[`${field.column}__to`] || ""}
            onChange={(value) => onChange(`${field.column}__to`, value)}
            placeholder="Sampai"
            className={`${inputClass} w-full`}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <span className="text-[10px] font-semibold text-muted-foreground">
        {field.label}
      </span>
      <Select
        value={values.payment_status || "all"}
        onValueChange={(v) => onChange("payment_status", v === "all" ? "" : v)}
      >
        <SelectTrigger className={`${inputClass} w-full`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Semua</SelectItem>
          <SelectItem value="paid">Paid</SelectItem>
          <SelectItem value="unpaid">Unpaid</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
