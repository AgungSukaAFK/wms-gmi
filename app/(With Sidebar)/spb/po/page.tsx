"use client";

import { Fragment, useEffect, useState } from "react";
import {
  Plus,
  Printer,
  ShieldAlert,
  ShoppingCart,
} from "lucide-react";
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
import {
  type ActiveFilter,
  FilterField,
  FilterPanel,
  FilterRange,
  FilterRangeFields,
  formatFilterDate,
  formatFilterRange,
} from "@/components/filter-panel";
import { ListSearchInput } from "@/components/list-search-input";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/toast";
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
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import { DatePickerString } from "@/components/date-picker-string";
import { CreateSpbPoDialog } from "@/components/spb/create-spb-po-dialog";
import { getSpbPoList, updateSpbPo } from "@/services/spb-actions";
import { formatDate, ymdToLocalStartIso } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

// Harus sama dengan kolom yang dicari di service list.
const SPB_PO_SEARCH_FIELDS = ["No PO", "No SO"];

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key sort di service.
const SPB_PO_COLUMNS = [
  { id: "spb_no", label: "No SPB" },
  { id: "po_no", label: "No PO", sortDirection: "asc" },
  { id: "so_no", label: "No SO", sortDirection: "asc" },
  { id: "so_date", label: "SO Date", sortDirection: "desc" },
  { id: "lokasi", label: "Lokasi" },
  { id: "item_count", label: "Item Count" },
  { id: "created_at", label: "Created", sortDirection: "desc" },
] as const satisfies readonly ReorderableColumn[];
type SpbPoColumnId = (typeof SPB_PO_COLUMNS)[number]["id"];

export default function SpbPoPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const columnOrder = useColumnOrder("wms:table-column-order:spb-po", SPB_PO_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [search, setSearch, resetSearch] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const dateFrom = urlState.get("dari");
  const setDateFrom = (v: string) =>
    urlState.set({ dari: v }, { resetPage: true });
  const dateTo = urlState.get("sampai");
  const setDateTo = (v: string) =>
    urlState.set({ sampai: v }, { resetPage: true });
  const sort = urlState.get("sort", "created_at_desc");
  const setSort = (v: string) =>
    urlState.set({ sort: v === "created_at_desc" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

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
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
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
  }, [debouncedSearch, dateFrom, dateTo, sort, page, limit]);

  const resetFilters = () => {
    resetSearch();
    urlState.reset();
  };

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const activeFilters: ActiveFilter[] = [];
  if (dateFrom || dateTo)
    activeFilters.push({
      key: "tanggal",
      label: "Tanggal",
      value: formatFilterRange(dateFrom, dateTo, formatFilterDate),
      onRemove: () => urlState.set({ dari: "", sampai: "" }, { resetPage: true }),
    });

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

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (row: any, id: SpbPoColumnId) => {
    switch (id) {
      case "spb_no":
        return (
          <TableCell>{row.spb?.spb_no || "-"}</TableCell>
        );
      case "po_no":
        return (
          <TableCell className="font-medium">{row.po_no}</TableCell>
        );
      case "so_no":
        return (
          <TableCell>{row.so_no || "-"}</TableCell>
        );
      case "so_date":
        return (
          <TableCell>
            {formatDate(row.so_date)}
          </TableCell>
        );
      case "lokasi":
        return (
          <TableCell>{row.spb?.spb_gudang || "-"}</TableCell>
        );
      case "item_count":
        return (
          <TableCell>{row.details?.length || 0}</TableCell>
        );
      case "created_at":
        return (
          <TableCell>
            {formatDate(row.created_at)}
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

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari No PO atau No SO"
            value={search}
            onChange={setSearch}
            searchableFields={SPB_PO_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterRangeFields>
              <FilterField label="SO Date">
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
            >
              {columnOrder.orderedColumns.map((column) => (
                <ReorderableTableHead
                  key={column.id}
                  column={column}
                  sort={{ currentSort: sort, onSort: handleSortChange }}
                />
              ))}
              <TableHead className="w-20 text-right pr-4">Aksi</TableHead>
            </ReorderableHeaderRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: limit }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-24 text-center text-muted-foreground"
                >
                  Belum ada data SPB-PO.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {columnOrder.order.map((id) => (
                    <Fragment key={id}>{renderCell(row, id)}</Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => window.open(`/spb/po/print/${row.id}`, "_blank")}
                      >
                        <Printer className="mr-2 h-4 w-4" /> Cetak
                      </DropdownMenuItem>
                      {isModerator && (
                        <DropdownMenuItem
                          className="text-amber-600 focus:text-amber-600"
                          onSelect={() => openModEdit(row)}
                        >
                          <ShieldAlert className="mr-2 h-4 w-4" /> Moderator Edit
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
          currentPage={page}
          totalItems={total}
          limit={limit}
          itemLabel="SPB PO"
          onPageChange={setPage}
          onLimitChange={(v) => {
            setLimit(Number(v));
            setPage(1);
          }}
          className="mt-6"
        />
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
