// components/approval/template-editor.tsx

"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  User as UserIcon,
  UserPlus,
  HelpCircle,
  Settings2,
  Search,
  Building2,
  ShieldCheck,
  Check,
  ChevronsUpDown,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebounce } from "use-debounce";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createClient } from "@/lib/supabase/client";
import {
  ApprovalTemplate,
  ApprovalTemplateStep,
  ApprovalType,
  ApprovalLevel,
} from "@/type";
import { toast } from "sonner";

type StepProfile = {
  nama?: string;
  email?: string;
};

type EditorStep = Partial<ApprovalTemplateStep> & {
  local_id: string;
  profiles?: StepProfile | null;
};

interface TemplateEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ApprovalTemplate | null;
  cabang: any[];
  userProfile: any;
  onSuccess: () => void;
}

export function TemplateEditor({
  open,
  onOpenChange,
  template,
  cabang,
  userProfile,
  onSuccess,
}: TemplateEditorProps) {
  const createStepId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ApprovalType>("Material Request");
  const [cabangId, setCabangId] = useState<string>("");
  const [steps, setSteps] = useState<EditorStep[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [stepSearchValues, setStepSearchValues] = useState<
    Record<string, string>
  >({});
  const activeSearchValue = activeStepId
    ? (stepSearchValues[activeStepId] ?? "")
    : "";
  const [debouncedSearch] = useDebounce(activeSearchValue, 500);

  useEffect(() => {
    if (open) {
      if (template) {
        setName(template.name || "");
        setType(template.type);
        setCabangId(template.cabang_id ? template.cabang_id.toString() : "all");
        setStepSearchValues({});
        setActiveStepId(null);
        fetchSteps(template.id);
      } else {
        setName("");
        setType("Material Request");
        setCabangId(
          userProfile?.isAdmin && !userProfile?.isModerator
            ? userProfile.cabang_id.toString()
            : "all",
        );
        setSteps([]);
        setStepSearchValues({});
        setActiveStepId(null);
      }
    }
  }, [open, template, userProfile]);

  useEffect(() => {
    if (open && activeStepId) {
      fetchProfiles(debouncedSearch);
    }
  }, [debouncedSearch, open, activeStepId]);

  useEffect(() => {
    if (open) {
      fetchProfiles("");
    }
  }, [open]);

  const fetchSteps = async (templateId: number) => {
    const { data } = await supabase
      .from("approval_template_steps")
      .select("*, profiles(nama, email)")
      .eq("template_id", templateId)
      .order("step_order");
    const mappedSteps: EditorStep[] = (data || []).map((step: any) => ({
      ...step,
      local_id: createStepId(),
    }));
    setSteps(mappedSteps);
  };

  const fetchProfiles = async (search: string) => {
    setSearching(true);
    let query = supabase
      .from("profiles")
      .select(
        `
        id, 
        nama, 
        email,
        cabang:cabang_id(nama_cabang),
        roles:user_roles(roles(label))
      `,
      )
      .order("nama")
      .limit(10);

    if (search) {
      query = query.or(`nama.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data } = await query;
    setProfiles(data || []);
    setSearching(false);
  };

  const addStep = (type: "user" | "requester") => {
    const nextOrder = steps.length + 1;
    const newStep: EditorStep = {
      local_id: createStepId(),
      step_order: nextOrder,
      approver_type: type,
      level: "menyetujui" as ApprovalLevel,
      user_id: null,
    };
    setSteps((prev) => [...prev, newStep]);
  };

  const removeStep = (stepId: string) => {
    setSteps((prev) => {
      const newSteps = prev.filter((step) => step.local_id !== stepId);
      return newSteps.map((step, i) => ({
        ...step,
        step_order: i + 1,
      }));
    });
    setStepSearchValues((prev) => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    setActiveStepId((prev) => (prev === stepId ? null : prev));
  };

  const updateStep = (
    stepId: string,
    updates: Partial<ApprovalTemplateStep> & { profiles?: StepProfile | null },
  ) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.local_id === stepId ? { ...step, ...updates } : step,
      ),
    );
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === steps.length - 1) return;

    setSteps((prev) => {
      const newSteps = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      [newSteps[index], newSteps[targetIndex]] = [
        newSteps[targetIndex],
        newSteps[index],
      ];

      return newSteps.map((step, i) => ({
        ...step,
        step_order: i + 1,
      }));
    });
  };

  const handleStepSearchChange = (stepId: string, value: string) => {
    setStepSearchValues((prev) => ({
      ...prev,
      [stepId]: value,
    }));
  };

  const handleStepPopoverOpenChange = (stepId: string, isOpen: boolean) => {
    if (!isOpen) {
      setActiveStepId((prev) => (prev === stepId ? null : prev));
      return;
    }

    setActiveStepId(stepId);
    if (!(stepId in stepSearchValues)) {
      setStepSearchValues((prev) => ({
        ...prev,
        [stepId]: "",
      }));
    }
    fetchProfiles(stepSearchValues[stepId] ?? "");
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Masukkan nama template terlebih dahulu");
      return;
    }

    if (!cabangId && cabangId !== "all") {
      toast.error("Pilih lokasi terlebih dahulu");
      return;
    }

    if (steps.length === 0) {
      toast.error("Tambahkan minimal satu tahap approval");
      return;
    }

    const invalidStep = steps.find(
      (s) => s.approver_type === "user" && !s.user_id,
    );
    if (invalidStep) {
      toast.error("Ada tahap approval yang belum memilih user");
      return;
    }

    setLoading(true);
    try {
      let templateId = template?.id;
      const finalCabangId = cabangId === "all" ? null : parseInt(cabangId);

      // Keep uniqueness check for site-specific templates only.
      // Global templates are allowed to have more than one entry per type.
      if (finalCabangId !== null) {
        let duplicateQuery = supabase
          .from("approval_templates")
          .select("id")
          .eq("type", type)
          .eq("cabang_id", finalCabangId)
          .limit(1);

        if (templateId) {
          duplicateQuery = duplicateQuery.neq("id", templateId);
        }

        const { data: duplicateTemplate, error: duplicateError } =
          await duplicateQuery.maybeSingle();

        if (duplicateError) throw duplicateError;

        if (duplicateTemplate) {
          toast.error(
            `Template untuk jenis \"${type}\" di lokasi ini sudah ada. Silakan edit template yang sudah ada.`,
          );
          return;
        }
      }

      if (!templateId) {
        const { data: newTemplate, error: tError } = await supabase
          .from("approval_templates")
          .insert({ name, type, cabang_id: finalCabangId })
          .select()
          .single();

        if (tError) throw tError;
        templateId = newTemplate.id;
      } else {
        await supabase
          .from("approval_templates")
          .update({ name, type, cabang_id: finalCabangId })
          .eq("id", templateId);
      }

      await supabase
        .from("approval_template_steps")
        .delete()
        .eq("template_id", templateId);

      const stepsToInsert = steps.map((s, i) => ({
        template_id: templateId,
        step_order: i + 1,
        approver_type: s.approver_type,
        user_id: s.user_id,
        level: s.level,
      }));

      const { error: sError } = await supabase
        .from("approval_template_steps")
        .insert(stepsToInsert);

      if (sError) throw sError;

      toast.success(
        template ? "Template berhasil diperbarui" : "Template berhasil dibuat",
      );
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error(error);
      if (error?.code === "23505") {
        toast.error(
          "Template untuk kombinasi jenis dokumen dan lokasi tersebut sudah ada (khusus lokasi non-global).",
        );
      } else {
        toast.error(error.message || "Gagal menyimpan template");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[90vh] max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0 shrink-0">
          <DialogTitle>
            {template
              ? "Edit Approval Template"
              : "Tambah Approval Template Baru"}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-4 flex-1 overflow-hidden flex flex-col">
          <div className="space-y-2 shrink-0">
            <Label className="text-xs text-slate-500 font-bold uppercase tracking-wider">
              Nama Template
            </Label>
            <Input
              placeholder="Contoh: Approval MR - Urgent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 text-[13px] font-semibold"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 shrink-0">
            <div className="space-y-2">
              <Label className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                Lokasi
              </Label>
              <Select
                value={cabangId}
                onValueChange={setCabangId}
                disabled={userProfile?.isAdmin && !userProfile?.isModerator}
              >
                <SelectTrigger className="h-10 text-[13px]">
                  <SelectValue placeholder="Pilih Lokasi" />
                </SelectTrigger>
                <SelectContent>
                  {userProfile?.isModerator && (
                    <SelectItem value="all" className="font-bold text-blue-600">
                      Semua Lokasi (Global)
                    </SelectItem>
                  )}
                  {cabang.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.nama_cabang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                Jenis Dokumen
              </Label>
              <Select value={type} onValueChange={(val: any) => setType(val)}>
                <SelectTrigger className="h-10 text-[13px]">
                  <SelectValue placeholder="Pilih Jenis" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Material Request">
                    Material Request
                  </SelectItem>
                  <SelectItem value="Purchase Request">
                    Purchase Request
                  </SelectItem>
                  <SelectItem value="Purchase Order">Purchase Order</SelectItem>
                  <SelectItem value="Receive Item">Receive Item</SelectItem>
                  <SelectItem value="Item Transfer">Item Transfer</SelectItem>
                  <SelectItem value="Stock Out - SPB">
                    Stock Out - SPB
                  </SelectItem>
                  <SelectItem value="Stock Out - SPB PO">
                    Stock Out - SPB PO
                  </SelectItem>
                  <SelectItem value="Stock Out - SPB DO">
                    Stock Out - SPB DO
                  </SelectItem>
                  <SelectItem value="Stock Out - SPB Invoice">
                    Stock Out - SPB Invoice
                  </SelectItem>
                  <SelectItem value="Return SPB">Return SPB</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator className="shrink-0" />

          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
            <div className="flex items-center justify-between shrink-0 px-1">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
                <Settings2 className="h-4 w-4 text-blue-500" /> Tahap Approval
              </h3>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs font-bold"
                  onClick={() => addStep("requester")}
                >
                  <UserPlus className="h-3.5 w-3.5" /> Tambah Requester
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs font-bold"
                  onClick={() => addStep("user")}
                >
                  <Plus className="h-3.5 w-3.5" /> Tambah User
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 border rounded-xl bg-slate-100/30 flex flex-col overflow-hidden shadow-inner">
              <div className="flex items-center gap-3 pl-[58px] pr-12 pt-3 pb-2 shrink-0 border-b bg-white/50 backdrop-blur-sm">
                <div className="flex-1 text-[10px] uppercase font-extrabold text-slate-400 tracking-widest px-1">
                  Penyetuju
                </div>
                <div className="w-[120px] text-[10px] uppercase font-extrabold text-slate-400 pl-2 tracking-widest">
                  Level
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {steps.length === 0 ? (
                  <div className="text-center py-16 border-2 border-dashed rounded-lg text-muted-foreground text-sm bg-white mx-1 my-1">
                    Belum ada tahap approval. <br /> Klik "Tambah" di atas untuk
                    memulai.
                  </div>
                ) : (
                  steps.map((step, index) => (
                    <div
                      key={step.local_id}
                      className="flex gap-3 items-center bg-white p-2 rounded-lg border border-slate-200 group shadow-sm transition-all hover:border-blue-200"
                    >
                      <div className="flex flex-col items-center min-w-[32px] shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 hover:bg-slate-100 text-slate-400 transition-colors"
                          onClick={() => moveStep(index, "up")}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                        <span className="text-[11px] font-black text-slate-500 my-0.5">
                          {index + 1}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 hover:bg-slate-100 text-slate-400 transition-colors"
                          onClick={() => moveStep(index, "down")}
                          disabled={index === steps.length - 1}
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </div>

                      <div className="flex-1 min-w-0 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          {step.approver_type === "requester" ? (
                            <div className="h-9 px-3 w-full flex items-center bg-blue-50/50 border border-blue-200 rounded-md text-[12px] font-bold text-blue-700 whitespace-nowrap">
                              <Bot className="h-4 w-4 mr-2 shrink-0 text-blue-500" />{" "}
                              Requester
                            </div>
                          ) : (
                            <Popover
                              open={activeStepId === step.local_id}
                              onOpenChange={(isOpen) =>
                                handleStepPopoverOpenChange(
                                  step.local_id,
                                  isOpen,
                                )
                              }
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className="w-full h-9 justify-between bg-white text-[12px] border-slate-200 px-3 hover:bg-slate-50 transition-colors rounded-md font-bold text-slate-700"
                                >
                                  <span className="truncate flex-1 text-left">
                                    {step.user_id
                                      ? step.profiles?.nama ||
                                        profiles.find(
                                          (p) => p.id === step.user_id,
                                        )?.nama ||
                                        "User terpilih"
                                      : "Pilih User..."}
                                  </span>
                                  <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-40" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-[calc(100vw-2rem)] max-w-[320px] p-0 shadow-xl border-slate-200 rounded-lg overflow-hidden"
                                align="start"
                                onOpenAutoFocus={(e) => e.preventDefault()}
                              >
                                <div className="flex items-center border-b px-3 bg-slate-50">
                                  <Search className="mr-2 h-4 w-4 shrink-0 opacity-40" />
                                  <input
                                    className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                                    placeholder="Cari user (nama/email)..."
                                    value={
                                      stepSearchValues[step.local_id] ?? ""
                                    }
                                    onChange={(e) =>
                                      handleStepSearchChange(
                                        step.local_id,
                                        e.currentTarget.value,
                                      )
                                    }
                                    autoFocus
                                  />
                                  {searching && (
                                    <Loader2 className="h-4 w-4 animate-spin opacity-40 ml-2" />
                                  )}
                                </div>

                                <div className="max-h-[250px] overflow-y-auto p-1 space-y-0.5 custom-scrollbar bg-white">
                                  {profiles.length === 0 && !searching && (
                                    <div className="py-12 text-center text-[12px] text-slate-500 font-medium">
                                      User tidak ditemukan.
                                    </div>
                                  )}

                                  {profiles.map((p) => (
                                    <div
                                      key={p.id}
                                      onClick={() => {
                                        updateStep(step.local_id, {
                                          user_id: p.id,
                                          profiles: {
                                            nama: p.nama,
                                            email: p.email,
                                          },
                                        });
                                        setActiveStepId(null);
                                      }}
                                      className={cn(
                                        "flex flex-col items-start gap-1 px-3 py-2 cursor-pointer transition-all rounded-md border border-transparent mb-0.5 last:mb-0",
                                        step.user_id === p.id
                                          ? "bg-blue-50 border-blue-100"
                                          : "hover:bg-slate-50 hover:border-slate-100",
                                      )}
                                    >
                                      <div className="flex items-center justify-between w-full gap-2">
                                        <span className="font-bold text-[13px] text-slate-800 tracking-tight truncate">
                                          {p.nama}
                                        </span>
                                        <div className="flex gap-1 shrink-0">
                                          {(p.roles as any[])?.map(
                                            (r: any, i: number) => (
                                              <Badge
                                                key={i}
                                                variant="secondary"
                                                className="text-[8px] px-1.5 py-0 h-3.5 bg-blue-100/50 text-blue-600 border-0 font-bold uppercase tracking-tighter"
                                              >
                                                {r.roles.label}
                                              </Badge>
                                            ),
                                          )}
                                        </div>
                                        {step.user_id === p.id && (
                                          <Check className="h-3.5 w-3.5 text-blue-600 shrink-0 stroke-[3px]" />
                                        )}
                                      </div>

                                      <div className="flex items-center gap-2 text-[10px] text-slate-400 w-full overflow-hidden font-medium">
                                        <span className="truncate max-w-[150px]">
                                          {p.email}
                                        </span>
                                        <span className="opacity-30">•</span>
                                        {p.cabang && (
                                          <div className="flex items-center truncate">
                                            <Building2 className="w-2.5 h-2.5 mr-1 opacity-50 text-slate-400" />
                                            <span className="truncate">
                                              {p.cabang.nama_cabang}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>

                        <div className="w-28 shrink-0 sm:w-[120px]">
                          <Select
                            value={step.level}
                            onValueChange={(val: any) =>
                              updateStep(step.local_id, { level: val })
                            }
                          >
                            <SelectTrigger className="bg-white h-9 text-[12px] border-slate-200 font-bold text-slate-700 rounded-md shadow-none hover:bg-slate-50 transition-colors">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="text-[12px]">
                              <SelectItem value="menyetujui">
                                Menyetujui
                              </SelectItem>
                              <SelectItem value="mengetahui">
                                Mengetahui
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="shrink-0 pl-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-200 hover:text-red-500 hover:bg-red-50 transition-all"
                            onClick={() => removeStep(step.local_id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="p-6 pt-3 shrink-0 border-t bg-slate-50/50">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="font-bold text-slate-500 hover:text-slate-800 transition-colors"
          >
            Batal
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 px-8 font-bold shadow-md shadow-blue-100 hover:shadow-lg transition-all"
          >
            {loading
              ? "Menyimpan..."
              : template
                ? "Update Template"
                : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Bot(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}
