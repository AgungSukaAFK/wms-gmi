"use client";

// Panel riwayat "Moderator Edit" — dipasang di halaman detail dokumen
// (MR/PR/PO/SPB) supaya siapapun bisa melihat kapan & oleh siapa dokumen ini
// pernah diedit lewat mode Moderator Edit (yang bisa bypass alur approval
// normal), demi akuntabilitas.

import React, { useEffect, useState } from "react";
import { History, Loader2, ShieldAlert } from "lucide-react";
import { getModeratorEditLogs } from "@/services/moderator-edit-actions";

interface ModeratorEditLogPanelProps {
  docType: "mr" | "pr" | "po" | "spb" | "spb_po" | "spb_do" | "spb_invoice" | "return_spb";
  docId: number;
  refreshKey?: number;
}

export function ModeratorEditLogPanel({
  docType,
  docId,
  refreshKey,
}: ModeratorEditLogPanelProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getModeratorEditLogs(docType, docId).then((res) => {
      if (active) {
        setLogs(res.data || []);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [docType, docId, refreshKey]);

  if (!loading && logs.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-3.5 w-3.5 text-warning" />
        <h5 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
          Riwayat Moderator Edit
        </h5>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div
              key={log.id}
              className="rounded-lg border border-warning/20 bg-warning/5 p-3 space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black text-foreground">
                  {log.user_nama || "Moderator"}
                </span>
                <div className="flex items-center gap-1 text-[9px] font-bold text-muted-foreground uppercase">
                  <History className="h-2.5 w-2.5" />
                  {new Date(log.created_at).toLocaleString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {log.summary}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
