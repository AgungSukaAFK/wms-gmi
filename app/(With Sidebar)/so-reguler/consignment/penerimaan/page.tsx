"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
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
  Plus,
  Loader2,
  PackageCheck,
  Trash2,
  Eye,
  MessageSquareWarning,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Content } from "@/components/content";
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
import { DatePickerString } from "@/components/date-picker-string";
import { MultiSelect } from "@/components/ui/multi-select";
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
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import {
  getConsignmentPenerimaanList,
  deleteConsignmentPenerimaan,
  resolveComplaintItem,
} from "@/services/consignment-penerimaan-actions";

// Harus sama dengan kolom yang dicari di `filtered`.
const PENERIMAAN_SEARCH_FIELDS = ["No. Penerimaan", "No. IK", "Customer"];

const STATUS_OPTIONS = [
  { label: "Komplain", value: "komplain" },
  { label: "Sesuai", value: "sesuai" },
];

const PENERIMAAN_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di getPenerimaanSortValue.
const PENERIMAAN_COLUMNS = [
  { id: "penerimaan_kode", label: "No. Penerimaan", sortDirection: "asc", className: PENERIMAAN_HEAD_CLASS },
  { id: "tanggal_terima", label: "Tgl Terima", sortDirection: "desc", className: PENERIMAAN_HEAD_CLASS },
  { id: "ik_kode", label: "No. IK", sortDirection: "asc", className: PENERIMAAN_HEAD_CLASS },
  { id: "customer", label: "Customer", sortDirection: "asc", className: PENERIMAAN_HEAD_CLASS },
  { id: "nama_penerima", label: "Nama Penerima", sortDirection: "asc", className: PENERIMAAN_HEAD_CLASS },
  { id: "item", label: "Item", className: `text-center ${PENERIMAAN_HEAD_CLASS}` },
  { id: "status", label: "Status", className: `text-center ${PENERIMAAN_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type PenerimaanColumnId = (typeof PENERIMAAN_COLUMNS)[number]["id"];

const getPenerimaanSortValue = (r: any, key: string) => {
  if (key === "ik_kode") return r.ik?.ik_kode;
  if (key === "customer") return r.customer?.customer_name;
  return r[key];
};

export default function ConsignmentPenerimaanPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [isModeratorOrAdmin, setIsModeratorOrAdmin] = useState(false);

  const columnOrder = useColumnOrder("wms:table-column-order:consignment-penerimaan", PENERIMAAN_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusFilters = urlState.list("status");
  const setStatusFilters = (v: string[]) =>
    urlState.set({ status: v }, { resetPage: true });
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

  const [detail, setDetail] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const [resolveTarget, setResolveTarget] = useState<any | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolving, setResolving] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await getConsignmentPenerimaanList();
    setRows(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: roleRows } = await supabase
          .from("user_roles")
          .select("roles(name)")
          .eq("user_id", user.id);
        const roleNames = (roleRows || [])
          .map((r: any) => r.roles?.name)
          .filter(Boolean);
        setIsModeratorOrAdmin(
          roleNames.some((r: string) => r === "moderator" || r === "admin"),
        );
      }
    };
    init();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasOpenComplaint = (r: any) =>
    (r.consignment_penerimaan_items || []).some(
      (i: any) => i.status === "komplain" && i.resolution_status === "open",
    );

  const filtered = rows.filter((r) => {
    const q = debouncedSearch.toLowerCase();
    const matchSearch =
      !q ||
      r.penerimaan_kode?.toLowerCase().includes(q) ||
      r.ik?.ik_kode?.toLowerCase().includes(q) ||
      r.customer?.customer_name?.toLowerCase().includes(q);
    const matchStatus =
      statusFilters.length !== 1 ||
      hasOpenComplaint(r) === (statusFilters[0] === "komplain");
    const tanggal = (r.tanggal_terima || "").slice(0, 10);
    const matchTanggal =
      (!dateFrom || tanggal >= dateFrom) && (!dateTo || tanggal <= dateTo);
    return matchSearch && matchStatus && matchTanggal;
  });

  const sorted = sortRows(filtered, sortOrder, getPenerimaanSortValue);
  const totalCount = sorted.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(totalCount / limit)));
  const pageRows = sorted.slice((safePage - 1) * limit, safePage * limit);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await deleteConsignmentPenerimaan(deleteTarget.id);
    if (res.success) {
      toast.success("Penerimaan berhasil dihapus, stok sudah dikembalikan.");
      load();
    } else {
      toast.error(res.error || "Gagal menghapus Penerimaan.");
    }
  };

  const handleResolve = async () => {
    if (!resolveTarget) return;
    setResolving(true);
    const res = await resolveComplaintItem(resolveTarget.id, resolveNote);
    setResolving(false);
    if (res.success) {
      toast.success("Komplain ditandai selesai.");
      setResolveTarget(null);
      setResolveNote("");
      load();
      setDetail((prev: any) =>
        prev
          ? {
              ...prev,
              consignment_penerimaan_items: prev.consignment_penerimaan_items.map(
                (i: any) =>
                  i.id === resolveTarget.id
                    ? { ...i, resolution_status: "selesai", catatan_resolusi: resolveNote }
                    : i,
              ),
            }
          : prev,
      );
    } else {
      toast.error(res.error || "Gagal menandai selesai.");
    }
  };

  const resetFilters = () => {
    resetSearchQuery();
    urlState.reset();
  };

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const optionLabels = (
    options: { label: string; value: string }[],
    values: string[],
  ) => values.map((v) => filterOptionLabel(options, v)).join(", ");
  const activeFilters: ActiveFilter[] = [];
  if (statusFilters.length > 0)
    activeFilters.push({
      key: "status",
      label: "Status",
      value: optionLabels(STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
    });
  if (dateFrom || dateTo)
    activeFilters.push({
      key: "tanggal",
      label: "Tanggal",
      value: formatFilterRange(dateFrom, dateTo, formatFilterDate),
      onRemove: () => urlState.set({ dari: "", sampai: "" }, { resetPage: true }),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (r: any, id: PenerimaanColumnId) => {
    switch (id) {
      case "penerimaan_kode":
        return (
          <TableCell className="font-bold text-xs">{r.penerimaan_kode}</TableCell>
        );
      case "tanggal_terima":
        return (
          <TableCell className="text-xs whitespace-nowrap">
            {r.tanggal_terima ? formatDate(r.tanggal_terima) : "-"}
          </TableCell>
        );
      case "ik_kode":
        return (
          <TableCell className="text-xs">{r.ik?.ik_kode || "-"}</TableCell>
        );
      case "customer":
        return (
          <TableCell className="text-xs">{r.customer?.customer_name || "-"}</TableCell>
        );
      case "nama_penerima":
        return (
          <TableCell className="text-xs">{r.nama_penerima}</TableCell>
        );
      case "item":
        return (
          <TableCell className="text-center">
            <Badge variant="outline" className="font-bold text-[10px]">
              {(r.consignment_penerimaan_items || []).length}
            </Badge>
          </TableCell>
        );
      case "status":
        return (
          <TableCell className="text-center">
            {hasOpenComplaint(r) ? (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <MessageSquareWarning className="h-3 w-3" /> Komplain
              </Badge>
            ) : (
              <Badge className="text-[10px]">Sesuai</Badge>
            )}
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
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Penerimaan Konsinyasi
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Konfirmasi barang diterima customer & komplain
              </p>
            </div>
          </div>
          <Link href="/so-reguler/consignment/penerimaan/create">
            <Button className="h-9 gap-2 text-xs font-bold uppercase">
              <Plus className="h-4 w-4" /> Buat Penerimaan
            </Button>
          </Link>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari No. Penerimaan, IK, atau Customer..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={PENERIMAAN_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Status">
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={STATUS_OPTIONS}
                />
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tanggal Terima">
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
          className="min-w-[1000px]"
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
                    : "Belum ada Penerimaan"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((r) => (
                <TableRow key={r.id}>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(r, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => setDetail(r)}
                      >
                        <Eye className="mr-2 h-4 w-4" /> Lihat Detail
                      </DropdownMenuItem>
                      {isModeratorOrAdmin && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setDeleteTarget(r)}
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
          itemLabel="Penerimaan"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.penerimaan_kode}</DialogTitle>
            <DialogDescription>
              IK {detail?.ik?.ik_kode} · {detail?.customer?.customer_name} · Diterima oleh {detail?.nama_penerima}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-9">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                  <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Kirim</TableHead>
                  <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Terima</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Status</TableHead>
                  <TableHead className="w-36 text-[10px] font-black uppercase text-muted-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detail?.consignment_penerimaan_items || []).map((item: any) => (
                  <TableRow key={item.id} className="h-14">
                    <TableCell>
                      <code className="block text-xs font-bold">{item.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground">{item.part_name}</span>
                    </TableCell>
                    <TableCell className="text-center text-xs font-bold">
                      {item.qty_kirim} {item.satuan}
                    </TableCell>
                    <TableCell className="text-center text-xs font-bold">
                      {item.qty_terima} {item.satuan}
                    </TableCell>
                    <TableCell>
                      {item.status === "komplain" ? (
                        <div className="space-y-1">
                          <Badge
                            variant={item.resolution_status === "selesai" ? "secondary" : "destructive"}
                            className="text-[10px]"
                          >
                            Komplain · {item.resolution_status === "selesai" ? "Selesai" : "Open"}
                          </Badge>
                          <p className="text-[10px] text-muted-foreground">{item.catatan_komplain}</p>
                          {item.catatan_resolusi && (
                            <p className="text-[10px] text-muted-foreground italic">
                              Resolusi: {item.catatan_resolusi}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Badge className="text-[10px]">Sesuai</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.status === "komplain" && item.resolution_status === "open" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px]"
                          onClick={() => {
                            setResolveTarget(item);
                            setResolveNote("");
                          }}
                        >
                          Tandai Selesai
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {detail?.catatan && (
            <p className="text-xs text-muted-foreground">Catatan: {detail.catatan}</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolveTarget} onOpenChange={(o) => !o && setResolveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selesaikan Komplain — {resolveTarget?.part_number}</DialogTitle>
            <DialogDescription>{resolveTarget?.catatan_komplain}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Catatan Resolusi (opsional)</Label>
            <Textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="Bagaimana komplain ini ditindaklanjuti..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolveTarget(null)} disabled={resolving}>
              Batal
            </Button>
            <Button onClick={handleResolve} disabled={resolving}>
              {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tandai Selesai"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        destructive
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Hapus Penerimaan ${deleteTarget?.penerimaan_kode ?? ""}?`}
        description="Qty terima akan dikurangi dari stok customer (membalikkan pergerakan stok Penerimaan ini). Tindakan ini tidak bisa dibatalkan."
        confirmText="Hapus"
        onConfirm={handleDelete}
      />
    </>
  );
}
