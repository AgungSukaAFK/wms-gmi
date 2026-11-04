"use client";

import React, { useEffect, useState } from "react";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Content } from "@/components/content";
import {
  type ActiveFilter,
  FilterField,
  FilterFields,
  FilterPanel,
} from "@/components/filter-panel";
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
import { RowActionsMenu } from "@/components/row-actions-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClipboardList, CheckCircle2, Loader2, Settings2 } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  getStockSettingRequests,
  resolveStockSettingRequest,
  setMinMaxFromRequest,
} from "@/services/stock-request-actions";

const REASON_META: Record<string, { label: string; className: string }> = {
  no_policy: {
    label: "Belum di-set",
    className: "bg-warning/10 text-warning border-warning/30",
  },
  limit_reached: {
    label: "Stok penuh",
    className: "bg-primary/10 text-primary border-primary/30",
  },
};

// Harus sama dengan kolom yang dicari di `filtered`.
const REQUEST_SEARCH_FIELDS = ["Part Number", "Nama Barang", "Cabang", "Peminta"];

const REQUEST_STATUS_LABEL: Record<string, string> = {
  open: "Belum diproses",
  resolved: "Selesai",
  all: "Semua",
};

const REQUEST_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di getRequestSortValue.
const REQUEST_COLUMNS = [
  { id: "part_number", label: "Barang", sortDirection: "asc", className: REQUEST_HEAD_CLASS },
  { id: "cabang", label: "Cabang", sortDirection: "asc", className: REQUEST_HEAD_CLASS },
  { id: "reason", label: "Alasan", sortDirection: "asc", className: REQUEST_HEAD_CLASS },
  { id: "current_qty", label: "Stok (saat minta)", sortDirection: "desc", className: `text-center ${REQUEST_HEAD_CLASS}` },
  { id: "requester", label: "Peminta", sortDirection: "asc", className: REQUEST_HEAD_CLASS },
] as const satisfies readonly ReorderableColumn[];
type RequestColumnId = (typeof REQUEST_COLUMNS)[number]["id"];

const getRequestSortValue = (r: any, key: string) => {
  switch (key) {
    case "part_number":
      return r.part_number || r.barang?.part_number || "";
    case "cabang":
      return r.cabang?.nama_cabang || "";
    case "reason":
      return r.reason || "";
    case "current_qty":
      return r.current_qty ?? 0;
    case "requester":
      return r.requester?.nama || "";
    default:
      return "";
  }
};

export default function StockRequestsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const columnOrder = useColumnOrder("wms:table-column-order:stock-requests", REQUEST_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusParam = urlState.get("status");
  const statusFilter: "open" | "resolved" | "all" =
    statusParam === "resolved" || statusParam === "all" ? statusParam : "open";
  const setStatusFilter = (v: string) =>
    urlState.set({ status: v === "open" ? "" : v }, { resetPage: true });
  const [denied, setDenied] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const sortOrder = urlState.get("sort", "");
  const setSortOrder = (v: string) => urlState.set({ sort: v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  // Dialog set min/max
  const [settingRow, setSettingRow] = useState<any | null>(null);
  const [minInput, setMinInput] = useState("");
  const [maxInput, setMaxInput] = useState("");
  const [savingMinMax, setSavingMinMax] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const res = await getStockSettingRequests(statusFilter);
    if (res.error) {
      setDenied(true);
      setRows([]);
    } else {
      setDenied(false);
      setRows(res.data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleResolve = async (id: number) => {
    setResolvingId(id);
    const res = await resolveStockSettingRequest(id);
    setResolvingId(null);
    if (res?.success) {
      toast.success("Request ditandai selesai.");
      fetchData();
    } else {
      toast.error(res?.error || "Gagal memproses");
    }
  };

  const filtered = rows.filter((r) => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    return [
      r.part_number || r.barang?.part_number,
      r.part_name || r.barang?.part_name,
      r.cabang?.nama_cabang,
      r.requester?.nama,
    ].some((v) => v?.toLowerCase().includes(q));
  });

  const sorted = sortRows(filtered, sortOrder, getRequestSortValue);
  const totalCount = sorted.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(totalCount / limit)));
  const pageRows = sorted.slice((safePage - 1) * limit, safePage * limit);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const openSetDialog = (r: any) => {
    setSettingRow(r);
    setMinInput("");
    setMaxInput(r.max_qty ? String(r.max_qty) : "");
  };

  const handleSaveMinMax = async () => {
    if (!settingRow) return;
    const min = Number(minInput || 0);
    const max = Number(maxInput || 0);
    if (max < 1) {
      toast.error("Max stok harus minimal 1.");
      return;
    }
    if (max < min) {
      toast.error("Max tidak boleh lebih kecil dari Min.");
      return;
    }
    setSavingMinMax(true);
    const res = await setMinMaxFromRequest(settingRow.id, min, max);
    setSavingMinMax(false);
    if (res?.success) {
      toast.success("Kebijakan stok tersimpan & request selesai.");
      setSettingRow(null);
      fetchData();
    } else {
      toast.error(res?.error || "Gagal menyimpan");
    }
  };

  const resetFilters = () => {
    resetSearchQuery();
    urlState.reset();
  };

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const activeFilters: ActiveFilter[] = [];
  if (statusFilter !== "open")
    activeFilters.push({
      key: "status",
      label: "Status",
      value: REQUEST_STATUS_LABEL[statusFilter],
      onRemove: () => setStatusFilter("open"),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (r: any, id: RequestColumnId) => {
    const meta = REASON_META[r.reason] || { label: r.reason, className: "" };

    switch (id) {
      case "part_number":
        return (
          <TableCell>
            <div className="font-mono text-xs font-bold text-foreground">
              {r.part_number || r.barang?.part_number}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {r.part_name || r.barang?.part_name}
            </div>
          </TableCell>
        );
      case "cabang":
        return (
          <TableCell className="text-[11px] font-semibold">
            {r.cabang?.nama_cabang || "-"}
          </TableCell>
        );
      case "reason":
        return (
          <TableCell>
            <Badge
              variant="outline"
              className={`text-[9px] font-bold uppercase ${meta.className}`}
            >
              {meta.label}
            </Badge>
          </TableCell>
        );
      case "current_qty":
        return (
          <TableCell className="text-center text-[11px] font-bold">
            {r.current_qty ?? "-"} / {r.max_qty ?? "-"}
          </TableCell>
        );
      case "requester":
        return (
          <TableCell className="text-[11px]">
            {r.requester?.nama || "-"}
          </TableCell>
        );
    }
  };

  return (
    <>
      {/* Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Request Pengaturan Stok
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                PN yang perlu di-set kebijakan min/max per cabang
              </p>
            </div>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari PN, nama barang, cabang, peminta..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={REQUEST_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Status">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-bold text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Belum diproses</SelectItem>
                    <SelectItem value="resolved">Selesai</SelectItem>
                    <SelectItem value="all">Semua</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </FilterFields>
          </FilterPanel>
        </div>
      </Content>

      {denied ? (
        <Content>
          <div className="py-12 text-center text-xs font-semibold text-muted-foreground">
            Halaman ini hanya untuk moderator / PPIC / PJO.
          </div>
        </Content>
      ) : (
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
                  <TableCell colSpan={6}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {debouncedSearch || statusFilter !== "open"
                    ? "Tidak ada data yang sesuai filter"
                    : "Tidak ada request"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((r) => (
                <TableRow key={r.id}>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(r, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    {r.status === "open" ? (
                    <RowActionsMenu>
                      <DropdownMenuItem onSelect={() => openSetDialog(r)}>
                        <Settings2 className="mr-2 h-4 w-4" /> Atur Stok
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={resolvingId === r.id}
                        onSelect={() => handleResolve(r.id)}
                      >
                        {resolvingId === r.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        )}
                        Tandai Selesai
                      </DropdownMenuItem>
                    </RowActionsMenu>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[9px] font-bold uppercase text-success border-success/40 bg-success/10"
                      >
                        Selesai
                      </Badge>
                    )}
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
          itemLabel="Request"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>
      )}

      {/* Dialog set min/max langsung */}
      <Dialog
        open={settingRow !== null}
        onOpenChange={(o) => {
          if (!o) setSettingRow(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              Atur Kebijakan Stok
            </DialogTitle>
            <DialogDescription className="text-left">
              <span className="font-mono font-bold text-foreground">
                {settingRow?.part_number || settingRow?.barang?.part_number}
              </span>{" "}
              di cabang{" "}
              <span className="font-bold text-foreground">
                {settingRow?.cabang?.nama_cabang}
              </span>
              . Stok saat ini: {settingRow?.current_qty ?? 0}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-muted-foreground uppercase">
                Min Stok
              </label>
              <Input
                type="number"
                min="0"
                value={minInput}
                onChange={(e) => setMinInput(e.target.value)}
                placeholder="0"
                className="font-bold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-muted-foreground uppercase">
                Max Stok
              </label>
              <Input
                type="number"
                min="1"
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                placeholder="0"
                className="font-bold"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Setelah disimpan, PN langsung bisa diminta di MR dan request ini
            otomatis ditandai selesai.
          </p>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="ghost"
              className="text-xs font-bold"
              onClick={() => setSettingRow(null)}
              disabled={savingMinMax}
            >
              Batal
            </Button>
            <Button
              className="gap-2 text-xs font-bold"
              onClick={handleSaveMinMax}
              disabled={savingMinMax}
            >
              {savingMinMax ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Simpan & Selesai
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
