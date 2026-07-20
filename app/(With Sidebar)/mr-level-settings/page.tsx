// app/(With Sidebar)/mr-level-settings/page.tsx

"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  computeMrAutoBucket,
  MR_AUTO_BUCKET_LABEL,
  MR_AUTO_BUCKET_BADGE_CLASS,
  MrAutoBucket,
} from "@/lib/mr-level";
import {
  getMrLevelAutoRules,
  updateMrLevelAutoRules,
} from "@/services/mr-level-actions";

const CONVERT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "partial", label: "Partial" },
  { value: "complete", label: "Complete" },
];

export default function MrLevelSettingsPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(true);
  const [isModerator, setIsModerator] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [pendingConvertStatuses, setPendingConvertStatuses] = useState<
    string[]
  >(["pending"]);
  const [closeStartMinReceivedPct, setCloseStartMinReceivedPct] =
    useState<number>(0);
  const [closeDoneMinReceivedPct, setCloseDoneMinReceivedPct] =
    useState<number>(100);

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*, roles:user_roles(roles(name))")
          .eq("id", user.id)
          .single();
        if (profile) {
          setIsModerator(
            (profile.roles as any[]).some((r) => r.roles.name === "moderator"),
          );
        }
      }
      setChecking(false);

      const res = await getMrLevelAutoRules();
      if (res.data) {
        setPendingConvertStatuses(res.data.pendingConvertStatuses);
        setCloseStartMinReceivedPct(res.data.closeStartMinReceivedPct);
        setCloseDoneMinReceivedPct(res.data.closeDoneMinReceivedPct);
        setUpdatedAt(res.data.updatedAt);
      } else if (res.error) {
        toast.error(res.error);
      }
      setLoading(false);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleConvertStatus = (value: string) => {
    setPendingConvertStatuses((prev) =>
      prev.includes(value)
        ? prev.filter((v) => v !== value)
        : [...prev, value],
    );
  };

  const invalidRange = closeDoneMinReceivedPct < closeStartMinReceivedPct;
  const noStatusSelected = pendingConvertStatuses.length === 0;

  const handleSave = async () => {
    if (invalidRange) {
      toast.error("Threshold CLOSE 2 harus ≥ threshold CLOSE 1.");
      return;
    }
    if (noStatusSelected) {
      toast.error("Pilih minimal satu status konversi untuk OPEN 1.");
      return;
    }
    setSaving(true);
    const res = await updateMrLevelAutoRules({
      pendingConvertStatuses,
      closeStartMinReceivedPct,
      closeDoneMinReceivedPct,
    });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Aturan trigger level MR berhasil disimpan.");
    setUpdatedAt(new Date().toISOString());
  };

  // Contoh hidup memakai fungsi asli, supaya moderator lihat efeknya sebelum
  // menyimpan — bukan logika duplikat.
  const previewRules = {
    pendingConvertStatuses,
    closeStartMinReceivedPct,
    closeDoneMinReceivedPct,
  };
  const previewCases: {
    label: string;
    input: Parameters<typeof computeMrAutoBucket>[0];
  }[] = [
    {
      label: "MR baru, belum ada PR",
      input: {
        mrConvertStatus: "pending",
        hasPo: false,
        qtyRequestTotal: 10,
        qtyReceivedTotal: 0,
      },
    },
    {
      label: "PR sudah dibuat, PO belum ada",
      input: {
        mrConvertStatus: "partial",
        hasPo: false,
        qtyRequestTotal: 10,
        qtyReceivedTotal: 0,
      },
    },
    {
      label: "PO sudah dibuat, belum ada barang diterima",
      input: {
        mrConvertStatus: "complete",
        hasPo: true,
        qtyRequestTotal: 10,
        qtyReceivedTotal: 0,
      },
    },
    {
      label: "Qty diterima 45% dari qty request",
      input: {
        mrConvertStatus: "complete",
        hasPo: true,
        qtyRequestTotal: 100,
        qtyReceivedTotal: 45,
      },
    },
    {
      label: "Qty diterima 100% dari qty request",
      input: {
        mrConvertStatus: "complete",
        hasPo: true,
        qtyRequestTotal: 100,
        qtyReceivedTotal: 100,
      },
    },
  ];

  if (checking || loading) {
    return (
      <Content title="Trigger Level MR">
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Content>
    );
  }

  if (!isModerator) {
    return (
      <Content title="Trigger Level MR">
        <p className="text-sm text-muted-foreground italic">
          Halaman ini hanya bisa diakses oleh moderator.
        </p>
      </Content>
    );
  }

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
            <SlidersHorizontal className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              TRIGGER LEVEL MR
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Atur syarat auto-deteksi status OPEN / CLOSE Material Request
            </p>
          </div>
        </div>
      </Content>

      <Content
        title="Syarat Auto-Deteksi"
        description="Sistem hanya bisa memastikan 5 bucket ini secara otomatis (OPEN 1, OPEN 2, OPEN 3-5, CLOSE 1, CLOSE 2). Sub-status detail (3A/3B/3C/4/5/2A/2B) tetap diset manual oleh moderator karena tergantung info yang tidak dimodelkan sistem (payment issue, budget approval, posisi barang, email ke HO)."
      >
        <div className="space-y-6 max-w-2xl">
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase text-foreground">
              Status konversi yang dianggap &quot;PR belum dibuat&quot; (
              <Badge
                variant="outline"
                className={`text-[9px] font-bold uppercase ${MR_AUTO_BUCKET_BADGE_CLASS.OPEN_1}`}
              >
                {MR_AUTO_BUCKET_LABEL.OPEN_1}
              </Badge>
              )
            </Label>
            <div className="flex flex-wrap gap-4 pt-1">
              {CONVERT_STATUS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={pendingConvertStatuses.includes(opt.value)}
                    onCheckedChange={() => toggleConvertStatus(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {noStatusSelected && (
              <p className="text-[11px] text-destructive">
                Pilih minimal satu status.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase text-foreground">
              Minimal % qty diterima untuk mulai{" "}
              <Badge
                variant="outline"
                className={`text-[9px] font-bold uppercase ${MR_AUTO_BUCKET_BADGE_CLASS.CLOSE_1}`}
              >
                {MR_AUTO_BUCKET_LABEL.CLOSE_1}
              </Badge>
            </Label>
            <Input
              type="number"
              min={0}
              step={0.01}
              className="w-40"
              value={closeStartMinReceivedPct}
              onChange={(e) =>
                setCloseStartMinReceivedPct(Number(e.target.value))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Default 0 = begitu ada qty diterima (&gt; 0), langsung dianggap
              CLOSE 1.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase text-foreground">
              Minimal % qty diterima untuk{" "}
              <Badge
                variant="outline"
                className={`text-[9px] font-bold uppercase ${MR_AUTO_BUCKET_BADGE_CLASS.CLOSE_2}`}
              >
                {MR_AUTO_BUCKET_LABEL.CLOSE_2}
              </Badge>
            </Label>
            <Input
              type="number"
              min={0}
              step={0.01}
              className="w-40"
              value={closeDoneMinReceivedPct}
              onChange={(e) =>
                setCloseDoneMinReceivedPct(Number(e.target.value))
              }
            />
            {invalidRange && (
              <p className="text-[11px] text-destructive">
                Harus ≥ threshold CLOSE 1 di atas.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleSave}
              disabled={saving || invalidRange || noStatusSelected}
              className="font-bold text-xs uppercase gap-2"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Simpan Aturan
            </Button>
            {updatedAt && (
              <span className="text-[10px] text-muted-foreground">
                Terakhir diubah:{" "}
                {new Date(updatedAt).toLocaleString("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            )}
          </div>
        </div>
      </Content>

      <Content
        title="Pratinjau"
        description="Contoh hasil bucket otomatis dengan aturan di atas (belum disimpan, hanya simulasi)."
      >
        <div className="space-y-2 max-w-2xl">
          {previewCases.map((c) => {
            const bucket: MrAutoBucket = computeMrAutoBucket(
              c.input,
              previewRules,
            );
            return (
              <div
                key={c.label}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="text-xs text-foreground">{c.label}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] font-bold uppercase shrink-0 ${MR_AUTO_BUCKET_BADGE_CLASS[bucket]}`}
                >
                  {MR_AUTO_BUCKET_LABEL[bucket]}
                </Badge>
              </div>
            );
          })}
        </div>
      </Content>
    </>
  );
}
