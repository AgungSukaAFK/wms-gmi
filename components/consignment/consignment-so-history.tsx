"use client";

import React, { useEffect, useState } from "react";
import { History, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils";

type LogChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

type SoLog = {
  id: number;
  action: "edit" | "delete";
  user_nama: string | null;
  user_role: string | null;
  reason: string | null;
  summary: string;
  changes: LogChange[] | null;
  created_at: string;
};

const DATE_FIELDS = new Set([
  "so_tanggal_input",
  "tgl_po_email_marketing",
  "tgl_po_customer",
  "due_date",
]);

const ROLE_LABEL: Record<string, string> = {
  moderator: "Moderator",
  admin: "Admin",
  marketing: "Marketing",
};

function showValue(field: string, v: string | null) {
  if (!v) return "—";
  return DATE_FIELDS.has(field) ? formatDate(v) : v;
}

/** Riwayat Aktivitas SO Consignment (consignment_so_logs), terbaru dulu. */
export function ConsignmentSoHistory({
  soId,
  refreshKey,
}: {
  soId: number;
  refreshKey?: unknown;
}) {
  const [logs, setLogs] = useState<SoLog[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    createClient()
      .from("consignment_so_logs")
      .select("id, action, user_nama, user_role, reason, summary, changes, created_at")
      .eq("so_id", soId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!active) return;
        setLogs((data as SoLog[]) || []);
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [soId, refreshKey]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Riwayat Aktivitas
        </h3>
        {logs.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {logs.length}
          </Badge>
        )}
      </div>

      {loaded && logs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-xs italic text-muted-foreground">
          Belum ada perubahan data sejak SO dibuat.
        </p>
      ) : (
        <ol className="space-y-3 border-l border-border pl-4">
          {logs.map((log) => {
            const Icon = log.action === "delete" ? Trash2 : Pencil;
            return (
              <li key={log.id} className="relative rounded-lg border p-3 text-xs">
                <span className="absolute -left-[25px] top-3 flex h-4 w-4 items-center justify-center rounded-full border bg-background">
                  <Icon className="h-2.5 w-2.5 text-muted-foreground" />
                </span>
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <p className="font-bold">
                    {log.user_nama || "-"}
                    {log.user_role && (
                      <span className="ml-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        {ROLE_LABEL[log.user_role] || log.user_role}
                      </span>
                    )}
                  </p>
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                    {formatDateTime(log.created_at)}
                  </span>
                </div>
                {log.reason && (
                  <p className="mt-1 italic text-muted-foreground">
                    Alasan: {log.reason}
                  </p>
                )}
                {log.changes && log.changes.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {log.changes.map((c) => (
                      <li key={c.field} className="break-words">
                        <span className="text-muted-foreground">{c.label}: </span>
                        <span className="text-destructive line-through">
                          {showValue(c.field, c.before)}
                        </span>{" "}
                        →{" "}
                        <span className="font-semibold">
                          {showValue(c.field, c.after)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1">{log.summary}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
