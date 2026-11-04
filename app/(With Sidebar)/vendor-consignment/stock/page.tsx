"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Warehouse, History, ClipboardCheck } from "lucide-react";
import { toast } from "@/lib/toast";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import {
  type ActiveFilter,
  FilterField,
  FilterFields,
  FilterPanel,
  filterOptionLabel,
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
import { formatDateTime } from "@/lib/utils";
import { VendorPicker, type VendorOption } from "@/components/vendor-consignment/vendor-picker";
import {
  adjustConsignmentStock,
  getConsignmentMovements,
  getConsignmentStockList,
} from "@/services/vendor-consignment-actions";

const MOVE_LABEL: Record<string, { label: string; tone: string }> = {
  GR: { label: "GR Konsinyasi", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  GR_CANCEL: { label: "Batal GR", tone: "bg-muted text-foreground/80" },
  IT_OUT: { label: "IT Keluar", tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  IT_IN: { label: "IT Masuk", tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  SPB_OUT: { label: "SPB Out", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
  SPB_CANCEL: { label: "SPB Batal", tone: "bg-muted text-foreground/80" },
  SPB_ROLLBACK: { label: "SPB Rollback", tone: "bg-muted text-foreground/80" },
  SPB_RETURN: { label: "Return SPB", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  ADJUSTMENT: { label: "Stock Opname", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
};

// Harus sama dengan kolom yang dicari di `filtered`.
const STOCK_SEARCH_FIELDS = ["Part Number", "Nama Part", "Vendor"];

const STOCK_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di getStockSortValue.
const STOCK_COLUMNS = [
  { id: "part", label: "Part", sortDirection: "asc", className: STOCK_HEAD_CLASS },
  { id: "vendor", label: "Vendor", sortDirection: "asc", className: STOCK_HEAD_CLASS },
  { id: "gudang", label: "Gudang", sortDirection: "asc", className: STOCK_HEAD_CLASS },
  { id: "qty", label: "Qty", sortDirection: "desc", className: `text-right ${STOCK_HEAD_CLASS}` },
  { id: "updated_at", label: "Update Terakhir", sortDirection: "desc", className: STOCK_HEAD_CLASS },
] as const satisfies readonly ReorderableColumn[];
type StockColumnId = (typeof STOCK_COLUMNS)[number]["id"];

const getStockSortValue = (r: any, key: string) => {
  if (key === "part") return r.barang?.part_number;
  if (key === "vendor") return r.vendors?.vendor_name;
  if (key === "gudang") return r.cabang?.nama_cabang;
  return r[key];
};

export default function ConsignmentStockPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [cabangs, setCabangs] = useState<any[]>([]);
  const [vendor, setVendor] = useState<VendorOption | null>(null);
  const columnOrder = useColumnOrder("wms:table-column-order:vendor-consignment-stock", STOCK_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const cabangId = urlState.get("gudang", "all");
  const setCabangId = (v: string) =>
    urlState.set({ gudang: v === "all" ? "" : v }, { resetPage: true });
  const sortOrder = urlState.get("sort", "");
  const setSortOrder = (v: string) => urlState.set({ sort: v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });
  const [isModeratorOrAdmin, setIsModeratorOrAdmin] = useState(false);

  const [historyRow, setHistoryRow] = useState<any | null>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [movesLoading, setMovesLoading] = useState(false);

  const [opnameRow, setOpnameRow] = useState<any | null>(null);
  const [opnameQty, setOpnameQty] = useState("");
  const [opnameNote, setOpnameNote] = useState("");
  const [opnameSaving, setOpnameSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await getConsignmentStockList({
      vendorId: vendor?.id ?? null,
      cabangId: cabangId === "all" ? null : Number(cabangId),
    });
    if (res.error) toast.error(res.error);
    setRows(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const { data: cabangData } = await supabase
        .from("cabang")
        .select("id, nama_cabang")
        .eq("is_active", true)
        .order("nama_cabang");
      setCabangs(cabangData || []);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: roleRows } = await supabase.from("user_roles").select("roles(name)").eq("user_id", user.id);
      const roleNames = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
      setIsModeratorOrAdmin(roleNames.some((r: string) => r === "moderator" || r === "admin"));
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?.id, cabangId]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return rows.filter(
      (r) =>
        !q ||
        r.barang?.part_number?.toLowerCase().includes(q) ||
        r.barang?.part_name?.toLowerCase().includes(q) ||
        r.vendors?.vendor_name?.toLowerCase().includes(q),
    );
  }, [rows, debouncedSearch]);

  const totalQty = filtered.reduce((a, r) => a + (Number(r.qty) || 0), 0);

  const sorted = sortRows(filtered, sortOrder, getStockSortValue);
  const totalCount = sorted.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(totalCount / limit)));
  const pageRows = sorted.slice((safePage - 1) * limit, safePage * limit);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const openHistory = async (row: any) => {
    setHistoryRow(row);
    setMovesLoading(true);
    const res = await getConsignmentMovements({
      vendorId: row.vendor_id,
      cabangId: row.cabang_id,
      partId: row.part_id,
    });
    if (res.error) toast.error(res.error);
    setMoves(res.data || []);
    setMovesLoading(false);
  };

  // Saldo dihitung mundur dari qty saat ini (sama seperti riwayat /stock).
  const movesWithSaldo = useMemo(() => {
    let saldo = Number(historyRow?.qty) || 0;
    return moves.map((m) => {
      const after = saldo;
      saldo -= Number(m.qty_change) || 0;
      return { ...m, saldo_after: after };
    });
  }, [moves, historyRow]);

  const handleOpname = async () => {
    if (!opnameRow) return;
    setOpnameSaving(true);
    const res = await adjustConsignmentStock({
      vendorId: opnameRow.vendor_id,
      cabangId: opnameRow.cabang_id,
      partId: opnameRow.part_id,
      qtyAktual: Number(opnameQty),
      catatan: opnameNote,
    });
    setOpnameSaving(false);
    if (res.error) return toast.error(res.error);
    toast.success(res.delta ? `Stok disesuaikan (${res.delta > 0 ? "+" : ""}${res.delta}).` : "Qty aktual sama, tidak ada perubahan.");
    setOpnameRow(null);
    load();
  };

  const resetFilters = () => {
    resetSearchQuery();
    setVendor(null);
    urlState.reset();
  };

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const activeFilters: ActiveFilter[] = [];
  if (vendor)
    activeFilters.push({
      key: "vendor",
      label: "Vendor",
      value: vendor.vendor_name,
      onRemove: () => setVendor(null),
    });
  if (cabangId !== "all")
    activeFilters.push({
      key: "gudang",
      label: "Gudang",
      value: filterOptionLabel(
        cabangs.map((c) => ({ label: c.nama_cabang, value: String(c.id) })),
        cabangId,
      ),
      onRemove: () => setCabangId("all"),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (r: any, id: StockColumnId) => {
    switch (id) {
      case "part":
        return (
          <TableCell>
            <code className="block text-xs font-bold">{r.barang?.part_number}</code>
            <span className="block text-[10px] text-muted-foreground">{r.barang?.part_name}</span>
          </TableCell>
        );
      case "vendor":
        return (
          <TableCell className="text-xs">{r.vendors?.vendor_name}</TableCell>
        );
      case "gudang":
        return (
          <TableCell className="text-xs">{r.cabang?.nama_cabang}</TableCell>
        );
      case "qty":
        return (
          <TableCell className={`text-right text-sm font-bold ${r.qty < 0 ? "text-destructive" : ""}`}>
            {r.qty} <span className="text-[10px] font-medium text-muted-foreground">{r.barang?.part_satuan}</span>
          </TableCell>
        );
      case "updated_at":
        return (
          <TableCell className="text-xs whitespace-nowrap">{formatDateTime(r.updated_at)}</TableCell>
        );
    }
  };

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
            <Warehouse className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">Stok Konsinyasi</h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Barang titipan vendor di gudang GMI (terpisah dari stok GMI) · stock opname per 3 bulan
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Part number, nama part, atau vendor..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={STOCK_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Vendor">
                <VendorPicker
                  value={vendor}
                  onChange={setVendor}
                  placeholder="Semua vendor"
                  className="h-9 text-xs"
                />
              </FilterField>

              <FilterField label="Gudang">
                <Select value={cabangId} onValueChange={setCabangId}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua gudang</SelectItem>
                    {cabangs.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nama_cabang}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
            </FilterFields>
          </FilterPanel>
        </div>
      </Content>

      <Content>
        <div className="mb-2 text-xs text-muted-foreground">
          {filtered.length} baris · total qty <span className="font-bold text-foreground">{totalQty}</span>
        </div>
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
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter"
                    : "Tidak ada stok konsinyasi"}
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
                        onSelect={() => openHistory(r)}
                      >
                        <History className="mr-2 h-4 w-4" /> Kartu Stok
                      </DropdownMenuItem>
                      {isModeratorOrAdmin && (
                        <DropdownMenuItem
                          onSelect={() => {
                            setOpnameRow(r);
                            setOpnameQty(String(r.qty));
                            setOpnameNote("");
                          }}
                        >
                          <ClipboardCheck className="mr-2 h-4 w-4" /> Stock Opname
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
          itemLabel="Stok"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <Dialog open={!!historyRow} onOpenChange={(o) => !o && setHistoryRow(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Kartu Stok {historyRow?.barang?.part_number}
            </DialogTitle>
            <DialogDescription>
              {historyRow?.vendors?.vendor_name} · {historyRow?.cabang?.nama_cabang} · saldo {historyRow?.qty}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg overflow-auto max-h-[60vh]">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-9">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Waktu</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Jenis</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Dokumen</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Saldo</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Keterangan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movesLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : movesWithSaldo.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center text-xs text-muted-foreground">
                      Belum ada mutasi.
                    </TableCell>
                  </TableRow>
                ) : (
                  movesWithSaldo.map((m) => {
                    const meta = MOVE_LABEL[m.type] || { label: m.type, tone: "bg-muted text-foreground/80" };
                    return (
                      <TableRow key={m.id} className="h-10">
                        <TableCell className="text-[11px] whitespace-nowrap">{formatDateTime(m.created_at)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[9px] font-bold border-0 ${meta.tone}`}>
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[11px] font-mono">{m.reference_id || "-"}</TableCell>
                        <TableCell
                          className={`text-right text-xs font-bold ${m.qty_change < 0 ? "text-destructive" : "text-green-700"}`}
                        >
                          {m.qty_change > 0 ? "+" : ""}
                          {m.qty_change}
                        </TableCell>
                        <TableCell className="text-right text-xs">{m.saldo_after}</TableCell>
                        <TableCell className="text-[11px] text-muted-foreground max-w-64">{m.notes || "-"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!opnameRow} onOpenChange={(o) => !o && setOpnameRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Stock Opname Konsinyasi</DialogTitle>
            <DialogDescription>
              {opnameRow?.barang?.part_number} · {opnameRow?.vendors?.vendor_name} · {opnameRow?.cabang?.nama_cabang}.
              Qty sistem saat ini: {opnameRow?.qty}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Qty aktual (hasil hitung fisik)</Label>
              <Input type="number" min={0} value={opnameQty} onChange={(e) => setOpnameQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Catatan</Label>
              <Input
                value={opnameNote}
                onChange={(e) => setOpnameNote(e.target.value)}
                placeholder="mis. Opname Q4 2026, selisih rusak"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpnameRow(null)}>
              Batal
            </Button>
            <Button onClick={handleOpname} disabled={opnameSaving || opnameQty === ""}>
              {opnameSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
