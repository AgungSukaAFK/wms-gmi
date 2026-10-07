// Dialog Forecasting AC: pengaturan AC unit, catat servis AC, paket part AC,
// dan part mayor tambahan per bulan. Pola validasi & toast sama dengan
// hm-dialogs.tsx (berhenti di error pertama, pesan DB jadi deskripsi toast).

"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatHm, fromDateInputValue, parseHmInput, toDateInputValue, type HmUnit } from "@/lib/hm";
import {
  AC_SECTION_LABEL,
  AC_SECTIONS,
  formatPeriod,
  formatRupiah,
  parseNumberInput,
  type HmAcPackage,
  type HmAcSection,
  type HmAcUnitRow,
} from "@/lib/hm-ac";
import type { HmBarangOption } from "@/services/hm-maintenance-client";
import {
  createAcExtra,
  recordAcService,
  saveAcPackage,
  upsertAcSetting,
} from "@/services/hm-ac-client";
import { BarangPicker, errorMessage, Field, FormError } from "@/components/hm-maintenance/hm-dialogs";

const NO_PACKAGE = "none";

// ============================================================
// Pengaturan AC unit
// ============================================================

export function AcUnitSettingDialog({
  open,
  onOpenChange,
  row,
  packages,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: HmAcUnitRow | null;
  packages: HmAcPackage[];
  onSaved: () => void;
}) {
  const [section, setSection] = useState<HmAcSection>("track");
  const [packageId, setPackageId] = useState(NO_PACKAGE);
  const [intervalHm, setIntervalHm] = useState("2000");
  const [lastHm, setLastHm] = useState("");
  const [daily, setDaily] = useState("20");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    const ac = row.ac;
    setSection(ac?.section ?? "track");
    setPackageId(ac?.package_id ? String(ac.package_id) : NO_PACKAGE);
    setIntervalHm(String(ac?.interval_hm ?? 2000));
    // Default unit baru: anggap servis AC terakhir di kelipatan interval
    // terdekat di bawah HM sekarang.
    setLastHm(String(ac?.last_service_hm ?? Math.floor(row.current_hm / 2000) * 2000));
    setDaily(String(ac?.daily_hm ?? 20).replace(".", ","));
    setActive(ac?.is_active ?? true);
    setError(null);
  }, [open, row]);

  if (!row) return null;

  async function handleSubmit() {
    if (!row) return;
    const i = parseHmInput(intervalHm);
    if (!i) return setError("Interval servis AC harus lebih dari 0 HM.");
    const l = parseHmInput(lastHm);
    if (l === null) return setError("HM servis AC terakhir harus berupa angka.");
    const d = parseNumberInput(daily);
    if (!d || d <= 0 || d > 24) return setError("Rata-rata HM per hari harus antara 0 dan 24.");
    setError(null);
    setSaving(true);
    try {
      await upsertAcSetting(row.id, {
        section,
        package_id: packageId === NO_PACKAGE ? null : Number(packageId),
        interval_hm: i,
        last_service_hm: l,
        daily_hm: d,
        is_active: active,
      });
      toast.success("Pengaturan AC unit disimpan");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error("Gagal menyimpan pengaturan AC", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pengaturan AC — {row.code}</DialogTitle>
          <DialogDescription>
            {row.model} · HM sekarang {formatHm(row.current_hm)}. Jatuh tempo servis AC = HM servis terakhir +
            interval.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Section">
            <Select value={section} onValueChange={(v) => setSection(v as HmAcSection)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AC_SECTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {AC_SECTION_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Paket Part AC">
            <Select value={packageId} onValueChange={setPackageId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih paket" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PACKAGE}>— Tanpa paket —</SelectItem>
                {packages.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Interval Servis AC (HM)" htmlFor="ac-interval">
            <Input id="ac-interval" inputMode="numeric" value={intervalHm} onChange={(e) => setIntervalHm(e.target.value)} />
          </Field>
          <Field label="HM Servis AC Terakhir" htmlFor="ac-last">
            <Input id="ac-last" inputMode="numeric" value={lastHm} onChange={(e) => setLastHm(e.target.value)} />
          </Field>
          <Field label="Rata-rata HM per Hari" htmlFor="ac-daily">
            <Input id="ac-daily" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
          </Field>
          <Field label="Ikut Forecast">
            <div className="flex h-9 items-center gap-2">
              <Switch checked={active} onCheckedChange={setActive} />
              <span className="text-sm text-muted-foreground">{active ? "Aktif" : "Nonaktif"}</span>
            </div>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Rata-rata HM per hari dipakai memperkirakan tanggal jatuh tempo. Unit di Excel biasanya kena servis AC
          tiap PMS 2000/4000/8000.
        </p>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Catat servis AC selesai
// ============================================================

export function AcServiceDialog({
  open,
  onOpenChange,
  unit,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit: HmUnit | null;
  onSaved: () => void;
}) {
  const [hm, setHm] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !unit) return;
    setHm(String(unit.current_hm));
    setDate(toDateInputValue(new Date()));
    setNote("");
    setError(null);
  }, [open, unit]);

  if (!unit) return null;

  async function handleSubmit() {
    if (!unit) return;
    const parsed = parseHmInput(hm);
    if (parsed === null) return setError("HM servis harus berupa angka.");
    const d = fromDateInputValue(date);
    if (!d) return setError("Tanggal servis wajib diisi.");
    setError(null);
    setSaving(true);
    try {
      await recordAcService({ unitId: unit.id, hm: parsed, date: d, note: note.trim() });
      toast.success("Servis AC dicatat");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error("Gagal mencatat servis AC", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat Servis AC — {unit.code}</DialogTitle>
          <DialogDescription>
            HM servis AC terakhir unit dimajukan, jatuh tempo berikutnya dihitung ulang. Riwayat ikut tercatat
            sebagai servis rutin.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="HM Saat Servis" htmlFor="ac-svc-hm">
            <Input id="ac-svc-hm" inputMode="numeric" value={hm} onChange={(e) => setHm(e.target.value)} />
          </Field>
          <Field label="Tanggal" htmlFor="ac-svc-date">
            <Input id="ac-svc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Catatan" htmlFor="ac-svc-note">
              <Textarea
                id="ac-svc-note"
                placeholder="mis. PMS 4000, ganti compressor"
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
            {saving ? "Menyimpan…" : "Catat Servis"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Paket part AC
// ============================================================

type ItemDraft = {
  key: string;
  barang: HmBarangOption | null;
  name: string;
  qty: string;
  price: string;
};

let draftSeq = 0;
const newDraft = (): ItemDraft => ({ key: `d${++draftSeq}`, barang: null, name: "", qty: "1", price: "" });

export function AcPackageDialog({
  open,
  onOpenChange,
  pkg,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = paket baru. */
  pkg: HmAcPackage | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(pkg?.name ?? "");
    setNote(pkg?.note ?? "");
    setItems(
      pkg && pkg.items.length > 0
        ? pkg.items.map((it) => ({
            key: `i${it.id}`,
            barang:
              it.barang_id && it.barang
                ? { id: it.barang_id, ...it.barang }
                : null,
            name: it.name,
            qty: String(it.qty).replace(".", ","),
            price: String(it.unit_price),
          }))
        : [newDraft()],
    );
    setError(null);
  }, [open, pkg]);

  const update = (key: string, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const total = items.reduce(
    (sum, it) => sum + (parseNumberInput(it.qty) ?? 0) * (parseNumberInput(it.price) ?? 0),
    0,
  );

  async function handleSubmit() {
    const n = name.trim();
    if (!n) return setError("Nama paket wajib diisi.");
    const filled = items.filter((it) => it.name.trim() || it.barang);
    const parsed = [];
    for (const [idx, it] of filled.entries()) {
      const itemName = it.name.trim() || it.barang?.part_name || "";
      const qty = parseNumberInput(it.qty);
      const price = parseNumberInput(it.price) ?? 0;
      if (!itemName) return setError(`Nama part baris ${idx + 1} wajib diisi.`);
      if (!qty || qty <= 0) return setError(`Qty part "${itemName}" harus lebih dari 0.`);
      parsed.push({ barang_id: it.barang?.id ?? null, name: itemName, qty, unit_price: price });
    }
    setError(null);
    setSaving(true);
    try {
      await saveAcPackage(pkg?.id ?? null, { name: n, note: note.trim(), items: parsed });
      toast.success(pkg ? "Paket diperbarui" : "Paket ditambahkan");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error("Gagal menyimpan paket", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{pkg ? "Ubah Paket Part AC" : "Tambah Paket Part AC"}</DialogTitle>
          <DialogDescription>
            Part dasar yang selalu diganti saat servis AC (mis. expansi valve, thermostat, dryer, v-belt, oli).
            Part mayor seperti compressor ditambahkan per unit di forecast bulanan.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama Paket" htmlFor="ac-pkg-name">
            <Input
              id="ac-pkg-name"
              placeholder="Paket AC D155A-6"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Keterangan" htmlFor="ac-pkg-note">
            <Input
              id="ac-pkg-note"
              placeholder="Untuk model D155A-6"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {items.map((it, idx) => (
            <div key={it.key} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_80px_140px_auto]">
              <BarangPicker
                value={it.barang}
                onChange={(b) => update(it.key, { barang: b, name: it.name || b?.part_name || "" })}
              />
              <Input
                placeholder={`Nama part #${idx + 1}`}
                value={it.name}
                onChange={(e) => update(it.key, { name: e.target.value })}
              />
              <Input
                inputMode="decimal"
                placeholder="Qty"
                value={it.qty}
                onChange={(e) => update(it.key, { qty: e.target.value })}
              />
              <Input
                inputMode="numeric"
                placeholder="Harga satuan"
                value={it.price}
                onChange={(e) => update(it.key, { price: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Hapus baris"
                onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, newDraft()])}>
            <Plus className="h-4 w-4" />
            Tambah Part
          </Button>
          <div className="text-sm">
            Total paket: <span className="font-mono font-semibold">{formatRupiah(total)}</span>
          </div>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan Paket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Part mayor tambahan per unit per bulan
// ============================================================

export function AcExtraDialog({
  open,
  onOpenChange,
  unit,
  periodKey,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit: HmUnit | null;
  periodKey: string;
  onSaved: () => void;
}) {
  const [barang, setBarang] = useState<HmBarangOption | null>(null);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBarang(null);
    setName("");
    setQty("1");
    setPrice("");
    setNote("");
    setError(null);
  }, [open]);

  if (!unit) return null;

  async function handleSubmit() {
    if (!unit) return;
    const n = name.trim() || barang?.part_name || "";
    if (!n) return setError("Nama part wajib diisi.");
    const q = parseNumberInput(qty);
    if (!q || q <= 0) return setError("Qty harus lebih dari 0.");
    setError(null);
    setSaving(true);
    try {
      await createAcExtra(unit.id, periodKey, {
        barang_id: barang?.id ?? null,
        name: n,
        qty: q,
        unit_price: parseNumberInput(price) ?? 0,
        note: note.trim(),
      });
      toast.success("Part tambahan ditambahkan");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error("Gagal menambahkan part", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Tambah Part Mayor — {unit.code}</DialogTitle>
          <DialogDescription>
            Part di luar paket dasar (compressor, magnet clutch, kondensor, evaporator, motor blower/fan) untuk
            forecast {formatPeriod(periodKey)}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Part Number (Master Barang)">
              <BarangPicker
                value={barang}
                onChange={(b) => {
                  setBarang(b);
                  if (b && !name.trim()) setName(b.part_name);
                }}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Nama Part" htmlFor="ac-extra-name">
              <Input
                id="ac-extra-name"
                placeholder="Compressor Assy"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Qty" htmlFor="ac-extra-qty">
            <Input id="ac-extra-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Harga Satuan (Rp)" htmlFor="ac-extra-price">
            <Input
              id="ac-extra-price"
              inputMode="numeric"
              placeholder="2814400"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Catatan" htmlFor="ac-extra-note">
              <Input
                id="ac-extra-note"
                placeholder="mis. compressor bocor"
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
            {saving ? "Menyimpan…" : "Tambah Part"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
