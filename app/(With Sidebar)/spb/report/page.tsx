"use client";

import { useCallback, useEffect, useState } from "react";
import { FileBox, Download, Search } from "lucide-react";
import { useDebounce } from "use-debounce";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { DatePickerString } from "@/components/date-picker-string";
import { toast } from "sonner";
import { getSpbReport } from "@/services/spb-actions";
import * as XLSX from "xlsx";

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
  po_no?: string | null;
  so_no?: string | null;
  po_created_at?: string | null;
  do_no?: string | null;
  do_created_at?: string | null;
  invoice_no?: string | null;
  invoice_date?: string | null;
  invoice_email_date?: string | null;
};

function formatReportDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString("id-ID") : "-";
}

export default function SpbReportPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SpbReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [exporting, setExporting] = useState(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);
  const [status, setStatus] = useState<
    "all" | "no_po" | "no_do" | "no_invoice"
  >("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await getSpbReport({
      search: debouncedSearch || undefined,
      status,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
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
  }, [debouncedSearch, status, startDate, endDate, page, limit]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const first = await getSpbReport({
        search: debouncedSearch || undefined,
        status,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
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
          startDate: startDate || undefined,
          endDate: endDate || undefined,
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
        "TGL SPB": row.spb_tanggal
          ? new Date(row.spb_tanggal).toLocaleDateString("id-ID")
          : "-",
        "NO SPB": row.spb_no || "-",
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
        "DATE INPUT SPB": row.spb_created_at
          ? new Date(row.spb_created_at).toLocaleDateString("id-ID")
          : "-",
        STATUS: row.spb_status || "-",
        "NO PO": row.po_no || "-",
        "NO SO": row.so_no || "-",
        "DATE INPUT PO": row.po_created_at
          ? new Date(row.po_created_at).toLocaleDateString("id-ID")
          : "-",
        "NO DO": row.do_no || "-",
        "DATE INPUT DO": row.do_created_at
          ? new Date(row.do_created_at).toLocaleDateString("id-ID")
          : "-",
        "NO INVOICE": row.invoice_no || "-",
        "TGL INVOICE": row.invoice_date
          ? new Date(row.invoice_date).toLocaleDateString("id-ID")
          : "-",
        "TGL EMAIL": row.invoice_email_date
          ? new Date(row.invoice_email_date).toLocaleDateString("id-ID")
          : "-",
      }));

      const ws = XLSX.utils.json_to_sheet(data);
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
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <DatePickerString
                value={startDate}
                onChange={(value) => {
                  setStartDate(value);
                  setPage(1);
                }}
                placeholder="Tanggal dari"
                className="h-9 w-full border-input bg-background text-xs text-foreground sm:w-44"
              />
            </div>

            <div className="flex w-full items-center gap-2 sm:w-auto">
              <DatePickerString
                value={endDate}
                onChange={(value) => {
                  setEndDate(value);
                  setPage(1);
                }}
                placeholder="Tanggal sampai"
                className="h-9 w-full border-input bg-background text-xs text-foreground sm:w-44"
              />
            </div>
          </div>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>TGL SPB</TableHead>
                <TableHead>NO SPB</TableHead>
                <TableHead>PART NUMBER</TableHead>
                <TableHead>PART NAME</TableHead>
                <TableHead>QTY</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead>KODE UNIT</TableHead>
                <TableHead>TYPE UNIT</TableHead>
                <TableHead>BRAND</TableHead>
                <TableHead>HM</TableHead>
                <TableHead>REMARK</TableHead>
                <TableHead>SECTION</TableHead>
                <TableHead>PIC GMI</TableHead>
                <TableHead>PIC PPA</TableHead>
                <TableHead>NO WO</TableHead>
                <TableHead>DATE INPUT SPB</TableHead>
                <TableHead>STATUS</TableHead>
                <TableHead>NO PO</TableHead>
                <TableHead>NO SO</TableHead>
                <TableHead>DATE INPUT PO</TableHead>
                <TableHead>NO DO</TableHead>
                <TableHead>DATE INPUT DO</TableHead>
                <TableHead>NO INVOICE</TableHead>
                <TableHead>TGL INVOICE</TableHead>
                <TableHead>TGL EMAIL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={25}
                    className="text-center text-muted-foreground"
                  >
                    Memuat report...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={25}
                    className="text-center text-muted-foreground"
                  >
                    Data report kosong.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => (
                  <TableRow key={`${row.spb_id}-${row.spb_dtl_id}-${idx}`}>
                    <TableCell>{formatReportDate(row.spb_tanggal)}</TableCell>
                    <TableCell>{row.spb_no}</TableCell>
                    <TableCell>{row.dtl_spb_part_number}</TableCell>
                    <TableCell>{row.dtl_spb_part_name}</TableCell>
                    <TableCell>{row.dtl_spb_qty}</TableCell>
                    <TableCell>{row.dtl_spb_part_satuan}</TableCell>
                    <TableCell>{row.spb_kode_unit || "-"}</TableCell>
                    <TableCell>{row.spb_tipe_unit || "-"}</TableCell>
                    <TableCell>{row.spb_brand || "-"}</TableCell>
                    <TableCell>{row.spb_hm ?? "-"}</TableCell>
                    <TableCell>{row.spb_problem_remark || "-"}</TableCell>
                    <TableCell>{row.spb_section || "-"}</TableCell>
                    <TableCell>{row.spb_pic_gmi || "-"}</TableCell>
                    <TableCell>{row.spb_pic_ppa || "-"}</TableCell>
                    <TableCell>{row.spb_no_wo || "-"}</TableCell>
                    <TableCell>
                      {formatReportDate(row.spb_created_at)}
                    </TableCell>
                    <TableCell>{row.spb_status}</TableCell>
                    <TableCell>{row.po_no || "-"}</TableCell>
                    <TableCell>{row.so_no || "-"}</TableCell>
                    <TableCell>{formatReportDate(row.po_created_at)}</TableCell>
                    <TableCell>{row.do_no || "-"}</TableCell>
                    <TableCell>{formatReportDate(row.do_created_at)}</TableCell>
                    <TableCell>{row.invoice_no || "-"}</TableCell>
                    <TableCell>{formatReportDate(row.invoice_date)}</TableCell>
                    <TableCell>
                      {formatReportDate(row.invoice_email_date)}
                    </TableCell>
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
          itemLabel="Report SPB"
        />
      </Content>
    </>
  );
}
