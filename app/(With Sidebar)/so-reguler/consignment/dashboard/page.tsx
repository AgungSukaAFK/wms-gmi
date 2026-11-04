"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  LayoutDashboard,
  ListChecks,
  RefreshCw,
} from "lucide-react";
import { Content } from "@/components/content";
import { ListSearchInput } from "@/components/list-search-input";
import {
  ColumnOrderReset,
  ReorderableHeaderRow,
  ReorderableTableHead,
} from "@/components/reorderable-table-head";
import { StickyHeaderTable } from "@/components/sticky-header-table";
import { TablePaginationFooter } from "@/components/table-pagination-footer";
import { Skeleton } from "@/components/ui/skeleton";
import { useColumnOrder } from "@/hooks/use-column-order";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import { TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import {
  getConsignmentDashboardReport,
  getConsignmentPerformanceReport,
  type ConsignmentPerformanceData,
} from "@/services/consignment-so-actions";
import { formatDate } from "@/lib/utils";
import { ConsignmentPerformanceTab } from "@/components/consignment/consignment-performance-tab";

type DashboardRow = {
  so_id: number;
  item_id: number;
  so_no: string | null;
  so_tanggal_input: string | null;
  tgl_po_email_marketing: string | null;
  tgl_po_customer: string | null;
  due_date: string | null;
  no_po: string | null;
  site: string | null;
  customer_name: string | null;
  part_number: string | null;
  part_name: string | null;
  qty: number | null;
  satuan: string | null;
  part_number_customer: string | null;
  total_qty_ik: number | null;
  no_ik_terakhir: string | null;
  tgl_ik_terakhir: string | null;
  no_awb_terakhir: string | null;
  gudang_terakhir: string | null;
  partial_full: string | null;
  durasi_kirim_ik_so: number | null;
};

type Column = {
  key: string;
  label: string;
  sortKey?: string;
  render: (row: DashboardRow) => React.ReactNode;
};

const DASH = () => <span className="text-muted-foreground/50">-</span>;

// Kolom fase SO (sudah ada datanya) + kolom fase berikutnya (supply,
// pengiriman IT, PR/PO GMI, rekonsiliasi) yang masih placeholder sampai
// tabel pendukungnya dibuat.
const COLUMNS: Column[] = [
  {
    key: "so_tanggal_input",
    label: "Tgl Input SO",
    sortKey: "so_tanggal_input",
    render: (r) => (r.so_tanggal_input ? formatDate(r.so_tanggal_input) : <DASH />),
  },
  {
    key: "so_no",
    label: "No. SO",
    sortKey: "so_no",
    render: (r) => r.so_no || <DASH />,
  },
  {
    key: "tgl_po_email_marketing",
    label: "Tgl Email PO Marketing",
    render: (r) => (r.tgl_po_email_marketing ? formatDate(r.tgl_po_email_marketing) : <DASH />),
  },
  {
    key: "tgl_po_customer",
    label: "Tgl PO Customer",
    render: (r) => (r.tgl_po_customer ? formatDate(r.tgl_po_customer) : <DASH />),
  },
  {
    key: "due_date",
    label: "Due Date",
    sortKey: "due_date",
    render: (r) => (r.due_date ? formatDate(r.due_date) : <DASH />),
  },
  { key: "no_po", label: "No. PO", render: (r) => r.no_po || <DASH /> },
  {
    key: "customer_name",
    label: "Customer",
    sortKey: "customer_name",
    render: (r) => r.customer_name || <DASH />,
  },
  {
    key: "part_number",
    label: "PN GMI / Deskripsi",
    sortKey: "part_number",
    render: (r) =>
      r.part_number ? (
        <div className="max-w-48">
          <span className="block text-xs font-bold">{r.part_number}</span>
          {r.part_name && (
            <span className="block text-[10px] text-muted-foreground truncate">
              {r.part_name}
            </span>
          )}
        </div>
      ) : (
        <DASH />
      ),
  },
  { key: "qty", label: "Qty", render: (r) => r.qty ?? <DASH /> },
  { key: "satuan", label: "UOM", render: (r) => r.satuan || <DASH /> },
  { key: "site", label: "Site", render: (r) => r.site || <DASH /> },

  // --- Cek supply / stok (menyusul) ---
  { key: "h_due_date_po_in", label: "H- Due Date PO In", render: DASH },
  { key: "remarks_supply", label: "Remarks Supply", render: DASH },
  { key: "gmi_ho", label: "GMI-HO", render: DASH },
  { key: "gmi_bpp", label: "GMI-BPP", render: DASH },
  { key: "total_stock", label: "Total", render: DASH },
  { key: "os_soh_jkt", label: "OS - SOH JKT", render: DASH },
  { key: "os_soh_bpn", label: "OS - SOH BPN", render: DASH },
  { key: "remarks_warehouse", label: "Remarks Warehouse", render: DASH },
  { key: "ready_stock", label: "Ready Stock / Non Stock", render: DASH },

  // --- Pengiriman internal / IT (menyusul) ---
  { key: "no_it", label: "No IT", render: DASH },
  { key: "tgl_kirim_ho_bpn", label: "Tgl Kirim HO → BPN", render: DASH },
  { key: "ekspedisi", label: "Ekspedisi", render: DASH },
  { key: "tgl_kirim_cust", label: "Tgl Kirim ke Cust", render: DASH },

  // --- Item Konsinyasi (IK) — otomatis dari fitur Item Konsinyasi ---
  {
    key: "no_ik_terakhir",
    label: "No. IK",
    render: (r) => r.no_ik_terakhir || <DASH />,
  },
  {
    key: "tgl_ik_terakhir",
    label: "Tgl IK",
    render: (r) => (r.tgl_ik_terakhir ? formatDate(r.tgl_ik_terakhir) : <DASH />),
  },
  {
    key: "no_awb_terakhir",
    label: "No AWB",
    render: (r) => r.no_awb_terakhir || <DASH />,
  },
  {
    key: "total_qty_ik",
    label: "Qty Kirim IK",
    render: (r) => r.total_qty_ik ?? <DASH />,
  },
  { key: "pic_tarik_ik", label: "PIC Tarik IK", render: DASH },
  {
    key: "gudang_terakhir",
    label: "Asal → Tujuan",
    render: (r) => r.gudang_terakhir || <DASH />,
  },
  {
    key: "partial_full",
    label: "Partial/Full",
    render: (r) => r.partial_full || <DASH />,
  },

  // --- Procurement / PR-PO GMI (menyusul) ---
  { key: "tgl_pr", label: "Tgl PR", render: DASH },
  { key: "no_pr", label: "No PR", render: DASH },
  { key: "qty_pr", label: "Qty (PR)", render: DASH },
  { key: "po_gmi", label: "PO GMI", render: DASH },
  { key: "tgl_po_gmi", label: "Tanggal PO GMI", render: DASH },
  { key: "qty_po_gmi", label: "Qty (PO GMI)", render: DASH },
  { key: "remarks_pr", label: "Remarks", render: DASH },
  { key: "estimasi_kedatangan", label: "Estimasi Tgl Kedatangan", render: DASH },

  // --- Rekonsiliasi (menyusul) ---
  { key: "tgl_rekonsil", label: "Tgl Rekonsil", render: DASH },
  { key: "no_doc_rekonsil", label: "No Doc Rekonsil", render: DASH },
  { key: "note_rekonsil", label: "Note", render: DASH },
  { key: "qty_rekonsil", label: "Qty Rekonsil", render: DASH },
  { key: "selisih", label: "Selisih", render: DASH },
  { key: "ket_rekonsil", label: "Ket Rekonsil", render: DASH },
  { key: "no_do_after_rekonsil", label: "No DO After Rekonsil", render: DASH },

  // --- Metrik lead time (menyusul) ---
  { key: "durasi_pr_po_out", label: "Tgl PR - Tgl PO Out", render: DASH },
  {
    key: "durasi_kirim_ik_so",
    label: "Tgl Kirim IK - Tgl SO",
    render: (r) =>
      r.durasi_kirim_ik_so !== null && r.durasi_kirim_ik_so !== undefined
        ? `${r.durasi_kirim_ik_so} hari`
        : <DASH />,
  },
  { key: "durasi_kirim_gmi_do", label: "Tgl Kirim GMI - Tgl DO PO Out", render: DASH },
];

// Harus sama dengan kolom yang dicari di getConsignmentDashboardReport.
const DASHBOARD_SEARCH_FIELDS = [
  "No. SO",
  "No. PO",
  "Site",
  "Part Number",
  "Nama Barang",
  "PN Customer",
];

// Id kolom = `key`; sort memakai `sortKey`.
const DASHBOARD_COLUMNS = COLUMNS.map((col) => ({
  ...col,
  id: col.key,
  sortDirection: col.sortKey ? ("asc" as const) : undefined,
  className:
    "whitespace-nowrap text-[10px] font-black uppercase text-muted-foreground",
}));

export default function DashboardConsignmentPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [total, setTotal] = useState(0);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder(
    "wms:table-column-order:consignment-dashboard",
    DASHBOARD_COLUMNS,
  );
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [search, setSearch] = useUrlSearchInput(debouncedSearch, (value) =>
    urlState.set({ search: value }, { resetPage: true }),
  );
  const sort = urlState.get("sort", "so_tanggal_input_desc");
  const setSort = (v: string) =>
    urlState.set({ sort: v === "so_tanggal_input_desc" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  const [activeTab, setActiveTab] = useState("tracking");
  const [perfMonths, setPerfMonths] = useState(6);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfData, setPerfData] = useState<ConsignmentPerformanceData | null>(
    null,
  );
  // Key data yang sudah dimuat ("6") -- null = perlu dimuat ulang.
  const [perfLoadedKey, setPerfLoadedKey] = useState<string | null>(null);

  const loadPerformance = useCallback(async (months: number) => {
    setPerfLoading(true);
    const res = await getConsignmentPerformanceReport({ months });
    if (res.error) toast.error(res.error);
    else setPerfData(res);
    setPerfLoadedKey(String(months));
    setPerfLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab !== "performance" || perfLoading) return;
    if (perfLoadedKey === String(perfMonths)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPerformance(perfMonths);
  }, [activeTab, perfMonths, perfLoadedKey, perfLoading, loadPerformance]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await getConsignmentDashboardReport({
      search: debouncedSearch || undefined,
      sort,
      page,
      limit,
    });
    if (res.error) {
      toast.error(res.error);
      setRows([]);
      setTotal(0);
    } else {
      setRows((res.data || []) as DashboardRow[]);
      setTotal(res.count || 0);
    }
    setLoading(false);
  }, [debouncedSearch, sort, page, limit]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const handleSortChange = (nextSort: string) => {
    setSort(nextSort);
    setPage(1);
  };

  return (
    <>
      <Content>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
              <LayoutDashboard className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight uppercase">
                Dashboard Consignment
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Tracking penuh proses SO Consignment
              </p>
            </div>
          </div>
        </div>
      </Content>

      <Content>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="h-9">
              <TabsTrigger
                value="tracking"
                className="gap-1.5 text-xs font-bold uppercase"
              >
                <ListChecks className="h-3.5 w-3.5" /> Tracking
              </TabsTrigger>
              <TabsTrigger
                value="performance"
                className="gap-1.5 text-xs font-bold uppercase"
              >
                <BarChart3 className="h-3.5 w-3.5" /> Performance
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {activeTab === "performance" && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">
                Periode
              </span>
              <Select
                value={String(perfMonths)}
                onValueChange={(v) => setPerfMonths(Number(v))}
              >
                <SelectTrigger className="h-9 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 bulan terakhir</SelectItem>
                  <SelectItem value="6">6 bulan terakhir</SelectItem>
                  <SelectItem value="12">12 bulan terakhir</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                disabled={perfLoading}
                onClick={() => loadPerformance(perfMonths)}
                title="Muat ulang data"
              >
                <RefreshCw
                  className={perfLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"}
                />
              </Button>
            </div>
          )}
        </div>
      </Content>

      {activeTab === "performance" ? (
        <ConsignmentPerformanceTab data={perfData} loading={perfLoading} />
      ) : (
        <>
          <Content>
            <ListSearchInput
              placeholder="Cari No. SO, No. PO, Part, atau Site..."
              value={search}
              onChange={setSearch}
              searchableFields={DASHBOARD_SEARCH_FIELDS}
            />
            <p className="mt-2 text-[10px] font-medium text-muted-foreground">
              Kolom fase supply, pengiriman, PR/PO GMI, dan rekonsiliasi masih
              placeholder (&ldquo;-&rdquo;) &mdash; akan diisi setelah fitur tahap
              berikutnya dibangun.
            </p>
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
                      <TableCell colSpan={COLUMNS.length}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={COLUMNS.length}
                      className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                    >
                      {debouncedSearch
                        ? "Tidak ada data yang sesuai pencarian."
                        : "Belum ada data SO Consignment"}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.item_id}>
                      {columnOrder.orderedColumns.map((col) => (
                        <TableCell key={col.key} className="whitespace-nowrap text-xs">
                          {col.render(row)}
                        </TableCell>
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
              itemLabel="Item SO Consignment"
              onPageChange={setPage}
              onLimitChange={(v) => {
                setLimit(Number(v));
                setPage(1);
              }}
              className="mt-6"
            />
          </Content>
        </>
      )}
    </>
  );
}
