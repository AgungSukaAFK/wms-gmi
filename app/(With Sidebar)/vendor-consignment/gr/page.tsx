"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Loader2, PackageCheck, Eye, Trash2, Printer, CheckCircle2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import {
  type ActiveFilter,
  FilterField,
  FilterFields,
  FilterPanel,
  FilterRange,
  FilterRangeFields,
  formatFilterDate,
  formatFilterRange,
} from "@/components/filter-panel";
import { DatePickerString } from "@/components/date-picker-string";
import { ListSearchInput } from "@/components/list-search-input";
import {
  ColumnOrderReset,
  ReorderableHeaderRow,
  ReorderableTableHead,
  type ReorderableColumn,
} from "@/components/reorderable-table-head";
import { StickyHeaderTable } from "@/components/sticky-header-table";
import { TablePaginationFooter } from "@/components/table-pagination-footer";
import { Skeleton } from "@/components/ui/skeleton";
import { useColumnOrder } from "@/hooks/use-column-order";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import { sortRows } from "@/lib/client-sort";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { VendorPicker, type VendorOption } from "@/components/vendor-consignment/vendor-picker";
import {
  deleteConsignmentGr,
  getConsignmentGrList,
  resolveConsignmentGrComplaint,
} from "@/services/vendor-consignment-actions";

// Harus sama dengan kolom yang dicari di `filtered`.
const GR_SEARCH_FIELDS = ["Kode GR", "Surat Jalan", "Kode PR", "Vendor"];

const GR_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di getGrSortValue.
const GR_COLUMNS = [
  { id: "gr_kode", label: "Kode GR", sortDirection: "asc", className: GR_HEAD_CLASS },
  { id: "gr_tanggal", label: "Tanggal", sortDirection: "desc", className: GR_HEAD_CLASS },
  { id: "pr", label: "PR", sortDirection: "asc", className: GR_HEAD_CLASS },
  { id: "vendor", label: "Vendor", sortDirection: "asc", className: GR_HEAD_CLASS },
  { id: "gudang", label: "Gudang", sortDirection: "asc", className: GR_HEAD_CLASS },
  { id: "no_surat_jalan", label: "Surat Jalan", sortDirection: "asc", className: GR_HEAD_CLASS },
  { id: "sesuai", label: "Sesuai / Kirim", className: `text-center ${GR_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type GrColumnId = (typeof GR_COLUMNS)[number]["id"];

const getGrSortValue = (gr: any, key: string) => {
  if (key === "pr") return gr.prs?.pr_kode;
  if (key === "vendor") return gr.vendors?.vendor_name;
  if (key === "gudang") return gr.cabang?.nama_cabang;
  return gr[key];
};

export default function ConsignmentGrPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [isModeratorOrAdmin, setIsModeratorOrAdmin] = useState(false);
  const columnOrder = useColumnOrder("wms:table-column-order:vendor-consignment-gr", GR_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const komplainFilter = urlState.get("komplain", "all");
  const setKomplainFilter = (v: string) =>
    urlState.set({ komplain: v === "all" ? "" : v }, { resetPage: true });
  const dateFrom = urlState.get("dari");
  const setDateFrom = (v: string) =>
    urlState.set({ dari: v }, { resetPage: true });
  const dateTo = urlState.get("sampai");
  const setDateTo = (v: string) =>
    urlState.set({ sampai: v }, { resetPage: true });
  const sortOrder = urlState.get("sort", "");
  const setSortOrder = (v: string) => urlState.set({ sort: v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  const [detailId, setDetailId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [resolveTarget, setResolveTarget] = useState<any | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolving, setResolving] = useState(false);

  const [bastOpen, setBastOpen] = useState(false);
  const [bastVendor, setBastVendor] = useState<VendorOption | null>(null);
  const [bastBulan, setBastBulan] = useState(new Date().toISOString().slice(0, 7));

  const load = async () => {
    setLoading(true);
    const res = await getConsignmentGrList();
    if (res.error) toast.error(res.error);
    setRows(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: roleRows } = await supabase.from("user_roles").select("roles(name)").eq("user_id", user.id);
      const roleNames = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
      setIsModeratorOrAdmin(roleNames.some((r: string) => r === "moderator" || r === "admin"));
    };
    init();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasOpenComplaint = (gr: any) =>
    (gr.vendor_consignment_gr_items || []).some((i: any) => i.resolution_status === "open");

  const filtered = rows.filter((gr) => {
    if (komplainFilter === "open" && !hasOpenComplaint(gr)) return false;
    const tanggal = (gr.gr_tanggal || "").slice(0, 10);
    if (dateFrom && tanggal < dateFrom) return false;
    if (dateTo && tanggal > dateTo) return false;
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    return (
      gr.gr_kode?.toLowerCase().includes(q) ||
      gr.no_surat_jalan?.toLowerCase().includes(q) ||
      gr.prs?.pr_kode?.toLowerCase().includes(q) ||
      gr.vendors?.vendor_name?.toLowerCase().includes(q)
    );
  });

  const sorted = sortRows(filtered, sortOrder, getGrSortValue);
  const totalCount = sorted.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(totalCount / limit)));
  const pageRows = sorted.slice((safePage - 1) * limit, safePage * limit);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const detail = rows.find((r) => r.id === detailId) || null;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await deleteConsignmentGr(deleteTarget.id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("GR dihapus, stok konsinyasinya sudah dikurangi kembali.");
    load();
  };

  const handleResolve = async () => {
    if (!resolveTarget) return;
    setResolving(true);
    const res = await resolveConsignmentGrComplaint(resolveTarget.id, resolveNote);
    setResolving(false);
    if (res.error) return toast.error(res.error);
    toast.success("Komplain ditandai selesai.");
    setResolveTarget(null);
    setResolveNote("");
    load();
  };

  const resetFilters = () => {
    resetSearchQuery();
    urlState.reset();
  };

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const activeFilters: ActiveFilter[] = [];
  if (komplainFilter === "open")
    activeFilters.push({
      key: "komplain",
      label: "Komplain",
      value: "Belum selesai",
      onRemove: () => setKomplainFilter("all"),
    });
  if (dateFrom || dateTo)
    activeFilters.push({
      key: "tanggal",
      label: "Tanggal",
      value: formatFilterRange(dateFrom, dateTo, formatFilterDate),
      onRemove: () => urlState.set({ dari: "", sampai: "" }, { resetPage: true }),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (gr: any, id: GrColumnId) => {
    const items = gr.vendor_consignment_gr_items || [];
    const terima = items.reduce((a: number, i: any) => a + i.qty_terima, 0);
    const kirim = items.reduce((a: number, i: any) => a + i.qty_kirim, 0);

    switch (id) {
      case "gr_kode":
        return (
          <TableCell className="font-bold text-xs">
            {gr.gr_kode}
            {hasOpenComplaint(gr) && (
              <Badge variant="destructive" className="ml-1.5 text-[9px] font-bold">
                Komplain
              </Badge>
            )}
          </TableCell>
        );
      case "gr_tanggal":
        return (
          <TableCell className="text-xs whitespace-nowrap">{formatDate(gr.gr_tanggal)}</TableCell>
        );
      case "pr":
        return (
          <TableCell className="text-xs">
            <Link href={`/pr/${gr.pr_id}`} className="hover:underline">
              {gr.prs?.pr_kode || "-"}
            </Link>
          </TableCell>
        );
      case "vendor":
        return (
          <TableCell className="text-xs">{gr.vendors?.vendor_name || "-"}</TableCell>
        );
      case "gudang":
        return (
          <TableCell className="text-xs">{gr.cabang?.nama_cabang || "-"}</TableCell>
        );
      case "no_surat_jalan":
        return (
          <TableCell className="text-xs">{gr.no_surat_jalan}</TableCell>
        );
      case "sesuai":
        return (
          <TableCell className="text-center text-xs font-bold">
            {terima} / {kirim}
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
              <PackageCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">GR Konsinyasi</h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Penerimaan barang titipan supplier di WH HO / Branch
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-9 gap-2 text-xs font-bold uppercase" onClick={() => setBastOpen(true)}>
              <Printer className="h-4 w-4" /> BAST Bulanan
            </Button>
            <Link href="/vendor-consignment/gr/create">
              <Button className="h-9 gap-2 text-xs font-bold uppercase">
                <Plus className="h-4 w-4" /> Terima Barang
              </Button>
            </Link>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari kode GR, PR, surat jalan, vendor..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={GR_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Komplain">
                <Select value={komplainFilter} onValueChange={setKomplainFilter}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua GR</SelectItem>
                    <SelectItem value="open">Komplain belum selesai</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tanggal GR">
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
            </FilterRangeFields>
          </FilterPanel>
        </div>
      </Content>

      <Content>
        {columnOrder.isCustomOrder && (
          <ColumnOrderReset onReset={columnOrder.resetOrder} />
        )}
        <StickyHeaderTable
          className="min-w-[1100px]"
          containerClassName="rounded-md border"
          header={
            <ReorderableHeaderRow
              order={columnOrder.order}
              onMove={columnOrder.moveColumn}
              className="hover:bg-transparent h-10"
            >
              {columnOrder.orderedColumns.map((column) => (
                <ReorderableTableHead
                  key={column.id}
                  column={column}
                  sort={{ currentSort: sortOrder, onSort: handleSortChange }}
                />
              ))}
              <TableHead className="w-20 text-right pr-4 text-[10px] font-black uppercase text-muted-foreground">
                Aksi
              </TableHead>
            </ReorderableHeaderRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(limit, 25) }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter"
                    : "Belum ada GR Konsinyasi"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((gr) => (
                <TableRow key={gr.id}>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(gr, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => setDetailId(gr.id)}
                      >
                        <Eye className="mr-2 h-4 w-4" /> Lihat Detail
                      </DropdownMenuItem>
                      {isModeratorOrAdmin && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setDeleteTarget(gr)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Hapus
                        </DropdownMenuItem>
                      )}
                    </RowActionsMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          currentPage={safePage}
          totalItems={totalCount}
          limit={limit}
          itemLabel="GR"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.gr_kode}</DialogTitle>
            <DialogDescription>
              PR {detail?.prs?.pr_kode} · {detail?.vendors?.vendor_name} · {detail?.cabang?.nama_cabang} · SJ{" "}
              {detail?.no_surat_jalan}
              {detail?.catatan ? ` · ${detail.catatan}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-9">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Kirim</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Sesuai</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Komplain</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detail?.vendor_consignment_gr_items || []).map((i: any) => (
                  <TableRow key={i.id} className="h-12">
                    <TableCell>
                      <code className="block text-xs font-bold">{i.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground">{i.part_name}</span>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {i.qty_kirim} {i.satuan}
                    </TableCell>
                    <TableCell className="text-right text-xs font-bold">{i.qty_terima}</TableCell>
                    <TableCell className="text-xs max-w-64">
                      {i.status === "komplain" ? (
                        <div className="space-y-1">
                          <p>{i.catatan_komplain}</p>
                          {i.resolution_status === "selesai" && (
                            <p className="text-[10px] text-green-700">Selesai: {i.catatan_resolusi}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {i.resolution_status === "open" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-[10px]"
                          onClick={() => setResolveTarget(i)}
                        >
                          <CheckCircle2 className="h-3 w-3" /> Tandai Selesai
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolveTarget} onOpenChange={(o) => !o && setResolveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Selesaikan komplain {resolveTarget?.part_number}</DialogTitle>
            <DialogDescription>{resolveTarget?.catatan_komplain}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Catatan penyelesaian</Label>
            <Input
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="mis. sudah diretur, diganti lewat GR-xxxx"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolveTarget(null)}>
              Batal
            </Button>
            <Button onClick={handleResolve} disabled={resolving}>
              {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bastOpen} onOpenChange={setBastOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>BAST Serah Terima Bulanan</DialogTitle>
            <DialogDescription>
              Rekap barang konsinyasi yang diterima dalam satu bulan, ditandatangani GMI & supplier.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Vendor</Label>
              <VendorPicker value={bastVendor} onChange={setBastVendor} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bulan</Label>
              <Input type="month" value={bastBulan} onChange={(e) => setBastBulan(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!bastVendor || !bastBulan}
              onClick={() =>
                window.open(`/vendor-consignment/gr/bast?vendor=${bastVendor!.id}&bulan=${bastBulan}`, "_blank")
              }
            >
              <Printer className="h-4 w-4" /> Cetak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        destructive
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Hapus GR ${deleteTarget?.gr_kode ?? ""}?`}
        description="Stok konsinyasi yang masuk lewat GR ini akan dikurangi kembali. Ditolak kalau barangnya sudah ditransfer/dipakai. Tindakan ini tidak bisa dibatalkan."
        confirmText="Hapus"
        onConfirm={handleDelete}
      />
    </>
  );
}
