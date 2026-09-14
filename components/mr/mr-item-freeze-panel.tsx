"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Snowflake } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/utils";
import {
  getMrItemFreezeInfo,
  reportFrozenMrItem,
  resolveMrItemFreeze,
} from "@/services/freeze-actions";

interface Props {
  mrItemId: number;
  currentUserId?: string;
  onChanged?: () => void;
}

/**
 * Panel freeze per-item (Scheduled MR) — mirror mr-freeze-panel.tsx (freeze
 * dokumen MR biasa) tapi scoped ke satu mr_items.
 */
export function MrItemFreezePanel({ mrItemId, currentUserId, onChanged }: Props) {
  const supabase = createClient();
  const [info, setInfo] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [kendala, setKendala] = useState("");
  const [resetDueDate, setResetDueDate] = useState("");
  const [busy, setBusy] = useState(false);

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
      setIsModerator(
        (roleRows || []).some((r: any) => r.roles?.name === "moderator"),
      );
    }
    const result = await getMrItemFreezeInfo(mrItemId);
    setInfo(result);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrItemId]);

  if (loading) return null;
  if (!info?.item?.is_item_frozen) return null;

  const mrInfo = info.item.mrs;
  const isOwner = currentUserId && mrInfo?.mr_pic_id === currentUserId;
  const openReport = (info.reports || []).find((r: any) => r.status === "open");

  const handleReport = async () => {
    if (!kendala.trim()) {
      toast.error("Keterangan kendala wajib diisi.");
      return;
    }
    setBusy(true);
    const res = await reportFrozenMrItem(mrItemId, kendala);
    setBusy(false);
    if (res.success) {
      toast.success("Laporan kendala terkirim ke moderator.");
      setKendala("");
      load();
      onChanged?.();
    } else {
      toast.error(res.error || "Gagal mengirim laporan.");
    }
  };

  const handleResolve = async (action: "unfreeze" | "reset") => {
    if (action === "reset" && !resetDueDate) {
      toast.error("Isi due date baru terlebih dahulu.");
      return;
    }
    setBusy(true);
    const res = await resolveMrItemFreeze({
      mrItemId,
      action,
      newDueDate: action === "reset" ? resetDueDate : undefined,
    });
    setBusy(false);
    if (res.success) {
      toast.success(
        action === "reset" ? "Due date item diperpanjang." : "Item di-unfreeze.",
      );
      load();
      onChanged?.();
    } else {
      toast.error(res.error || "Gagal memproses.");
    }
  };

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Snowflake className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase text-sky-700">
              Item Di-Freeze
            </span>
            <Badge className="h-4 px-1.5 bg-sky-600 text-white text-[9px] font-bold uppercase">
              Terkunci
            </Badge>
          </div>
          <p className="text-[11px] text-sky-700/80 font-medium">
            {info.item.item_frozen_reason}
          </p>
          {info.item.item_frozen_at && (
            <p className="text-[9px] text-sky-600/60 font-semibold uppercase">
              Sejak {formatDateTime(info.item.item_frozen_at)}
            </p>
          )}
        </div>
      </div>

      {(info.reports || []).length > 0 && (
        <div className="space-y-1.5">
          {info.reports.map((r: any) => (
            <div
              key={r.id}
              className="rounded-md border border-sky-100 bg-white p-2 text-[11px]"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-foreground">
                  {r.reporter?.nama || "User"}
                </span>
                <Badge
                  variant="outline"
                  className={`text-[9px] font-bold uppercase ${r.status === "open" ? "text-warning border-warning/30" : "text-success border-success/30"}`}
                >
                  {r.status}
                </Badge>
              </div>
              <p className="text-muted-foreground mt-0.5">{r.kendala}</p>
              {r.resolution && (
                <p className="text-muted-foreground/70 italic mt-1">
                  Resolusi: {r.resolution}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {isOwner && !isModerator && (
        <div className="space-y-2">
          {openReport ? (
            <p className="text-[11px] font-semibold text-sky-700">
              Laporan sudah terkirim, menunggu tindakan moderator.
            </p>
          ) : (
            <>
              <Textarea
                value={kendala}
                onChange={(e) => setKendala(e.target.value)}
                placeholder="Jelaskan kendala item ini..."
                className="h-16 resize-none text-xs bg-white"
              />
              <Button
                size="sm"
                className="h-8 text-xs font-bold"
                onClick={handleReport}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Kirim Laporan"}
              </Button>
            </>
          )}
        </div>
      )}

      {isModerator && (
        <div className="space-y-2 border-t border-sky-100 pt-2.5">
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={resetDueDate}
              onChange={(e) => setResetDueDate(e.target.value)}
              className="h-8 text-xs bg-white"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 text-xs font-bold"
              onClick={() => handleResolve("reset")}
              disabled={busy}
            >
              Perpanjang Due Date
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-full text-xs font-bold"
            onClick={() => handleResolve("unfreeze")}
            disabled={busy}
          >
            Unfreeze (Lanjut Tanpa Ubah Due Date)
          </Button>
        </div>
      )}
    </div>
  );
}
