"use client";

import React, { useCallback, useEffect, useState } from "react";
import { LayoutDashboard, Search } from "lucide-react";
import { useDebounce } from "use-debounce";
import { Content } from "@/components/content";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { toast } from "sonner";
import { getConsignmentDashboardReport } from "@/services/consignment-so-actions";
import { formatDate } from "@/lib/utils";

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
  code_item_customer: string | null;
  part_number: string | null;
  part_name: string | null;
  qty: number | null;
  satuan: string | null;
  part_number_customer: string | null;
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
    key: "code_item_customer",
    label: "Code Item Customer",
    render: (r) => r.code_item_customer || <DASH />,
  },
  {
    key: "part_number",
    label: "Part Number",
    sortKey: "part_number",
    render: (r) => r.part_number || <DASH />,
  },
  { key: "part_name", label: "Deskripsi Barang", render: (r) => r.part_name || <DASH /> },
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
  { key: "no_awb", label: "No AWB", render: DASH },
  { key: "tgl_kirim_cust", label: "Tgl Kirim ke Cust", render: DASH },
  { key: "no_ik", label: "No. IK", render: DASH },
  { key: "qty_kirim_ik", label: "Qty Kirim IK", render: DASH },
  { key: "pic_tarik_ik", label: "PIC Tarik IK", render: DASH },
  { key: "gudang", label: "Gudang", render: DASH },
  { key: "partial_full", label: "Partial/Full", render: DASH },

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
  { key: "durasi_kirim_ik_so", label: "Tgl Kirim IK - Tgl SO", render: DASH },
  { key: "durasi_kirim_gmi_do", label: "Tgl Kirim GMI - Tgl DO PO Out", render: DASH },
];

export default function DashboardConsignmentPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);
  const [sort, setSort] = useState("so_tanggal_input_desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

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
        <div className="relative min-w-0 flex-1 xl:max-w-100">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Cari No. SO, No. PO, Part, atau Site..."
            className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium"
          />
        </div>
        <p className="mt-2 text-[10px] font-medium text-muted-foreground">
          Kolom fase supply, pengiriman, PR/PO GMI, dan rekonsiliasi masih
          placeholder (&ldquo;-&rdquo;) &mdash; akan diisi setelah fitur tahap
          berikutnya dibangun.
        </p>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((col) =>
                  col.sortKey ? (
                    <SortableTableHead
                      key={col.key}
                      sortKey={col.sortKey}
                      currentSort={sort}
                      onSort={handleSortChange}
                      className="whitespace-nowrap text-[10px] font-black uppercase text-muted-foreground"
                    >
                      {col.label}
                    </SortableTableHead>
                  ) : (
                    <TableHead
                      key={col.key}
                      className="whitespace-nowrap text-[10px] font-black uppercase text-muted-foreground"
                    >
                      {col.label}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={COLUMNS.length}
                    className="h-24 text-center text-xs text-muted-foreground"
                  >
                    Memuat dashboard...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={COLUMNS.length}
                    className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Belum ada data SO Consignment
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.item_id}>
                    {COLUMNS.map((col) => (
                      <TableCell key={col.key} className="whitespace-nowrap text-xs">
                        {col.render(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DataTablePagination
          totalCount={total}
          pageSize={limit}
          currentPage={page}
          onPageChange={setPage}
          onPageSizeChange={(v) => {
            setLimit(Number(v));
            setPage(1);
          }}
          itemLabel="Item SO Consignment"
        />
      </Content>
    </>
  );
}
