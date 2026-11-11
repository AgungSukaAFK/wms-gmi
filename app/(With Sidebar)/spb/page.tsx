"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Ban,
  Edit2,
  FileWarning,
  Loader2,
  MapPin,
  Plus,
  Printer,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/toast";
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
  FilterFields,
  FilterPanel,
  FilterRange,
  FilterRangeFields,
  filterOptionLabel,
  formatFilterDate,
  formatFilterRange,
} from "@/components/filter-panel";
import { ListSearchInput } from "@/components/list-search-input";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePickerString } from "@/components/date-picker-string";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  cancelSpb,
  deleteSpb,
  getSpbList,
  getStockOutApprovalTemplateOptions,
  previewStockOutApprovalFromTemplate,
  updateSpb,
} from "@/services/spb-actions";
import { getCabangList } from "@/services/master-actions";
import { UnitPicker } from "@/components/units/unit-picker";
import { useAuthStore } from "@/stores/auth-store";
import { formatDate } from "@/lib/utils";
import {
  SPB_BASE_STATUSES,
  SPB_COMPLETING_STATUSES,
  spbBaseStatusClass,
  spbCompletingStatusClass,
} from "@/lib/spb-status";
import { useConfirmDialog } from "@/components/confirm-dialog";

type CabangOption = { id: number; nama_cabang: string };

type SpbRow = {
  id: number;
  spb_no: string;
  spb_is_consignment?: boolean | null;
  spb_no_wo?: string | null;
  spb_tanggal: string;
  spb_kode_unit?: string | null;
  spb_tipe_unit?: string | null;
  spb_brand?: string | null;
  spb_hm?: number | null;
  spb_gudang?: string | null;
  spb_pic_gmi?: string | null;
  spb_pic_ppa?: string | null;
  spb_status: string;
  approval_template_id?: number | null;
  // Computed column (null kalau migration status SPB belum dijalankan).
  spb_base_status?: string | null;
  spb_base_missing?: string[] | null;
  spb_completing_status?: string | null;
};

type SpbTemplateOption = { id: number; name: string | null; cabang_id: number | null };
type SpbApprovalPreviewStep = { nama: string; position?: string | null };

// Harus sama dengan kolom yang dicari di getSpbList.
const SPB_SEARCH_FIELDS = ["No SPB", "No WO", "PIC GMI", "PIC PPA"];

const SPB_STATUS_OPTIONS = [
  "DONE QUOT",
  "PO_ATTACH",
  "DO_ATTACH",
  "Partial",
  "Returned",
  "CANCELLED",
];

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key sort di service.
const SPB_COLUMNS = [
  { id: "spb_no", label: "No SPB", sortDirection: "asc" },
  { id: "spb_no_wo", label: "No WO", sortDirection: "asc" },
  { id: "spb_tanggal", label: "Tanggal", sortDirection: "desc" },
  { id: "spb_kode_unit", label: "Kode Unit", sortDirection: "asc" },
  { id: "spb_tipe_unit", label: "Tipe Unit", sortDirection: "asc" },
  { id: "spb_brand", label: "Brand", sortDirection: "asc" },
  { id: "spb_hm", label: "HM", sortDirection: "asc" },
  { id: "spb_gudang", label: "Lokasi", sortDirection: "asc" },
  { id: "spb_pic_gmi", label: "PIC GMI", sortDirection: "asc" },
  { id: "spb_pic_ppa", label: "PIC PPA", sortDirection: "asc" },
  { id: "spb_status", label: "Status", sortDirection: "asc" },
  { id: "spb_base_status", label: "Base Status", sortDirection: "asc" },
  { id: "spb_completing_status", label: "Completing Status", sortDirection: "asc" },
] as const satisfies readonly ReorderableColumn[];
type SpbColumnId = (typeof SPB_COLUMNS)[number]["id"];

export default function SpbPage() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const profile = useAuthStore((s) => s.profile);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SpbRow[]>([]);
  const columnOrder = useColumnOrder("wms:table-column-order:spb", SPB_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [search, setSearch, resetSearch] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const status = urlState.get("status", "all");
  const setStatus = (v: string) =>
    urlState.set({ status: v === "all" ? "" : v }, { resetPage: true });
  const baseStatus = urlState.get("base", "all");
  const setBaseStatus = (v: string) =>
    urlState.set({ base: v === "all" ? "" : v }, { resetPage: true });
  const completingStatus = urlState.get("progress", "all");
  const setCompletingStatus = (v: string) =>
    urlState.set({ progress: v === "all" ? "" : v }, { resetPage: true });
  const locationFilters = urlState.list("lokasi");
  const setLocationFilters = (v: string[]) =>
    urlState.set({ lokasi: v }, { resetPage: true });
  const dateFrom = urlState.get("dari");
  const setDateFrom = (v: string) =>
    urlState.set({ dari: v }, { resetPage: true });
  const dateTo = urlState.get("sampai");
  const setDateTo = (v: string) =>
    urlState.set({ sampai: v }, { resetPage: true });
  const [availableCabang, setAvailableCabang] = useState<CabangOption[]>([]);
  const sort = urlState.get("sort", "created_at_desc");
  const setSort = (v: string) =>
    urlState.set({ sort: v === "created_at_desc" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });
  const [total, setTotal] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SpbRow | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    spb_no_wo: "",
    spb_section: "",
    spb_pic_ppa: "",
    spb_kode_unit: "",
    spb_tipe_unit: "",
    spb_brand: "",
    spb_hm: "",
    spb_problem_remark: "",
    spb_status: "DONE QUOT",
  });

  // Ubah/perbarui template approval (menentukan nama-nama di slot tanda
  // tangan cetak) — supaya bisa disesuaikan tanpa cancel & buat ulang SPB.
  // `editTemplatePendingId` cuma pilihan di dropdown; baru "commit" jadi
  // `editTemplateAppliedId` (dikirim ke updateSpb bersama approvals hasil
  // preview-nya) setelah "Perbarui dari Template" berhasil, supaya
  // approval_template_id yang tersimpan tidak pernah lepas sinkron dari isi
  // approvals-nya.
  const [editTemplateOptions, setEditTemplateOptions] = useState<SpbTemplateOption[]>([]);
  const [editLoadingTemplates, setEditLoadingTemplates] = useState(false);
  const [editTemplatePendingId, setEditTemplatePendingId] = useState<number | null>(null);
  const [editTemplateAppliedId, setEditTemplateAppliedId] = useState<number | null>(null);
  const [editApprovalsPreview, setEditApprovalsPreview] = useState<
    SpbApprovalPreviewStep[] | null
  >(null);
  const [editApplyingTemplate, setEditApplyingTemplate] = useState(false);

  const canManageSpb = useMemo(() => {
    const roleNames = (
      (profile as { roles?: { name?: string }[] } | null)?.roles || []
    )
      .map((role) => role?.name)
      .filter((name): name is string => Boolean(name));
    return roleNames.some((role) => role === "moderator" || role === "admin");
  }, [profile]);

  const fetchData = async () => {
    setLoading(true);
    const res = await getSpbList({
      search: debouncedSearch || undefined,
      status,
      baseStatus: baseStatus === "all" ? undefined : baseStatus,
      completingStatus: completingStatus === "all" ? undefined : completingStatus,
      cabangIds: locationFilters.length > 0 ? locationFilters.map(Number) : undefined,
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
      setRows((res.data || []) as SpbRow[]);
      setTotal(res.count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [
    debouncedSearch,
    status,
    baseStatus,
    completingStatus,
    locationFilters,
    dateFrom,
    dateTo,
    sort,
    page,
    limit,
  ]);

  useEffect(() => {
    getCabangList().then((data) => setAvailableCabang((data || []) as CabangOption[]));
  }, []);

  const resetFilters = () => {
    resetSearch();
    urlState.reset();
  };

  const locationOptions = availableCabang.map((c) => ({
    label: c.nama_cabang,
    value: c.id.toString(),
  }));

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const activeFilters: ActiveFilter[] = [];
  if (status !== "all")
    activeFilters.push({
      key: "status",
      label: "Status",
      value: status,
      onRemove: () => setStatus("all"),
    });
  if (baseStatus !== "all")
    activeFilters.push({
      key: "base",
      label: "Base Status",
      value: baseStatus,
      onRemove: () => setBaseStatus("all"),
    });
  if (completingStatus !== "all")
    activeFilters.push({
      key: "progress",
      label: "Completing Status",
      value: completingStatus,
      onRemove: () => setCompletingStatus("all"),
    });
  if (locationFilters.length > 0)
    activeFilters.push({
      key: "lokasi",
      label: "Lokasi",
      value: locationFilters
        .map((v) => filterOptionLabel(locationOptions, v))
        .join(", "),
      onRemove: () => setLocationFilters([]),
    });
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

  const openEdit = (row: SpbRow) => {
    setEditTarget(row);
    setEditForm({
      spb_no_wo: row.spb_no_wo || "",
      spb_section: "",
      spb_pic_ppa: row.spb_pic_ppa || "",
      spb_kode_unit: row.spb_kode_unit || "",
      spb_tipe_unit: row.spb_tipe_unit || "",
      spb_brand: row.spb_brand || "",
      spb_hm: row.spb_hm != null ? String(row.spb_hm) : "",
      spb_problem_remark: "",
      spb_status: row.spb_status || "DONE QUOT",
    });
    setEditTemplatePendingId(row.approval_template_id ?? null);
    setEditTemplateAppliedId(null);
    setEditApprovalsPreview(null);
    setEditOpen(true);

    setEditLoadingTemplates(true);
    getStockOutApprovalTemplateOptions("spb", row.id)
      .then((res) => {
        if (res.error) {
          toast.error(res.error);
          setEditTemplateOptions([]);
          return;
        }
        setEditTemplateOptions(res.data || []);
      })
      .finally(() => setEditLoadingTemplates(false));
  };

  const handleApplyEditTemplate = async () => {
    if (!editTarget || !editTemplatePendingId) {
      toast.error("Pilih template terlebih dahulu.");
      return;
    }
    setEditApplyingTemplate(true);
    const res = await previewStockOutApprovalFromTemplate(
      "spb",
      editTarget.id,
      editTemplatePendingId,
    );
    setEditApplyingTemplate(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    setEditApprovalsPreview(res.data as SpbApprovalPreviewStep[]);
    setEditTemplateAppliedId(editTemplatePendingId);
    toast.success(
      "Nama tanda tangan diperbarui dari template. Cek dulu sebelum menyimpan.",
    );
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    const res = await updateSpb(editTarget.id, {
      spb_no_wo: editForm.spb_no_wo || undefined,
      spb_section: editForm.spb_section || undefined,
      spb_pic_ppa: editForm.spb_pic_ppa || undefined,
      // Tipe & brand ditentukan server dari master Unit berdasarkan kode.
      spb_kode_unit: editForm.spb_kode_unit || undefined,
      spb_hm: editForm.spb_hm ? Number(editForm.spb_hm) : undefined,
      spb_problem_remark: editForm.spb_problem_remark || undefined,
      spb_status: editForm.spb_status,
      ...(editApprovalsPreview && editTemplateAppliedId
        ? { approval_template_id: editTemplateAppliedId, approvals: editApprovalsPreview }
        : {}),
    });
    setEditSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("SPB berhasil diperbarui.");
    setEditOpen(false);
    setEditTarget(null);
    fetchData();
  };

  const onDelete = async (row: SpbRow) => {
    const ok = await confirm({
      title: `Hapus SPB ${row.spb_no}?`,
      description:
        "Detail SPB, SPB PO, SPB DO, SPB Invoice, dan Return SPB terkait akan ikut terhapus. " +
        "Stok akan dikembalikan ke gudang asal.",
      confirmText: "Hapus",
      destructive: true,
    });
    if (!ok) return;

    const toastId = toast.loading(`Menghapus SPB ${row.spb_no}...`);
    const res = await deleteSpb(row.id);
    if (res.error) {
      toast.error(`Gagal menghapus SPB: ${res.error}`, { id: toastId });
      return;
    }

    toast.success(`SPB ${row.spb_no} berhasil dihapus.`, { id: toastId });
    fetchData();
  };

  const onCancel = async (row: SpbRow) => {
    const reason = window.prompt(
      `Alasan cancel SPB ${row.spb_no}?\n\nStok yang sudah keluar akan dikembalikan.`,
    );
    if (!reason) return;
    const res = await cancelSpb(row.id, reason);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("SPB berhasil dibatalkan, stok sudah dikembalikan.");
    fetchData();
  };

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (row: SpbRow, id: SpbColumnId) => {
    switch (id) {
      case "spb_no":
        return (
          <TableCell className="font-medium">
            {row.spb_no}
            {row.spb_is_consignment && (
              <span className="ml-1.5 rounded border border-violet-300 bg-violet-50 px-1 text-[9px] font-bold uppercase text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800">
                Konsinyasi
              </span>
            )}
          </TableCell>
        );
      case "spb_no_wo":
        return (
          <TableCell>{row.spb_no_wo || "-"}</TableCell>
        );
      case "spb_tanggal":
        return (
          <TableCell>
            {formatDate(row.spb_tanggal)}
          </TableCell>
        );
      case "spb_kode_unit":
        return (
          <TableCell>{row.spb_kode_unit || "-"}</TableCell>
        );
      case "spb_tipe_unit":
        return (
          <TableCell>{row.spb_tipe_unit || "-"}</TableCell>
        );
      case "spb_brand":
        return (
          <TableCell>{row.spb_brand || "-"}</TableCell>
        );
      case "spb_hm":
        return (
          <TableCell>{row.spb_hm ?? "-"}</TableCell>
        );
      case "spb_gudang":
        return (
          <TableCell>{row.spb_gudang || "-"}</TableCell>
        );
      case "spb_pic_gmi":
        return (
          <TableCell>{row.spb_pic_gmi || "-"}</TableCell>
        );
      case "spb_pic_ppa":
        return (
          <TableCell>{row.spb_pic_ppa || "-"}</TableCell>
        );
      case "spb_status":
        return (
          <TableCell>{row.spb_status}</TableCell>
        );
      case "spb_base_status":
        return (
          <TableCell>
            {row.spb_base_status ? (
              <div className="flex flex-col items-start gap-0.5">
                <span className={spbBaseStatusClass(row.spb_base_status)}>
                  {row.spb_base_status}
                </span>
                {row.spb_base_missing && row.spb_base_missing.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    Kosong: {row.spb_base_missing.join(", ")}
                  </span>
                )}
              </div>
            ) : (
              "-"
            )}
          </TableCell>
        );
      case "spb_completing_status":
        return (
          <TableCell>
            {row.spb_completing_status ? (
              <span className={spbCompletingStatusClass(row.spb_completing_status)}>
                {row.spb_completing_status}
              </span>
            ) : (
              "-"
            )}
          </TableCell>
        );
    }
  };

  return (
    <>
      {confirmDialog}
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <FileWarning className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                SURAT PENGELUARAN BARANG (SPB)
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Stock out sesuai alur WMS lama
              </p>
            </div>
          </div>
          <Button
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
            asChild
          >
            <Link href="/spb/create">
              <Plus className="h-4 w-4" /> BUAT SPB
            </Link>
          </Button>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari No SPB, No WO, PIC"
            value={search}
            onChange={setSearch}
            searchableFields={SPB_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Status">
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                    <SelectValue placeholder="Filter status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    {SPB_STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>

              <FilterField label="Base Status">
                <Select value={baseStatus} onValueChange={setBaseStatus}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                    <SelectValue placeholder="Filter base status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Base Status</SelectItem>
                    {SPB_BASE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>

              <FilterField label="Completing Status">
                <Select value={completingStatus} onValueChange={setCompletingStatus}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                    <SelectValue placeholder="Filter completing status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Completing Status</SelectItem>
                    {SPB_COMPLETING_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>

              <FilterField label="Lokasi">
                <MultiSelect
                  placeholder="Semua Lokasi"
                  icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
                  searchable
                  selected={locationFilters}
                  onChange={setLocationFilters}
                  options={locationOptions}
                />
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tanggal SPB">
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
          className="min-w-[1750px]"
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
                  <TableCell colSpan={14}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={14}
                  className="h-24 text-center text-muted-foreground"
                >
                  Belum ada data SPB.
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
                      {canManageSpb && (
                        <DropdownMenuItem
                          onSelect={() => openEdit(row)}
                        >
                          <Edit2 className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onSelect={() => window.open(`/spb/print/${row.id}`, "_blank")}
                      >
                        <Printer className="mr-2 h-4 w-4" /> Cetak
                      </DropdownMenuItem>
                      {canManageSpb && row.spb_status !== "CANCELLED" && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => onCancel(row)}
                        >
                          <Ban className="mr-2 h-4 w-4" /> Cancel SPB
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => onDelete(row)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Hapus
                      </DropdownMenuItem>
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
          itemLabel="SPB"
          onPageChange={setPage}
          onLimitChange={(v) => {
            setLimit(Number(v));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit SPB</DialogTitle>
            <DialogDescription>
              Moderator/admin dapat memperbarui data header SPB tanpa mengubah
              item detail.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="spb_no_wo">No WO</Label>
              <Input
                id="spb_no_wo"
                value={editForm.spb_no_wo}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_no_wo: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_section">Section</Label>
              <Input
                id="spb_section"
                value={editForm.spb_section}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_section: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_pic_ppa">PIC PPA</Label>
              <Input
                id="spb_pic_ppa"
                value={editForm.spb_pic_ppa}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_pic_ppa: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_kode_unit">Kode Unit</Label>
              <UnitPicker
                value={
                  editForm.spb_kode_unit
                    ? {
                        id: null,
                        kode_unit: editForm.spb_kode_unit,
                        tipe_unit: editForm.spb_tipe_unit,
                        brand: editForm.spb_brand || null,
                      }
                    : null
                }
                onChange={(unit) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_kode_unit: unit.kode_unit,
                    spb_tipe_unit: unit.tipe_unit,
                    spb_brand: unit.brand || "",
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_tipe_unit">Tipe Unit</Label>
              <Input
                id="spb_tipe_unit"
                value={editForm.spb_tipe_unit || "-"}
                readOnly
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_brand">Brand</Label>
              <Input
                id="spb_brand"
                value={editForm.spb_brand || "-"}
                readOnly
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_hm">HM</Label>
              <Input
                id="spb_hm"
                type="number"
                value={editForm.spb_hm}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, spb_hm: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_status">Status</Label>
              <Select
                value={editForm.spb_status}
                onValueChange={(value) =>
                  setEditForm((prev) => ({ ...prev, spb_status: value }))
                }
              >
                <SelectTrigger id="spb_status">
                  <SelectValue placeholder="Pilih status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DONE QUOT">DONE QUOT</SelectItem>
                  <SelectItem value="PO_ATTACH">PO_ATTACH</SelectItem>
                  <SelectItem value="DO_ATTACH">DO_ATTACH</SelectItem>
                  <SelectItem value="Partial">Partial</SelectItem>
                  <SelectItem value="Returned">Returned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="spb_problem_remark">Catatan Masalah</Label>
              <Textarea
                id="spb_problem_remark"
                value={editForm.spb_problem_remark}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_problem_remark: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label>Template Approval (Tanda Tangan Cetak)</Label>
            <p className="text-xs text-muted-foreground leading-relaxed">
              SPB tidak punya approval digital — template ini cuma menentukan
              nama-nama yang tercetak di slot tanda tangan. Kalau template-nya
              sudah direvisi (atau mau pakai template lain), pilih di sini lalu
              klik &ldquo;Perbarui&rdquo; supaya tidak perlu cancel & buat
              ulang SPB.
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={editTemplatePendingId ? String(editTemplatePendingId) : undefined}
                onValueChange={(v) => setEditTemplatePendingId(Number(v))}
                disabled={editLoadingTemplates || editTemplateOptions.length === 0}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue
                    placeholder={editLoadingTemplates ? "Memuat template..." : "Pilih template"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {editTemplateOptions.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name || `Template #${t.id}`}
                      {t.cabang_id === null ? " (Global)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={handleApplyEditTemplate}
                disabled={editApplyingTemplate || !editTemplatePendingId}
              >
                {editApplyingTemplate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="h-3.5 w-3.5" />
                )}
                Perbarui
              </Button>
            </div>
            {editApprovalsPreview && (
              <div className="rounded-md border bg-muted/40 p-2.5 text-xs space-y-1">
                <p className="font-semibold text-muted-foreground">
                  Akan tercetak sebagai:
                </p>
                {editApprovalsPreview.map((step, idx) => (
                  <p key={idx}>
                    {step.position ? `${step.position}: ` : ""}
                    {step.nama || "-"}
                  </p>
                ))}
                <p className="text-[11px] text-amber-600">
                  Belum tersimpan — klik &ldquo;Simpan Perubahan&rdquo; untuk menerapkan.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Batal
            </Button>
            <Button onClick={saveEdit} disabled={editSaving}>
              {editSaving ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
