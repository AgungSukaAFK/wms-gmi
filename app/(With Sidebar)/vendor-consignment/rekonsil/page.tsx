"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Loader2,
  Scale,
  Eye,
  Trash2,
  Printer,
  CheckCircle2,
  Undo2,
  ShoppingCart,
  Receipt,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import {
  CONSIGNMENT_MANAGER_ROLES,
  isConsignmentManager,
} from "@/lib/vendor-consignment-roles";
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
import { formatDate, toYmdLocal } from "@/lib/utils";
import {
  deleteRekonsil,
  finalizeRekonsil,
  getRekonsilDetail,
  getRekonsilList,
  reopenRekonsil,
  updateRekonsilBilling,
} from "@/services/vendor-consignment-actions";

// Feedback rekonsil maksimal H+3 dari tanggal rekonsil (flowchart).
function feedbackDeadline(rkTanggal: string) {
  const d = new Date(`${rkTanggal}T00:00:00`);
  d.setDate(d.getDate() + 3);
  return toYmdLocal(d);
}

function statusOf(rk: any): { label: string; tone: string } {
  if (rk.payment_status === "paid") return { label: "Lunas", tone: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800" };
  if (rk.invoice_no) return { label: "Invoice", tone: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-800" };
  if (rk.po_id) return { label: "PO dibuat", tone: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800" };
  if (rk.status === "final") return { label: "BAST Final", tone: "bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-900/40 dark:text-cyan-300 dark:border-cyan-800" };
  return { label: "Draft", tone: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800" };
}

// Harus sama dengan kolom yang dicari di `filtered`.
const RK_SEARCH_FIELDS = ["Kode Rekonsil", "Vendor", "Site", "Kode PO", "No. Invoice"];

const RK_STATUS_OPTIONS = ["Draft", "BAST Final", "PO dibuat", "Invoice", "Lunas"].map(
  (label) => ({ label, value: label }),
);

const RK_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di getRekonsilSortValue.
const RK_COLUMNS = [
  { id: "rk_kode", label: "Kode", sortDirection: "asc", className: RK_HEAD_CLASS },
  { id: "site", label: "Site / Vendor", sortDirection: "asc", className: RK_HEAD_CLASS },
  { id: "periode", label: "Periode", sortDirection: "desc", className: RK_HEAD_CLASS },
  { id: "qty", label: "Qty", className: `text-right ${RK_HEAD_CLASS}` },
  { id: "status", label: "Status", className: RK_HEAD_CLASS },
  { id: "po_invoice", label: "PO / Invoice", className: RK_HEAD_CLASS },
] as const satisfies readonly ReorderableColumn[];
type RekonsilColumnId = (typeof RK_COLUMNS)[number]["id"];

const getRekonsilSortValue = (rk: any, key: string) => {
  if (key === "site") return rk.cabang?.nama_cabang;
  if (key === "periode") return rk.periode_awal;
  return rk[key];
};

export default function RekonsilPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const columnOrder = useColumnOrder("wms:table-column-order:vendor-consignment-rekonsil", RK_COLUMNS);
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
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "finalize" | "reopen" | "delete"; rk: any } | null>(null);
  const [busy, setBusy] = useState(false);

  const [billingRk, setBillingRk] = useState<any | null>(null);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceTanggal, setInvoiceTanggal] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"unpaid" | "paid">("unpaid");
  const [paidAt, setPaidAt] = useState("");

  const isMod = isConsignmentManager(roles);
  const canPo = roles.includes("purchasing");
  const canBilling = roles.some((r) => ["purchasing", "finance", ...CONSIGNMENT_MANAGER_ROLES].includes(r));
  const canReopen = roles.some((r) => ["purchasing", ...CONSIGNMENT_MANAGER_ROLES].includes(r));

  const load = async () => {
    setLoading(true);
    const res = await getRekonsilList();
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
      setUserId(user.id);
      const { data: roleRows } = await supabase.from("user_roles").select("roles(name)").eq("user_id", user.id);
      setRoles((roleRows || []).map((r: any) => r.roles?.name).filter(Boolean));
    };
    init();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = rows.filter((rk) => {
    if (statusFilters.length > 0 && !statusFilters.includes(statusOf(rk).label)) {
      return false;
    }
    const tanggal = (rk.rk_tanggal || "").slice(0, 10);
    if (dateFrom && tanggal < dateFrom) return false;
    if (dateTo && tanggal > dateTo) return false;
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    return (
      rk.rk_kode?.toLowerCase().includes(q) ||
      rk.vendors?.vendor_name?.toLowerCase().includes(q) ||
      rk.cabang?.nama_cabang?.toLowerCase().includes(q) ||
      rk.pos?.po_kode?.toLowerCase().includes(q) ||
      rk.invoice_no?.toLowerCase().includes(q)
    );
  });

  const sorted = sortRows(filtered, sortOrder, getRekonsilSortValue);
  const totalCount = sorted.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(totalCount / limit)));
  const pageRows = sorted.slice((safePage - 1) * limit, safePage * limit);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setDetail({ id });
    const res = await getRekonsilDetail(id);
    setDetailLoading(false);
    if (res.error) {
      setDetail(null);
      return toast.error(res.error);
    }
    setDetail(res.data);
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const fn =
      confirm.kind === "finalize" ? finalizeRekonsil : confirm.kind === "reopen" ? reopenRekonsil : deleteRekonsil;
    const res = await fn(confirm.rk.id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(
      confirm.kind === "finalize"
        ? "Rekonsil final, siap dibuatkan PO oleh purchasing."
        : confirm.kind === "reopen"
          ? "Rekonsil dikembalikan ke draft."
          : "Rekonsil dihapus.",
    );
    load();
  };

  const openBilling = (rk: any) => {
    setBillingRk(rk);
    setInvoiceNo(rk.invoice_no || "");
    setInvoiceTanggal(rk.invoice_tanggal || "");
    setPaymentStatus(rk.payment_status || "unpaid");
    setPaidAt(rk.paid_at || toYmdLocal());
  };

  const saveBilling = async () => {
    if (!billingRk) return;
    setBusy(true);
    const res = await updateRekonsilBilling(billingRk.id, {
      invoice_no: invoiceNo,
      invoice_tanggal: invoiceTanggal || null,
      payment_status: paymentStatus,
      paid_at: paymentStatus === "paid" ? paidAt : null,
    });
    setBusy(false);
    if (res.error) return toast.error(res.error);
    toast.success("Tagihan diperbarui.");
    setBillingRk(null);
    load();
  };

  const today = toYmdLocal();

  const canDeleteRk = (rk: any) =>
    !rk.po_id && (isMod || (rk.status === "draft" && rk.created_by === userId));

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
      value: optionLabels(RK_STATUS_OPTIONS, statusFilters),
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
  const renderCell = (rk: any, id: RekonsilColumnId) => {
    const st = statusOf(rk);
    const qty = (rk.vendor_consignment_rekonsil_items || []).reduce(
      (a: number, i: any) => a + i.qty,
      0,
    );
    const deadline = feedbackDeadline(rk.rk_tanggal);

    switch (id) {
      case "rk_kode":
        return (
          <TableCell className="text-xs">
            <span className="font-bold">{rk.rk_kode}</span>
            <span className="block text-[10px] text-muted-foreground">{formatDate(rk.rk_tanggal)}</span>
          </TableCell>
        );
      case "site":
        return (
          <TableCell className="text-xs">
            <span className="font-semibold">{rk.cabang?.nama_cabang}</span>
            <span className="block text-[10px] text-muted-foreground">{rk.vendors?.vendor_name}</span>
          </TableCell>
        );
      case "periode":
        return (
          <TableCell className="text-xs whitespace-nowrap">
            {formatDate(rk.periode_awal)} – {formatDate(rk.periode_akhir)}
          </TableCell>
        );
      case "qty":
        return (
          <TableCell className="text-right text-xs font-bold">{qty}</TableCell>
        );
      case "status":
        return (
          <TableCell>
            <Badge variant="outline" className={`text-[10px] font-bold ${st.tone}`}>
              {st.label}
            </Badge>
            {rk.status === "draft" && (
              <span
                className={`block mt-1 text-[10px] ${deadline < today ? "text-destructive font-bold" : "text-muted-foreground"}`}
              >
                Feedback s.d. {formatDate(deadline)}
              </span>
            )}
          </TableCell>
        );
      case "po_invoice":
        return (
          <TableCell className="text-xs">
            {rk.pos ? (
              <Link href={`/po/${rk.po_id}`} className="font-semibold hover:underline">
                {rk.pos.po_kode}
              </Link>
            ) : (
              "-"
            )}
            {rk.invoice_no && (
              <span className="block text-[10px] text-muted-foreground">Inv {rk.invoice_no}</span>
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
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">Rekonsil & BAST Konsinyasi</h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Rekonsil site per 2 minggu → BAST → PO Rekonsil (FIFO PR) → invoice → payment
              </p>
            </div>
          </div>
          <Link href="/vendor-consignment/rekonsil/create">
            <Button className="h-9 gap-2 text-xs font-bold uppercase">
              <Plus className="h-4 w-4" /> Buat Rekonsil
            </Button>
          </Link>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari kode, vendor, site, PO, invoice..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={RK_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Status">
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={RK_STATUS_OPTIONS}
                />
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tanggal Rekonsil">
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
                    : "Belum ada rekonsil"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((rk) => (
                <TableRow key={rk.id}>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(rk, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => openDetail(rk.id)}
                      >
                        <Eye className="mr-2 h-4 w-4" /> Lihat Detail
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={`/vendor-consignment/rekonsil/${rk.id}/print`} target="_blank">
                          <Printer className="mr-2 h-4 w-4" /> Cetak BAST
                        </Link>
                      </DropdownMenuItem>
                      {rk.status === "draft" && (
                        <DropdownMenuItem
                          onSelect={() => setConfirm({ kind: "finalize", rk })}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" /> BAST Final
                        </DropdownMenuItem>
                      )}
                      {rk.status === "final" && !rk.po_id && canPo && (
                        <DropdownMenuItem asChild>
                          <Link href={`/vendor-consignment/rekonsil/${rk.id}/po`}>
                            <ShoppingCart className="mr-2 h-4 w-4" /> Buat PO
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {rk.status === "final" && !rk.po_id && canReopen && (
                        <DropdownMenuItem
                          onSelect={() => setConfirm({ kind: "reopen", rk })}
                        >
                          <Undo2 className="mr-2 h-4 w-4" /> Kembalikan ke Draft
                        </DropdownMenuItem>
                      )}
                      {rk.po_id && canBilling && (
                        <DropdownMenuItem
                          onSelect={() => openBilling(rk)}
                        >
                          <Receipt className="mr-2 h-4 w-4" /> Tagihan
                        </DropdownMenuItem>
                      )}
                      {canDeleteRk(rk) && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setConfirm({ kind: "delete", rk })}
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
          itemLabel="Rekonsil"
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
            <DialogTitle>{detail?.rk_kode || "Rekonsil"}</DialogTitle>
            <DialogDescription>
              {detail?.cabang?.nama_cabang} · {detail?.vendors?.vendor_name}
              {detail?.periode_awal
                ? ` · ${formatDate(detail.periode_awal)} – ${formatDate(detail.periode_akhir)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="border rounded-lg overflow-auto max-h-[60vh]">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="h-9">
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Tgl SPB</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">No. SPB</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detail?.vendor_consignment_rekonsil_items || []).map((i: any) => (
                    <TableRow key={i.id} className="h-10">
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(i.spb_tanggal)}</TableCell>
                      <TableCell className="text-xs font-bold">{i.spb_no}</TableCell>
                      <TableCell>
                        <code className="text-xs font-bold">{i.part_number}</code>
                        <span className="ml-2 text-[10px] text-muted-foreground">{i.part_name}</span>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold">
                        {i.qty} {i.satuan}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!billingRk} onOpenChange={(o) => !o && setBillingRk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tagihan {billingRk?.rk_kode}</DialogTitle>
            <DialogDescription>
              PO {billingRk?.pos?.po_kode} · {billingRk?.vendors?.vendor_name}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className="text-xs">No. Invoice Vendor</Label>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            </div>
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className="text-xs">Tgl Invoice</Label>
              <DatePickerString value={invoiceTanggal} onChange={setInvoiceTanggal} />
            </div>
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className="text-xs">Status Payment</Label>
              <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as "unpaid" | "paid")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">Belum dibayar</SelectItem>
                  <SelectItem value="paid">Sudah dibayar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {paymentStatus === "paid" && (
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label className="text-xs">Tgl Bayar</Label>
                <DatePickerString value={paidAt} onChange={setPaidAt} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBillingRk(null)}>
              Batal
            </Button>
            <Button onClick={saveBilling} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        destructive={confirm?.kind === "delete"}
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm?.kind === "finalize"
            ? `Finalkan BAST ${confirm.rk.rk_kode}?`
            : confirm?.kind === "reopen"
              ? `Kembalikan ${confirm?.rk.rk_kode} ke draft?`
              : `Hapus rekonsil ${confirm?.rk.rk_kode}?`
        }
        description={
          confirm?.kind === "finalize"
            ? "Pastikan BAST sudah ditandatangani admin site, PJO, dan supplier. Setelah final, purchasing bisa membuat PO Rekonsil."
            : confirm?.kind === "reopen"
              ? "Dipakai kalau ada feedback/koreksi. Rekonsil bisa dihapus & dibuat ulang selama belum ada PO."
              : "Baris SPB-nya kembali bisa direkonsil ulang. Tindakan ini tidak bisa dibatalkan."
        }
        confirmText="Lanjutkan"
        onConfirm={runConfirm}
      />
    </>
  );
}
