"use client";

import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Loader2, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  MR_LEVEL_DEFINITIONS,
  MrLevelCode,
  MrAutoBucket,
  computeMrAutoBucket,
  resolveMrLevelDisplay,
} from "@/lib/mr-level";
import { setMrManualLevel } from "@/services/mr-level-actions";

interface MrLevelBadgeProps {
  mrId: number;
  mrConvertStatus: string | null | undefined;
  hasPo: boolean;
  qtyRequestTotal: number;
  qtyReceivedTotal: number;
  manualLevel: string | null | undefined;
  manualNote?: string | null;
  manualSetByName?: string | null;
  manualSetAt?: string | null;
  canEdit: boolean;
  size?: "xs" | "sm";
  onChanged?: (patch: {
    manual_level: string | null;
    manual_level_note: string | null;
  }) => void;
}

export function MrLevelBadge({
  mrId,
  mrConvertStatus,
  hasPo,
  qtyRequestTotal,
  qtyReceivedTotal,
  manualLevel,
  manualNote,
  manualSetByName,
  manualSetAt,
  canEdit,
  size = "sm",
  onChanged,
}: MrLevelBadgeProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<string>(manualLevel || "");
  const [note, setNote] = useState(manualNote || "");
  const [saving, setSaving] = useState(false);

  const autoBucket: MrAutoBucket = computeMrAutoBucket({
    mrConvertStatus,
    hasPo,
    qtyRequestTotal,
    qtyReceivedTotal,
  });

  const display = resolveMrLevelDisplay({
    manualLevel,
    manualNote,
    autoBucket,
  });

  const textSize = size === "xs" ? "text-[9px]" : "text-[10px]";

  const startEdit = () => {
    setSelectedLevel(manualLevel || "");
    setNote(manualNote || "");
    setEditing(true);
  };

  const handleSave = async () => {
    if (!selectedLevel) {
      toast.error("Pilih status terlebih dahulu.");
      return;
    }
    setSaving(true);
    const res = await setMrManualLevel({
      mrId,
      level: selectedLevel as MrLevelCode,
      note: note.trim() || undefined,
    });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Status MR berhasil diubah manual.");
    onChanged?.({
      manual_level: selectedLevel,
      manual_level_note: note.trim() || null,
    });
    setEditing(false);
  };

  const handleResetToAuto = async () => {
    setSaving(true);
    const res = await setMrManualLevel({ mrId, level: null });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Status MR dikembalikan ke otomatis.");
    onChanged?.({ manual_level: null, manual_level_note: null });
    setEditing(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setEditing(false);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()}>
          <Badge
            variant="outline"
            className={`${textSize} font-bold uppercase cursor-pointer hover:opacity-80 transition-opacity ${display.badgeClass}`}
          >
            {display.label}
            {display.isManual && (
              <Pencil className="h-2.5 w-2.5 ml-1 inline-block" />
            )}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 space-y-2 border-b border-border">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">
              Status Saat Ini
            </span>
            <Badge
              variant="outline"
              className={`text-[10px] font-bold uppercase ${display.badgeClass}`}
            >
              {display.label}
            </Badge>
          </div>
          {display.isManual ? (
            <div className="text-[11px] text-foreground space-y-0.5">
              <p className="font-semibold">{display.description}</p>
              {manualNote && (
                <p className="text-muted-foreground italic">
                  &ldquo;{manualNote}&rdquo;
                </p>
              )}
              {(manualSetByName || manualSetAt) && (
                <p className="text-[10px] text-muted-foreground">
                  Diset manual oleh{" "}
                  <span className="font-semibold">
                    {manualSetByName || "-"}
                  </span>
                  {manualSetAt &&
                    ` · ${new Date(manualSetAt).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}`}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              Dihitung otomatis oleh sistem. Sub-status pastinya (payment
              issue, budget approval, posisi barang, dokumen ke HO) belum
              bisa dipastikan sistem.
            </p>
          )}
        </div>

        {canEdit && (
          <div className="p-3 border-b border-border space-y-2">
            {!editing ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] font-bold uppercase gap-1.5 flex-1"
                  onClick={startEdit}
                  disabled={saving}
                >
                  <Pencil className="h-3 w-3" /> Set Manual
                </Button>
                {display.isManual && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[10px] font-bold uppercase gap-1.5 text-muted-foreground"
                    onClick={handleResetToAuto}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Otomatis
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Select value={selectedLevel} onValueChange={setSelectedLevel}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Pilih status..." />
                  </SelectTrigger>
                  <SelectContent>
                    {MR_LEVEL_DEFINITIONS.map((def) => (
                      <SelectItem
                        key={def.code}
                        value={def.code}
                        className="text-xs"
                      >
                        {def.label} — {def.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  placeholder="Catatan (opsional)..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="text-xs min-h-16 resize-none"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-[10px] font-bold uppercase flex-1"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Simpan"
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[10px] font-bold uppercase"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                  >
                    Batal
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto">
          <p className="text-[9px] font-bold uppercase text-muted-foreground">
            Keterangan Semua Status
          </p>
          {MR_LEVEL_DEFINITIONS.map((def, idx) => (
            <React.Fragment key={def.code}>
              {idx === 7 && <Separator className="my-1.5" />}
              <div
                className={`flex items-start gap-2 rounded-md px-1.5 py-1 ${
                  manualLevel === def.code ? "bg-muted/60" : ""
                }`}
              >
                <span className="text-[9px] font-bold text-foreground w-14 shrink-0 pt-0.5">
                  {def.label}
                </span>
                <span className="text-[10px] text-muted-foreground leading-snug">
                  {def.description}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
