"use client";

import { useEffect, useState } from "react";
import { FileBox, Search } from "lucide-react";
import { useDebounce } from "use-debounce";
import { Content } from "@/components/content";
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

export default function SpbReportPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);
  const [status, setStatus] = useState<
    "all" | "no_po" | "no_do" | "no_invoice"
  >("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const fetchData = async () => {
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
  };

  useEffect(() => {
    fetchData();
  }, [debouncedSearch, status, startDate, endDate, page, limit]);

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
                    <TableCell>
                      {new Date(row.spb_tanggal).toLocaleDateString("id-ID")}
                    </TableCell>
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
                      {row.spb_created_at
                        ? new Date(row.spb_created_at).toLocaleDateString(
                            "id-ID",
                          )
                        : "-"}
                    </TableCell>
                    <TableCell>{row.spb_status}</TableCell>
                    <TableCell>{row.po_no || "-"}</TableCell>
                    <TableCell>{row.so_no || "-"}</TableCell>
                    <TableCell>
                      {row.po_created_at
                        ? new Date(row.po_created_at).toLocaleDateString(
                            "id-ID",
                          )
                        : "-"}
                    </TableCell>
                    <TableCell>{row.do_no || "-"}</TableCell>
                    <TableCell>
                      {row.do_created_at
                        ? new Date(row.do_created_at).toLocaleDateString(
                            "id-ID",
                          )
                        : "-"}
                    </TableCell>
                    <TableCell>{row.invoice_no || "-"}</TableCell>
                    <TableCell>
                      {row.invoice_date
                        ? new Date(row.invoice_date).toLocaleDateString("id-ID")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {row.invoice_email_date
                        ? new Date(row.invoice_email_date).toLocaleDateString(
                            "id-ID",
                          )
                        : "-"}
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
