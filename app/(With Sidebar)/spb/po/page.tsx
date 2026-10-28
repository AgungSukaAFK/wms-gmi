"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Printer,
  Search,
  ShieldAlert,
  ShoppingCart,
} from "lucide-react";
import { Content } from "@/components/content";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { DatePickerString } from "@/components/date-picker-string";
import { CreateSpbPoDialog } from "@/components/spb/create-spb-po-dialog";
import { getSpbPoList, updateSpbPo } from "@/services/spb-actions";
import { useDebounce } from "use-debounce";
import { formatDate, ymdToLocalStartIso } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

export default function SpbPoPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState("created_at_desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);

  const [openCreateModal, setOpenCreateModal] = useState(false);

  // Moderator Edit state
  const [isModerator, setIsModerator] = useState(false);
  const [modOpen, setModOpen] = useState(false);
  const [modSaving, setModSaving] = useState(false);
  const [modRow, setModRow] = useState<any>(null);
  const [modSoNo, setModSoNo] = useState("");
  const [modSoDate, setModSoDate] = useState("");

  const fetchList = async () => {
    setLoading(true);
    const res = await getSpbPoList({
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
      setRows(res.data || []);
      setTotal(res.count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchList();
  }, [debouncedSearch, sort, page, limit]);

  const handleSortChange = (nextSort: string) => {
    setSort(nextSort);
    setPage(1);
  };

  useEffect(() => {
    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        const { data: roleRows } = await supabase
          .from("user_roles")
          .select("roles(name)")
          .eq("user_id", user.id);
        setIsModerator(
          (roleRows || []).some((r: any) => r.roles?.name === "moderator"),
        );
      }
    };
    loadUser();
  }, [supabase]);

  const openModEdit = (row: any) => {
    setModRow(row);
    setModSoNo(row.so_no || "");
    setModSoDate(row.so_date ? String(row.so_date).slice(0, 10) : "");
    setModOpen(true);
  };

  const handleModSave = async () => {
    if (!modRow) return;
    setModSaving(true);
    const res = await updateSpbPo(modRow.id, {
      so_no: modSoNo || null,
      so_date: modSoDate ? ymdToLocalStartIso(modSoDate) : null,
    });
    if (res.error) {
      toast.error(res.error);
      setModSaving(false);
      return;
    }
    toast.success("Moderator Edit berhasil disimpan.");
    setModOpen(false);
    setModSaving(false);
    fetchList();
  };

  return (
    <>
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                PURCHASE ORDER (SPB)
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Attach PO ke SPB
              </p>
            </div>
          </div>

          <Button
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
            onClick={() => setOpenCreateModal(true)}
          >
            <Plus className="h-4 w-4" /> BUAT SPB-PO
          </Button>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="space-y-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1 xl:min-w-70">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Cari No PO atau No SO"
                className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium text-foreground transition-all focus:bg-background"
              />
            </div>
          </div>

          <div className="rounded-lg border">
            <Table containerClassName="max-h-[75vh] overflow-y-auto">
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card [&_th]:shadow-[0_2px_4px_-2px_rgba(0,0,0,0.15)]">
                <TableRow>
                  <TableHead>No SPB</TableHead>
                  <SortableTableHead
                    sortKey="po_no"
                    currentSort={sort}
                    onSort={handleSortChange}
                  >
                    No PO
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="so_no"
                    currentSort={sort}
                    onSort={handleSortChange}
                  >
                    No SO
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="so_date"
                    currentSort={sort}
                    onSort={handleSortChange}
                    defaultDir="desc"
                  >
                    SO Date
                  </SortableTableHead>
                  <TableHead>Lokasi</TableHead>
                  <TableHead>Item Count</TableHead>
                  <SortableTableHead
                    sortKey="created_at"
                    currentSort={sort}
                    onSort={handleSortChange}
                    defaultDir="desc"
                  >
                    Created
                  </SortableTableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center text-muted-foreground"
                    >
                      Memuat data...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center text-muted-foreground"
                    >
                      Belum ada data SPB-PO.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.spb?.spb_no || "-"}</TableCell>
                      <TableCell className="font-medium">{row.po_no}</TableCell>
                      <TableCell>{row.so_no || "-"}</TableCell>
                      <TableCell>
                        {formatDate(row.so_date)}
                      </TableCell>
                      <TableCell>{row.spb?.spb_gudang || "-"}</TableCell>
                      <TableCell>{row.details?.length || 0}</TableCell>
                      <TableCell>
                        {formatDate(row.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              window.open(`/spb/po/print/${row.id}`, "_blank")
                            }
                          >
                            <Printer className="mr-1.5 h-3.5 w-3.5" />
                            Cetak
                          </Button>
                          {isModerator && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 border-amber-300 text-amber-600 hover:bg-amber-50"
                              onClick={() => openModEdit(row)}
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                              Moderator Edit
                            </Button>
                          )}
                        </div>
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
            itemLabel="SPB PO"
          />
        </div>
      </Content>

      <CreateSpbPoDialog
        open={openCreateModal}
        onOpenChange={setOpenCreateModal}
        onCreated={fetchList}
      />

      <Dialog open={modOpen} onOpenChange={setModOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Moderator Edit — SPB PO {modRow?.po_no}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>No SO</Label>
              <Input value={modSoNo} onChange={(e) => setModSoNo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Tanggal SO</Label>
              <DatePickerString value={modSoDate} onChange={setModSoDate} />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setModOpen(false)}
              disabled={modSaving}
            >
              Batal
            </Button>
            <Button onClick={handleModSave} disabled={modSaving}>
              {modSaving ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
