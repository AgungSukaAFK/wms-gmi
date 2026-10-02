"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
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
import { toast } from "sonner";
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

type DraftComponent = WoFormulaComponentInput & { _key: string };

export default function WoFormulaPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [formulas, setFormulas] = useState<any[]>([]);

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
      let q = supabase.from("barang").select("*").order("part_name").limit(15);
      if (debouncedTargetSearch)
        q = q.or(
          `part_number.ilike.%${debouncedTargetSearch}%,part_name.ilike.%${debouncedTargetSearch}%`,
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
      let q = supabase.from("barang").select("*").order("part_name").limit(15);
      if (debouncedComponentSearch)
        q = q.or(
          `part_number.ilike.%${debouncedComponentSearch}%,part_name.ilike.%${debouncedComponentSearch}%`,
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
    if (!confirm("Hapus formula ini? Aksi ini tidak bisa dibatalkan.")) return;
    const result = await deleteWoFormula(formulaId);
    if ((result as any).error) toast.error((result as any).error);
    else {
      toast.success("Formula dihapus.");
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
        .or(`nama.ilike.%${debouncedUserSearch}%,email.ilike.%${debouncedUserSearch}%`)
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

  return (
    <>
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

      <Content size="lg">
        <div className="overflow-hidden rounded-xl border border-border">
          <Table containerClassName="max-h-[70vh] overflow-y-auto">
            <TableHeader className="bg-muted/50 border-b border-border [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:shadow-[0_2px_4px_-2px_rgba(0,0,0,0.15)]">
              <TableRow>
                <TableHead>PN Target</TableHead>
                <TableHead>Nama Barang</TableHead>
                <TableHead className="text-center">Jumlah Komponen</TableHead>
                <TableHead className="text-right pr-6">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {formulas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-40 text-center text-muted-foreground italic">
                    Belum ada formula. Klik &quot;Tambah Formula&quot; untuk membuat.
                  </TableCell>
                </TableRow>
              ) : (
                formulas.map((f) => {
                  const barang = Array.isArray(f.barang) ? f.barang[0] : f.barang;
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="font-mono text-xs font-bold uppercase">
                        {barang?.part_number}
                      </TableCell>
                      <TableCell className="font-semibold">{barang?.part_name}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{f.wo_formula_components?.length || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(f)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(f.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
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
