"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Loader2,
  Plus,
  Trash2,
  Search,
  Pencil,
  Beaker,
  Users,
  ChevronLeft,
  X,
  ShieldAlert,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { useDebounce } from "use-debounce";
import { canManageWoFormula, canGrantWoFormulaAccess } from "@/lib/wo-formula-permissions";
import {
  getWoFormulaList,
  getWoFormulaByTargetPart,
  upsertWoFormula,
  deleteWoFormula,
  getWoFormulaEditors,
  toggleWoFormulaEditor,
  WoFormulaComponentInput,
} from "@/services/wo-formula-actions";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { orIlikePattern } from "@/lib/supabase/search-filter";

type DraftComponent = WoFormulaComponentInput & { _key: string };

// Harus sama dengan kolom yang dicari di `filteredFormulas`.
const FORMULA_SEARCH_FIELDS = ["PN Target", "Nama Barang"];

const FORMULA_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di getFormulaSortValue.
const FORMULA_COLUMNS = [
  { id: "pn", label: "PN Target", sortDirection: "asc", className: FORMULA_HEAD_CLASS },
  { id: "nama", label: "Nama Barang", sortDirection: "asc", className: FORMULA_HEAD_CLASS },
  { id: "komponen", label: "Jumlah Komponen", className: `text-center ${FORMULA_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type FormulaColumnId = (typeof FORMULA_COLUMNS)[number]["id"];

const formulaBarang = (f: any) =>
  Array.isArray(f.barang) ? f.barang[0] : f.barang;

const getFormulaSortValue = (f: any, key: string) =>
  key === "pn" ? formulaBarang(f)?.part_number : formulaBarang(f)?.part_name;

export default function WoFormulaPage() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [formulas, setFormulas] = useState<any[]>([]);
  const columnOrder = useColumnOrder("wms:table-column-order:wo-formula", FORMULA_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const sortOrder = urlState.get("sort", "");
  const setSortOrder = (v: string) => urlState.set({ sort: v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  // Formula editor dialog
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingFormulaId, setEditingFormulaId] = useState<number | null>(null);
  const [targetPart, setTargetPart] = useState<any | null>(null);
  const [targetSearch, setTargetSearch] = useState("");
  const [debouncedTargetSearch] = useDebounce(targetSearch, 300);
  const [targetResults, setTargetResults] = useState<any[]>([]);
  const [targetPopoverOpen, setTargetPopoverOpen] = useState(false);
  const [components, setComponents] = useState<DraftComponent[]>([]);
  const [componentSearch, setComponentSearch] = useState("");
  const [debouncedComponentSearch] = useDebounce(componentSearch, 300);
  const [componentResults, setComponentResults] = useState<any[]>([]);
  const [componentPopoverOpen, setComponentPopoverOpen] = useState(false);

  // Kelola Akses dialog
  const [accessOpen, setAccessOpen] = useState(false);
  const [editors, setEditors] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [debouncedUserSearch] = useDebounce(userSearch, 300);
  const [userResults, setUserResults] = useState<any[]>([]);

  useEffect(() => {
    void init();
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("roles(name)")
      .eq("user_id", user.id);
    const roleNames = (roleRows || [])
      .map((r: any) => r.roles?.name)
      .filter(Boolean);
    setRoles(roleNames);

    if (canManageWoFormula(roleNames)) {
      await refreshFormulas();
    }
    setLoading(false);
  }

  async function refreshFormulas() {
    const { data } = await getWoFormulaList();
    setFormulas(data || []);
  }

  // Search PN target (saat create baru) -- server query, debounced.
  useEffect(() => {
    if (!targetPopoverOpen) return;
    const run = async () => {
      let q = supabase.from("barang").select("*").is("deleted_at", null).order("part_name").limit(15);
      if (debouncedTargetSearch)
        q = q.or(
          `part_number.ilike.${orIlikePattern(debouncedTargetSearch)},part_name.ilike.${orIlikePattern(debouncedTargetSearch)}`,
        );
      const { data } = await q;
      setTargetResults(data || []);
    };
    void run();
  }, [debouncedTargetSearch, targetPopoverOpen]);

  // Search PN komponen.
  useEffect(() => {
    if (!componentPopoverOpen) return;
    const run = async () => {
      let q = supabase.from("barang").select("*").is("deleted_at", null).order("part_name").limit(15);
      if (debouncedComponentSearch)
        q = q.or(
          `part_number.ilike.${orIlikePattern(debouncedComponentSearch)},part_name.ilike.${orIlikePattern(debouncedComponentSearch)}`,
        );
      const { data } = await q;
      setComponentResults(data || []);
    };
    void run();
  }, [debouncedComponentSearch, componentPopoverOpen]);

  function openCreate() {
    setEditingFormulaId(null);
    setTargetPart(null);
    setTargetSearch("");
    setComponents([]);
    setEditorOpen(true);
  }

  async function openEdit(formulaRow: any) {
    const targetBarang = Array.isArray(formulaRow.barang)
      ? formulaRow.barang[0]
      : formulaRow.barang;
    setEditingFormulaId(formulaRow.id);
    setTargetPart({ id: formulaRow.target_part_id, ...targetBarang });
    setTargetSearch("");
    setEditorOpen(true);

    const { data } = await getWoFormulaByTargetPart(formulaRow.target_part_id);
    const comps = (data?.wo_formula_components || []).map((c: any) => ({
      _key: `${c.component_part_id}`,
      component_part_id: c.component_part_id,
      component_part_number: c.component_part_number,
      component_part_name: c.component_part_name,
      component_satuan: c.component_satuan,
      qty_per_unit: Number(c.qty_per_unit),
    }));
    setComponents(comps);
  }

  function addComponent(barang: any) {
    if (components.some((c) => c.component_part_id === barang.id)) {
      toast.error("Komponen ini sudah ada di daftar.");
      return;
    }
    setComponents((prev) => [
      ...prev,
      {
        _key: `${barang.id}`,
        component_part_id: barang.id,
        component_part_number: barang.part_number,
        component_part_name: barang.part_name,
        component_satuan: barang.part_satuan,
        qty_per_unit: 1,
      },
    ]);
    setComponentPopoverOpen(false);
    setComponentSearch("");
  }

  function updateComponentQty(key: string, qty: number) {
    setComponents((prev) =>
      prev.map((c) => (c._key === key ? { ...c, qty_per_unit: qty } : c)),
    );
  }

  function removeComponent(key: string) {
    setComponents((prev) => prev.filter((c) => c._key !== key));
  }

  async function handleSaveFormula() {
    if (!targetPart) return toast.error("Pilih PN target dulu.");
    if (components.length === 0)
      return toast.error("Minimal 1 komponen formula harus diisi.");
    for (const c of components) {
      if (!c.qty_per_unit || c.qty_per_unit <= 0)
        return toast.error(`${c.component_part_number}: qty per unit harus > 0.`);
    }

    setSaving(true);
    try {
      const result = await upsertWoFormula(
        targetPart.id,
        components.map(({ _key, ...c }) => c),
      );
      if ((result as any).error) {
        toast.error((result as any).error);
      } else {
        toast.success("Formula tersimpan.");
        setEditorOpen(false);
        await refreshFormulas();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(formulaId: number) {
    if (
      !(await confirm({
        title: "Hapus formula ini?",
        confirmText: "Hapus",
        destructive: true,
      }))
    )
      return;
    const toastId = toast.loading("Menghapus formula...");
    const result = await deleteWoFormula(formulaId);
    if ((result as any).error) toast.error((result as any).error, { id: toastId });
    else {
      toast.success("Formula dihapus.", { id: toastId });
      await refreshFormulas();
    }
  }

  async function openAccess() {
    setAccessOpen(true);
    const { data } = await getWoFormulaEditors();
    setEditors(data || []);
  }

  useEffect(() => {
    if (!accessOpen) return;
    const run = async () => {
      if (!debouncedUserSearch) {
        setUserResults([]);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("id, nama, email")
        .or(`nama.ilike.${orIlikePattern(debouncedUserSearch)},email.ilike.${orIlikePattern(debouncedUserSearch)}`)
        .limit(10);
      setUserResults(data || []);
    };
    void run();
  }, [debouncedUserSearch, accessOpen]);

  async function grantAccess(userId: string) {
    const result = await toggleWoFormulaEditor(userId, true);
    if ((result as any).error) return toast.error((result as any).error);
    toast.success("Akses diberikan.");
    setUserSearch("");
    setUserResults([]);
    const { data } = await getWoFormulaEditors();
    setEditors(data || []);
  }

  async function revokeAccess(userId: string) {
    const result = await toggleWoFormulaEditor(userId, false);
    if ((result as any).error) return toast.error((result as any).error);
    toast.success("Akses dicabut.");
    const { data } = await getWoFormulaEditors();
    setEditors(data || []);
  }

  if (loading) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canManageWoFormula(roles)) {
    return (
      <Content size="lg">
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-bold text-foreground uppercase">Akses Ditolak</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Halaman ini hanya untuk moderator dan user yang dipilih moderator
            sebagai pengelola Working Order Formula.
          </p>
        </div>
      </Content>
    );
  }

  const canGrant = canGrantWoFormulaAccess(roles);

  const filteredFormulas = formulas.filter((f) => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    const barang = formulaBarang(f);
    return (
      barang?.part_number?.toLowerCase().includes(q) ||
      barang?.part_name?.toLowerCase().includes(q)
    );
  });

  const sorted = sortRows(filteredFormulas, sortOrder, getFormulaSortValue);
  const totalCount = sorted.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(totalCount / limit)));
  const pageRows = sorted.slice((safePage - 1) * limit, safePage * limit);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (f: any, id: FormulaColumnId) => {
    const barang = Array.isArray(f.barang) ? f.barang[0] : f.barang;

    switch (id) {
      case "pn":
        return (
          <TableCell className="font-mono text-xs font-bold uppercase">
            {barang?.part_number}
          </TableCell>
        );
      case "nama":
        return (
          <TableCell className="font-semibold">{barang?.part_name}</TableCell>
        );
      case "komponen":
        return (
          <TableCell className="text-center">
            <Badge variant="outline">{f.wo_formula_components?.length || 0}</Badge>
          </TableCell>
        );
    }
  };

  return (
    <>
      {confirmDialog}
      <Content size="lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/working-order")}
              className="h-9 w-9 shrink-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Beaker className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Manajemen WO Formula
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Komposisi bahan per PN untuk Working Order
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {canGrant && (
              <Button variant="outline" onClick={openAccess} className="gap-2">
                <Users className="h-4 w-4" /> Kelola Akses
              </Button>
            )}
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" /> Tambah Formula
            </Button>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari PN target atau nama barang..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={FORMULA_SEARCH_FIELDS}
          />
        </div>
      </Content>

      <Content>
        {columnOrder.isCustomOrder && (
          <ColumnOrderReset onReset={columnOrder.resetOrder} />
        )}
        <StickyHeaderTable
          className="min-w-[800px]"
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
                  <TableCell colSpan={4}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {debouncedSearch
                    ? "Tidak ada data yang sesuai filter"
                    : "Belum ada formula"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((f) => (
                <TableRow key={f.id}>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(f, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => openEdit(f)}
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => handleDelete(f.id)}
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
          currentPage={safePage}
          totalItems={totalCount}
          limit={limit}
          itemLabel="Formula"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      {/* Formula editor dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingFormulaId ? "Edit Formula" : "Tambah Formula"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                PN Target
              </Label>
              {editingFormulaId ? (
                <div className="p-3 bg-muted/40 border border-border rounded-lg text-sm font-bold">
                  {targetPart?.part_number} — {targetPart?.part_name}
                </div>
              ) : (
                <Popover open={targetPopoverOpen} onOpenChange={setTargetPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      {targetPart ? `${targetPart.part_number} — ${targetPart.part_name}` : "Cari PN target..."}
                      <Search className="h-3.5 w-3.5 opacity-40" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[calc(100vw-2rem)] max-w-100 p-0" align="start">
                    <div className="p-2 border-b border-border">
                      <Input
                        placeholder="Cari part number / nama..."
                        value={targetSearch}
                        onChange={(e) => setTargetSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-62.5 overflow-y-auto p-1">
                      {targetResults.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => {
                            setTargetPart(b);
                            setTargetPopoverOpen(false);
                          }}
                          className="w-full text-left p-2.5 rounded-md hover:bg-muted text-sm"
                        >
                          <div className="font-bold text-xs uppercase">{b.part_number}</div>
                          <div className="text-xs text-muted-foreground">{b.part_name}</div>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                  Komponen Formula
                </Label>
                <Popover open={componentPopoverOpen} onOpenChange={setComponentPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Tambah Komponen
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[calc(100vw-2rem)] max-w-100 p-0" align="end">
                    <div className="p-2 border-b border-border">
                      <Input
                        placeholder="Cari part number / nama..."
                        value={componentSearch}
                        onChange={(e) => setComponentSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-62.5 overflow-y-auto p-1">
                      {componentResults.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => addComponent(b)}
                          className="w-full text-left p-2.5 rounded-md hover:bg-muted text-sm"
                        >
                          <div className="font-bold text-xs uppercase">{b.part_number}</div>
                          <div className="text-xs text-muted-foreground">{b.part_name}</div>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Part Number</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead className="w-32 text-center">Qty / Unit</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {components.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-20 text-center text-muted-foreground italic text-xs">
                          Belum ada komponen
                        </TableCell>
                      </TableRow>
                    ) : (
                      components.map((c) => (
                        <TableRow key={c._key}>
                          <TableCell className="font-mono text-xs font-bold uppercase">
                            {c.component_part_number}
                          </TableCell>
                          <TableCell className="text-xs">{c.component_part_name}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={c.qty_per_unit}
                              onChange={(e) =>
                                updateComponentQty(c._key, Number(e.target.value) || 0)
                              }
                              className="h-8 text-center"
                            />
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => removeComponent(c._key)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleSaveFormula} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Formula"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kelola Akses dialog */}
      <Dialog open={accessOpen} onOpenChange={setAccessOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Kelola Akses WO Formula</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Tambah User
              </Label>
              <Input
                placeholder="Cari nama / email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
              {userResults.length > 0 && (
                <div className="border border-border rounded-lg max-h-40 overflow-y-auto">
                  {userResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => grantAccess(u.id)}
                      className="w-full text-left p-2.5 hover:bg-muted text-sm flex items-center justify-between"
                    >
                      <span>
                        <span className="font-semibold">{u.nama}</span>{" "}
                        <span className="text-xs text-muted-foreground">{u.email}</span>
                      </span>
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                User dengan Akses
              </Label>
              <div className="border border-border rounded-lg divide-y divide-border">
                {editors.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground italic">
                    Belum ada user tambahan (selain moderator).
                  </div>
                ) : (
                  editors.map((u) => (
                    <div key={u.id} className="p-2.5 flex items-center justify-between text-sm">
                      <span>
                        <span className="font-semibold">{u.nama}</span>{" "}
                        <span className="text-xs text-muted-foreground">{u.email}</span>
                      </span>
                      <Button variant="ghost" size="icon" onClick={() => revokeAccess(u.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessOpen(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
