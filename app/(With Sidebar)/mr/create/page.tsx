"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  MessageSquare,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { MRItemSelector, MRItem } from "@/components/mr/mr-item-selector";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger 
} from "@/components/ui/popover";
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
  const [mrTanggal, setMrTanggal] = useState(new Date().toISOString().split("T")[0]);
  const [mrDueDate, setMrDueDate] = useState("");
  const [mrPriority, setMrPriority] = useState("P3");
  const [mrRemarks, setMrRemarks] = useState("");
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*, cabang(id, nama_cabang)")
        .eq("id", user.id)
        .single();

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
      const template = templates.find(t => t.id.toString() === selectedTemplateId);
      if (!template) throw new Error("Template tidak valid");

      const sortedSteps = [...(template.steps || [])].sort((a: any, b: any) => a.step_order - b.step_order);
      
      const approvalData = sortedSteps.map((step: any) => {
        const isFirst = step.step_order === 1;
        return {
          step_id: step.id,
          step_order: step.step_order,
          level: step.level,
          status: isFirst ? "approved" : "pending",
          user_id: isFirst ? userProfile.id : (step.user_id || null),
          nama: isFirst ? userProfile.nama : (step.profiles?.nama || "Unknown Approver"),
          email: isFirst ? userProfile.email : (step.profiles?.email || "-"),
          role: isFirst ? "Requester" : (step.level === 'menyetujui' ? 'Approver' : 'Reviewer'),
          processed_at: isFirst ? new Date().toISOString() : null,
          signature_url: isFirst ? signature.image_url : null,
          snapshot: isFirst ? {
            nama: userProfile.nama,
            email: userProfile.email,
            lokasi: userProfile.cabang?.nama_cabang,
            role: "Requester"
          } : null
        };
      });

      const { data: newMr, error: mrError } = await supabase
        .from("mrs")
        .insert({
          mr_kode: mrKode,
          cabang_id: userProfile.cabang_id,
          mr_pic: userProfile.nama,
          mr_pic_id: userProfile.id,
          mr_tanggal: mrTanggal,
          mr_due_date: mrDueDate,
          mr_status: approvalData.length > 1 ? "open" : "approved",
          mr_priority: mrPriority,
          mr_remarks: mrRemarks,
          approvals: approvalData
        })
        .select()
        .single();

      if (mrError) throw mrError;

      const itemsToInsert = items.map(item => ({
        mr_id: newMr.id,
        part_id: item.part_id,
        part_number: item.part_number,
        part_name: item.part_name,
        satuan: item.satuan,
        qty_request: item.qty
      }));

      await supabase.from("mr_items").insert(itemsToInsert);
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
      case "P1": return "text-red-600 bg-red-50 border-red-200";
      case "P2": return "text-orange-600 bg-orange-50 border-orange-200";
      case "P3": return "text-blue-600 bg-blue-50 border-blue-200";
      case "P4": return "text-slate-600 bg-slate-50 border-slate-200";
      default: return "";
    }
  };

  const filteredTemplates = templates
    .filter(t => t.name.toLowerCase().includes(debouncedTemplateSearch.toLowerCase()))
    .slice(0, 10);

  const selectedTemplate = templates.find(t => t.id.toString() === selectedTemplateId);

  if (initialLoading) {
    return (
      <Content>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </Content>
    );
  }

  return (
    <Content className="bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto py-6 px-4 space-y-4">
        {/* Navigation */}
        <div className="flex items-center justify-between text-slate-900">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="text-slate-500 hover:text-slate-900 h-8 gap-1.5 font-medium px-0"
          >
            <ChevronLeft className="h-4 w-4" /> Daftar Material Request
          </Button>
          <div className="flex items-center gap-2">
             <Badge variant="outline" className="bg-white text-slate-500 border-slate-200 uppercase font-bold text-[10px]">Draft</Badge>
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          {/* Header Info */}
          <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-3">
               <div className="h-10 w-10 bg-slate-900 rounded flex items-center justify-center">
                  <FileText className="h-5 w-5 text-white" />
               </div>
               <div>
                  <h1 className="text-lg font-bold text-slate-900 leading-tight">BUAT MATERIAL REQUEST</h1>
                  <p className="text-[10px] text-slate-400 font-medium uppercase mt-1">Dokumentasi Internal</p>
               </div>
            </div>
            <div className="flex flex-col gap-1 w-full md:w-auto">
               <Label className="text-[10px] font-semibold uppercase text-slate-500">Nomor Dokumen</Label>
               <Input 
                 placeholder="Input Kode MR..." 
                 className="h-9 w-full md:w-[240px] bg-slate-50 border-slate-200 rounded-md font-medium text-xs uppercase text-slate-900"
                 value={mrKode}
                 onChange={(e) => setMrKode(e.target.value)}
               />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6 p-5">
            {/* Column 1: Requester */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-slate-500">Pemohon (Requester)</Label>
                <div className="p-3 bg-slate-50 border rounded-md border-slate-100">
                    <p className="text-sm font-semibold text-slate-800 leading-none">{userProfile?.nama}</p>
                    <p className="text-[11px] text-slate-500 mt-1">{userProfile?.email}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-amber-500" /> Tingkat Prioritas
                </Label>
                <Select value={mrPriority} onValueChange={setMrPriority}>
                   <SelectTrigger className={`h-10 font-bold text-xs rounded-md ${getPriorityColor(mrPriority)}`}>
                      <SelectValue placeholder="Pilih Prioritas" />
                   </SelectTrigger>
                   <SelectContent>
                      <SelectItem value="P1" className="text-red-600 font-bold">P1 - EMERGENCY</SelectItem>
                      <SelectItem value="P2" className="text-orange-600 font-bold">P2 - HIGH</SelectItem>
                      <SelectItem value="P3" className="text-blue-600 font-bold">P3 - NORMAL</SelectItem>
                      <SelectItem value="P4" className="text-slate-600 font-bold">P4 - LOW</SelectItem>
                   </SelectContent>
                </Select>
              </div>
            </div>

            {/* Column 2: Location & Dates */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-slate-500">Lokasi Site</Label>
                <div className="p-3 bg-slate-50 border rounded-md border-slate-100">
                    <p className="text-sm font-semibold text-slate-800 leading-none uppercase">{userProfile?.cabang?.nama_cabang}</p>
                    <p className="text-[10px] font-semibold text-blue-600 mt-1 uppercase tracking-tighter">Authorized Location</p>
                </div>
              </div>
              <div className="space-y-1.5">
                 <Label className="text-[10px] uppercase font-bold text-slate-500">Keterangan / Remarks</Label>
                 <Textarea 
                   placeholder="Catatan tambahan (Opsional)..."
                   className="h-[84px] resize-none text-xs font-medium border-slate-200 bg-slate-50/50 focus:bg-white text-slate-900"
                   value={mrRemarks}
                   onChange={(e) => setMrRemarks(e.target.value)}
                 />
              </div>
            </div>

            {/* Column 3: Dates Info */}
            <div className="space-y-4">
               <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold text-slate-500 uppercase">Input & Deadline</Label>
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-md space-y-4">
                     <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1.5 min-w-[80px]">
                           <CalendarIcon className="h-3 w-3 text-slate-400" />
                           <span className="text-[10px] font-bold text-slate-500 uppercase">Tgl Input</span>
                        </div>
                        <Input 
                          type="date"
                          className="h-8 py-0 px-2 rounded-md border-slate-200 bg-white font-bold text-xs w-[130px] text-slate-900"
                          value={mrTanggal}
                          onChange={(e) => setMrTanggal(e.target.value)}
                        />
                     </div>
                     <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1.5 min-w-[80px]">
                           <Clock className="h-3 w-3 text-red-400" />
                           <span className="text-[10px] font-bold text-slate-500 uppercase">Deadline</span>
                        </div>
                        <Input 
                          type="date"
                          className="h-8 py-0 px-2 rounded-md border-slate-200 bg-white font-bold text-xs text-red-600 w-[130px]"
                          value={mrDueDate}
                          onChange={(e) => setMrDueDate(e.target.value)}
                        />
                     </div>
                  </div>
               </div>
            </div>
          </div>

          <Separator className="bg-slate-50" />

          <div className="p-5 border-b border-slate-100 min-h-[200px]">
             <MRItemSelector items={items} onItemsChange={setItems} />
          </div>

          <div className="p-5 flex flex-col lg:flex-row justify-between gap-8 bg-slate-50/50">
             <div className="flex-1 space-y-4 max-w-[500px]">
                <div className="space-y-1.5">
                   <Label className="text-[10px] uppercase font-bold text-slate-500">Alur Approval</Label>
                   <Popover open={templatePopoverOpen} onOpenChange={setTemplatePopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full h-10 justify-between bg-white border-slate-200 rounded-md px-3 font-semibold text-sm shadow-sm hover:bg-slate-50 transition-all text-slate-900"
                      >
                        {selectedTemplate ? selectedTemplate.name : "Cari Template Approval..."}
                        <Search className="ml-2 h-3.5 w-3.5 opacity-40 shrink-0" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0 rounded-lg border border-slate-200 shadow-xl overflow-hidden" align="start">
                      <div className="p-2 border-b border-slate-100 bg-slate-50">
                        <Input 
                           placeholder="Filter template..."
                           className="h-8 bg-white border-slate-200 rounded-md text-xs text-slate-900"
                           value={templateSearch}
                           onChange={(e) => setTemplateSearch(e.target.value)}
                        />
                      </div>
                      <div className="max-h-[250px] overflow-y-auto p-1 text-sm bg-white">
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
                                selectedTemplateId === t.id.toString() ? "bg-slate-900 text-white" : "hover:bg-slate-100 text-slate-900"
                              }`}
                            >
                              <div className="flex flex-col">
                                 <span className="font-semibold text-xs">{t.name}</span>
                                 <span className="text-[9px] uppercase font-medium mt-0.5 opacity-60">
                                    {t.steps?.length || 0} Langkah Persetujuan
                                 </span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="p-6 text-center text-slate-400 text-xs italic">Data tidak ditemukan</div>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {selectedTemplate && (
                   <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Urutan Persetujuan:</p>
                      <div className="space-y-3">
                         {selectedTemplate.steps?.sort((a:any, b:any) => a.step_order - b.step_order).map((step: any, idx: number) => (
                           <div key={step.id} className="flex gap-3 items-start relative">
                              {idx < selectedTemplate.steps.length - 1 && (
                                <div className="absolute left-[13px] top-6 h-full w-[2px] bg-slate-100" />
                              )}
                              <div className="h-7 w-7 bg-slate-50 border rounded flex items-center justify-center shrink-0 z-10">
                                 <span className="text-[10px] font-semibold text-slate-600">{step.step_order}</span>
                              </div>
                              <div className="flex flex-col gap-0.5">
                                 <span className="text-xs font-semibold text-slate-900">
                                    {step.approver_type === 'requester' ? userProfile?.nama : (step.profiles?.nama || "User Unknown")}
                                 </span>
                                 <span className="text-[9px] text-slate-500 font-medium uppercase tracking-tighter">
                                    {step.level === 'mengetahui' ? 'INFO ONLY' : 'PRIMARY APPROVER'}
                                 </span>
                              </div>
                           </div>
                         ))}
                      </div>
                   </div>
                )}
             </div>

             <div className="w-full lg:w-[280px] flex flex-col gap-3">
                <div className="bg-slate-900 p-5 rounded-lg flex flex-col items-center gap-4 shadow-sm border border-slate-800">
                   <ShieldCheck className="h-6 w-6 text-green-500" />
                   <div className="text-center">
                      <p className="text-xs font-semibold text-white uppercase">Validasi Dokumen</p>
                      <p className="text-[10px] text-slate-400 mt-1 font-medium">Siap untuk dikirim?</p>
                   </div>
                   <Button 
                    className="w-full h-10 rounded-md bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm transition-all"
                    onClick={handleSubmitClick}
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "SIGN & SUBMIT"}
                  </Button>
                </div>
                <p className="text-center text-[9px] text-slate-400 font-medium italic">
                  Pastikan data benar sebelum tanda tangan.
                </p>
             </div>
          </div>
        </div>
      </div>

      <MRSignatureDialog 
        open={isSignatureOpen}
        onOpenChange={setIsSignatureOpen}
        onConfirm={handleConfirmSignature}
      />
    </Content>
  );
}
