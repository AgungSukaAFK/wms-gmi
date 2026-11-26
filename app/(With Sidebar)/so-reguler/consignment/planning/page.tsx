"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn, formatDate } from "@/lib/utils";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { MultiSelect } from "@/components/ui/multi-select";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  type ActiveFilter,
  FilterField,
  FilterFields,
  FilterPanel,
  filterOptionLabel,
} from "@/components/filter-panel";
import { ListSearchInput } from "@/components/list-search-input";
import { StickyHeaderTable } from "@/components/sticky-header-table";
import { TablePaginationFooter } from "@/components/table-pagination-footer";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import { toast } from "@/lib/toast";
import { CalendarRange, Plus, Truck, Lock, LockOpen, Trash2 } from "lucide-react";
import {
  deleteIkPlan,
  getIkPlanRows,
  setIkPlanStatus,
} from "@/services/consignment-ik-plan-actions";
import {
  daysToDue,
  isIkPlanner,
  PLAN_PROGRESS_COLOR,
  PLAN_PROGRESS_LABEL,
  type IkPlanRow,
  type PlanProgress,
} from "@/lib/consignment-plan";

const SEARCH_FIELDS = ["Kode Planning", "No. PO", "No. SO", "Part Number", "PN Cust"];

const PROGRESS_OPTIONS = (Object.keys(PLAN_PROGRESS_LABEL) as PlanProgress[]).map((k) => ({
  value: k,
  label: PLAN_PROGRESS_LABEL[k],
}));

const DUE_OPTIONS = [
  { value: "lewat", label: "Lewat due date" },
  { value: "7", label: "≤ 7 hari lagi" },
  { value: "30", label: "≤ 30 hari lagi" },
];

const SOH_OPTIONS = [{ value: "kurang", label: "Stok kurang (minus)" }];

const TH = "text-[10px] font-black uppercase text-muted-foreground whitespace-nowrap";
const NUM = "text-right text-xs tabular-nums";

function SisaDue({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted-foreground">-</span>;
  return (
    <span
      className={cn(
        "font-bold whitespace-nowrap",
        days < 0 ? "text-destructive" : days <= 7 ? "text-amber-600 dark:text-amber-400" : "",
      )}
    >
      {days < 0 ? `Lewat ${-days} hr` : `${days} hr`}
    </span>
  );
}

type ConfirmAction = { kind: "close" | "open" | "delete"; row: IkPlanRow } | null;

export default function ConsignmentIkPlanningPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<IkPlanRow[]>([]);
  const [canPlan, setCanPlan] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);

  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  // Default: sembunyikan baris selesai/ditutup (tampil kalau filter status diisi).
  const progressFilters = urlState.list("status");
  const customerFilters = urlState.list("customer");
  const siteFilters = urlState.list("site");
  const dueFilter = urlState.get("due");
  const sohFilter = urlState.get("soh");
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 50);
  const setLimit = (n: number) => urlState.set({ limit: n === 50 ? "" : n });

  const load = async () => {
    setLoading(true);
    const res = await getIkPlanRows();
    if (res.error) toast.error(res.error);
    setRows(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("user_roles").select("roles(name)").eq("user_id", user.id);
      setCanPlan(isIkPlanner((data || []).map((r: any) => r.roles?.name).filter(Boolean)));
    });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customerOptions = useMemo(
    () =>
      [...new Map(rows.map((r) => [String(r.customer_id), r.customer_name || "-"])).entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [rows],
  );
  const siteOptions = useMemo(
    () =>
      [...new Set(rows.map((r) => r.site_name))]
        .sort((a, b) => a.localeCompare(b))
        .map((s) => ({ value: s, label: s })),
    [rows],
  );

  const filtered = rows.filter((r) => {
    const q = debouncedSearch.toLowerCase();
    if (
      q &&
      ![r.plan_kode, r.no_po, r.so_no, r.part_number, r.part_name, r.part_number_customer].some((v) =>
        v?.toLowerCase().includes(q),
      )
    )
      return false;
    if (progressFilters.length > 0) {
      if (!progressFilters.includes(r.progress)) return false;
    } else if (!q && (r.progress === "selesai" || r.progress === "ditutup")) {
      return false;
    }
    if (customerFilters.length > 0 && !customerFilters.includes(String(r.customer_id))) return false;
    if (siteFilters.length > 0 && !siteFilters.includes(r.site_name)) return false;
    if (dueFilter) {
      const d = daysToDue(r.due_date);
      if (d === null) return false;
      if (dueFilter === "lewat" ? d >= 0 : d < 0 || d > Number(dueFilter)) return false;
    }
    if (sohFilter === "kurang" && !(r.sisa_plan > 0 && r.selisih_soh < 0)) return false;
    return true;
  });

  const totalCount = filtered.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(totalCount / limit)));
  const pageRows = filtered.slice((safePage - 1) * limit, safePage * limit);

  const summary = useMemo(() => {
    const active = filtered.filter((r) => r.sisa_plan > 0);
    return {
      plans: new Set(filtered.map((r) => r.plan_id)).size,
      sisa: active.reduce((s, r) => s + r.sisa_plan, 0),
      kurang: active.filter((r) => r.selisih_soh < 0).length,
      lewat: active.filter((r) => (daysToDue(r.due_date) ?? 0) < 0).length,
    };
  }, [filtered]);

  const activeFilters: ActiveFilter[] = [];
  const labels = (opts: { value: string; label: string }[], vals: string[]) =>
    vals.map((v) => filterOptionLabel(opts, v)).join(", ");
  if (progressFilters.length > 0)
    activeFilters.push({
      key: "status",
      label: "Status",
      value: labels(PROGRESS_OPTIONS, progressFilters),
      onRemove: () => urlState.set({ status: [] }, { resetPage: true }),
    });
  if (customerFilters.length > 0)
    activeFilters.push({
      key: "customer",
      label: "Customer",
      value: labels(customerOptions, customerFilters),
      onRemove: () => urlState.set({ customer: [] }, { resetPage: true }),
    });
  if (siteFilters.length > 0)
    activeFilters.push({
      key: "site",
      label: "Site",
      value: siteFilters.join(", "),
      onRemove: () => urlState.set({ site: [] }, { resetPage: true }),
    });
  if (dueFilter)
    activeFilters.push({
      key: "due",
      label: "Due Date",
      value: filterOptionLabel(DUE_OPTIONS, dueFilter),
      onRemove: () => urlState.set({ due: "" }, { resetPage: true }),
    });
  if (sohFilter)
    activeFilters.push({
      key: "soh",
      label: "Stok",
      value: filterOptionLabel(SOH_OPTIONS, sohFilter),
      onRemove: () => urlState.set({ soh: "" }, { resetPage: true }),
    });

  const runConfirm = async () => {
    if (!confirm) return;
    const { kind, row } = confirm;
    const res =
      kind === "delete"
        ? await deleteIkPlan(row.plan_id)
        : await setIkPlanStatus(row.plan_id, kind === "close" ? "closed" : "open");
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(
      kind === "delete"
        ? `Planning ${row.plan_kode} dihapus.`
        : kind === "close"
          ? `Planning ${row.plan_kode} ditutup.`
          : `Planning ${row.plan_kode} dibuka kembali.`,
    );
    load();
  };

  const COLS = 19;

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <CalendarRange className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">Planning IK</h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Rencana kirim sebelum Item Konsinyasi dieksekusi warehouse
              </p>
            </div>
          </div>
          {canPlan && (
            <Link href="/so-reguler/consignment/planning/create">
              <Button className="h-9 gap-2 text-xs font-bold uppercase">
                <Plus className="h-4 w-4" /> Buat Planning IK
              </Button>
            </Link>
          )}
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari Kode Planning, No. PO, No. SO, Part Number, PN Cust..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={SEARCH_FIELDS}
          />
          <FilterPanel
            activeFilters={activeFilters}
            onReset={() => {
              resetSearchQuery();
              urlState.reset();
            }}
          >
            <FilterFields>
              <FilterField label="Status">
                <MultiSelect
                  placeholder="Berjalan (default)"
                  selected={progressFilters}
                  onChange={(v) => urlState.set({ status: v }, { resetPage: true })}
                  options={PROGRESS_OPTIONS}
                />
              </FilterField>
              <FilterField label="Customer">
                <MultiSelect
                  placeholder="Semua Customer"
                  searchable
                  selected={customerFilters}
                  onChange={(v) => urlState.set({ customer: v }, { resetPage: true })}
                  options={customerOptions}
                />
              </FilterField>
              <FilterField label="Site Tujuan">
                <MultiSelect
                  placeholder="Semua Site"
                  searchable
                  selected={siteFilters}
                  onChange={(v) => urlState.set({ site: v }, { resetPage: true })}
                  options={siteOptions}
                />
              </FilterField>
              <FilterField label="Due Date">
                <MultiSelect
                  placeholder="Semua"
                  selected={dueFilter ? [dueFilter] : []}
                  onChange={(v) => urlState.set({ due: v[v.length - 1] || "" }, { resetPage: true })}
                  options={DUE_OPTIONS}
                />
              </FilterField>
              <FilterField label="Stok">
                <MultiSelect
                  placeholder="Semua"
                  selected={sohFilter ? [sohFilter] : []}
                  onChange={(v) => urlState.set({ soh: v[v.length - 1] || "" }, { resetPage: true })}
                  options={SOH_OPTIONS}
                />
              </FilterField>
            </FilterFields>
          </FilterPanel>
          {!loading && (
            <p className="text-[11px] text-muted-foreground">
              {summary.plans} planning · sisa plan <b className="text-foreground">{summary.sisa}</b> qty ·{" "}
              <span className={summary.kurang ? "text-destructive font-semibold" : ""}>
                {summary.kurang} baris stok kurang
              </span>{" "}
              ·{" "}
              <span className={summary.lewat ? "text-destructive font-semibold" : ""}>
                {summary.lewat} baris lewat due date
              </span>
            </p>
          )}
        </div>
      </Content>

      <Content>
        <StickyHeaderTable
          className="min-w-[1900px]"
          containerClassName="rounded-md border"
          header={
            <TableRow className="hover:bg-transparent h-10">
              <TableHead className={TH}>Kode Planning</TableHead>
              <TableHead className={TH}>No. PO</TableHead>
              <TableHead className={TH}>Part Number</TableHead>
              <TableHead className={TH}>PN Cust</TableHead>
              <TableHead className={cn(TH, "text-right")}>Qty PO</TableHead>
              <TableHead className={cn(TH, "text-right")}>Outstanding</TableHead>
              <TableHead className={TH}>Site Tujuan</TableHead>
              <TableHead className={cn(TH, "text-right")}>SOH</TableHead>
              <TableHead className={cn(TH, "text-right")}>Plan Qty</TableHead>
              <TableHead className={cn(TH, "text-right")}>Sudah IK</TableHead>
              <TableHead className={TH}>Tgl PO</TableHead>
              <TableHead className={TH}>Due Date PO</TableHead>
              <TableHead className={TH}>Sisa Due Date</TableHead>
              <TableHead
                className={cn(TH, "text-right")}
                title="SOH dikurangi sisa plan kumulatif part yang sama di gudang yang sama (dijatah dari due date terdekat). Minus = stok tidak cukup."
              >
                SOH − Plan
              </TableHead>
              <TableHead className={TH}>Notes</TableHead>
              <TableHead className={TH}>Status</TableHead>
              <TableHead className={TH}>Customer</TableHead>
              <TableHead className={TH}>Tgl Planning</TableHead>
              <TableHead className={cn(TH, "w-14 text-right pr-4")}>Aksi</TableHead>
            </TableRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: 10 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={COLS}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLS}
                  className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {rows.length === 0 ? "Belum ada Planning IK" : "Tidak ada baris yang sesuai filter"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((r, idx) => {
                const firstOfPlan = idx === 0 || pageRows[idx - 1].plan_id !== r.plan_id;
                const canExecute = r.plan_status === "open" && r.sisa_plan > 0 && r.outstanding > 0;
                return (
                  <TableRow key={r.plan_item_id} className={cn(firstOfPlan && idx > 0 && "border-t-2")}>
                    <TableCell className="text-xs font-bold whitespace-nowrap">{r.plan_kode}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.no_po || "-"}
                      <span className="block text-[10px] text-muted-foreground">{r.so_no}</span>
                    </TableCell>
                    <TableCell className="text-xs">
                      <code className="font-bold">{r.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground truncate max-w-56">
                        {r.part_name}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{r.part_number_customer || "-"}</TableCell>
                    <TableCell className={NUM}>{r.qty_po}</TableCell>
                    <TableCell className={cn(NUM, "font-semibold")}>{r.outstanding}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{r.site_name}</TableCell>
                    <TableCell className={NUM}>
                      {r.soh}
                      <span className="block text-[9px] text-muted-foreground">{r.dari_cabang_name}</span>
                    </TableCell>
                    <TableCell className={cn(NUM, "font-bold")}>{r.plan_qty}</TableCell>
                    <TableCell className={NUM}>{r.realized_qty}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{r.tgl_po ? formatDate(r.tgl_po) : "-"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.due_date ? formatDate(r.due_date) : "-"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.sisa_plan > 0 ? <SisaDue days={daysToDue(r.due_date)} /> : "-"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        NUM,
                        "font-bold",
                        r.sisa_plan > 0 && r.selisih_soh < 0 && "text-destructive",
                      )}
                    >
                      {r.sisa_plan > 0 ? r.selisih_soh : "-"}
                    </TableCell>
                    <TableCell className="text-xs max-w-48">
                      <span className="line-clamp-2" title={r.notes || undefined}>
                        {r.notes || "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={r.progress}
                        label={PLAN_PROGRESS_LABEL[r.progress]}
                        color={PLAN_PROGRESS_COLOR[r.progress]}
                      />
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{r.customer_name || "-"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{formatDate(r.plan_tanggal)}</TableCell>
                    <TableCell className="text-right pr-4">
                      <RowActionsMenu>
                        {canExecute && (
                          <DropdownMenuItem asChild>
                            <Link href={`/so-reguler/consignment/ik/create?plan=${r.plan_id}`}>
                              <Truck className="mr-2 h-4 w-4" /> Buat IK dari {r.plan_kode}
                            </Link>
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/so-reguler/consignment/planning?search=${encodeURIComponent(r.plan_kode)}`}
                          >
                            <CalendarRange className="mr-2 h-4 w-4" /> Lihat semua baris {r.plan_kode}
                          </Link>
                        </DropdownMenuItem>
                        {canPlan && (
                          <>
                            <DropdownMenuSeparator />
                            {r.plan_status === "open" ? (
                              <DropdownMenuItem onSelect={() => setConfirm({ kind: "close", row: r })}>
                                <Lock className="mr-2 h-4 w-4" /> Tutup planning
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => setConfirm({ kind: "open", row: r })}>
                                <LockOpen className="mr-2 h-4 w-4" /> Buka kembali planning
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setConfirm({ kind: "delete", row: r })}
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Hapus planning
                            </DropdownMenuItem>
                          </>
                        )}
                      </RowActionsMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          currentPage={safePage}
          totalItems={totalCount}
          limit={limit}
          itemLabel="baris"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <ConfirmDialog
        destructive={confirm?.kind !== "open"}
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm?.kind === "delete"
            ? `Hapus planning ${confirm.row.plan_kode}?`
            : confirm?.kind === "close"
              ? `Tutup planning ${confirm?.row.plan_kode}?`
              : `Buka kembali planning ${confirm?.row.plan_kode}?`
        }
        description={
          confirm?.kind === "delete"
            ? "Semua baris planning ini ikut terhapus. Hanya bisa kalau belum ada IK yang dibuat dari planning ini."
            : confirm?.kind === "close"
              ? "Sisa plan yang belum dikirim tidak akan dieksekusi lagi dan tidak lagi mengurangi outstanding yang bisa direncanakan. IK yang sudah dibuat tetap."
              : "Sisa plan kembali bisa dieksekusi warehouse."
        }
        confirmText={confirm?.kind === "delete" ? "Hapus" : confirm?.kind === "close" ? "Tutup" : "Buka"}
        onConfirm={runConfirm}
      />
    </>
  );
}
