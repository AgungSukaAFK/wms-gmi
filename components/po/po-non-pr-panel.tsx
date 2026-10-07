"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link2, Loader2, Search, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { cn } from "@/lib/utils";
import {
  fetchPoItemJcUsage,
  JC_PROGRESS_LABEL,
  jcProgressStatus,
  type JcProgressStatus,
  type PoItemJcUsage,
} from "@/lib/po-non-pr";
import { fetchPrItemPoCoverage } from "@/lib/pr-po-coverage";
import {
  deletePoItemPrLink,
  linkPoItemToPrItem,
} from "@/services/po-non-pr-actions";

// Panel khusus PO Non-PR (dipakai di detail page & side sheet PO): referensi
// PR teks, progres Job Costing per item, link manual ke item PR WMS
// ("Hubungkan ke PR", banyak-ke-banyak), dan shortcut buat Job Costing.

type PoItemRow = {
  id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  qty_received: number;
};

type LinkRow = {
  id: number;
  po_item_id: number;
  pr_item_id: number;
  qty_pr: number;
  notes: string | null;
  pr_items: {
    part_number: string;
    satuan: string;
    pr_id: number;
    prs: { pr_kode: string } | null;
  } | null;
};

export const JC_PROGRESS_BADGE_CLASS: Record<JcProgressStatus, string> = {
  belum_terima: "border-border text-muted-foreground",
  belum_jc: "border-destructive/40 text-destructive",
  partial: "border-warning/40 text-warning",
  selesai: "border-success/40 text-success",
};

export function PoNonPrPanel({
  poId,
  poStatus,
  prReferensi,
  items,
  canLink,
  isModerator,
  compact = false,
}: {
  poId: number;
  poStatus: string;
  prReferensi: string | null;
  items: PoItemRow[];
  canLink: boolean;
  isModerator: boolean;
  compact?: boolean;
}) {
  const supabase = createClient();
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [usage, setUsage] = useState<Map<number, PoItemJcUsage>>(new Map());
  const [linkTarget, setLinkTarget] = useState<PoItemRow | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const itemIdsKey = items.map((i) => i.id).join(",");

  const refresh = useCallback(async () => {
    const ids = items.map((i) => i.id);
    if (ids.length === 0) return;
    const [{ data: linkData }, usageMap] = await Promise.all([
      supabase
        .from("po_item_pr_links")
        .select(
          "id, po_item_id, pr_item_id, qty_pr, notes, pr_items(part_number, satuan, pr_id, prs(pr_kode))",
        )
        .in("po_item_id", ids)
        .order("id"),
      fetchPoItemJcUsage(supabase, ids),
    ]);
    setLinks((linkData as any) || []);
    setUsage(usageMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemIdsKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalAvailableForJc = items.reduce(
    (s, i) => s + Math.max(0, (i.qty_received || 0) - (usage.get(i.id)?.qtyUsed || 0)),
    0,
  );

  const handleDeleteLink = async (linkId: number) => {
    if (!confirm("Hapus link PO ke PR ini? Status konversi PR akan dihitung ulang.")) return;
    setDeletingId(linkId);
    const res = await deletePoItemPrLink(linkId);
    setDeletingId(null);
    if (res.error) return toast.error(res.error);
    toast.success("Link dihapus.");
    refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-[9px] font-bold uppercase border-warning/40 text-warning"
            >
              PO Non-PR
            </Badge>
            <span className="text-[10px] font-bold uppercase text-muted-foreground">
              Referensi PR
            </span>
          </div>
          <p className="text-xs font-semibold text-foreground whitespace-pre-wrap">
            {prReferensi || "-"}
          </p>
        </div>
        {poStatus !== "rejected" && (
          <Link
            href={`/job-costing/create?po_id=${poId}`}
            aria-disabled={totalAvailableForJc <= 0}
            className={cn(totalAvailableForJc <= 0 && "pointer-events-none")}
          >
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs font-bold"
              disabled={totalAvailableForJc <= 0}
            >
              <Wrench className="h-3.5 w-3.5" /> Buat Job Costing
            </Button>
          </Link>
        )}
      </div>

      <div className="rounded-lg border border-border overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[9px] font-black uppercase">Part</TableHead>
              <TableHead className="text-[9px] font-black uppercase text-center">
                Diterima / PO
              </TableHead>
              <TableHead className="text-[9px] font-black uppercase text-center">
                Dipakai JC
              </TableHead>
              <TableHead className="text-[9px] font-black uppercase">
                Terhubung ke PR
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const u = usage.get(item.id);
              const status = jcProgressStatus(item.qty_received || 0, u?.qtyUsed || 0);
              const itemLinks = links.filter((l) => l.po_item_id === item.id);
              return (
                <TableRow key={item.id} className="align-top">
                  <TableCell className="py-2">
                    <p className="text-[11px] font-black font-mono uppercase">
                      {item.part_number}
                    </p>
                    {!compact && (
                      <p className="text-[10px] text-muted-foreground uppercase">
                        {item.part_name}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-center text-xs font-bold whitespace-nowrap">
                    {item.qty_received || 0} / {item.qty}{" "}
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {item.satuan}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] font-bold uppercase",
                          JC_PROGRESS_BADGE_CLASS[status],
                        )}
                      >
                        {JC_PROGRESS_LABEL[status]}
                        {(u?.qtyUsed || 0) > 0 && ` · ${u!.qtyUsed}`}
                      </Badge>
                      {u?.jobs.map((j) => (
                        <span
                          key={j.id}
                          className="text-[9px] font-mono text-muted-foreground"
                        >
                          {j.job_kode}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {itemLinks.map((l) => (
                        <Badge
                          key={l.id}
                          variant="outline"
                          className="gap-1 text-[9px] font-bold font-mono"
                          title={l.notes || undefined}
                        >
                          <Link
                            href={`/pr/${l.pr_items?.pr_id}`}
                            className="hover:underline"
                          >
                            {l.pr_items?.prs?.pr_kode || "PR"} ·{" "}
                            {l.pr_items?.part_number} · {l.qty_pr}{" "}
                            {l.pr_items?.satuan}
                          </Link>
                          {isModerator && (
                            <button
                              type="button"
                              className="ml-0.5 text-destructive disabled:opacity-40"
                              disabled={deletingId === l.id}
                              onClick={() => handleDeleteLink(l.id)}
                              aria-label="Hapus link"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </Badge>
                      ))}
                      {canLink && poStatus !== "rejected" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 gap-1 px-1.5 text-[10px] font-bold"
                          onClick={() => setLinkTarget(item)}
                        >
                          <Link2 className="h-3 w-3" /> Hubungkan
                        </Button>
                      )}
                      {itemLinks.length === 0 && !canLink && (
                        <span className="text-[10px] text-muted-foreground">-</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <LinkToPrDialog
        target={linkTarget}
        onClose={() => setLinkTarget(null)}
        onLinked={() => {
          setLinkTarget(null);
          refresh();
        }}
      />
    </div>
  );
}

function LinkToPrDialog({
  target,
  onClose,
  onLinked,
}: {
  target: PoItemRow | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const supabase = createClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [loading, setLoading] = useState(false);
  const [prItems, setPrItems] = useState<any[]>([]);
  const [picked, setPicked] = useState<any | null>(null);
  const [qtyPr, setQtyPr] = useState(0);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!target) {
      setSearch("");
      setPrItems([]);
      setPicked(null);
      setQtyPr(0);
      setNotes("");
    }
  }, [target]);

  // Cari PR approved by kode PR, tampilkan item-nya + sisa yang belum ter-PO.
  useEffect(() => {
    if (!target) return;
    const run = async () => {
      setLoading(true);
      let q = supabase
        .from("prs")
        .select("id, pr_kode, pr_items(id, part_number, part_name, satuan, qty)")
        .eq("pr_status", "approved")
        .order("created_at", { ascending: false })
        .limit(10);
      if (debouncedSearch) q = q.ilike("pr_kode", `%${debouncedSearch}%`);
      const { data } = await q;
      const rows = (data || []).flatMap((pr: any) =>
        (pr.pr_items || []).map((it: any) => ({ ...it, pr_id: pr.id, pr_kode: pr.pr_kode })),
      );
      const coverage = await fetchPrItemPoCoverage(
        supabase,
        rows.map((r: any) => r.id),
      );
      setPrItems(
        rows.map((r: any) => ({
          ...r,
          remaining: Math.max(0, r.qty - (coverage[r.id]?.convertedQty || 0)),
        })),
      );
      setLoading(false);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, target]);

  const handleSubmit = async () => {
    if (!target || !picked) return;
    if (!(qtyPr > 0)) return toast.error("Qty PR wajib lebih dari 0.");
    setSubmitting(true);
    const res = await linkPoItemToPrItem({
      po_item_id: target.id,
      pr_item_id: picked.id,
      qty_pr: qtyPr,
      notes,
    });
    setSubmitting(false);
    if (res.error) return toast.error(res.error);
    toast.success("Item PO berhasil dihubungkan ke PR.");
    onLinked();
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Hubungkan ke PR</DialogTitle>
          <DialogDescription>
            Item PO <b className="font-mono">{target?.part_number}</b> (
            {target?.qty} {target?.satuan}). Qty diisi manual dalam{" "}
            <b>satuan PR</b> — PN/satuan PO dan PR berbeda, sistem tidak
            mengkonversi otomatis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari kode PR (approved)..."
              className="h-9 pl-8 text-sm"
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : prItems.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Tidak ada item PR approved yang cocok.
              </p>
            ) : (
              prItems.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  disabled={it.remaining <= 0}
                  onClick={() => {
                    setPicked(it);
                    setQtyPr(it.remaining);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 disabled:opacity-40",
                    picked?.id === it.id && "bg-primary/10",
                  )}
                >
                  <Badge variant="outline" className="text-[9px] font-bold font-mono">
                    {it.pr_kode}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-black font-mono uppercase">
                      {it.part_number}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground uppercase">
                      {it.part_name}
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap">
                    Sisa {it.remaining} / {it.qty} {it.satuan}
                  </span>
                </button>
              ))
            )}
          </div>

          {picked && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                  Qty PR yang ditutup ({picked.satuan})
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={picked.remaining}
                  value={qtyPr || ""}
                  onChange={(e) => setQtyPr(Math.max(0, Number(e.target.value) || 0))}
                  className="h-9 font-bold"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                  Catatan
                </Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Opsional"
                  className="h-9"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={!picked || submitting} className="gap-1.5">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Hubungkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
