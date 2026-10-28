"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  updateItemTransferTracking,
  updateItemTransferTrackingModerator,
} from "@/services/item-transfer-actions";

export const TRACKING_ORDER = [
  "created",
  "packing",
  "ready_pickup",
  "in_transit",
  "delivered",
];
export const TRACKING_LABEL: Record<string, string> = {
  created: "Item Transfer Dibuat",
  packing: "Packing",
  ready_pickup: "Siap Diambil",
  in_transit: "Dalam Pengiriman",
  delivered: "Barang Diterima",
  completed: "Selesai Final",
};
// "completed" hanya lewat Konfirmasi Barang Diterima (TTD penerima),
// jadi tampil di dropdown tapi tidak bisa dipilih.
const TRACKING_FULL_ORDER = [...TRACKING_ORDER, "completed"];

interface Props {
  itId: number;
  trackingStatus: string | null | undefined;
  trackingNote: string | null | undefined;
  /** Gudang asal: boleh ganti status (maju/mundur), tanpa catatan. */
  canTrack: boolean;
  /** Moderator/admin: boleh ganti status + catatan tracking. */
  canOverride: boolean;
  onSaved: () => Promise<void> | void;
}

export function ItemTransferTrackingControl(props: Props) {
  // Remount saat status/catatan tersimpan berubah supaya pilihan ikut reset.
  return (
    <TrackingControlForm
      key={`${props.trackingStatus}|${props.trackingNote ?? ""}`}
      {...props}
    />
  );
}

function TrackingControlForm({
  itId,
  trackingStatus,
  trackingNote,
  canTrack,
  canOverride,
  onSaved,
}: Props) {
  const current = trackingStatus || "created";
  const [status, setStatus] = useState(current);
  const [note, setNote] = useState(trackingNote || "");
  const [saving, setSaving] = useState(false);

  const canEdit = canTrack || canOverride;
  const dirty =
    status !== current ||
    (canOverride && note.trim() !== (trackingNote || "").trim());
  const stepIndex = TRACKING_FULL_ORDER.indexOf(current);

  const handleSave = async () => {
    setSaving(true);
    const res = canOverride
      ? await updateItemTransferTrackingModerator(itId, status, note)
      : await updateItemTransferTracking(itId, status);
    setSaving(false);
    if (res.error) return toast.error(res.error);
    toast.success(`Tracking: ${TRACKING_LABEL[status]}`);
    await onSaved();
  };

  return (
    <div className="space-y-2">
      <Select
        value={status}
        onValueChange={setStatus}
        disabled={!canEdit || saving}
      >
        <SelectTrigger className="h-10 w-full bg-white border-orange-200 font-bold text-xs uppercase rounded-lg text-orange-700 disabled:opacity-100">
          <SelectValue placeholder="Pilih status pengiriman" />
        </SelectTrigger>
        <SelectContent>
          {TRACKING_FULL_ORDER.map((s, idx) => (
            <SelectItem
              key={s}
              value={s}
              disabled={s === "completed"}
              className="text-xs font-bold uppercase"
            >
              {idx + 1}. {TRACKING_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {stepIndex >= 0 && (
        <p className="text-[10px] font-medium text-orange-700/70">
          Tahap {stepIndex + 1} dari {TRACKING_FULL_ORDER.length}
        </p>
      )}

      {canOverride && (
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Catatan tracking (opsional, khusus moderator/admin)"
          className="min-h-20 bg-white border-orange-200 text-xs"
          disabled={saving}
        />
      )}

      {canEdit && (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 text-xs font-bold border-orange-200 text-orange-700 hover:bg-orange-50"
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Simpan Status Pengiriman
        </Button>
      )}
    </div>
  );
}
