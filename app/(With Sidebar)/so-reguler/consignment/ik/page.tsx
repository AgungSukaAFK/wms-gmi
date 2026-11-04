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
  ClipboardList,
  ArrowRight,
  Trash2,
  Eye,
} from "lucide-react";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import {
  getConsignmentIkList,
  deleteConsignmentIk,
} from "@/services/consignment-ik-actions";

// Tujuan IK: site customer (IK baru) atau gudang cabang (IK lama).
const tujuanIk = (ik: any) => ik?.ke_site_name || ik?.cabang_tujuan?.nama_cabang || "-";

// Harus sama dengan kolom yang dicari di `filtered`.
const IK_SEARCH_FIELDS = ["No. IK", "No. AWB", "No. SO"];

const ASAL_OPTIONS = [
  { label: "Input Web", value: "web" },
  { label: "Import ERP", value: "import" },
];

const IK_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di getIkSortValue.
const IK_COLUMNS = [
  { id: "ik_kode", label: "Kode IK", sortDirection: "asc", className: IK_HEAD_CLASS },
  { id: "ik_tanggal", label: "Tgl IK", sortDirection: "desc", className: IK_HEAD_CLASS },
  { id: "so_no", label: "No. SO", sortDirection: "asc", className: IK_HEAD_CLASS },
  { id: "rute", label: "Asal → Tujuan", className: IK_HEAD_CLASS },
  { id: "no_awb", label: "No. AWB", sortDirection: "asc", className: IK_HEAD_CLASS },
  { id: "item", label: "Item", className: `text-center ${IK_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type IkColumnId = (typeof IK_COLUMNS)[number]["id"];

const getIkSortValue = (ik: any, key: string) =>
  key === "so_no" ? ik.so?.so_no : ik[key];

export default function ConsignmentIkPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [iks, setIks] = useState<any[]>([]);
  const [isModeratorOrAdmin, setIsModeratorOrAdmin] = useState(false);

  const columnOrder = useColumnOrder("wms:table-column-order:consignment-ik", IK_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const asalFilters = urlState.list("asal");
  const setAsalFilters = (v: string[]) =>
    urlState.set({ asal: v }, { resetPage: true });
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

  const [detailIk, setDetailIk] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await getConsignmentIkList();
    setIks(res.data || []);
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

  const filtered = iks.filter((ik) => {
    const q = debouncedSearch.toLowerCase();
    const matchSearch =
      !q ||
      ik.ik_kode?.toLowerCase().includes(q) ||
      ik.no_awb?.toLowerCase().includes(q) ||
      ik.so?.so_no?.toLowerCase().includes(q);
    const matchAsal =
      asalFilters.length !== 1 ||
      Boolean(ik.ik_is_import) === (asalFilters[0] === "import");
    const tanggal = (ik.ik_tanggal || "").slice(0, 10);
    const matchTanggal =
      (!dateFrom || tanggal >= dateFrom) && (!dateTo || tanggal <= dateTo);
    return matchSearch && matchAsal && matchTanggal;
  });

  const sorted = sortRows(filtered, sortOrder, getIkSortValue);
  const totalCount = sorted.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(totalCount / limit)));
  const pageRows = sorted.slice((safePage - 1) * limit, safePage * limit);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await deleteConsignmentIk(deleteTarget.id);
    if (res.success) {
      toast.success("IK berhasil dihapus, pergerakan stoknya sudah dibalik.");
      load();
    } else {
      toast.error(res.error || "Gagal menghapus IK.");
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
  if (asalFilters.length > 0)
    activeFilters.push({
      key: "asal",
      label: "Asal Data",
      value: optionLabels(ASAL_OPTIONS, asalFilters),
      onRemove: () => setAsalFilters([]),
    });
  if (dateFrom || dateTo)
    activeFilters.push({
      key: "tanggal",
      label: "Tanggal",
      value: formatFilterRange(dateFrom, dateTo, formatFilterDate),
      onRemove: () => urlState.set({ dari: "", sampai: "" }, { resetPage: true }),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (ik: any, id: IkColumnId) => {
    switch (id) {
      case "ik_kode":
        return (
          <TableCell className="font-bold text-xs">
            {ik.ik_kode}
            {ik.ik_is_import && (
              <Badge variant="secondary" className="ml-1.5 text-[9px] font-bold">
                Import ERP
              </Badge>
            )}
          </TableCell>
        );
      case "ik_tanggal":
        return (
          <TableCell className="text-xs whitespace-nowrap">
            {ik.ik_tanggal ? formatDate(ik.ik_tanggal) : "-"}
          </TableCell>
        );
      case "so_no":
        return (
          <TableCell className="text-xs">{ik.so?.so_no || "-"}</TableCell>
        );
      case "rute":
        return (
          <TableCell className="text-xs whitespace-nowrap">
            <span className="flex items-center gap-1">
              {ik.cabang_asal?.nama_cabang || "-"}
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              {tujuanIk(ik)}
            </span>
          </TableCell>
        );
      case "no_awb":
        return (
          <TableCell className="text-xs">{ik.no_awb || "-"}</TableCell>
        );
      case "item":
        return (
          <TableCell className="text-center">
            <Badge variant="outline" className="font-bold text-[10px]">
              {(ik.consignment_ik_items || []).length}
            </Badge>
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
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Item Konsinyasi
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Pengiriman fisik barang Consignment ke site customer
              </p>
            </div>
          </div>
          <Link href="/so-reguler/consignment/ik/create">
            <Button className="h-9 gap-2 text-xs font-bold uppercase">
              <Plus className="h-4 w-4" /> Buat Item Konsinyasi
            </Button>
          </Link>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari No. IK, No. AWB, atau No. SO..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={IK_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Asal Data">
                <MultiSelect
                  placeholder="Semua Asal"
                  selected={asalFilters}
                  onChange={setAsalFilters}
                  options={ASAL_OPTIONS}
                />
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tanggal IK">
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
                  <TableCell colSpan={7}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter"
                    : "Belum ada Item Konsinyasi"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((ik) => (
                <TableRow key={ik.id}>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(ik, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => setDetailIk(ik)}
                      >
                        <Eye className="mr-2 h-4 w-4" /> Lihat Detail
                      </DropdownMenuItem>
                      {isModeratorOrAdmin && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setDeleteTarget(ik)}
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
          itemLabel="IK"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <Dialog open={!!detailIk} onOpenChange={(o) => !o && setDetailIk(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailIk?.ik_kode}</DialogTitle>
            <DialogDescription>
              {detailIk?.cabang_asal?.nama_cabang} → {tujuanIk(detailIk)}
              {detailIk?.no_awb ? ` · AWB: ${detailIk.no_awb}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-9">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detailIk?.consignment_ik_items || []).map((item: any) => (
                  <TableRow key={item.id} className="h-11">
                    <TableCell>
                      <code className="block text-xs font-bold">{item.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground">{item.part_name}</span>
                    </TableCell>
                    <TableCell className="text-right text-xs font-bold">
                      {item.qty} {item.satuan}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        destructive
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Hapus Item Konsinyasi ${deleteTarget?.ik_kode ?? ""}?`}
        description="Pergerakan stok IK ini akan dibalik (stok dikembalikan ke gudang asal). Tindakan ini tidak bisa dibatalkan."
        confirmText="Hapus"
        onConfirm={handleDelete}
      />
    </>
  );
}
