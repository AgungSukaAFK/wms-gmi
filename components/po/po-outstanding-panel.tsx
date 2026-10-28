"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AlertTriangle, Building2, Link2, Loader2, Lock, X } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { fetchPrItemPoCoverage } from "@/lib/pr-po-coverage";
import { parsePrRefCodes } from "@/lib/po-outstanding";
import {
  linkOutstandingPoItems,
  setOutstandingPoCabang,
  unlinkOutstandingPoItem,
} from "@/services/po-outstanding-actions";

// Panel khusus PO Outstanding (import ERP, lihat lib/po-outstanding.ts):
// referensi Excel per item, lokasi PO, dan "Hubungkan ke PR" banyak item
// sekaligus (checkbox). Item yang sudah punya RI dikunci.

type ItemRow = {
  id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  qty_received: number;
  pr_item_id: number | null;
  ost_pr_ref: string | null;
  ost_proyek_ref: string | null;
  ost_keterangan: string | null;
  pr_items: { pr_id: number; prs: { pr_kode: string } | null } | null;
};

type Candidate = {
  id: number;
  pr_id: number;
  part_id: number;
  qty: number;
  satuan: string;
  pr_kode: string;
  pr_tanggal: string | null;
  cabang: string | null;
  remaining: number;
};

const NONE = "none";

function one<T>(v: T | T[] | null | undefined): T | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

export function PoOutstandingPanel({
  poId,
  poStatus,
  cabangId,
  canEdit,
  onChanged,
}: {
  poId: number;
  poStatus: string;
  cabangId: number | null;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const supabase = createClient();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);
  const [cabangOptions, setCabangOptions] = useState<{ id: number; nama_cabang: string }[]>([]);
  const [savingCabang, setSavingCabang] = useState(false);

  const editable = canEdit && poStatus !== "rejected";

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("po_items")
      .select(
        "id, part_id, part_number, part_name, satuan, qty, qty_received, pr_item_id, ost_pr_ref, ost_proyek_ref, ost_keterangan, pr_items(pr_id, prs(pr_kode))",
      )
      .eq("po_id", poId)
      .order("id");
    const rows: ItemRow[] = ((data as any[]) || []).map((r) => {
      const pri = one<any>(r.pr_items);
      return { ...r, pr_items: pri ? { pr_id: pri.pr_id, prs: one(pri.prs) } : null };
    });
    const ids = rows.map((r) => r.id);
    const { data: riRows } = ids.length
      ? await supabase
          .from("receive_items")
          .select("po_item_id, receives!inner(ri_status)")
          .in("po_item_id", ids)
          .neq("receives.ri_status", "rejected")
      : { data: [] as any[] };
    const lockedIds = new Set<number>((riRows || []).map((r: any) => r.po_item_id));
    for (const r of rows) if (Number(r.qty_received) > 0) lockedIds.add(r.id);
    setItems(rows);
    setLocked(lockedIds);
    setSelected((prev) => prev.filter((id) => rows.some((r) => r.id === id && !r.pr_item_id)));
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId]);

  useEffect(() => {
    refresh();
    supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then(({ data }) => setCabangOptions(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const selectableIds = items
    .filter((i) => !i.pr_item_id && !locked.has(i.id))
    .map((i) => i.id);
  const linkedCount = items.filter((i) => i.pr_item_id).length;
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.includes(id));

  const proyekRefs = Array.from(
    new Set(items.map((i) => i.ost_proyek_ref).filter(Boolean) as string[]),
  );

  const afterChange = () => {
    refresh();
    onChanged?.();
  };

  const handleUnlink = async (item: ItemRow) => {
    if (
      !confirm(
        `Lepas link ${item.part_number} dari ${item.pr_items?.prs?.pr_kode || "PR"}? Status konversi PR akan dihitung ulang.`,
      )
    )
      return;
    setUnlinkingId(item.id);
    const res = await unlinkOutstandingPoItem(item.id);
    setUnlinkingId(null);
    if (res.error) return toast.error(res.error);
    toast.success("Link item dilepas.");
    afterChange();
  };

  const handleCabangChange = async (value: string) => {
    setSavingCabang(true);
    const res = await setOutstandingPoCabang(poId, value === NONE ? null : Number(value));
    setSavingCabang(false);
    if (res.error) return toast.error(res.error);
    toast.success("Lokasi PO disimpan.");
    onChanged?.();
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-[11px] font-medium leading-relaxed text-foreground">
        PO ini hasil import <b>PO Outstanding</b> dari ERP lama. Lengkapi
        lokasi, hubungkan tiap item ke item PR di WMS (centang item lalu{" "}
        <b>Hubungkan ke PR</b>), dan isi jalur approval lewat{" "}
        <b>Edit PO</b> (pakai template) atau <b>Moderator Edit</b>. Item yang
        terhubung ke PR ikut mengalir ke MR saat barang diterima. Item yang
        sudah ada Receive Item dikunci{" "}
        <Lock className="inline h-3 w-3 -mt-0.5" />.
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5 w-full max-w-xs">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
            <Building2 className="h-3 w-3" /> Lokasi PO
          </Label>
          <Select
            value={cabangId ? String(cabangId) : NONE}
            onValueChange={handleCabangChange}
            disabled={!editable || savingCabang}
          >
            <SelectTrigger className="h-9 w-full text-xs font-bold uppercase">
              <SelectValue placeholder="Pilih lokasi..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Belum dipilih</SelectItem>
              {cabangOptions.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nama_cabang}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {proyekRefs.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase font-bold text-muted-foreground">
              Nama Proyek (referensi Excel)
            </p>
            <div className="flex flex-wrap gap-1">
              {proyekRefs.map((p) => (
                <Badge key={p} variant="secondary" className="text-[9px] font-bold uppercase">
                  {p}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">
            {linkedCount}/{items.length} item terhubung
          </span>
          {editable && (
            <Button
              size="sm"
              className="gap-1.5 text-xs font-bold"
              disabled={selected.length === 0}
              onClick={() => setDialogOpen(true)}
            >
              <Link2 className="h-3.5 w-3.5" /> Hubungkan ke PR ({selected.length})
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <Table className="table-fixed w-full" containerClassName="max-h-[55vh] overflow-y-auto">
          <TableHeader className="bg-muted/50 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-3">
                {editable && (
                  <Checkbox
                    checked={allSelected}
                    disabled={selectableIds.length === 0}
                    onCheckedChange={(v) => setSelected(v ? selectableIds : [])}
                  />
                )}
              </TableHead>
              <TableHead className="text-[9px] font-black uppercase w-40">Part</TableHead>
              <TableHead className="text-[9px] font-black uppercase text-center w-28">
                Diterima / PO
              </TableHead>
              <TableHead className="text-[9px] font-black uppercase">Referensi Excel</TableHead>
              <TableHead className="text-[9px] font-black uppercase w-56">Terhubung ke PR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-20 text-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mx-auto" />
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const isLocked = locked.has(item.id);
                const canSelect = editable && !item.pr_item_id && !isLocked;
                return (
                  <TableRow key={item.id} className="align-top">
                    <TableCell className="py-2 pl-3">
                      {canSelect ? (
                        <Checkbox
                          checked={selected.includes(item.id)}
                          onCheckedChange={(v) =>
                            setSelected((prev) =>
                              v ? [...prev, item.id] : prev.filter((id) => id !== item.id),
                            )
                          }
                        />
                      ) : isLocked ? (
                        <Lock
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-label="Sudah ada Receive Item"
                        />
                      ) : null}
                    </TableCell>
                    <TableCell className="py-2">
                      <p className="text-[11px] font-black font-mono uppercase break-all">
                        {item.part_number}
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase truncate" title={item.part_name}>
                        {item.part_name}
                      </p>
                    </TableCell>
                    <TableCell className="py-2 text-center text-xs font-bold whitespace-nowrap">
                      {item.qty_received || 0} / {item.qty}{" "}
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {item.satuan}
                      </span>
                    </TableCell>
                    <TableCell className="py-2 space-y-0.5">
                      <p className="text-[10px] font-bold font-mono">{item.ost_pr_ref || "-"}</p>
                      {item.ost_proyek_ref && (
                        <p className="text-[9px] font-bold uppercase text-muted-foreground">
                          {item.ost_proyek_ref}
                        </p>
                      )}
                      {item.ost_keterangan && (
                        <p className="text-[9px] text-muted-foreground whitespace-pre-wrap line-clamp-3" title={item.ost_keterangan}>
                          {item.ost_keterangan}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      {item.pr_item_id ? (
                        <Badge variant="outline" className="gap-1 text-[9px] font-bold font-mono border-success/40 text-success">
                          <Link href={`/pr/${item.pr_items?.pr_id}`} className="hover:underline">
                            {item.pr_items?.prs?.pr_kode || "PR"}
                          </Link>
                          {editable && !isLocked && (
                            <button
                              type="button"
                              className="ml-0.5 text-destructive disabled:opacity-40"
                              disabled={unlinkingId === item.id}
                              onClick={() => handleUnlink(item)}
                              aria-label="Lepas link"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] font-bold uppercase text-muted-foreground">
                          Belum terhubung
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <LinkDialog
        open={dialogOpen}
        poId={poId}
        items={items.filter((i) => selected.includes(i.id))}
        onClose={() => setDialogOpen(false)}
        onLinked={() => {
          setDialogOpen(false);
          setSelected([]);
          afterChange();
        }}
      />
    </div>
  );
}

function LinkDialog({
  open,
  poId,
  items,
  onClose,
  onLinked,
}: {
  open: boolean;
  poId: number;
  items: ItemRow[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [split, setSplit] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const itemKey = items.map((i) => i.id).join(",");

  useEffect(() => {
    if (!open || items.length === 0) return;
    const run = async () => {
      setLoading(true);
      const partIds = Array.from(new Set(items.map((i) => i.part_id)));
      const { data } = await supabase
        .from("pr_items")
        .select(
          "id, pr_id, part_id, qty, satuan, status, prs!inner(pr_kode, pr_status, pr_tanggal, cabang(nama_cabang))",
        )
        .in("part_id", partIds)
        .eq("prs.pr_status", "approved")
        .neq("prs.pr_jenis", "konsinyasi")
        .neq("status", "rejected")
        .limit(1000);
      const rows = (data as any[]) || [];
      const coverage = await fetchPrItemPoCoverage(
        supabase,
        rows.map((r) => r.id),
      );
      const list: Candidate[] = rows.map((r) => {
        const pr = one<any>(r.prs);
        return {
          id: r.id,
          pr_id: r.pr_id,
          part_id: r.part_id,
          qty: Number(r.qty) || 0,
          satuan: r.satuan,
          pr_kode: pr?.pr_kode || "",
          pr_tanggal: pr?.pr_tanggal || null,
          cabang: one<any>(pr?.cabang)?.nama_cabang || null,
          remaining: Math.max(0, (Number(r.qty) || 0) - (coverage[r.id]?.convertedQty || 0)),
        };
      });
      setCandidates(list);

      // Saran otomatis: item PR dari kode PR di referensi Excel yang masih
      // punya sisa, tanpa memakai item PR yang sama dua kali.
      const used = new Set<number>();
      const next: Record<number, string> = {};
      for (const item of items) {
        const refs = parsePrRefCodes(item.ost_pr_ref);
        const match = list.find(
          (c) =>
            c.part_id === item.part_id &&
            c.remaining > 0 &&
            refs.includes(c.pr_kode.toUpperCase()) &&
            !used.has(c.id),
        );
        if (match) {
          used.add(match.id);
          next[item.id] = String(match.id);
        } else {
          next[item.id] = NONE;
        }
      }
      setChoice(next);
      setSplit(false);
      setLoading(false);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemKey]);

  const candidatesFor = useCallback(
    (item: ItemRow) => {
      const refs = parsePrRefCodes(item.ost_pr_ref);
      return candidates
        .filter((c) => c.part_id === item.part_id)
        .sort((a, b) => {
          const ra = refs.includes(a.pr_kode.toUpperCase()) ? 0 : 1;
          const rb = refs.includes(b.pr_kode.toUpperCase()) ? 0 : 1;
          if (ra !== rb) return ra - rb;
          if ((a.remaining > 0) !== (b.remaining > 0)) return a.remaining > 0 ? -1 : 1;
          return (b.pr_tanggal || "").localeCompare(a.pr_tanggal || "");
        });
    },
    [candidates],
  );

  const chosenIds = useMemo(
    () => Object.values(choice).filter((v) => v !== NONE),
    [choice],
  );

  const links = items
    .filter((i) => choice[i.id] && choice[i.id] !== NONE)
    .map((i) => ({ po_item_id: i.id, pr_item_id: Number(choice[i.id]), split }));

  const handleSubmit = async () => {
    if (links.length === 0) return toast.error("Pilih item PR untuk minimal satu item.");
    setSubmitting(true);
    const res = await linkOutstandingPoItems(poId, links);
    setSubmitting(false);
    if (res.error) {
      toast.error(res.error, { duration: 10000, style: { whiteSpace: "pre-line" } });
      return;
    }
    toast.success(
      `${res.linked} item terhubung ke PR${res.split ? `, ${res.split} item dipecah` : ""}.`,
    );
    onLinked();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Hubungkan Item ke PR</DialogTitle>
          <DialogDescription>
            Pilih item PR (approved, part number sama) untuk tiap item PO.
            Saran otomatis diambil dari No. PR di referensi Excel. Item yang
            dibiarkan &quot;Tidak dihubungkan&quot; dilewati.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-border">
              <Table className="table-fixed w-full" containerClassName="max-h-[55vh] overflow-y-auto">
                <TableHeader className="bg-muted/50 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[9px] font-black uppercase w-40">Part</TableHead>
                    <TableHead className="text-[9px] font-black uppercase w-20 text-center">Qty PO</TableHead>
                    <TableHead className="text-[9px] font-black uppercase w-40">Ref. PR Excel</TableHead>
                    <TableHead className="text-[9px] font-black uppercase">Item PR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const opts = candidatesFor(item);
                    const picked = opts.find((c) => String(c.id) === choice[item.id]);
                    const over = picked ? item.qty > picked.remaining : false;
                    return (
                      <TableRow key={item.id} className="align-top">
                        <TableCell className="py-2">
                          <p className="text-[11px] font-black font-mono uppercase break-all">
                            {item.part_number}
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase truncate">
                            {item.part_name}
                          </p>
                        </TableCell>
                        <TableCell className="py-2 text-center text-xs font-bold">
                          {item.qty}{" "}
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {item.satuan}
                          </span>
                        </TableCell>
                        <TableCell className="py-2 text-[10px] font-mono font-bold whitespace-normal wrap-break-word">
                          {item.ost_pr_ref || "-"}
                        </TableCell>
                        <TableCell className="py-2 space-y-1">
                          <Select
                            value={choice[item.id] || NONE}
                            onValueChange={(v) => setChoice((prev) => ({ ...prev, [item.id]: v }))}
                          >
                            <SelectTrigger className="h-8 w-full text-[11px] font-bold">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Tidak dihubungkan</SelectItem>
                              {opts.map((c) => {
                                const takenElsewhere =
                                  chosenIds.includes(String(c.id)) && choice[item.id] !== String(c.id);
                                return (
                                  <SelectItem
                                    key={c.id}
                                    value={String(c.id)}
                                    disabled={c.remaining <= 0 || takenElsewhere}
                                  >
                                    {c.pr_kode} · sisa {c.remaining}/{c.qty} {c.satuan}
                                    {c.cabang ? ` · ${c.cabang}` : ""}
                                    {c.pr_tanggal ? ` · ${formatDate(c.pr_tanggal)}` : ""}
                                    {takenElsewhere ? " · dipakai item lain" : ""}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                          {opts.length === 0 && (
                            <p className="text-[10px] text-muted-foreground">
                              Tidak ada PR approved untuk part ini.
                            </p>
                          )}
                          {picked && over && (
                            <p
                              className={cn(
                                "flex items-start gap-1 text-[10px] font-semibold",
                                split ? "text-warning" : "text-destructive",
                              )}
                            >
                              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                              {split
                                ? `Dipecah: ${picked.remaining} terhubung ke ${picked.pr_kode}, ${item.qty - picked.remaining} jadi item terpisah (belum terhubung).`
                                : `Qty PO melebihi sisa PR (${picked.remaining}). Centang "pecah item" di bawah.`}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <label className="flex items-start gap-2 text-[11px] font-medium cursor-pointer">
              <Checkbox checked={split} onCheckedChange={(v) => setSplit(Boolean(v))} className="mt-0.5" />
              <span>
                Pecah item bila qty PO melebihi sisa PR: bagian sebesar sisa PR
                dihubungkan, sisanya jadi item terpisah yang bisa dihubungkan ke
                PR lain.
              </span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || loading || links.length === 0}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `Hubungkan ${links.length} Item`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
