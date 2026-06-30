"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Snowflake,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import {
  reportFrozenMr,
  resolveFrozenMr,
  getMrFreezeInfo,
} from "@/services/freeze-actions";
import { businessToday } from "@/lib/business-date";

interface MrFreezePanelProps {
  mrId: number;
  currentUserId?: string;
  onChanged?: () => void;
}

export function MrFreezePanel({
  mrId,
  currentUserId,
  onChanged,
}: MrFreezePanelProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);

  const [kendala, setKendala] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [resolveMode, setResolveMode] = useState<"unfreeze" | "reset" | null>(
    null,
  );
  const [resolution, setResolution] = useState("");
  const [resetDeadlines, setResetDeadlines] = useState<Record<number, string>>(
    {},
  );

  const load = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("user_id", user.id);
      const roleNames = (roleRows || [])
        .map((r: any) => r?.roles?.name)
        .filter(Boolean);
      setIsModerator(roleNames.includes("moderator"));
    }
    const res = await getMrFreezeInfo(mrId);
    setInfo(res);
    // Prefill deadline reset dengan nilai existing.
    const dl: Record<number, string> = {};
    (res.items || []).forEach((it: any) => {
      if (it.deadline) dl[it.mr_item_id] = it.deadline;
    });
    setResetDeadlines(dl);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrId]);

  if (loading) return null;
  if (!info?.mr?.is_frozen) return null;

  const mr = info.mr;
  const reports: any[] = info.reports || [];
  const items: any[] = info.items || [];
  const openReport = reports.find((r) => r.status === "open");
  const isOwner = currentUserId && mr.mr_pic_id === currentUserId;

  const handleReport = async () => {
    if (!kendala.trim()) {
      toast.error("Keterangan kendala wajib diisi.");
      return;
    }
    setSubmitting(true);
    const res = await reportFrozenMr(mrId, kendala.trim());
    setSubmitting(false);
    if (res?.success) {
      toast.success("Laporan kendala terkirim ke moderator.");
      setKendala("");
      load();
      onChanged?.();
    } else {
      toast.error(res?.error || "Gagal mengirim laporan");
    }
  };

  const handleResolve = async () => {
    if (!resolveMode) return;
    setSubmitting(true);
    const res = await resolveFrozenMr({
      mrId,
      action: resolveMode,
      resolution: resolution.trim() || undefined,
      deadlines:
        resolveMode === "reset"
          ? items.map((it) => ({
              mr_item_id: it.mr_item_id,
              deadline: resetDeadlines[it.mr_item_id],
            }))
          : undefined,
    });
    setSubmitting(false);
    if (res?.success) {
      toast.success(
        resolveMode === "reset" ? "MR di-reset & dibuka." : "MR di-unfreeze.",
      );
      setResolveMode(null);
      setResolution("");
      load();
      onChanged?.();
    } else {
      toast.error(res?.error || "Gagal memproses");
    }
  };

  const today = businessToday();

  return (
    <div className="rounded-xl border-2 border-sky-300 bg-sky-50/60 overflow-hidden">
      {/* Banner */}
      <div className="flex items-start gap-3 p-4 border-b border-sky-200 bg-sky-100/60">
        <div className="h-9 w-9 rounded-lg bg-sky-500 flex items-center justify-center text-white shrink-0">
          <Snowflake className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-black text-sky-900 uppercase tracking-tight">
              MR Di-Freeze
            </h3>
            <Badge className="bg-sky-500 text-white border-none text-[9px] font-bold uppercase">
              Terkunci
            </Badge>
          </div>
          <p className="text-[11px] font-semibold text-sky-800 mt-1">
            {mr.frozen_reason || "MR melewati deadline share stock."}
          </p>
          {mr.frozen_at && (
            <p className="text-[10px] text-sky-700/70 mt-0.5">
              Sejak: {new Date(mr.frozen_at).toLocaleString("id-ID")}
            </p>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Riwayat laporan */}
        {reports.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-sky-900 uppercase tracking-widest">
              Laporan Kendala
            </p>
            {reports.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-sky-200 bg-white p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-foreground">
                    {r.reporter?.nama || "Pembuat MR"}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[9px] font-bold uppercase ${
                      r.status === "open"
                        ? "text-warning border-warning/40 bg-warning/10"
                        : "text-success border-success/40 bg-success/10"
                    }`}
                  >
                    {r.status === "open" ? "Menunggu Moderator" : "Selesai"}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {r.kendala}
                </p>
                {r.status === "resolved" && (
                  <p className="text-[10px] text-success mt-1 font-semibold">
                    Tindakan:{" "}
                    {r.resolution_action === "reset" ? "Reset deadline" : "Unfreeze"}
                    {r.resolution ? ` — ${r.resolution}` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Owner: form lapor kendala */}
        {isOwner && !isModerator && (
          <div className="space-y-2">
            {openReport ? (
              <p className="text-[11px] font-semibold text-sky-800 rounded-lg border border-sky-200 bg-white p-3">
                Laporan kendala Anda sudah dikirim dan menunggu tindakan
                moderator. Anda belum bisa melanjutkan alur MR ini.
              </p>
            ) : (
              <>
                <p className="text-[10px] font-bold text-sky-900 uppercase tracking-widest">
                  Lapor Kendala ke Moderator
                </p>
                <Textarea
                  value={kendala}
                  onChange={(e) => setKendala(e.target.value)}
                  placeholder="Jelaskan kendala kenapa sampai lewat deadline tapi delivery belum dibuat..."
                  className="min-h-20 bg-white border-sky-200 text-xs"
                  disabled={submitting}
                />
                <Button
                  size="sm"
                  className="w-full gap-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold"
                  onClick={handleReport}
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Kirim Laporan
                </Button>
              </>
            )}
          </div>
        )}

        {/* Moderator: unfreeze / reset */}
        {isModerator && (
          <div className="space-y-3 rounded-lg border border-sky-300 bg-white p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-sky-700" />
              <p className="text-[11px] font-bold text-sky-900 uppercase tracking-tight">
                Tindakan Moderator
              </p>
            </div>

            {!resolveMode && (
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs font-bold border-sky-300 text-sky-700 hover:bg-sky-50"
                  onClick={() => setResolveMode("unfreeze")}
                >
                  Unfreeze (Lanjut)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs font-bold border-amber-300 text-amber-700 hover:bg-amber-50"
                  onClick={() => setResolveMode("reset")}
                >
                  Reset Deadline
                </Button>
              </div>
            )}

            {resolveMode === "reset" && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Set deadline baru per item
                </p>
                {items.map((it) => (
                  <div
                    key={it.mr_item_id}
                    className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] font-bold truncate">
                        {it.part_number}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {it.part_name}
                      </div>
                    </div>
                    <Input
                      type="date"
                      min={today}
                      value={resetDeadlines[it.mr_item_id] || ""}
                      onChange={(e) =>
                        setResetDeadlines((prev) => ({
                          ...prev,
                          [it.mr_item_id]: e.target.value,
                        }))
                      }
                      className="h-8 w-40 text-[11px] font-bold"
                    />
                  </div>
                ))}
              </div>
            )}

            {resolveMode && (
              <div className="space-y-2">
                <Textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  placeholder="Catatan tindakan (opsional)"
                  className="min-h-16 bg-white border-sky-200 text-xs"
                  disabled={submitting}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs font-bold"
                    onClick={() => setResolveMode(null)}
                    disabled={submitting}
                  >
                    Batal
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 gap-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold"
                    onClick={handleResolve}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    {resolveMode === "reset"
                      ? "Reset & Buka MR"
                      : "Unfreeze MR"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
