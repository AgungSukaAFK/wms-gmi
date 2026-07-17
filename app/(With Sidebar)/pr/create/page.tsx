"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft,
  Calendar as CalendarIcon,
  User,
  Building2,
  CheckCircle2,
  Loader2,
  FileText,
  Search,
  ArrowRight,
  Truck,
  Info,
  Package,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useDebounce } from "use-debounce";
import { createPurchaseRequest } from "@/services/procurement-actions";
import { cn, toYmdLocal } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";

interface DraftPrItem {
  mr_item_id: number;
  mr_id: number;
  mr_kode: string;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty_sharestock_total: number;
  remaining: number;
  selected: boolean;
  qty: number;
}

export default function CreatePRPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // User & Data State
  const [userProfile, setUserProfile] = useState<any>(null);
  const [mrs, setMrs] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);

  // Form State
  const [prKode, setPrKode] = useState("");
  const [prTanggal, setPrTanggal] = useState(toYmdLocal());
  const [selectedMrs, setSelectedMrs] = useState<any[]>([]);
  const [draftItems, setDraftItems] = useState<DraftPrItem[]>([]);
  const [sharestockAllocations, setSharestockAllocations] = useState<any[]>([]);

  // MR Search State
  const [mrSearch, setMrSearch] = useState("");
  const [debouncedMrSearch] = useDebounce(mrSearch, 300);
  const [mrPopoverOpen, setMrPopoverOpen] = useState(false);
  const [prAccurate, setPrAccurate] = useState(false);

  // Template State
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);

  // Signature dialog
  const [isSignatureOpen, setIsSignatureOpen] = useState(false);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
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
      .select(
        `
        *, 
        cabang(id, nama_cabang),
        user_roles(roles(label))
      `,
      )
      .eq("id", user.id)
      .single();

    if (profile) {
      setUserProfile(profile);
      fetchApprovedMRs(profile.cabang_id);

      const { data: templateData } = await supabase
        .from("approval_templates")
        .select(
          "*, steps:approval_template_steps(*, profiles(id, nama, email))",
        )
        .eq("type", "Purchase Request")
        .or(`cabang_id.eq.${profile.cabang_id},cabang_id.is.null`)
        .order("name");
      setTemplates(templateData || []);
      if (templateData && templateData.length > 0) {
        setSelectedTemplateId(templateData[0].id.toString());
      }
    }
    setInitialLoading(false);
  };

  const fetchApprovedMRs = async (cabangId: number) => {
    const { data } = await supabase
      .from("mrs")
      .select("id, mr_kode, mr_tanggal, mr_pic")
      .eq("mr_status", "approved")
      .order("created_at", { ascending: false })
      .limit(15);

    setMrs(data || []);
  };

  // Hitung qty yang sudah terpakai di PR lain (belum rejected) per mr_item.
  const fetchConvertedMap = async (mrItemIds: number[]) => {
    if (mrItemIds.length === 0) return {} as Record<number, number>;
    const { data } = await supabase
      .from("pr_items")
      .select("mr_item_id, qty, prs!inner(pr_status)")
      .in("mr_item_id", mrItemIds);
    const map: Record<number, number> = {};
    (data || []).forEach((row: any) => {
      const prStatus = Array.isArray(row.prs)
        ? row.prs[0]?.pr_status
        : row.prs?.pr_status;
      if (prStatus === "rejected") return;
      map[row.mr_item_id] = (map[row.mr_item_id] || 0) + row.qty;
    });
    return map;
  };

  const handleToggleMR = async (mr: any) => {
    const isSelected = selectedMrs.some((m) => m.id === mr.id);
    if (isSelected) {
      setSelectedMrs((prev) => prev.filter((m) => m.id !== mr.id));
      setDraftItems((prev) => prev.filter((i) => i.mr_id !== mr.id));
      return;
    }

    setSelectedMrs((prev) => [...prev, mr]);

    // Fetch items that have qty_pr > 0 OR qty_sharestock_total > 0
    const { data: items } = await supabase
      .from("mr_items")
      .select("*")
      .eq("mr_id", mr.id)
      .or("qty_pr.gt.0,qty_sharestock_total.gt.0");

    const relevantItems = (items || []).filter((i: any) => i.qty_pr > 0);
    const convertedMap = await fetchConvertedMap(
      relevantItems.map((i: any) => i.id),
    );

    const newDrafts: DraftPrItem[] = relevantItems.map((item: any) => {
      const remaining = Math.max(
        0,
        item.qty_pr - (convertedMap[item.id] || 0),
      );
      return {
        mr_item_id: item.id,
        mr_id: mr.id,
        mr_kode: mr.mr_kode,
        part_id: item.part_id,
        part_number: item.part_number,
        part_name: item.part_name,
        satuan: item.satuan,
        qty_sharestock_total: item.qty_sharestock_total || 0,
        remaining,
        selected: remaining > 0,
        qty: remaining,
      };
    });
    setDraftItems((prev) => [...prev, ...newDrafts]);

    // Fetch sharestock allocations breakdown (for display context only)
    if (items && items.length > 0) {
      const itemIds = items.map((i: any) => i.id);
      const { data: allocs } = await supabase
        .from("mr_sharestock_allocations")
        .select("*, cabang(nama_cabang)")
        .in("mr_item_id", itemIds);
      setSharestockAllocations((prev) => [...prev, ...(allocs || [])]);
    }
  };

  const toggleDraftItem = (mrItemId: number, checked: boolean) => {
    setDraftItems((prev) =>
      prev.map((i) =>
        i.mr_item_id === mrItemId ? { ...i, selected: checked } : i,
      ),
    );
  };

  const updateDraftItemQty = (mrItemId: number, qty: number) => {
    setDraftItems((prev) =>
      prev.map((i) =>
        i.mr_item_id === mrItemId
          ? { ...i, qty: Math.max(0, Math.min(qty, i.remaining)) }
          : i,
      ),
    );
  };

  const handleSave = () => {
    const chosen = draftItems.filter((i) => i.selected && i.qty > 0);
    if (!prKode) return toast.error("Kode PR harus diisi");
    if (selectedMrs.length === 0) return toast.error("Pilih Material Request");
    if (!selectedTemplateId) return toast.error("Pilih Alur Approval");
    if (chosen.length === 0)
      return toast.error("Tidak ada item terpilih untuk diproses ke PR");
    if (!templates.find((t) => t.id.toString() === selectedTemplateId))
      return toast.error("Template approval tidak valid");
    setIsSignatureOpen(true);
  };

  const handleConfirmSignature = async (signature: {
    id: string;
    image_url: string;
    label: string;
  }) => {
    const itemsForPr = draftItems.filter((i) => i.selected && i.qty > 0);
    const template = templates.find(
      (t) => t.id.toString() === selectedTemplateId,
    )!;

    const sortedSteps = [...(template.steps || [])].sort(
      (a: any, b: any) => a.step_order - b.step_order,
    );
    const approvalData = sortedSteps.map((step: any, idx: number) => {
      const isFirst = idx === 0;
      const isRequester = step.approver_type === "requester";
      const profile = isRequester ? userProfile : step.profiles;
      return {
        type: isRequester ? "Requester" : profile?.nama || "Approver",
        status: isFirst ? "approved" : "pending",
        userid: profile?.id || "",
        nama: profile?.nama || "Unknown",
        email: profile?.email || "",
        level: step.step_order,
        processed_at: isFirst ? new Date().toISOString() : null,
        signature_url: isFirst ? signature.image_url : null,
        notes: null,
        snapshot: isFirst
          ? {
              nama: userProfile.nama,
              email: userProfile.email,
              lokasi: userProfile.cabang?.nama_cabang,
            }
          : null,
      };
    });

    setLoading(true);
    try {
      const result = await createPurchaseRequest({
        pr_kode: prKode,
        cabang_id: userProfile.cabang_id,
        pr_pic_id: userProfile.id,
        pr_tanggal: prTanggal,
        accurate: prAccurate,
        approvals: approvalData,
        items: itemsForPr.map((item) => ({
          part_id: item.part_id,
          part_number: item.part_number,
          part_name: item.part_name,
          satuan: item.satuan,
          qty: item.qty,
          mr_id: item.mr_id,
          mr_item_id: item.mr_item_id,
        })),
      });

      if (result.success) {
        toast.success("Purchase Request berhasil dibuat");
        router.push("/pr");
      } else {
        toast.error(result.error || "Gagal membuat PR");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const userRoles =
    userProfile?.user_roles?.map((ur: any) => ur.roles?.label).join(", ") ||
    "Staff Procurement";

  const filteredTemplates = templates
    .filter((t) => t.name.toLowerCase().includes(templateSearch.toLowerCase()))
    .slice(0, 10);
  const selectedTemplate = templates.find(
    (t) => t.id.toString() === selectedTemplateId,
  );

  return (
    <>
      {/* Section 1: Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
              className="h-9 w-9 shrink-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                BUAT PURCHASE REQUEST
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                External Procurement Process
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1 w-full md:w-auto">
            <Label className="text-[10px] font-semibold uppercase text-muted-foreground px-1">
              Nomor PR (Manual)
            </Label>
            <Input
              placeholder="PR/XXXX/2026..."
              className="h-10 w-full bg-muted/40 border-input rounded-md font-bold text-sm uppercase text-primary md:w-70"
              value={prKode}
              onChange={(e) => setPrKode(e.target.value)}
            />
          </div>
        </div>
      </Content>

      {/* Section 2: Form Fields */}
      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Column 1: PIC & Lokasi */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                <User className="h-3 w-3" /> Penanggung Jawab
              </Label>
              <div className="p-3.5 bg-muted/40 border border-border rounded-lg">
                <p className="text-sm font-bold text-foreground leading-none uppercase">
                  {userProfile?.nama}
                </p>
                <p className="text-[10px] text-muted-foreground mt-2 uppercase font-medium">
                  {userRoles}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                <Building2 className="h-3 w-3" /> Lokasi Point
              </Label>
              <div className="p-3.5 bg-muted/40 border border-border rounded-lg">
                <p className="text-sm font-bold text-foreground leading-none uppercase">
                  {userProfile?.cabang?.nama_cabang}
                </p>
                <p className="text-[10px] font-semibold text-primary mt-2 uppercase">
                  Authorized Site
                </p>
              </div>
            </div>
          </div>

          {/* Column 2: Date & MR Reference */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                <CalendarIcon className="h-3 w-3" /> Tanggal Pengajuan
              </Label>
              <Input
                type="date"
                className="h-10 font-bold text-sm border-input bg-muted/40 focus:bg-background rounded-lg"
                value={prTanggal}
                onChange={(e) => setPrTanggal(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                <FileText className="h-3 w-3" /> Referensi MR (bisa lebih dari 1)
              </Label>
              <Popover open={mrPopoverOpen} onOpenChange={setMrPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full h-10 justify-between bg-muted/40 border-input rounded-lg px-3 font-bold text-xs uppercase shadow-sm hover:bg-background transition-all",
                      selectedMrs.length > 0
                        ? "text-primary border-primary/30 bg-primary/5"
                        : "text-muted-foreground",
                    )}
                  >
                    {selectedMrs.length > 0
                      ? `${selectedMrs.length} MR Dipilih`
                      : "Pilih MR Referensi..."}
                    <Search className="ml-2 h-3.5 w-3.5 opacity-40 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[calc(100vw-2rem)] max-w-112.5 p-0 rounded-xl border border-border shadow-xl overflow-hidden"
                  align="start"
                >
                  <div className="p-2 border-b border-border bg-muted/40">
                    <Input
                      placeholder="Cari Kode MR..."
                      className="h-9 bg-background border-input rounded-md text-xs font-medium"
                      value={mrSearch}
                      onChange={(e) => setMrSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-62.5 overflow-y-auto p-1.5 text-sm bg-background">
                    {mrs.length > 0 ? (
                      mrs
                        .filter((m) =>
                          m.mr_kode
                            .toLowerCase()
                            .includes(mrSearch.toLowerCase()),
                        )
                        .map((m) => {
                          const isChecked = selectedMrs.some(
                            (sel) => sel.id === m.id,
                          );
                          return (
                            <button
                              key={m.id}
                              onClick={() => handleToggleMR(m)}
                              className={`w-full text-left p-3 rounded-lg transition-all flex items-center justify-between group mb-1 ${
                                isChecked
                                  ? "bg-foreground text-background"
                                  : "hover:bg-muted text-foreground"
                              }`}
                            >
                              <div className="flex flex-col">
                                <span className="font-bold text-xs uppercase tracking-tight">
                                  {m.mr_kode}
                                </span>
                                <span className="text-[9px] uppercase font-medium mt-1 opacity-60">
                                  Pemohon: {m.mr_pic}
                                </span>
                              </div>
                              {isChecked ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-all" />
                              )}
                            </button>
                          );
                        })
                    ) : (
                      <div className="p-12 text-center text-muted-foreground text-xs italic font-medium">
                        MR Approved Tidak Ditemukan
                      </div>
                    )}
                  </div>
                  <div className="p-2 border-t border-border bg-muted/40">
                    <Button
                      size="sm"
                      className="w-full h-8 text-xs font-bold"
                      onClick={() => setMrPopoverOpen(false)}
                    >
                      Selesai ({selectedMrs.length} dipilih)
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Column 3: Approval Template + Submit */}
          <div className="space-y-4">
            {/* Template Picker */}
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                <ShieldCheck className="h-3 w-3" /> Alur Approval
              </Label>
              <Popover
                open={templatePopoverOpen}
                onOpenChange={setTemplatePopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full h-10 justify-between bg-muted/40 border-input rounded-lg px-3 font-semibold text-sm hover:bg-background transition-all text-foreground"
                  >
                    {selectedTemplate
                      ? selectedTemplate.name
                      : templates.length === 0
                        ? "Tidak ada template tersedia"
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
                        Template tidak ditemukan
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Step Preview */}
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
                            {idx === 0
                              ? "Pemohon (Auto-Approve)"
                              : step.level === "mengetahui"
                                ? "INFO ONLY"
                                : "APPROVER"}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Submit Box */}
            <div className="w-full bg-foreground rounded-xl p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                <span className="text-xs font-bold text-background uppercase tracking-tight">
                  Simpan Purchase Request
                </span>
              </div>
              <div className="flex items-center gap-2.5 p-2.5 bg-amber-500/10 border border-amber-400/30 rounded-md">
                <Checkbox
                  id="pr-accurate"
                  checked={prAccurate}
                  onCheckedChange={(v) => setPrAccurate(Boolean(v))}
                  className="border-amber-400 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                />
                <label
                  htmlFor="pr-accurate"
                  className="cursor-pointer select-none"
                >
                  <p className="text-[10px] font-bold text-amber-300 uppercase tracking-tight leading-none">
                    Sudah Input ke Accurate
                  </p>
                  <p className="text-[9px] text-amber-500/70 font-medium mt-0.5">
                    Centang jika sudah terdata di Accurate
                  </p>
                </label>
              </div>
              <Button
                className="w-full h-11 bg-background text-foreground hover:bg-background/90 font-bold text-xs uppercase gap-2 transition-all active:scale-95 rounded-lg"
                onClick={handleSave}
                disabled={
                  loading || draftItems.length === 0 || !selectedTemplateId
                }
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> SIMPAN PR
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </Content>

      {/* Section 3: Items Table */}
      <Content>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 bg-primary rounded-full" />
            <h3 className="text-xs font-bold text-foreground uppercase">
              Daftar Barang Transaksi
            </h3>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent border-b border-border h-12">
                  <TableHead className="w-10 pl-4" />
                  <TableHead className="text-[10px] font-bold uppercase text-muted-foreground">
                    MR Asal
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase text-muted-foreground pl-4">
                    Part Number
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase text-muted-foreground">
                    Nama Barang
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase text-muted-foreground text-center">
                    Share Stock
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase text-muted-foreground text-center">
                    Qty PR (Sisa)
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase text-muted-foreground text-right pr-8">
                    Satuan
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draftItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-60 text-center text-muted-foreground/30 font-medium italic"
                    >
                      {selectedMrs.length > 0
                        ? "Tidak ada item pemenuhan untuk MR yang dipilih"
                        : "Silakan pilih MR Referensi"}
                    </TableCell>
                  </TableRow>
                ) : (
                  draftItems.map((item) => {
                    const itemAllocs = sharestockAllocations.filter(
                      (a) => a.mr_item_id === item.mr_item_id,
                    );
                    return (
                      <TableRow
                        key={item.mr_item_id}
                        className={cn(
                          "hover:bg-muted/30 transition-all border-b border-border/50 group",
                          !item.selected && "opacity-50",
                        )}
                      >
                        <TableCell className="pl-4">
                          <Checkbox
                            checked={item.selected}
                            disabled={item.remaining <= 0}
                            onCheckedChange={(v) =>
                              toggleDraftItem(item.mr_item_id, Boolean(v))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-[9px] font-bold uppercase"
                          >
                            {item.mr_kode}
                          </Badge>
                        </TableCell>
                        <TableCell className="pl-4 font-mono text-[11px] font-bold text-muted-foreground uppercase tracking-tighter">
                          {item.part_number}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-bold text-foreground uppercase tracking-tight">
                            {item.part_name}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {item.qty_sharestock_total > 0 ? (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="inline-flex h-8 gap-1.5 items-center px-3 bg-success/10 text-success rounded-md font-bold text-xs hover:bg-success/20 transition-colors">
                                  {item.qty_sharestock_total}
                                  <Truck className="h-3 w-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-64 p-3 rounded-lg shadow-xl border-border"
                                align="center"
                              >
                                <h4 className="text-[10px] font-bold uppercase text-muted-foreground mb-2 tracking-widest border-b border-border pb-1.5">
                                  Rincian Share Stock
                                </h4>
                                <div className="space-y-1.5 pt-1">
                                  {itemAllocs.map((alloc, idx) => (
                                    <div
                                      key={idx}
                                      className="flex justify-between items-center text-xs font-bold text-foreground bg-muted/50 p-2 rounded"
                                    >
                                      <span className="uppercase text-[9px]">
                                        {alloc.cabang?.nama_cabang}
                                      </span>
                                      <span className="font-bold text-success">
                                        {alloc.qty}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          ) : (
                            <span className="text-muted-foreground/30 text-xs font-bold">
                              -
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <Input
                              type="number"
                              min={0}
                              max={item.remaining}
                              disabled={!item.selected}
                              value={item.qty}
                              onChange={(e) =>
                                updateDraftItemQty(
                                  item.mr_item_id,
                                  Number(e.target.value) || 0,
                                )
                              }
                              className="h-8 w-20 text-center font-bold text-sm mx-auto"
                            />
                            <span className="text-[9px] font-medium text-muted-foreground">
                              Sisa {item.remaining}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-8 font-bold text-muted-foreground text-[10px] uppercase">
                          {item.satuan}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
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
