"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Plus,
  Printer,
  ShieldAlert,
  Truck,
} from "lucide-react";
import { useDebounce } from "use-debounce";
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
  FilterPanel,
  FilterRange,
  FilterRangeFields,
  formatFilterDate,
  formatFilterRange,
} from "@/components/filter-panel";
import { ListSearchInput } from "@/components/list-search-input";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DatePickerString } from "@/components/date-picker-string";
import {
  createSpbDo,
  getSpbDoList,
  getSpbPoDetailsByPoId,
  getSpbPoOptionsForDo,
  updateSpbDo,
} from "@/services/spb-actions";
import { cn, formatDate, ymdToLocalStartIso } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type PoOption = {
  id: number;
  po_no: string;
  spb?: { spb_no?: string } | null;
};

type PoDetailRow = {
  id: number;
  spb_detail?: {
    dtl_spb_part_number: string;
    dtl_spb_part_name: string;
    dtl_spb_qty: number;
    dtl_spb_part_satuan: string;
  } | null;
};

// Harus sama dengan kolom yang dicari di service list.
const SPB_DO_SEARCH_FIELDS = ["No DO", "PIC"];

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key sort di service.
const SPB_DO_COLUMNS = [
  { id: "spb_no", label: "No SPB" },
  { id: "po_no", label: "No PO" },
  { id: "do_no", label: "No DO", sortDirection: "asc" },
  { id: "do_date", label: "Tanggal DO", sortDirection: "desc" },
  { id: "do_status_part", label: "Status Part", sortDirection: "asc" },
  { id: "do_pic", label: "PIC", sortDirection: "asc" },
  { id: "created_at", label: "Created", sortDirection: "desc" },
] as const satisfies readonly ReorderableColumn[];
type SpbDoColumnId = (typeof SPB_DO_COLUMNS)[number]["id"];

export default function SpbDoPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const columnOrder = useColumnOrder("wms:table-column-order:spb-do", SPB_DO_COLUMNS);
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
  const [poOptionSearch, setPoOptionSearch] = useState("");
  const [debouncedPoOptionSearch] = useDebounce(poOptionSearch, 300);

  const [poOptions, setPoOptions] = useState<PoOption[]>([]);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [selectedPoLabel, setSelectedPoLabel] = useState("");
  const [openPoCombobox, setOpenPoCombobox] = useState(false);
  const [poDetails, setPoDetails] = useState<PoDetailRow[]>([]);
  const [selectedDetailIds, setSelectedDetailIds] = useState<number[]>([]);

  const [doNo, setDoNo] = useState("");
  const [doDate, setDoDate] = useState("");
  const [doPic, setDoPic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [openCreateModal, setOpenCreateModal] = useState(false);

  // Moderator Edit state
  const [isModerator, setIsModerator] = useState(false);
  const [modOpen, setModOpen] = useState(false);
  const [modSaving, setModSaving] = useState(false);
  const [modRow, setModRow] = useState<any>(null);
  const [modDoDate, setModDoDate] = useState("");
  const [modDoStatusPart, setModDoStatusPart] = useState("");
  const [modDoPic, setModDoPic] = useState("");

  const selectedPo = useMemo(
    () => poOptions.find((s) => String(s.id) === selectedPoId),
    [poOptions, selectedPoId],
  );

  const fetchList = async () => {
    setLoading(true);
    const res = await getSpbDoList({
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

  const fetchPoOptions = async () => {
    const res = await getSpbPoOptionsForDo({
      search: debouncedPoOptionSearch || undefined,
      limit: 15,
    });
    if (res.error) return;
    setPoOptions((res.data || []) as PoOption[]);
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

  useEffect(() => {
    if (!openCreateModal) return;
    fetchPoOptions();
  }, [openCreateModal, debouncedPoOptionSearch]);

  useEffect(() => {
    const loadDetails = async () => {
      if (!selectedPoId) {
        setPoDetails([]);
        setSelectedDetailIds([]);
        return;
      }
      const res = await getSpbPoDetailsByPoId(Number(selectedPoId));
      if (res.error) {
        toast.error(res.error);
        setPoDetails([]);
        return;
      }
      setPoDetails((res.data || []) as PoDetailRow[]);
      setSelectedDetailIds([]);
    };

    loadDetails();
  }, [selectedPoId]);

  const toggleDetail = (id: number, checked: boolean) => {
    setSelectedDetailIds((prev) =>
      checked ? [...prev, id] : prev.filter((v) => v !== id),
    );
  };

  const submit = async () => {
    if (!selectedPoId) return toast.error("Pilih SPB-PO.");
    if (!doNo.trim()) return toast.error("No DO wajib diisi.");
    if (!selectedDetailIds.length) return toast.error("Pilih minimal 1 item.");

    setSubmitting(true);
    const res = await createSpbDo({
      spb_po_id: Number(selectedPoId),
      do_no: doNo,
      do_date: doDate ? ymdToLocalStartIso(doDate) : undefined,
      do_pic: doPic || undefined,
      details: selectedDetailIds.map((id) => ({ spb_po_dtl_id: id })),
    });
    setSubmitting(false);

    if (res.error) {
      toast.error(res.error);
      return;
    }

    toast.success("SPB-DO berhasil dibuat.");
    resetCreateForm();
    setOpenCreateModal(false);
    fetchList();
  };

  const resetCreateForm = () => {
    setDoNo("");
    setDoDate("");
    setDoPic("");
    setSelectedPoId("");
    setSelectedPoLabel("");
    setPoOptionSearch("");
    setOpenPoCombobox(false);
    setPoDetails([]);
    setSelectedDetailIds([]);
  };

  const handleOpenCreateModal = (open: boolean) => {
    setOpenCreateModal(open);
    if (!open) {
      resetCreateForm();
    }
  };

  const openModEdit = (row: any) => {
    setModRow(row);
    setModDoDate(row.do_date ? String(row.do_date).slice(0, 10) : "");
    setModDoStatusPart(row.do_status_part || "");
    setModDoPic(row.do_pic || "");
    setModOpen(true);
  };

  const handleModSave = async () => {
    if (!modRow) return;
    setModSaving(true);
    const res = await updateSpbDo(modRow.id, {
      do_date: modDoDate ? ymdToLocalStartIso(modDoDate) : null,
      do_status_part: modDoStatusPart || null,
      do_pic: modDoPic || null,
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
  const renderCell = (row: any, id: SpbDoColumnId) => {
    switch (id) {
      case "spb_no":
        return (
          <TableCell>{row.po?.spb?.spb_no || "-"}</TableCell>
        );
      case "po_no":
        return (
          <TableCell>{row.po?.po_no || "-"}</TableCell>
        );
      case "do_no":
        return (
          <TableCell className="font-medium">{row.do_no}</TableCell>
        );
      case "do_date":
        return (
          <TableCell>
            {formatDate(row.do_date)}
          </TableCell>
        );
      case "do_status_part":
        return (
          <TableCell>{row.do_status_part || "-"}</TableCell>
        );
      case "do_pic":
        return (
          <TableCell>{row.do_pic || "-"}</TableCell>
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
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                DELIVERY ORDER (SPB)
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Attach DO ke SPB-PO
              </p>
            </div>
          </div>

          <Button
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
            onClick={() => setOpenCreateModal(true)}
          >
            <Plus className="h-4 w-4" /> BUAT SPB-DO
          </Button>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari No DO atau PIC"
            value={search}
            onChange={setSearch}
            searchableFields={SPB_DO_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterRangeFields>
              <FilterField label="Tanggal DO">
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
                  Belum ada data SPB-DO.
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
                        onSelect={() => window.open(`/spb/do/print/${row.id}`, "_blank")}
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
          itemLabel="SPB DO"
          onPageChange={setPage}
          onLimitChange={(v) => {
            setLimit(Number(v));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <Dialog open={openCreateModal} onOpenChange={handleOpenCreateModal}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Buat SPB-DO</DialogTitle>
            <DialogDescription>
              Pilih SPB-PO, isi data DO, lalu pilih item detail PO.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Pilih SPB-PO</Label>
                <Popover open={openPoCombobox} onOpenChange={setOpenPoCombobox}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={openPoCombobox}
                      className="w-full justify-between font-normal"
                    >
                      <span className="truncate">
                        {selectedPo
                          ? `${selectedPo.po_no} · No SPB: ${selectedPo.spb?.spb_no || "-"}`
                          : selectedPoLabel || "Pilih PO..."}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-(--radix-popover-trigger-width) p-0"
                    align="start"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Cari No PO..."
                        value={poOptionSearch}
                        onValueChange={setPoOptionSearch}
                      />
                      <CommandList>
                        <CommandEmpty>Tidak ada PO ditemukan.</CommandEmpty>
                        <CommandGroup>
                          {poOptions.map((po) => {
                            const value = String(po.id);
                            const label = `${po.po_no} - ${po.spb?.spb_no || "-"}`;

                            return (
                              <CommandItem
                                key={po.id}
                                value={label}
                                onSelect={() => {
                                  setSelectedPoId(value);
                                  setSelectedPoLabel(label);
                                  setOpenPoCombobox(false);
                                }}
                                className="items-start gap-2"
                              >
                                <div className="flex min-w-0 flex-1 flex-col">
                                  <span className="font-semibold truncate">
                                    {po.po_no}
                                  </span>
                                  <span className="text-xs text-muted-foreground truncate">
                                    No SPB: {po.spb?.spb_no || "-"}
                                  </span>
                                </div>
                                <Check
                                  className={cn(
                                    "mt-0.5 shrink-0",
                                    selectedPoId === value
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Tanggal DO</Label>
                <DatePickerString value={doDate} onChange={setDoDate} />
              </div>

              <div className="space-y-2">
                <Label>No DO</Label>
                <Input value={doNo} onChange={(e) => setDoNo(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>PIC</Label>
                <Input
                  value={doPic}
                  onChange={(e) => setDoPic(e.target.value)}
                />
              </div>

            </div>

            {selectedPoId && (
              <div className="rounded-md border">
                <Table
                  className="table-fixed"
                  containerClassName="max-h-[55vh] overflow-y-auto"
                >
                  <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background [&_th]:shadow-[0_2px_4px_-2px_rgba(0,0,0,0.15)]">
                    <TableRow>
                      <TableHead className="w-10">Pilih</TableHead>
                      <TableHead className="w-32">Part Number</TableHead>
                      <TableHead>Part Name</TableHead>
                      <TableHead className="w-16">Qty</TableHead>
                      <TableHead className="w-20">Satuan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poDetails.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-muted-foreground"
                        >
                          Tidak ada detail item.
                        </TableCell>
                      </TableRow>
                    ) : (
                      poDetails.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedDetailIds.includes(item.id)}
                              onChange={(e) =>
                                toggleDetail(item.id, e.target.checked)
                              }
                            />
                          </TableCell>
                          <TableCell
                            className="truncate"
                            title={item.spb_detail?.dtl_spb_part_number || "-"}
                          >
                            {item.spb_detail?.dtl_spb_part_number || "-"}
                          </TableCell>
                          <TableCell
                            className="truncate"
                            title={item.spb_detail?.dtl_spb_part_name || "-"}
                          >
                            {item.spb_detail?.dtl_spb_part_name || "-"}
                          </TableCell>
                          <TableCell>
                            {item.spb_detail?.dtl_spb_qty || 0}
                          </TableCell>
                          <TableCell>
                            {item.spb_detail?.dtl_spb_part_satuan || "-"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenCreateModal(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Menyimpan..." : "Simpan SPB-DO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modOpen} onOpenChange={setModOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Moderator Edit — SPB DO {modRow?.do_no}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tanggal DO</Label>
              <DatePickerString value={modDoDate} onChange={setModDoDate} />
            </div>
            <div className="space-y-2">
              <Label>Status Part</Label>
              <Input
                value={modDoStatusPart}
                onChange={(e) => setModDoStatusPart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>PIC</Label>
              <Input value={modDoPic} onChange={(e) => setModDoPic(e.target.value)} />
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
