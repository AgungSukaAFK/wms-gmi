// Dialog form modul Periodic Maintenance (hm.md §6). Validasi berurutan &
// berhenti di error pertama, pesan tampil di bawah form. Toast sukses/gagal
// mengikuti tabel §6.7; pesan error DB (mis. stok kurang) jadi deskripsi.

"use client";

import { ReactNode, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useDebounce } from "use-debounce";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  formatCount,
  formatDate,
  formatHm,
  fromDateInputValue,
  HmPartView,
  HmReplacement,
  HmServiceKind,
  HmUnit,
  parseHmInput,
  SERVICE_KIND_LABEL,
  toDateInputValue,
} from "@/lib/hm";
import {
  createHmPart,
  createHmUnit,
  fetchHmCabangOptions,
  fetchHmReplacements,
  HmBarangOption,
  HmCabangOption,
  recordHmReplacement,
  recordHmService,
  searchHmBarang,
  updateHmPart,
  updateHmUnit,
  updateHmUnitHm,
} from "@/services/hm-maintenance-client";

const NO_CABANG = "none";

export function errorMessage(e: unknown) {
  return e && typeof e === "object" && "message" in e ? String(e.message) : undefined;
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-sm font-medium text-destructive">{message}</p>;
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-semibold">
        {label}
      </Label>
      {children}
    </div>
  );
}

// ============================================================
// Unit (§6.1)
// ============================================================

export function HmUnitFormDialog({
  open,
  onOpenChange,
  unit,
  defaultCabangId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = mode tambah. */
  unit: HmUnit | null;
  /** Site awal saat mode tambah (site yang sedang dipilih). */
  defaultCabangId?: number | null;
  onSaved: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [hm, setHm] = useState("");
  const [cabangId, setCabangId] = useState<string>(NO_CABANG);
  const [cabangOptions, setCabangOptions] = useState<HmCabangOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(unit?.code ?? "");
    setName(unit?.name ?? "");
    setModel(unit?.model ?? "");
    setHm(unit ? String(unit.current_hm) : "");
    const initialCabang = unit ? unit.cabang_id : (defaultCabangId ?? null);
    setCabangId(initialCabang ? String(initialCabang) : NO_CABANG);
    setError(null);
    fetchHmCabangOptions()
      .then(setCabangOptions)
      .catch(() => setCabangOptions([]));
  }, [open, unit, defaultCabangId]);

  async function handleSubmit() {
    const c = code.trim();
    const n = name.trim();
    const m = model.trim();
    if (!c || !n || !m) return setError("Kode, nama, dan model unit wajib diisi.");
    const parsedHm = parseHmInput(hm);
    if (parsedHm === null) return setError("HM terkini harus berupa angka.");
    setError(null);

    const cabang_id = cabangId === NO_CABANG ? null : Number(cabangId);
    setSaving(true);
    try {
      if (unit) {
        // HM sengaja tidak ikut disimpan (hm.md §15.3).
        await updateHmUnit(unit.id, { code: c, name: n, model: m, cabang_id });
        toast.success("Unit diperbarui");
      } else {
        await createHmUnit({ code: c, name: n, model: m, current_hm: parsedHm, cabang_id });
        toast.success("Unit ditambahkan");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(unit ? "Gagal memperbarui unit" : "Gagal menambahkan unit", {
        description: errorMessage(e),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{unit ? "Ubah Unit" : "Tambah Unit"}</DialogTitle>
          <DialogDescription>Data unit dipakai untuk menghitung jatuh tempo seluruh part.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kode Unit" htmlFor="hm-unit-code">
            <Input id="hm-unit-code" placeholder="EXC-01" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Model" htmlFor="hm-unit-model">
            <Input id="hm-unit-model" placeholder="Komatsu PC200" value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Nama Unit" htmlFor="hm-unit-name">
              <Input
                id="hm-unit-name"
                placeholder="Excavator Tambang Blok A"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </div>
          <Field label="HM Terkini" htmlFor="hm-unit-hm">
            <Input
              id="hm-unit-hm"
              inputMode="numeric"
              placeholder="4820"
              value={hm}
              onChange={(e) => setHm(e.target.value)}
              disabled={!!unit}
              title={unit ? "HM diubah lewat tombol Perbarui HM" : undefined}
            />
          </Field>
          <Field label="Site / Gudang (sumber stok part)">
            <Select value={cabangId} onValueChange={setCabangId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih gudang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CABANG}>— Belum ditentukan —</SelectItem>
                {cabangOptions.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {unit && (
          <p className="text-xs text-muted-foreground">HM terkini diubah lewat tombol &quot;Perbarui HM&quot;.</p>
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan Unit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Perbarui HM (§6.5)
// ============================================================

export function HmUpdateHmDialog({
  open,
  onOpenChange,
  unit,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit: HmUnit;
  onSaved: () => void;
}) {
  const [hm, setHm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHm(String(unit.current_hm));
    setError(null);
  }, [open, unit]);

  async function handleSubmit() {
    const parsed = parseHmInput(hm);
    if (parsed === null) return setError("HM harus berupa angka.");
    setError(null);
    setSaving(true);
    try {
      await updateHmUnitHm(unit.id, parsed);
      toast.success("HM unit diperbarui");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error("Gagal memperbarui HM", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Perbarui HM Unit</DialogTitle>
          <DialogDescription>HM terkini dipakai untuk menghitung sisa HM seluruh part.</DialogDescription>
        </DialogHeader>
        <Field label="HM Terkini" htmlFor="hm-update-hm">
          <Input id="hm-update-hm" inputMode="numeric" value={hm} onChange={(e) => setHm(e.target.value)} />
        </Field>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan HM"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Part (§6.2) + link master barang
// ============================================================

export function BarangPicker({
  value,
  onChange,
}: {
  value: HmBarangOption | null;
  onChange: (b: HmBarangOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced] = useDebounce(term, 300);
  const [results, setResults] = useState<HmBarangOption[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    searchHmBarang(debounced)
      .then((r) => !cancelled && setResults(r))
      .catch(() => !cancelled && setResults([]));
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="min-w-0 flex-1 justify-between font-normal">
            <span className="truncate">
              {value ? `${value.part_number} — ${value.part_name}` : "Cari part number / nama barang..."}
            </span>
            <Search className="h-3.5 w-3.5 shrink-0 opacity-40" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[calc(100vw-2rem)] max-w-100 p-0" align="start">
          <div className="border-b p-2">
            <Input
              autoFocus
              placeholder="Cari part number / nama..."
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>
          <div className="max-h-62.5 overflow-y-auto p-1">
            {results.length === 0 && (
              <div className="p-3 text-center text-xs text-muted-foreground">Tidak ada barang ditemukan.</div>
            )}
            {results.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  onChange(b);
                  setOpen(false);
                }}
                className="w-full rounded-md p-2.5 text-left text-sm hover:bg-muted"
              >
                <div className="text-xs font-bold uppercase">{b.part_number}</div>
                <div className="text-xs text-muted-foreground">{b.part_name}</div>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" onClick={() => onChange(null)}>
          Lepas
        </Button>
      )}
    </div>
  );
}

export function HmPartFormDialog({
  open,
  onOpenChange,
  unitId,
  part,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitId: number;
  /** null = mode tambah. */
  part: HmPartView | null;
  onSaved: () => void;
}) {
  const [barang, setBarang] = useState<HmBarangOption | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [intervalHm, setIntervalHm] = useState("");
  const [lastHm, setLastHm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBarang(
      part?.barang_id
        ? { id: part.barang_id, part_number: part.code, part_name: part.name, part_satuan: "" }
        : null,
    );
    setCode(part?.code ?? "");
    setName(part?.name ?? "");
    setIntervalHm(part ? String(part.interval_hm) : "");
    setLastHm(part ? String(part.last_replacement_hm) : "");
    setError(null);
  }, [open, part]);

  function handlePickBarang(b: HmBarangOption | null) {
    setBarang(b);
    if (b) {
      setCode(b.part_number);
      if (!name.trim()) setName(b.part_name);
    }
  }

  async function handleSubmit() {
    const c = code.trim();
    const n = name.trim();
    if (!c) return setError("Part number wajib diisi.");
    if (!n) return setError("Nama part wajib diisi.");
    const iv = parseHmInput(intervalHm);
    if (iv === null || iv <= 0) return setError("Interval HM harus berupa angka lebih dari 0.");
    const last = parseHmInput(lastHm);
    if (last === null) return setError("HM ganti terakhir harus berupa angka.");
    setError(null);

    const input = { barang_id: barang?.id ?? null, code: c, name: n, interval_hm: iv, last_replacement_hm: last };
    setSaving(true);
    try {
      if (part) {
        await updateHmPart(part.id, input);
        toast.success("Part diperbarui");
      } else {
        await createHmPart(unitId, input);
        toast.success("Part ditambahkan");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(part ? "Gagal memperbarui part" : "Gagal menambahkan part", {
        description: errorMessage(e),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{part ? "Ubah Part" : "Tambah Part"}</DialogTitle>
          <DialogDescription>Jatuh tempo dihitung dari HM ganti terakhir + interval part.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Barang (Master Barang)">
              <BarangPicker value={barang} onChange={handlePickBarang} />
            </Field>
            <p className="mt-1 text-xs text-muted-foreground">
              Opsional. Jika di-link, Stock on Hand diambil dari stok WMS di gudang unit dan stok bisa dipotong
              saat penggantian dicatat.
            </p>
          </div>
          <Field label="Part Number" htmlFor="hm-part-code">
            <Input
              id="hm-part-code"
              placeholder="11L-1199"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!!barang}
            />
          </Field>
          <Field label="Deskripsi Part" htmlFor="hm-part-name">
            <Input id="hm-part-name" placeholder="Filter Oli Mesin" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Interval (HM)" htmlFor="hm-part-interval">
            <Input
              id="hm-part-interval"
              inputMode="numeric"
              placeholder="250"
              value={intervalHm}
              onChange={(e) => setIntervalHm(e.target.value)}
            />
          </Field>
          <Field label="HM Ganti Terakhir" htmlFor="hm-part-last">
            <Input
              id="hm-part-last"
              inputMode="numeric"
              placeholder="4500"
              value={lastHm}
              onChange={(e) => setLastHm(e.target.value)}
            />
          </Field>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan Part"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Catat Penggantian (§6.3) + potong stok WMS
// ============================================================

export function HmReplacementFormDialog({
  open,
  onOpenChange,
  unit,
  part,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit: HmUnit;
  part: HmPartView | null;
  onSaved: () => void;
}) {
  const [hm, setHm] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canDeduct = !!part?.barang_id && unit.cabang_id !== null;

  useEffect(() => {
    if (!open) return;
    setHm(String(unit.current_hm));
    setDate(toDateInputValue(new Date()));
    setNote("");
    setQty(canDeduct ? "1" : "0");
    setError(null);
  }, [open, unit, canDeduct]);

  if (!part) return null;

  async function handleSubmit() {
    if (!part) return;
    const parsedHm = parseHmInput(hm);
    if (parsedHm === null) return setError("HM saat ganti harus berupa angka.");
    const parsedDate = fromDateInputValue(date);
    if (!parsedDate) return setError("Tanggal penggantian wajib diisi.");
    const qtyUsed = canDeduct ? parseHmInput(qty) : 0;
    if (qtyUsed === null) return setError("Qty dipakai harus berupa angka.");
    if (canDeduct && part.stock_on_hand !== null && qtyUsed > part.stock_on_hand) {
      return setError(`Stok di gudang unit tidak mencukupi (tersedia ${formatCount(part.stock_on_hand)}).`);
    }
    setError(null);
    setSaving(true);
    try {
      await recordHmReplacement({ partId: part.id, hm: parsedHm, date: parsedDate, note: note.trim(), qtyUsed });
      toast.success("Penggantian dicatat");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error("Gagal mencatat penggantian", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat Penggantian</DialogTitle>
          <DialogDescription>
            {part.code} · {part.name} — HM ganti terakhir dan jatuh tempo akan dihitung ulang.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="HM Saat Ganti" htmlFor="hm-rep-hm">
            <Input id="hm-rep-hm" inputMode="numeric" value={hm} onChange={(e) => setHm(e.target.value)} />
          </Field>
          <Field label="Tanggal" htmlFor="hm-rep-date">
            <Input id="hm-rep-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Qty Dipakai (potong stok gudang unit)" htmlFor="hm-rep-qty">
              <Input
                id="hm-rep-qty"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                disabled={!canDeduct}
              />
            </Field>
            <p className="mt-1 text-xs text-muted-foreground">
              {canDeduct
                ? `Stok tersedia: ${formatCount(part.stock_on_hand ?? 0)}. Isi 0 jika tidak memakai stok gudang.`
                : !part.barang_id
                  ? "Part belum di-link ke master barang — stok tidak dipotong."
                  : "Unit belum punya gudang — stok tidak dipotong."}
            </p>
          </div>
          <div className="sm:col-span-2">
            <Field label="Catatan" htmlFor="hm-rep-note">
              <Textarea
                id="hm-rep-note"
                placeholder="Mekanik, kondisi part, merek filter…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan Penggantian"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Riwayat Penggantian (§9.4)
// ============================================================

export function HmReplacementHistoryDialog({
  open,
  onOpenChange,
  part,
  isAdmin,
  onRecord,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  part: HmPartView | null;
  isAdmin: boolean;
  onRecord: () => void;
}) {
  // Hasil disimpan bersama partId-nya: loading = hasil belum untuk part ini.
  const [result, setResult] = useState<{ partId: number; rows: HmReplacement[] } | null>(null);
  const loading = !!part && result?.partId !== part.id;
  const rows = result?.rows ?? [];

  useEffect(() => {
    if (!open || !part) return;
    let cancelled = false;
    fetchHmReplacements(part.id)
      .then((r) => !cancelled && setResult({ partId: part.id, rows: r }))
      .catch(() => !cancelled && setResult({ partId: part.id, rows: [] }));
    return () => {
      cancelled = true;
      setResult(null);
    };
  }, [open, part]);

  if (!part) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Riwayat Penggantian</DialogTitle>
          <DialogDescription>
            {part.code} · {part.name} — urut dari yang terbaru.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border">
          <Table containerClassName="max-h-[22rem] overflow-y-auto">
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead className="text-right">HM</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Catatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    Belum ada penggantian tercatat untuk part ini.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                      {formatDate(r.date)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                      {formatHm(r.hm)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {r.qty_used > 0 ? formatCount(r.qty_used) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.note || "—"}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
          {isAdmin && (
            <Button
              onClick={() => {
                onOpenChange(false);
                onRecord();
              }}
            >
              Catat Penggantian
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Catat Servis Umum (§6.4)
// ============================================================

export function HmServiceFormDialog({
  open,
  onOpenChange,
  unit,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit: HmUnit;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<HmServiceKind>("rutin");
  const [date, setDate] = useState("");
  const [hm, setHm] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind("rutin");
    setDate(toDateInputValue(new Date()));
    setHm(String(unit.current_hm));
    setNote("");
    setError(null);
  }, [open, unit]);

  async function handleSubmit() {
    const parsedHm = parseHmInput(hm);
    if (parsedHm === null) return setError("HM servis harus berupa angka.");
    const parsedDate = fromDateInputValue(date);
    if (!parsedDate) return setError("Tanggal servis wajib diisi.");
    setError(null);
    setSaving(true);
    try {
      await recordHmService({ unitId: unit.id, kind, date: parsedDate, hm: parsedHm, note: note.trim() });
      toast.success("Servis dicatat");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error("Gagal mencatat servis", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat Servis Umum</DialogTitle>
          <DialogDescription>Servis rutin, perbaikan, atau inspeksi unit.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Jenis Servis">
              <Select value={kind} onValueChange={(v) => setKind(v as HmServiceKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SERVICE_KIND_LABEL) as HmServiceKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {SERVICE_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Tanggal" htmlFor="hm-svc-date">
            <Input id="hm-svc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="HM Saat Servis" htmlFor="hm-svc-hm">
            <Input id="hm-svc-hm" inputMode="numeric" value={hm} onChange={(e) => setHm(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Catatan" htmlFor="hm-svc-note">
              <Textarea
                id="hm-svc-note"
                placeholder="Pekerjaan yang dilakukan, temuan, spare part…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan Servis"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Konfirmasi hapus (§6.6)
// ============================================================

export function HmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  /** Lempar error kalau gagal (dialog tetap terbuka). */
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // toast ditangani pemanggil
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Batal
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={busy}>
            {busy ? "Menghapus…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
