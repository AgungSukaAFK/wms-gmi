"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { diffSoSnapshots, type SoSnapshot } from "@/lib/so-revision";

type Revision = {
  id: number;
  revision_no: number;
  edited_by_nama: string | null;
  reason: string;
  snapshot_before: SoSnapshot;
  snapshot_after: SoSnapshot;
  created_at: string;
};

const fmt = (n: number) => n.toLocaleString("id-ID");

function Change({ before, after }: { before: string; after: string }) {
  return (
    <span className="break-words">
      <span className="text-destructive line-through">{before}</span> →{" "}
      <span className="font-semibold">{after}</span>
    </span>
  );
}

/** Riwayat Edit SO (so_reguler_revisions), terbaru dulu. */
export function SoRevisionHistory({
  soId,
  refreshKey,
}: {
  soId: number;
  refreshKey?: unknown;
}) {
  const [revisions, setRevisions] = useState<Revision[]>([]);

  useEffect(() => {
    createClient()
      .from("so_reguler_revisions")
      .select(
        "id, revision_no, edited_by_nama, reason, snapshot_before, snapshot_after, created_at",
      )
      .eq("so_id", soId)
      .order("revision_no", { ascending: false })
      .then(({ data }) => setRevisions((data as Revision[]) || []));
  }, [soId, refreshKey]);

  if (revisions.length === 0) return null;

  return (
    <Content>
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-bold">Riwayat Perubahan SO</h2>
        <Badge variant="secondary" className="text-[10px]">
          {revisions.length} revisi
        </Badge>
      </div>
      <div className="space-y-3">
        {revisions.map((r) => {
          const d = diffSoSnapshots(r.snapshot_before, r.snapshot_after);
          return (
            <div key={r.id} className="rounded-lg border p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">
                  Revisi ke-{r.revision_no}
                  <span className="ml-2 font-medium text-muted-foreground">
                    {r.edited_by_nama || "-"} · {formatDate(r.created_at)}
                  </span>
                </p>
              </div>
              <p className="mt-1 italic text-muted-foreground">
                Alasan: {r.reason}
              </p>
              <ul className="mt-2 space-y-1">
                {d.header.map((c) => (
                  <li key={c.label}>
                    <span className="text-muted-foreground">{c.label}: </span>
                    <Change before={c.before} after={c.after} />
                  </li>
                ))}
                {d.added.map((i) => (
                  <li key={`a-${i.id}`}>
                    <span className="font-semibold text-success">+ Tambah</span>{" "}
                    <code className="font-bold">{i.part_number}</code> ·{" "}
                    {fmt(i.qty)} {i.satuan}
                  </li>
                ))}
                {d.removed.map((i) => (
                  <li key={`r-${i.id}`}>
                    <span className="font-semibold text-destructive">
                      − Hapus
                    </span>{" "}
                    <code className="font-bold">{i.part_number}</code> ·{" "}
                    {fmt(i.qty)} {i.satuan}
                  </li>
                ))}
                {d.changed.map((i) => (
                  <li key={`c-${i.part_number}`}>
                    <code className="font-bold">{i.part_number}</code>{" "}
                    {i.changes.map((c, idx) => (
                      <span key={c.label}>
                        {idx > 0 && " · "}
                        <span className="text-muted-foreground">
                          {c.label}:{" "}
                        </span>
                        <Change before={c.before} after={c.after} />
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Content>
  );
}
