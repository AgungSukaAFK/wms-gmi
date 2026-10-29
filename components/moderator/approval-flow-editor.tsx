"use client";

// Editor jalur approval bebas untuk fitur "Moderator Edit". Dipakai di halaman
// detail MR (dan nantinya PR/PO/SPB) supaya moderator bisa mengubah approver,
// role (menyetujui/mengetahui), urutan, dan status tiap tahap secara langsung.
// Status akhir dokumen (open/approved/rejected) diturunkan otomatis dari array
// ini oleh server action — komponen ini murni edit state di client.
//
// Kalau `templateType` diisi, di atas daftar muncul pilihan "Isi dari
// Template": moderator bisa mengganti seluruh jalur sekaligus sesuai
// approval_templates, lalu tetap mengubah tiap tahap secara manual.
// (Dokumen Stock Out tidak memakainya — StockOutModeratorEditDialog punya
// pemilih template sendiri karena ikut menyimpan approval_template_id.)

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "use-debounce";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Search,
  Loader2,
  ChevronsUpDown,
  LayoutTemplate,
} from "lucide-react";
import type { ModeratorApprovalStep } from "@/services/moderator-edit-actions";
import type { ApprovalType } from "@/type";

interface ApprovalFlowEditorProps {
  steps: ModeratorApprovalStep[];
  onChange: (steps: ModeratorApprovalStep[]) => void;
  // Opsional — aktifkan pilihan "Isi dari Template".
  templateType?: ApprovalType;
  // Lokasi dokumen: template lokasi ini (lalu Global) ditaruh paling atas.
  templateCabangId?: number | null;
  // Pembuat dokumen, mengisi tahap template bertipe "requester".
  requesterId?: string | null;
}

type TemplateOption = {
  id: number;
  name: string | null;
  cabang_id: number | null;
  cabang: { nama_cabang: string } | null;
  steps: {
    id: number;
    step_order: number;
    approver_type: "user" | "requester";
    level: string | null;
    profiles: { id: string; nama: string; email: string } | null;
  }[];
};

const one = (v: any) => (Array.isArray(v) ? v[0] : v);

export function ApprovalFlowEditor({
  steps,
  onChange,
  templateType,
  templateCabangId,
  requesterId,
}: ApprovalFlowEditorProps) {
  const supabase = createClient();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [applyingTemplate, setApplyingTemplate] = useState(false);

  useEffect(() => {
    if (!templateType) return;
    const run = async () => {
      setLoadingTemplates(true);
      const { data, error } = await supabase
        .from("approval_templates")
        .select(
          "id, name, cabang_id, cabang(nama_cabang), steps:approval_template_steps(id, step_order, approver_type, level, profiles(id, nama, email))",
        )
        .eq("type", templateType)
        .order("name");
      if (error) toast.error(`Gagal memuat template approval: ${error.message}`);
      setTemplates(
        (data || []).map((t: any) => ({
          ...t,
          cabang: one(t.cabang) ?? null,
          steps: (t.steps || []).map((s: any) => ({ ...s, profiles: one(s.profiles) ?? null })),
        })),
      );
      setLoadingTemplates(false);
    };
    run();
  }, [templateType]);

  // Moderator boleh pakai template lokasi mana pun, tapi yang sesuai lokasi
  // dokumen (lalu Global) ditaruh di atas.
  const sortedTemplates = useMemo(() => {
    const rank = (t: TemplateOption) =>
      templateCabangId != null && t.cabang_id === templateCabangId
        ? 0
        : t.cabang_id === null
          ? 1
          : 2;
    return [...templates].sort((a, b) => rank(a) - rank(b));
  }, [templates, templateCabangId]);

  useEffect(() => {
    if (activeIndex === null) return;
    const run = async () => {
      setSearching(true);
      let query = supabase
        .from("profiles")
        .select("id, nama, email")
        .order("nama")
        .limit(10);
      if (debouncedSearch) {
        query = query.or(`nama.ilike.%${debouncedSearch}%,email.ilike.%${debouncedSearch}%`);
      }
      const { data } = await query;
      setProfiles(data || []);
      setSearching(false);
    };
    run();
  }, [debouncedSearch, activeIndex]);

  const updateStep = (index: number, patch: Partial<ModeratorApprovalStep>) => {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === steps.length - 1) return;
    const target = direction === "up" ? index - 1 : index + 1;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const addStep = () => {
    onChange([
      ...steps,
      {
        userid: "",
        nama: "",
        email: "",
        approval_role: "menyetujui",
        status: "pending",
        processed_at: null,
        signature_url: null,
        notes: null,
      },
    ]);
    setActiveIndex(steps.length);
  };

  const getStatusBadgeClass = (status: string) => {
    if (status === "approved") return "bg-success/10 text-success border-success/30";
    if (status === "rejected") return "bg-destructive/10 text-destructive border-destructive/30";
    return "bg-muted text-muted-foreground border-border";
  };

  // Ganti seluruh jalur dengan langkah template. Approver yang sudah approve
  // dan masih ada di template baru tetap approved (TTD-nya dipertahankan);
  // sisanya pending. Hasilnya cuma state form — belum tersimpan.
  const applyTemplate = async () => {
    const template = templates.find((t) => String(t.id) === selectedTemplateId);
    if (!template) return;
    const templateSteps = [...template.steps].sort((a, b) => a.step_order - b.step_order);
    if (templateSteps.length === 0) {
      toast.error("Template ini belum punya langkah approval.");
      return;
    }

    setApplyingTemplate(true);
    let requester: { id: string; nama: string; email: string } | null = null;
    if (requesterId && templateSteps.some((s) => s.approver_type === "requester")) {
      const { data } = await supabase
        .from("profiles")
        .select("id, nama, email")
        .eq("id", requesterId)
        .maybeSingle();
      requester = data;
    }
    setApplyingTemplate(false);

    const usedPrev = new Set<number>();
    const next: ModeratorApprovalStep[] = templateSteps.map((s) => {
      const isRequester = s.approver_type === "requester";
      const profile = isRequester ? requester : s.profiles;
      const userid = profile?.id || "";
      const prevIndex = userid
        ? steps.findIndex(
            (p, i) => !usedPrev.has(i) && p.userid === userid && p.status === "approved",
          )
        : -1;
      const prev = prevIndex >= 0 ? steps[prevIndex] : null;
      if (prevIndex >= 0) usedPrev.add(prevIndex);
      return {
        userid,
        nama: profile?.nama || "",
        email: profile?.email || "",
        approval_role: s.level === "mengetahui" ? "mengetahui" : "menyetujui",
        status: prev ? "approved" : "pending",
        processed_at: prev?.processed_at ?? null,
        signature_url: prev?.signature_url ?? null,
        notes: null,
        snapshot: prev?.snapshot ?? null,
        ...(isRequester ? { role: "Requester" } : {}),
        step_id: s.id,
      };
    });

    const previous = steps;
    onChange(next);
    setActiveIndex(null);
    const kept = next.filter((s) => s.status === "approved").length;
    const missing = next.filter((s) => !s.userid).length;
    toast.success(
      `Template "${template.name || `#${template.id}`}" diterapkan (${next.length} tahap` +
        (kept ? `, ${kept} tetap approved` : "") +
        `). Cek lalu simpan.`,
      {
        description: missing
          ? `${missing} tahap belum punya approver — pilih manual.`
          : undefined,
        action: { label: "Batalkan", onClick: () => onChange(previous) },
      },
    );
  };

  return (
    <div className="space-y-2.5">
      {templateType && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
          <span className="text-[9px] font-bold uppercase text-muted-foreground">
            Isi dari Template
          </span>
          <div className="flex items-center gap-2">
            <Select
              value={selectedTemplateId || undefined}
              onValueChange={setSelectedTemplateId}
              disabled={loadingTemplates || templates.length === 0}
            >
              <SelectTrigger className="h-9 flex-1 min-w-0 bg-background text-[12px]">
                <SelectValue
                  placeholder={
                    loadingTemplates
                      ? "Memuat template..."
                      : templates.length === 0
                        ? "Belum ada template untuk dokumen ini"
                        : "Pilih template approval..."
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sortedTemplates.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)} className="text-[12px]">
                    {t.name || `Template #${t.id}`}
                    <span className="text-muted-foreground">
                      {" "}
                      · {t.cabang?.nama_cabang || "Global"} · {t.steps.length} tahap
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-[11px] font-bold shrink-0"
              onClick={applyTemplate}
              disabled={!selectedTemplateId || applyingTemplate}
            >
              {applyingTemplate ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LayoutTemplate className="h-3.5 w-3.5" />
              )}
              Terapkan
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Mengganti seluruh daftar di bawah sesuai template. Approver yang
            sudah approve dan masih ada di template tetap approved (TTD-nya
            ikut), sisanya pending. Setelah itu tiap tahap tetap bisa diubah —
            belum tersimpan sampai tombol simpan ditekan.
          </p>
        </div>
      )}

      {steps.map((step, index) => (
        <div
          key={index}
          className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5"
        >
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground"
                onClick={() => moveStep(index, "up")}
                disabled={index === 0}
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <span className="text-[10px] font-black text-muted-foreground">
                {index + 1}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground"
                onClick={() => moveStep(index, "down")}
                disabled={index === steps.length - 1}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>

            <Popover
              open={activeIndex === index}
              onOpenChange={(open) => {
                setActiveIndex(open ? index : null);
                setSearch("");
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-9 flex-1 min-w-0 justify-between bg-background text-[12px] font-bold"
                >
                  <span className="truncate">{step.nama || "Pilih approver..."}</span>
                  <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-40" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start">
                <div className="p-2 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      autoFocus
                      placeholder="Cari user (nama/email)..."
                      className="pl-8 h-9 text-sm"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto p-1">
                  {searching ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : profiles.length === 0 ? (
                    <p className="text-center text-[11px] text-muted-foreground py-4 italic">
                      User tidak ditemukan.
                    </p>
                  ) : (
                    profiles.map((p) => (
                      <button
                        key={p.id}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-muted/60 rounded-md"
                        onClick={() => {
                          updateStep(index, {
                            userid: p.id,
                            nama: p.nama,
                            email: p.email,
                          });
                          setActiveIndex(null);
                        }}
                      >
                        <p className="text-xs font-bold text-foreground">{p.nama}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{p.email}</p>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => removeStep(index)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pl-9">
            <Select
              value={step.approval_role}
              onValueChange={(val: any) => updateStep(index, { approval_role: val })}
            >
              <SelectTrigger className="h-8 w-36 text-[11px] font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="menyetujui">Menyetujui</SelectItem>
                <SelectItem value="mengetahui">Mengetahui</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={step.status}
              onValueChange={(val: any) => updateStep(index, { status: val })}
            >
              <SelectTrigger className={`h-8 w-32 text-[11px] font-bold ${getStatusBadgeClass(step.status)}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>

            {step.signature_url && (
              <Badge variant="outline" className="h-6 px-2 text-[9px] text-success border-success/30 bg-success/10 font-black uppercase">
                Ada TTD
              </Badge>
            )}
          </div>

          {step.status === "rejected" && (
            <div className="pl-9 space-y-1">
              <span className="text-[9px] font-bold uppercase text-muted-foreground">
                Catatan / Alasan Penolakan
              </span>
              <Textarea
                value={step.notes || ""}
                onChange={(e) => updateStep(index, { notes: e.target.value })}
                placeholder="Alasan penolakan tahap ini..."
                className="h-16 resize-none text-xs"
              />
            </div>
          )}
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50 font-semibold"
        onClick={addStep}
      >
        <Plus className="h-4 w-4" /> Tambah Tahap Approval
      </Button>
    </div>
  );
}
