"use client";

// Riwayat PO — timeline revisi (Edit PO oleh purchasing/moderator) dari
// po_revisions, termasuk approval ronde sebelumnya yang di-reset tiap revisi.
// Nilai harga disembunyikan untuk user tanpa akses harga.

import React, { useEffect, useState } from "react";
import {
  ChevronDown,
  FilePlus2,
  History,
  Loader2,
  Minus,
  Pencil,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatDateTime } from "@/lib/utils";
import { getPoRevisions } from "@/services/po-revision-actions";
import { formatPoMoney } from "@/lib/po-currency";
import {
  PO_REVISION_PRICE_FIELDS,
  type PoRevisionChanges,
  type PoRevisionItemSnapshot,
} from "@/lib/po-revision";

interface PoRevisionHistoryProps {
  poId: number;
  canViewPrice: boolean;
  createdAt?: string | null;
  createdBy?: string | null;
  refreshKey?: number;
}

const RESTRICTED = "Restricted";

export function PoRevisionHistory({
  poId,
  canViewPrice,
  createdAt,
  createdBy,
  refreshKey,
}: PoRevisionHistoryProps) {
  const [revisions, setRevisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getPoRevisions(poId).then((res) => {
      if (active) {
        setRevisions(res.data || []);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [poId, refreshKey]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-3.5 w-3.5 text-primary" />
        <h5 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
          Riwayat PO
        </h5>
        {revisions.length > 0 && (
          <Badge variant="outline" className="text-[9px] font-bold uppercase">
            {revisions.length} revisi
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ol className="relative space-y-3 border-l border-border pl-5">
          {revisions.map((rev) => (
            <RevisionEntry key={rev.id} rev={rev} canViewPrice={canViewPrice} />
          ))}
          <li className="relative">
            <span className="absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-muted ring-4 ring-background">
              <FilePlus2 className="h-2.5 w-2.5 text-muted-foreground" />
            </span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[11px] font-black text-foreground">PO dibuat</span>
              <span className="text-[10px] text-muted-foreground">
                {createdBy || "-"} · {createdAt ? formatDateTime(createdAt) : "-"}
              </span>
            </div>
            {revisions.length === 0 && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Belum pernah direvisi.
              </p>
            )}
          </li>
        </ol>
      )}
    </div>
  );
}

function RevisionEntry({ rev, canViewPrice }: { rev: any; canViewPrice: boolean }) {
  const [open, setOpen] = useState(false);
  const changes: PoRevisionChanges | null = rev.changes || null;
  const prevApprovals: any[] = rev.snapshot_before?.approvals || [];
  const currency = changes?.totals.currency || "IDR";
  const money = (v: number) =>
    canViewPrice ? formatPoMoney(v, currency as any) : RESTRICTED;

  const headerChanges = (changes?.header || []).map((h) =>
    !canViewPrice && PO_REVISION_PRICE_FIELDS.has(h.field)
      ? { ...h, before: RESTRICTED, after: RESTRICTED }
      : h,
  );

  return (
    <li className="relative">
      <span className="absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary ring-4 ring-background">
        <Pencil className="h-2.5 w-2.5 text-primary-foreground" />
      </span>
      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className="text-[9px] font-black uppercase">Rev. {rev.revision_no}</Badge>
            <span className="text-[11px] font-black text-foreground">
              {rev.edited_by_nama || "-"}
            </span>
            {rev.edited_by_role && (
              <Badge variant="outline" className="text-[8px] font-bold uppercase">
                {rev.edited_by_role}
              </Badge>
            )}
          </div>
          <span className="text-[9px] font-bold text-muted-foreground uppercase">
            {formatDateTime(rev.created_at)}
          </span>
        </div>

        <div className="rounded-md border-l-2 border-warning bg-warning/5 px-2.5 py-1.5">
          <p className="text-[9px] font-bold uppercase text-muted-foreground">Alasan</p>
          <p className="text-[11px] text-foreground whitespace-pre-wrap">{rev.reason}</p>
        </div>

        {rev.summary && (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Perubahan: {rev.summary}. Approval diulang dari awal.
          </p>
        )}

        {changes && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-bold uppercase text-primary hover:underline"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
            {open ? "Sembunyikan detail" : "Lihat detail perubahan"}
          </button>
        )}

        {open && changes && (
          <div className="space-y-3 pt-1">
            {(changes.prs.added.length > 0 || changes.prs.removed.length > 0) && (
              <Section title="Referensi PR">
                <div className="flex flex-wrap gap-1.5">
                  {changes.prs.added.map((k) => (
                    <Badge key={`a-${k}`} variant="outline" className="text-[9px] font-bold border-success/40 text-success gap-1">
                      <Plus className="h-2.5 w-2.5" /> {k}
                    </Badge>
                  ))}
                  {changes.prs.removed.map((k) => (
                    <Badge key={`r-${k}`} variant="outline" className="text-[9px] font-bold border-destructive/40 text-destructive gap-1 line-through">
                      <Minus className="h-2.5 w-2.5" /> {k}
                    </Badge>
                  ))}
                </div>
              </Section>
            )}

            {headerChanges.length > 0 && (
              <Section title="Informasi PO">
                <ChangeTable
                  rows={headerChanges.map((h) => ({
                    key: h.field,
                    label: h.label,
                    before: h.before,
                    after: h.after,
                  }))}
                />
              </Section>
            )}

            {(changes.items.added.length > 0 ||
              changes.items.removed.length > 0 ||
              changes.items.changed.length > 0) && (
              <Section title="Item">
                <div className="space-y-1">
                  {changes.items.added.map((i) => (
                    <ItemLine key={`a-${i.id}`} kind="added" item={i} money={money} />
                  ))}
                  {changes.items.removed.map((i) => (
                    <ItemLine key={`r-${i.id}`} kind="removed" item={i} money={money} />
                  ))}
                  {changes.items.changed.map((c, idx) => (
                    <div key={`c-${idx}`} className="flex flex-wrap items-baseline gap-x-2 text-[10px]">
                      <Pencil className="h-2.5 w-2.5 text-warning self-center" />
                      <span className="font-mono font-black uppercase">{c.part_number}</span>
                      {c.pr_kode && (
                        <span className="text-muted-foreground uppercase">{c.pr_kode}</span>
                      )}
                      {c.changes.map((f) => (
                        <span key={f.field} className="text-muted-foreground">
                          {f.label}:{" "}
                          <span className="line-through">
                            {f.field === "harga" && !canViewPrice ? RESTRICTED : f.before}
                          </span>{" "}
                          →{" "}
                          <span className="font-bold text-foreground">
                            {f.field === "harga" && !canViewPrice ? RESTRICTED : f.after}
                          </span>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {changes.totals.before !== changes.totals.after && (
              <Section title="Total PO">
                <p className="text-[11px]">
                  <span className="line-through text-muted-foreground">
                    {money(changes.totals.before)}
                  </span>{" "}
                  →{" "}
                  <span className="font-black text-foreground">
                    {money(changes.totals.after)}
                  </span>
                </p>
              </Section>
            )}

            {prevApprovals.length > 0 && (
              <Section title="Approval sebelum revisi (di-reset)">
                <div className="space-y-1">
                  {prevApprovals.map((a, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2 text-[10px]">
                      <span className="w-4 text-muted-foreground font-bold">{idx + 1}.</span>
                      <span className="font-bold text-foreground">{a.nama || "-"}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[8px] font-bold uppercase",
                          a.status === "approved" && "border-success/40 text-success",
                          a.status === "rejected" && "border-destructive/40 text-destructive",
                        )}
                      >
                        {a.status}
                      </Badge>
                      {a.processed_at && (
                        <span className="text-muted-foreground">
                          {formatDateTime(a.processed_at)}
                        </span>
                      )}
                      {a.notes && (
                        <span className="text-muted-foreground italic">“{a.notes}”</span>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function ChangeTable({
  rows,
}: {
  rows: { key: string; label: string; before: string; after: string }[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-[10px]">
        <thead className="bg-muted/50">
          <tr className="text-left text-[9px] uppercase text-muted-foreground">
            <th className="px-2 py-1 font-black">Field</th>
            <th className="px-2 py-1 font-black">Sebelum</th>
            <th className="px-2 py-1 font-black">Sesudah</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border align-top">
              <td className="px-2 py-1 font-bold text-muted-foreground whitespace-nowrap">{r.label}</td>
              <td className="px-2 py-1 text-muted-foreground line-through break-words">{r.before}</td>
              <td className="px-2 py-1 font-bold text-foreground break-words">{r.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemLine({
  kind,
  item,
  money,
}: {
  kind: "added" | "removed";
  item: PoRevisionItemSnapshot;
  money: (v: number) => string;
}) {
  const added = kind === "added";
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline gap-x-2 text-[10px]",
        !added && "text-destructive",
      )}
    >
      {added ? (
        <Plus className="h-2.5 w-2.5 text-success self-center" />
      ) : (
        <Minus className="h-2.5 w-2.5 self-center" />
      )}
      <span className={cn("font-mono font-black uppercase", !added && "line-through")}>
        {item.part_number}
      </span>
      <span className={cn("text-muted-foreground uppercase truncate max-w-60", !added && "line-through")}>
        {item.part_name}
      </span>
      {item.pr_kode && <span className="text-muted-foreground uppercase">{item.pr_kode}</span>}
      <span className="text-muted-foreground">
        {item.qty} {item.satuan} × {money(item.harga)}
      </span>
    </div>
  );
}
