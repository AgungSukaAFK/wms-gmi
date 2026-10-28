"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronsUpDown,
  ClipboardPaste,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DatePickerString } from "@/components/date-picker-string";
import {
  createSpbPo,
  getSpbDetailsForPo,
  getSpbOptionsForPo,
} from "@/services/spb-actions";
import { cn, formatDate, ymdToLocalStartIso } from "@/lib/utils";

type SpbOption = {
  id: number;
  spb_no: string;
  spb_status: string;
  spb_tanggal: string | null;
  spb_gudang: string | null;
  spb_kode_unit: string | null;
  /** No PO yang sudah terpasang di SPB ini. */
  po_nos: string[];
};

type SpbDetail = {
  id: number;
  spb_id: number;
  dtl_spb_part_number: string;
  dtl_spb_part_name: string;
  dtl_spb_qty: number;
  dtl_spb_part_satuan: string;
  /** No PO yang sudah memuat item ini. */
  po_nos: string[];
};

// Batas tempel: query .in("spb_no", ...) lewat URL, jangan sampai kepanjangan.
const MAX_PASTE = 100;

function spbMeta(spb: SpbOption) {
  return [
    spb.spb_tanggal ? formatDate(spb.spb_tanggal) : null,
    spb.spb_gudang,
    spb.spb_kode_unit,
  ]
    .filter(Boolean)
    .join(" · ");
}

function PoTag({ poNos, prefix }: { poNos: string[]; prefix: string }) {
  if (!poNos.length) return null;
  return (
    <span
      className="inline-flex max-w-full shrink-0 items-center truncate rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-400"
      title={poNos.join(", ")}
    >
      {prefix} {poNos[0]}
      {poNos.length > 1 && ` +${poNos.length - 1}`}
    </span>
  );
}

function SectionTitle({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {step}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function CreateSpbPoDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [poNo, setPoNo] = useState("");
  const [soNo, setSoNo] = useState("");
  const [soDate, setSoDate] = useState("");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [optionSearch, setOptionSearch] = useState("");
  const [debouncedOptionSearch] = useDebounce(optionSearch, 300);
  const [options, setOptions] = useState<SpbOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);

  const [selectedSpbs, setSelectedSpbs] = useState<SpbOption[]>([]);
  // Cache item per SPB; undefined = masih dimuat.
  const [detailsBySpb, setDetailsBySpb] = useState<
    Record<number, SpbDetail[]>
  >({});
  const [selectedDetailIds, setSelectedDetailIds] = useState<Set<number>>(
    new Set(),
  );
  const [collapsedSpbIds, setCollapsedSpbIds] = useState<Set<number>>(
    new Set(),
  );
  const [submitting, setSubmitting] = useState(false);

  const selectedSpbIds = useMemo(
    () => new Set(selectedSpbs.map((s) => s.id)),
    [selectedSpbs],
  );

  // Item terpilih dihitung dari SPB yang masih ada di daftar, jadi id yatim
  // (SPB dihapus saat item-nya masih dimuat) tidak ikut tersimpan.
  const entries = useMemo(
    () =>
      selectedSpbs.map((spb) => {
        const items = detailsBySpb[spb.id];
        return {
          spb,
          items,
          pickedIds: (items || [])
            .filter((d) => selectedDetailIds.has(d.id))
            .map((d) => d.id),
        };
      }),
    [selectedSpbs, detailsBySpb, selectedDetailIds],
  );
  const totalPicked = entries.reduce((n, e) => n + e.pickedIds.length, 0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setOptionsLoading(true);
      const res = await getSpbOptionsForPo({
        search: debouncedOptionSearch.trim() || undefined,
        limit: 20,
      });
      if (cancelled) return;
      setOptionsLoading(false);
      if (!res.error) setOptions(res.data as SpbOption[]);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, debouncedOptionSearch]);

  const addSpbs = async (list: SpbOption[]) => {
    const fresh = list.filter((s) => !selectedSpbIds.has(s.id));
    if (!fresh.length) return;
    setSelectedSpbs((prev) => [
      ...prev,
      ...fresh.filter((s) => !prev.some((p) => p.id === s.id)),
    ]);

    const loaded: Record<number, SpbDetail[]> = {};
    const missing = fresh.filter((s) => !detailsBySpb[s.id]).map((s) => s.id);
    if (missing.length) {
      const res = await getSpbDetailsForPo(missing);
      if (res.error) {
        toast.error(res.error);
        setSelectedSpbs((prev) => prev.filter((s) => !missing.includes(s.id)));
        return;
      }
      missing.forEach((id) => (loaded[id] = []));
      (res.data as SpbDetail[]).forEach((d) => loaded[d.spb_id]?.push(d));
      setDetailsBySpb((prev) => ({ ...prev, ...loaded }));
    }

    // Default: centang item yang belum masuk PO mana pun.
    const items = fresh.flatMap(
      (s) => detailsBySpb[s.id] ?? loaded[s.id] ?? [],
    );
    setSelectedDetailIds((prev) => {
      const next = new Set(prev);
      items.forEach((d) => {
        if (!d.po_nos.length) next.add(d.id);
      });
      return next;
    });
  };

  const removeSpb = (spbId: number) => {
    setSelectedSpbs((prev) => prev.filter((s) => s.id !== spbId));
    const ids = (detailsBySpb[spbId] || []).map((d) => d.id);
    setSelectedDetailIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const toggleSpb = (spb: SpbOption) => {
    if (selectedSpbIds.has(spb.id)) removeSpb(spb.id);
    else addSpbs([spb]);
  };

  const setDetailsChecked = (ids: number[], checked: boolean) => {
    setSelectedDetailIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const toggleCollapsed = (spbId: number) => {
    setCollapsedSpbIds((prev) => {
      const next = new Set(prev);
      if (next.has(spbId)) next.delete(spbId);
      else next.add(spbId);
      return next;
    });
  };

  const allCollapsed =
    selectedSpbs.length > 0 &&
    selectedSpbs.every((s) => collapsedSpbIds.has(s.id));

  const handlePaste = async () => {
    const nos = Array.from(
      new Set(
        pasteText
          .split(/[\s,;]+/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    if (!nos.length) return toast.error("Tempel minimal 1 No SPB.");
    if (nos.length > MAX_PASTE) {
      return toast.error(`Maksimal ${MAX_PASTE} No SPB sekali tempel.`);
    }

    setPasting(true);
    const res = await getSpbOptionsForPo({ spb_nos: nos });
    if (res.error) {
      setPasting(false);
      return toast.error(res.error);
    }
    const byNo = new Map(
      (res.data as SpbOption[]).map((s) => [s.spb_no.toUpperCase(), s]),
    );
    // Urutan mengikuti urutan tempelan.
    await addSpbs(nos.flatMap((n) => byNo.get(n) ?? []));
    setPasting(false);

    const notFound = nos.filter((n) => !byNo.has(n));
    if (notFound.length) {
      // Sisakan yang gagal di textarea supaya gampang dibetulkan.
      setPasteText(notFound.join("\n"));
      toast.warning(
        `${byNo.size} SPB ditambahkan. ${notFound.length} tidak ditemukan / tidak bisa di-PO (masih di kotak tempel).`,
      );
    } else {
      setPasteText("");
      setPasteOpen(false);
      toast.success(`${byNo.size} SPB ditambahkan.`);
    }
  };

  const resetForm = () => {
    setPoNo("");
    setSoNo("");
    setSoDate("");
    setPickerOpen(false);
    setOptionSearch("");
    setPasteOpen(false);
    setPasteText("");
    setSelectedSpbs([]);
    setSelectedDetailIds(new Set());
    setCollapsedSpbIds(new Set());
  };

  const handleOpenChange = (next: boolean) => {
    if (submitting) return;
    if (!next) resetForm();
    onOpenChange(next);
  };

  const submit = async () => {
    if (!poNo.trim()) return toast.error("No PO wajib diisi.");
    if (!entries.length) return toast.error("Pilih minimal 1 SPB.");
    if (entries.some((e) => !e.items)) {
      return toast.error("Tunggu item SPB selesai dimuat.");
    }
    const empty = entries.find((e) => !e.pickedIds.length);
    if (empty) {
      setCollapsedSpbIds((prev) => {
        const next = new Set(prev);
        next.delete(empty.spb.id);
        return next;
      });
      return toast.error(
        `SPB ${empty.spb.spb_no} belum ada item yang dipilih. Centang itemnya atau hapus SPB dari daftar.`,
      );
    }

    setSubmitting(true);
    const res = await createSpbPo({
      po_no: poNo,
      so_no: soNo || undefined,
      so_date: soDate ? ymdToLocalStartIso(soDate) : undefined,
      spbs: entries.map((e) => ({
        spb_id: e.spb.id,
        details: e.pickedIds.map((id) => ({ spb_dtl_id: id })),
      })),
    });
    setSubmitting(false);

    if (res.error) {
      toast.error(res.error);
      return;
    }

    toast.success(`${res.count} SPB-PO berhasil dibuat.`);
    resetForm();
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Buat SPB-PO</DialogTitle>
          <DialogDescription>
            Satu No PO bisa dipasang ke banyak SPB sekaligus. Tiap SPB
            tersimpan sebagai SPB-PO sendiri.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section className="space-y-3">
            <SectionTitle
              step={1}
              title="Informasi PO"
              hint="berlaku untuk semua SPB yang dipilih"
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="spb-po-no">
                  No PO <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="spb-po-no"
                  value={poNo}
                  onChange={(e) => setPoNo(e.target.value)}
                  placeholder="Nomor PO customer"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="spb-so-no">No SO</Label>
                <Input
                  id="spb-so-no"
                  value={soNo}
                  onChange={(e) => setSoNo(e.target.value)}
                  placeholder="Opsional"
                />
              </div>
              <div className="space-y-1.5">
                <Label>SO Date</Label>
                <DatePickerString
                  value={soDate}
                  onChange={setSoDate}
                  placeholder="Opsional"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle
              step={2}
              title="Pilih SPB"
              hint={
                selectedSpbs.length
                  ? `${selectedSpbs.length} SPB dipilih`
                  : "bisa pilih banyak sekaligus"
              }
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    className="min-w-0 flex-1 justify-between font-normal text-muted-foreground"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Search className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        Cari &amp; centang SPB (No SPB / No WO / Kode Unit)
                      </span>
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-(--radix-popover-trigger-width) min-w-80 p-0"
                  align="start"
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Ketik No SPB, No WO, atau Kode Unit..."
                      value={optionSearch}
                      onValueChange={setOptionSearch}
                    />
                    <CommandList className="max-h-80">
                      <CommandEmpty>
                        {optionsLoading
                          ? "Mencari..."
                          : "Tidak ada SPB ditemukan."}
                      </CommandEmpty>
                      <CommandGroup>
                        {options.map((spb) => (
                          <CommandItem
                            key={spb.id}
                            value={String(spb.id)}
                            onSelect={() => toggleSpb(spb)}
                            className="items-start gap-3"
                          >
                            <Checkbox
                              checked={selectedSpbIds.has(spb.id)}
                              className="pointer-events-none mt-0.5"
                              tabIndex={-1}
                            />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate font-semibold">
                                {spb.spb_no}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {spbMeta(spb) || "-"}
                              </span>
                            </div>
                            <PoTag poNos={spb.po_nos} prefix="Sudah PO" />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                    <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        {selectedSpbs.length} SPB dipilih
                      </span>
                      <Button
                        size="sm"
                        className="h-7"
                        onClick={() => setPickerOpen(false)}
                      >
                        Selesai
                      </Button>
                    </div>
                  </Command>
                </PopoverContent>
              </Popover>
              <Button
                variant={pasteOpen ? "secondary" : "outline"}
                className="gap-2"
                onClick={() => setPasteOpen((v) => !v)}
              >
                <ClipboardPaste className="h-4 w-4" />
                Tempel daftar No SPB
              </Button>
            </div>

            {pasteOpen && (
              <div className="space-y-2 rounded-md border border-dashed bg-muted/30 p-3">
                <Textarea
                  rows={4}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={
                    "Tempel No SPB dari Excel/email, satu per baris atau dipisah koma/spasi.\nContoh:\nGMITJE/2026/10/10045\nGMITJE/2026/10/10046"
                  }
                  className="font-mono text-xs"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    No SPB harus lengkap & persis. Maks {MAX_PASTE} sekali
                    tempel.
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPasteOpen(false)}
                    >
                      Tutup
                    </Button>
                    <Button size="sm" onClick={handlePaste} disabled={pasting}>
                      {pasting && (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      )}
                      Tambahkan
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <SectionTitle
              step={3}
              title="Item per SPB"
              hint={
                selectedSpbs.length
                  ? `${totalPicked} item dicentang`
                  : undefined
              }
            >
              {selectedSpbs.length > 1 && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() =>
                      setCollapsedSpbIds(
                        allCollapsed
                          ? new Set()
                          : new Set(selectedSpbs.map((s) => s.id)),
                      )
                    }
                  >
                    {allCollapsed ? "Buka semua" : "Ciutkan semua"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => {
                      setSelectedSpbs([]);
                      setSelectedDetailIds(new Set());
                    }}
                  >
                    Hapus semua
                  </Button>
                </div>
              )}
            </SectionTitle>

            {selectedSpbs.length === 0 ? (
              <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                Belum ada SPB. Cari dan centang SPB di atas, atau tempel daftar
                No SPB.
              </div>
            ) : (
              <div className="space-y-2">
                {entries.map(({ spb, items, pickedIds }) => {
                  const collapsed = collapsedSpbIds.has(spb.id);
                  const allPicked =
                    !!items?.length && pickedIds.length === items.length;
                  return (
                    <div
                      key={spb.id}
                      className={cn(
                        "overflow-hidden rounded-md border",
                        items && !pickedIds.length && "border-destructive/50",
                      )}
                    >
                      <div className="flex items-center gap-3 bg-muted/40 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleCollapsed(spb.id)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={collapsed ? "Buka item" : "Ciutkan item"}
                        >
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 transition-transform",
                              !collapsed && "rotate-90",
                            )}
                          />
                        </button>
                        <Checkbox
                          checked={allPicked}
                          disabled={!items?.length}
                          onCheckedChange={(v) =>
                            setDetailsChecked(
                              (items || []).map((d) => d.id),
                              v === true,
                            )
                          }
                          aria-label={`Pilih semua item ${spb.spb_no}`}
                        />
                        <button
                          type="button"
                          onClick={() => toggleCollapsed(spb.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="truncate text-sm font-semibold">
                              {spb.spb_no}
                            </span>
                            <PoTag poNos={spb.po_nos} prefix="Sudah PO" />
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {spbMeta(spb) || "-"}
                          </div>
                        </button>
                        <span
                          className={cn(
                            "shrink-0 text-xs font-semibold tabular-nums",
                            items && !pickedIds.length
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {items ? (
                            `${pickedIds.length}/${items.length} item`
                          ) : (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeSpb(spb.id)}
                          title="Hapus SPB dari daftar"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      {!collapsed && items && (
                        <div className="divide-y border-t">
                          {items.length === 0 ? (
                            <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                              SPB ini tidak punya item.
                            </div>
                          ) : (
                            items.map((item) => {
                              const checked = selectedDetailIds.has(item.id);
                              return (
                                <label
                                  key={item.id}
                                  className={cn(
                                    "grid cursor-pointer grid-cols-[1.75rem_9rem_minmax(0,1fr)_4rem_4.5rem] items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/40",
                                    !checked && "text-muted-foreground",
                                  )}
                                >
                                  <span className="flex justify-center">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(v) =>
                                        setDetailsChecked([item.id], v === true)
                                      }
                                    />
                                  </span>
                                  <span
                                    className="truncate font-mono text-xs"
                                    title={item.dtl_spb_part_number}
                                  >
                                    {item.dtl_spb_part_number}
                                  </span>
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span
                                      className="truncate"
                                      title={item.dtl_spb_part_name}
                                    >
                                      {item.dtl_spb_part_name}
                                    </span>
                                    <PoTag
                                      poNos={item.po_nos}
                                      prefix="Sudah di PO"
                                    />
                                  </span>
                                  <span className="text-right tabular-nums">
                                    {item.dtl_spb_qty}
                                  </span>
                                  <span className="truncate text-xs">
                                    {item.dtl_spb_part_satuan}
                                  </span>
                                </label>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="items-center border-t px-6 py-4 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {selectedSpbs.length}
            </span>{" "}
            SPB ·{" "}
            <span className="font-semibold text-foreground">{totalPicked}</span>{" "}
            item
            {poNo.trim() && (
              <>
                {" "}
                · No PO{" "}
                <span className="font-semibold text-foreground">
                  {poNo.trim()}
                </span>
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              onClick={submit}
              disabled={submitting || !selectedSpbs.length}
            >
              {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {submitting
                ? "Menyimpan..."
                : `Simpan ${selectedSpbs.length} SPB-PO`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
