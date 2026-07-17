"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft,
  Calendar as CalendarIcon,
  User,
  ClipboardCheck,
  Building2,
  CheckCircle2,
  Hash,
  Loader2,
  FileText,
  ShieldCheck,
  Search,
  Clock,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { MRItemSelector, MRItem } from "@/components/mr/mr-item-selector";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { createMaterialRequest } from "@/services/procurement-actions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import { canCreateMR } from "@/lib/mr-permissions";

export default function CreateMRPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // User & Data State
  const [userProfile, setUserProfile] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);

  // Form State
  const [mrKode, setMrKode] = useState("");
  const [mrTanggal, setMrTanggal] = useState(toYmdLocal());
  const [mrDueDate, setMrDueDate] = useState("");
  const [mrPriority, setMrPriority] = useState("P3");
  const [mrAccurate, setMrAccurate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [items, setItems] = useState<MRItem[]>([]);

  // Template Search State
  const [templateSearch, setTemplateSearch] = useState("");
  const [debouncedTemplateSearch] = useDebounce(templateSearch, 300);
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);

  // Signature Modal
  const [isSignatureOpen, setIsSignatureOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setInitialLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*, cabang(id, nama_cabang), roles:user_roles(roles(name))")
        .eq("id", user.id)
        .single();

      // Guard: role yang tidak diizinkan membuat MR dialihkan kembali ke list.
      if (
        profile &&
        !canCreateMR((profile.roles as any[])?.map((r: any) => r.roles?.name))
      ) {
        toast.error("Akses ditolak. Role Anda tidak diizinkan membuat MR.");
        router.push("/mr");
        return;
      }

      if (profile) {
        setUserProfile(profile);
        const { data: templateData } = await supabase
          .from("approval_templates")
          .select("*, steps:approval_template_steps(*, profiles(nama, email))")
          .eq("type", "Material Request")
          .or(`cabang_id.eq.${profile.cabang_id},cabang_id.is.null`)
          .order("name");

        setTemplates(templateData || []);
        if (templateData && templateData.length > 0) {
          setSelectedTemplateId(templateData[0].id.toString());
        }
      }
      setInitialLoading(false);
    };

    fetchData();
  }, [supabase, router]);

  const validateForm = () => {
    if (!mrKode.trim()) return "Nomor Dokumen harus diisi";
    if (!mrTanggal) return "Tanggal MR harus diisi";
    if (!mrDueDate) return "Due Date harus diisi";
    if (!selectedTemplateId) return "Pilih Alur Approval";
    if (items.length === 0) return "Daftar barang tidak boleh kosong";
    return null;
  };

  const handleSubmitClick = () => {
    const error = validateForm();
    if (error) {
      toast.error(error);
      return;
    }
    setIsSignatureOpen(true);
  };

  const handleConfirmSignature = async (signature: any) => {
    setLoading(true);
    try {
      const template = templates.find(
        (t) => t.id.toString() === selectedTemplateId,
      );
      if (!template) throw new Error("Template tidak valid");

      const sortedSteps = [...(template.steps || [])].sort(
        (a: any, b: any) => a.step_order - b.step_order,
      );

      const approvalData = sortedSteps.map((step: any) => {
        const isFirst = step.step_order === 1;
        return {
          step_id: step.id,
          step_order: step.step_order,
          level: step.level,
          status: isFirst ? "approved" : "pending",
          user_id: isFirst ? userProfile.id : step.user_id || null,
          nama: isFirst
            ? userProfile.nama
            : step.profiles?.nama || "Unknown Approver",
          email: isFirst ? userProfile.email : step.profiles?.email || "-",
          role: isFirst
            ? "Requester"
            : step.level === "menyetujui"
              ? "Approver"
              : "Reviewer",
          processed_at: isFirst ? new Date().toISOString() : null,
          signature_url: isFirst ? signature.image_url : null,
          snapshot: isFirst
            ? {
                nama: userProfile.nama,
                email: userProfile.email,
                lokasi: userProfile.cabang?.nama_cabang,
                role: "Requester",
              }
            : null,
        };
      });

      const result = await createMaterialRequest({
        mr_kode: mrKode.trim(),
        cabang_id: userProfile.cabang_id,
        mr_pic: userProfile.nama,
        mr_pic_id: userProfile.id,
        mr_tanggal: mrTanggal,
        mr_due_date: mrDueDate,
        mr_priority: mrPriority,
        accurate: mrAccurate,
        approvals: approvalData,
        items: items.map((item) => ({
          part_id: item.part_id,
          part_number: item.part_number,
          part_name: item.part_name,
          satuan: item.satuan,
          qty_request: item.qty,
          remarks: item.remarks?.trim() || undefined,
        })),
      });

      if (result.error) {
        throw new Error(result.error);
      }

      toast.success("Material Request berhasil dibuat");
      router.push("/mr");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (p: string) => {
    switch (p) {
      case "P1":
        return "text-destructive bg-destructive/10 border-destructive/30";
      case "P2":
        return "text-warning bg-warning/10 border-warning/30";
      case "P3":
        return "text-primary bg-primary/10 border-primary/30";
      case "P4":
        return "text-muted-foreground bg-muted border-border";
      default:
        return "";
    }
  };

  const filteredTemplates = templates
    .filter((t) =>
      t.name.toLowerCase().includes(debouncedTemplateSearch.toLowerCase()),
    )
    .slice(0, 10);

  const selectedTemplate = templates.find(
    (t) => t.id.toString() === selectedTemplateId,
  );

  if (initialLoading) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {/* Section 1: Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => router.back()}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                BUAT MATERIAL REQUEST
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Dokumentasi Internal
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1 w-full md:w-auto">
            <Label className="text-[10px] font-semibold uppercase text-muted-foreground">
              Nomor Dokumen
            </Label>
            <Input
              placeholder="Input Kode MR..."
              className="h-9 w-full rounded-md border-input bg-background px-3 text-xs font-semibold uppercase text-foreground md:w-60"
              value={mrKode}
              onChange={(e) => setMrKode(e.target.value)}
            />
          </div>
        </div>
      </Content>

      {/* Section 2: Form Fields + Item Selector */}
      <Content>
        <div className="grid grid-cols-1 gap-x-6 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
          {/* Column 1: Requester + Priority */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Pemohon (Requester)
              </Label>
              <div className="rounded-md border border-input bg-background p-3">
                <p className="text-sm font-semibold text-foreground leading-none">
                  {userProfile?.nama}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {userProfile?.email}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 text-warning" /> Tingkat
                Prioritas
              </Label>
              <Select value={mrPriority} onValueChange={setMrPriority}>
                <SelectTrigger
                  className={`h-9 w-full rounded-md border-input bg-background text-xs font-semibold ${getPriorityColor(mrPriority)}`}
                >
                  <SelectValue placeholder="Pilih Prioritas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="P1" className="text-destructive font-bold">
                    P1 - EMERGENCY
                  </SelectItem>
                  <SelectItem value="P2" className="text-warning font-bold">
                    P2 - HIGH
                  </SelectItem>
                  <SelectItem value="P3" className="text-primary font-bold">
                    P3 - NORMAL
                  </SelectItem>
                  <SelectItem
                    value="P4"
                    className="text-muted-foreground font-bold"
                  >
                    P4 - LOW
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Column 2: Location + Remarks */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Lokasi Site
              </Label>
              <div className="rounded-md border border-input bg-background p-3">
                <p className="text-sm font-semibold text-foreground leading-none uppercase">
                  {userProfile?.cabang?.nama_cabang}
                </p>
                <p className="text-[10px] font-semibold text-primary mt-1 uppercase tracking-tighter">
                  Authorized Location
                </p>
              </div>
            </div>
            {/* ACCURATE_HIDDEN: hidden per request, default always false */}
            {false && (
              <div className="flex items-center gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-md">
                <Checkbox
                  id="mr-accurate"
                  checked={mrAccurate}
                  onCheckedChange={(v) => setMrAccurate(Boolean(v))}
                  className="border-amber-400 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                />
                <label
                  htmlFor="mr-accurate"
                  className="cursor-pointer select-none"
                >
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-tight leading-none">
                    Sudah Input ke Accurate
                  </p>
                  <p className="text-[9px] text-amber-500 font-medium mt-0.5">
                    Centang jika dokumen ini sudah terdata di sistem Accurate
                  </p>
                </label>
              </div>
            )}
          </div>

          {/* Column 3: Dates */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold text-muted-foreground uppercase">
                Input & Deadline
              </Label>
              <div className="space-y-3 rounded-md border border-input bg-background p-3">
                <div className="space-y-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">
                      Tgl Input
                    </span>
                  </div>
                  <DatePickerString
                    className="h-9 w-full rounded-md border-input bg-background px-2 text-xs font-semibold text-foreground"
                    value={mrTanggal}
                    onChange={setMrTanggal}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Clock className="h-3 w-3 text-destructive/60" />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">
                      Deadline
                    </span>
                  </div>
                  <DatePickerString
                    className="h-9 w-full rounded-md border-input bg-background px-2 text-xs font-semibold text-destructive"
                    value={mrDueDate}
                    onChange={setMrDueDate}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="min-h-50">
          <MRItemSelector
            items={items}
            onItemsChange={setItems}
            cabangId={userProfile?.cabang_id ?? null}
            onCancelMR={() => router.push("/mr")}
          />
        </div>
      </Content>

      {/* Section 3: Approval + Submit */}
      <Content>
        <div className="flex flex-col lg:flex-row justify-between gap-8">
          <div className="flex-1 space-y-4 max-w-full lg:max-w-125">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Alur Approval
              </Label>
              <Popover
                open={templatePopoverOpen}
                onOpenChange={setTemplatePopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="h-9 w-full justify-between rounded-md border-input bg-background px-3 text-xs font-semibold text-foreground transition-all hover:bg-muted"
                  >
                    {selectedTemplate
                      ? selectedTemplate.name
                      : "Cari Template Approval..."}
                    <Search className="ml-2 h-3.5 w-3.5 opacity-40 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[calc(100vw-2rem)] max-w-100 p-0 rounded-lg border border-border shadow-xl overflow-hidden"
                  align="start"
                >
                  <div className="p-2 border-b border-border bg-muted/50">
                    <Input
                      placeholder="Filter template..."
                      className="h-8 bg-background border-input rounded-md text-xs text-foreground"
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-62.5 overflow-y-auto p-1 text-sm">
                    {filteredTemplates.length > 0 ? (
                      filteredTemplates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            setSelectedTemplateId(t.id.toString());
                            setTemplatePopoverOpen(false);
                            setTemplateSearch("");
                          }}
                          className={`w-full text-left p-2.5 rounded-md transition-all flex items-center justify-between group ${
                            selectedTemplateId === t.id.toString()
                              ? "bg-foreground text-background"
                              : "hover:bg-muted text-foreground"
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="font-semibold text-xs">
                              {t.name}
                            </span>
                            <span className="text-[9px] uppercase font-medium mt-0.5 opacity-60">
                              {t.steps?.length || 0} Langkah Persetujuan
                            </span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="p-6 text-center text-muted-foreground text-xs italic">
                        Data tidak ditemukan
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {selectedTemplate && (
              <div className="bg-background border border-border rounded-lg p-3 space-y-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase">
                  Urutan Persetujuan:
                </p>
                <div className="space-y-3">
                  {selectedTemplate.steps
                    ?.sort((a: any, b: any) => a.step_order - b.step_order)
                    .map((step: any, idx: number) => (
                      <div
                        key={step.id}
                        className="flex gap-3 items-start relative"
                      >
                        {idx < selectedTemplate.steps.length - 1 && (
                          <div className="absolute left-3.25 top-6 h-full w-0.5 bg-border" />
                        )}
                        <div className="h-7 w-7 bg-muted/40 border border-border rounded flex items-center justify-center shrink-0 z-10">
                          <span className="text-[10px] font-semibold text-muted-foreground">
                            {step.step_order}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-semibold text-foreground">
                            {step.approver_type === "requester"
                              ? userProfile?.nama
                              : step.profiles?.nama || "User Unknown"}
                          </span>
                          <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-tighter">
                            {step.level === "mengetahui"
                              ? "INFO ONLY"
                              : "PRIMARY APPROVER"}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>

          <div className="w-full flex flex-col gap-3 lg:w-70">
            <div className="bg-foreground p-5 rounded-lg flex flex-col items-center gap-4 shadow-sm border border-border">
              <ShieldCheck className="h-6 w-6 text-success" />
              <div className="text-center">
                <p className="text-xs font-semibold text-background uppercase">
                  Validasi Dokumen
                </p>
                <p className="text-[10px] text-background/50 mt-1 font-medium">
                  Siap untuk dikirim?
                </p>
              </div>
              <Button
                className="w-full h-10 rounded-md bg-background hover:bg-muted text-foreground font-bold text-sm transition-all"
                onClick={handleSubmitClick}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "SIGN & SUBMIT"
                )}
              </Button>
            </div>
            <p className="text-center text-[9px] text-muted-foreground font-medium italic">
              Pastikan data benar sebelum tanda tangan.
            </p>
          </div>
        </div>
      </Content>

      <MRSignatureDialog
        open={isSignatureOpen}
        onOpenChange={setIsSignatureOpen}
        onConfirm={handleConfirmSignature}
      />
    </>
  );
}
