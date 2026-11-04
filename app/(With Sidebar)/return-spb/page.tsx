"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Printer,
  ShieldAlert,
  Undo2,
  Check,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Content } from "@/components/content";
import { DatePickerString } from "@/components/date-picker-string";
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
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import {
  approveReturnSpb,
  getReturnSpbList,
  rejectReturnSpb,
} from "@/services/spb-actions";
import {
  moderatorEditReturnSpb,
  ModeratorApprovalStep,
} from "@/services/moderator-edit-actions";
import { StockOutModeratorEditDialog } from "@/components/moderator/stock-out-moderator-edit-dialog";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";

// Harus sama dengan kolom yang dicari di getReturnSpbList.
const RETURN_SEARCH_FIELDS = ["Kode Return"];

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key sort di service.
const RETURN_COLUMNS = [
  { id: "rtn_kode", label: "Kode Return", sortDirection: "asc" },
  { id: "spb_no", label: "No SPB" },
  { id: "rtn_tanggal", label: "Tanggal Return", sortDirection: "desc" },
  { id: "rtn_status", label: "Status", sortDirection: "asc" },
  { id: "approval_status", label: "Approval", sortDirection: "asc" },
  { id: "catatan", label: "Catatan" },
  { id: "created_at", label: "Created" },
] as const satisfies readonly ReorderableColumn[];
type ReturnColumnId = (typeof RETURN_COLUMNS)[number]["id"];

export default function ReturnSpbPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const columnOrder = useColumnOrder("wms:table-column-order:return-spb", RETURN_COLUMNS);
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
  const [userId, setUserId] = useState("");

  // Moderator Edit state
  const [isModerator, setIsModerator] = useState(false);
  const [modOpen, setModOpen] = useState(false);
  const [modSaving, setModSaving] = useState(false);
  const [modRow, setModRow] = useState<any>(null);
  const [modRtnTanggal, setModRtnTanggal] = useState("");
  const [modRtnNote, setModRtnNote] = useState("");
  const [modApprovals, setModApprovals] = useState<ModeratorApprovalStep[]>([]);
  const [modRejectionReason, setModRejectionReason] = useState("");
  const [modTemplateId, setModTemplateId] = useState<number | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const res = await getReturnSpbList({
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
    fetchData();
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
        setUserId(user.id);
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

  const isMyApprovalTurn = (row: any) => {
    return (row.approvals || []).some(
      (a: any) => a.userid === userId && a.status === "pending",
    );
  };

  const normalizeApprovalStep = (a: any): ModeratorApprovalStep => ({
    userid: a.userid || a.user_id || "",
    nama: a.nama || "",
    email: a.email || "",
    approval_role:
      a.approval_role === "mengetahui" || a.level === "mengetahui"
        ? "mengetahui"
        : "menyetujui",
    status: a.status || "pending",
    processed_at: a.processed_at ?? null,
    signature_url: a.signature_url ?? null,
    notes: a.notes ?? null,
    snapshot: a.snapshot ?? null,
    position: a.position ?? null,
  });

  const openModEdit = (row: any) => {
    setModRow(row);
    setModRtnTanggal(row.rtn_tanggal ? String(row.rtn_tanggal).slice(0, 10) : "");
    setModRtnNote(row.rtn_note || "");
    setModApprovals((row.approvals || []).map(normalizeApprovalStep));
    setModRejectionReason("");
    setModTemplateId(row.approval_template_id ?? null);
    setModOpen(true);
  };

  const modWillBeApproved =
    modApprovals.length > 0 && modApprovals.every((a) => a.status === "approved");
  const modDowngradeLocked = modRow?.approval_status === "completed";
  const modBlockedDowngrade = modDowngradeLocked && !modWillBeApproved;

  const handleModSave = async () => {
    if (!modRow) return;
    setModSaving(true);
    const res = await moderatorEditReturnSpb(modRow.id, {
      rtn_tanggal: modRtnTanggal || undefined,
      rtn_note: modRtnNote || null,
      approval_template_id: modTemplateId ?? undefined,
      approvals: modApprovals,
      rejection_reason: modRejectionReason,
    });
    if (res.error) {
      toast.error(res.error);
      setModSaving(false);
      return;
    }
    toast.success("Moderator Edit berhasil disimpan.");
    setModOpen(false);
    setModSaving(false);
    fetchData();
  };

  const onApprove = async (id: number) => {
    const res = await approveReturnSpb(id);
    if (res.error) return toast.error(res.error);
    toast.success("Approval return berhasil diproses.");
    fetchData();
  };

  const onReject = async (id: number) => {
    const reason = window.prompt("Alasan reject Return SPB:");
    if (!reason) return;
    const res = await rejectReturnSpb(id, reason);
    if (res.error) return toast.error(res.error);
    toast.success("Return SPB berhasil direject.");
    fetchData();
  };

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (row: any, id: ReturnColumnId) => {
    switch (id) {
      case "rtn_kode":
        return (
          <TableCell className="font-medium">
            {row.rtn_kode}
          </TableCell>
        );
      case "spb_no":
        return (
          <TableCell>{row.spb?.spb_no || "-"}</TableCell>
        );
      case "rtn_tanggal":
        return (
          <TableCell>
            {formatDate(row.rtn_tanggal)}
          </TableCell>
        );
      case "rtn_status":
        return (
          <TableCell>{row.rtn_status}</TableCell>
        );
      case "approval_status":
        return (
          <TableCell>{row.approval_status || "open"}</TableCell>
        );
      case "catatan":
        return (
          <TableCell>{row.rtn_note || "-"}</TableCell>
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
              <Undo2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                RETURN SPB
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Pengembalian barang dari SPB
              </p>
            </div>
          </div>
          <Button
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
            asChild
          >
            <Link href="/return-spb/create">
              <Plus className="h-4 w-4" /> BUAT RETURN
            </Link>
          </Button>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari kode return"
            value={search}
            onChange={setSearch}
            searchableFields={RETURN_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterRangeFields>
              <FilterField label="Tanggal Return">
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
                  Belum ada data return.
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
                        onSelect={() => window.open(`/return-spb/print/${row.id}`, "_blank")}
                      >
                        <Printer className="mr-2 h-4 w-4" /> Cetak
                      </DropdownMenuItem>
                      {row.approval_status === "open" && isMyApprovalTurn(row) && (
                        <>
                          <DropdownMenuItem
                            onSelect={() => onApprove(row.id)}
                          >
                            <Check className="mr-2 h-4 w-4" /> Approve
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => onReject(row.id)}
                          >
                            <X className="mr-2 h-4 w-4" /> Reject
                          </DropdownMenuItem>
                        </>
                      )}
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
          itemLabel="Return SPB"
          onPageChange={setPage}
          onLimitChange={(v) => {
            setLimit(Number(v));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      {modRow && (
        <StockOutModeratorEditDialog
          open={modOpen}
          onOpenChange={setModOpen}
          title={`Moderator Edit — Return SPB ${modRow.rtn_kode}`}
          docType="return_spb"
          docId={modRow.id}
          fields={[
            {
              key: "rtn_tanggal",
              label: "Tanggal Return",
              type: "date",
              value: modRtnTanggal,
              onChange: setModRtnTanggal,
            },
            {
              key: "rtn_note",
              label: "Catatan",
              type: "textarea",
              value: modRtnNote,
              onChange: setModRtnNote,
            },
          ]}
          approvals={modApprovals}
          onApprovalsChange={setModApprovals}
          rejectionReason={modRejectionReason}
          onRejectionReasonChange={setModRejectionReason}
          downgradeLocked={modDowngradeLocked}
          downgradeLockedMessage="Return ini berstatus completed, kemungkinan sudah diposting ke stok. Status approval tidak bisa diturunkan dari 'completed' tanpa membereskan posting tersebut terlebih dahulu."
          blockedDowngrade={modBlockedDowngrade}
          saving={modSaving}
          onSave={handleModSave}
          currentTemplateId={modTemplateId}
          onTemplateIdChange={setModTemplateId}
        />
      )}
    </>
  );
}
