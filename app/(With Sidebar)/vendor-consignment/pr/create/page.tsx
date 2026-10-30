"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  ChevronLeft,
  FileSpreadsheet,
  Building2,
  Calendar as CalendarIcon,
  Search,
  Plus,
  Trash2,
  Loader2,
  ShieldCheck,
  Package,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { VendorPicker, type VendorOption } from "@/components/vendor-consignment/vendor-picker";
import { createConsignmentPr } from "@/services/vendor-consignment-actions";
import { useGoBack } from "@/hooks/use-go-back";

interface PrItem {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
}

export default function CreateConsignmentPrPage() {
  const supabase = createClient();
  const router = useRouter();
  const goBack = useGoBack("/vendor-consignment/pr");

  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [cabangs, setCabangs] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const [prKode, setPrKode] = useState("");
  const [prTanggal, setPrTanggal] = useState(toYmdLocal());
  const [cabangId, setCabangId] = useState<number | null>(null);
  const [vendor, setVendor] = useState<VendorOption | null>(null);
  const [items, setItems] = useState<PrItem[]>([]);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [results, setResults] = useState<any[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  const [isSignatureOpen, setIsSignatureOpen] = useState(false);

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("*, cabang(id, nama_cabang)")
        .eq("id", user.id)
        .single();
      setUserProfile(profile);
      setCabangId(profile?.cabang_id ?? null);

      const { data: cabangData } = await supabase
        .from("cabang")
        .select("id, nama_cabang")
        .eq("is_active", true)
        .order("nama_cabang");
      setCabangs(cabangData || []);

      const { data: tpl } = await supabase
        .from("approval_templates")
        .select("*, steps:approval_template_steps(*, profiles(id, nama, email))")
        .eq("type", "Purchase Request")
        .or(`${profile?.cabang_id ? `cabang_id.eq.${profile.cabang_id},` : ""}cabang_id.is.null`)
        .order("name");
      setTemplates(tpl || []);
      if (tpl && tpl.length > 0) setSelectedTemplateId(tpl[0].id.toString());
      setInitialLoading(false);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const run = async () => {
      let q = supabase.from("barang").select("id, part_number, part_name, part_satuan").order("part_name").limit(15);
      if (debouncedSearch)
        q = q.or(`part_number.ilike.%${debouncedSearch}%,part_name.ilike.%${debouncedSearch}%`);
      const { data } = await q;
      setResults(data || []);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, searchOpen]);

  const addItem = (b: any) => {
    if (items.some((i) => i.part_id === b.id)) return;
    setItems((prev) => [
      ...prev,
      { part_id: b.id, part_number: b.part_number, part_name: b.part_name, satuan: b.part_satuan, qty: 1 },
    ]);
    setSearchOpen(false);
    setSearch("");
  };

  const validate = () => {
    if (!prKode.trim()) return "Kode PR wajib diisi.";
    if (!cabangId) return "Pilih gudang penerima.";
    if (!vendor) return "Pilih vendor (supplier).";
    if (items.length === 0) return "Tambahkan minimal satu item.";
    if (items.some((i) => !(i.qty > 0))) return "Qty item harus lebih dari 0.";
    if (!selectedTemplateId) return "Pilih alur approval.";
    return null;
  };

  const handleConfirmSignature = async (signature: { id: string; image_url: string }) => {
    const template = templates.find((t) => t.id.toString() === selectedTemplateId);
    if (!template) return toast.error("Template approval tidak valid");
    const sortedSteps = [...(template.steps || [])].sort((a: any, b: any) => a.step_order - b.step_order);
    // Bentuk approvals sama persis dengan PR biasa (diproses approvePR).
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
          ? { nama: userProfile.nama, email: userProfile.email, lokasi: userProfile.cabang?.nama_cabang }
          : null,
      };
    });

    setLoading(true);
    const res = await createConsignmentPr({
      pr_kode: prKode.trim(),
      pr_tanggal: prTanggal,
      cabang_id: cabangId!,
      vendor_id: vendor!.id,
      approvals: approvalData,
      items: items.map((i) => ({ part_id: i.part_id, qty: i.qty })),
    });
    setLoading(false);
    if (res.error) return toast.error(res.error);
    toast.success("PR Konsinyasi berhasil dibuat");
    router.push("/vendor-consignment/pr");
  };

  const selectedTemplate = templates.find((t) => t.id.toString() === selectedTemplateId);

  if (initialLoading) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={goBack}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">Buat PR Konsinyasi</h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Daftar barang titipan yang diminta ke supplier
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Kode PR</Label>
            <Input
              placeholder="Input Kode PR..."
              value={prKode}
              onChange={(e) => setPrKode(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Tanggal
            </Label>
            <DatePickerString value={prTanggal} onChange={setPrTanggal} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Building2 className="h-3 w-3" /> Gudang Penerima (WH HO / Branch)
            </Label>
            <Select value={cabangId?.toString()} onValueChange={(v) => setCabangId(parseInt(v))}>
              <SelectTrigger className="h-10 text-sm font-bold">
                <SelectValue placeholder="Pilih gudang..." />
              </SelectTrigger>
              <SelectContent>
                {cabangs.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Briefcase className="h-3 w-3" /> Vendor (Supplier)
            </Label>
            <VendorPicker value={vendor} onChange={setVendor} />
          </div>
        </div>
      </Content>

      <Content>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Daftar Item</h3>
          </div>
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <Plus className="h-3.5 w-3.5" /> Tambah Item
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[calc(100vw-2rem)] max-w-100 p-0" align="end">
              <div className="p-2 border-b bg-muted/40">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Cari barang..."
                    className="pl-8 h-8 text-xs"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-75 overflow-y-auto p-1">
                {results.length > 0 ? (
                  results.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => addItem(r)}
                      disabled={items.some((i) => i.part_id === r.id)}
                      className="w-full text-left p-2 hover:bg-muted rounded-md disabled:opacity-50"
                    >
                      <code className="text-xs font-bold">{r.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground truncate">{r.part_name}</span>
                    </button>
                  ))
                ) : (
                  <div className="p-6 text-center text-xs text-muted-foreground italic">Barang tidak ditemukan.</div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10 hover:bg-transparent">
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                <TableHead className="w-20 text-center text-[10px] font-black uppercase text-muted-foreground">Unit</TableHead>
                <TableHead className="w-32 text-center text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                <TableHead className="w-14" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length > 0 ? (
                items.map((item) => (
                  <TableRow key={item.part_id} className="h-12">
                    <TableCell>
                      <span className="font-semibold text-xs">{item.part_name}</span>
                      <code className="block text-[10px] text-muted-foreground">{item.part_number}</code>
                    </TableCell>
                    <TableCell className="text-center text-[10px] font-medium text-muted-foreground uppercase">
                      {item.satuan}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        value={item.qty}
                        onChange={(e) => {
                          const qty = Math.max(1, parseInt(e.target.value) || 1);
                          setItems((prev) => prev.map((i) => (i.part_id === item.part_id ? { ...i, qty } : i)));
                        }}
                        className="h-8 w-24 mx-auto text-center text-xs"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setItems((prev) => prev.filter((i) => i.part_id !== item.part_id))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="h-24 hover:bg-transparent">
                  <TableCell colSpan={4} className="text-center text-xs italic text-muted-foreground">
                    Belum ada item.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Content>
        <div className="flex flex-col lg:flex-row justify-between gap-6">
          <div className="flex-1 space-y-1.5 max-w-full lg:max-w-125">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Alur Approval (Purchase Request)</Label>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger className="h-10 text-sm font-semibold">
                <SelectValue placeholder="Pilih template approval..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id.toString()}>
                    {t.name} ({t.steps?.length || 0} langkah)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templates.length === 0 && (
              <p className="text-[10px] text-destructive font-medium">
                Belum ada template approval tipe &quot;Purchase Request&quot;.
              </p>
            )}
            {selectedTemplate && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[...(selectedTemplate.steps || [])]
                  .sort((a: any, b: any) => a.step_order - b.step_order)
                  .map((s: any) => (
                    <Badge key={s.id} variant="outline" className="text-[10px]">
                      {s.step_order}. {s.approver_type === "requester" ? userProfile?.nama : s.profiles?.nama || "User"}
                    </Badge>
                  ))}
              </div>
            )}
          </div>
          <div className="w-full lg:w-70">
            <div className="bg-foreground p-5 rounded-lg flex flex-col items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-success" />
              <p className="text-[10px] text-background/60 text-center font-medium">
                Setelah approved, PR dicetak/di-share ke supplier sebagai dasar pengiriman barang titipan.
              </p>
              <Button
                className="w-full h-10 bg-background text-foreground hover:bg-muted font-bold text-sm"
                disabled={loading}
                onClick={() => {
                  const err = validate();
                  if (err) return toast.error(err);
                  setIsSignatureOpen(true);
                }}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "SIGN & SUBMIT"}
              </Button>
            </div>
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
