"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Search,
  ShoppingCart,
  Building2,
  Calendar,
  Package,
  Loader2,
  ChevronRight,
  CheckCircle2,
  User,
  CreditCard,
  AlertCircle,
  FileText,
  ShieldCheck,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createPurchaseOrder } from "@/services/procurement-actions";
import { useDebounce } from "use-debounce";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { DatePickerString } from "@/components/date-picker-string";

type Step = 1 | 2 | 3;

interface POItem {
  mr_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  harga: number;
  vendor_id: number | null;
}

export default function CreatePOPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // User & auth
  const [userProfile, setUserProfile] = useState<any>(null);

  // Step 1 — Select PR
  const [prs, setPrs] = useState<any[]>([]);
  const [prSearch, setPrSearch] = useState("");
  const [debouncedPrSearch] = useDebounce(prSearch, 300);
  const [prPopoverOpen, setPrPopoverOpen] = useState(false);
  const [selectedPr, setSelectedPr] = useState<any>(null);

  // Step 2 — Vendor per item
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [vendorResults, setVendorResults] = useState<Record<number, any[]>>({});
  const [vendorLoading, setVendorLoading] = useState<Record<number, boolean>>(
    {},
  );
  const [selectedVendorMap, setSelectedVendorMap] = useState<
    Record<number, any>
  >({});
  const [vendorSearch, setVendorSearch] = useState<Record<number, string>>({});
  const [vendorPopoverOpen, setVendorPopoverOpen] = useState<
    Record<number, boolean>
  >({});

  // Step 3 — PO Header
  const [poKode, setPoKode] = useState("");
  const [poTanggal, setPoTanggal] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [poEstimasi, setPoEstimasi] = useState("");
  const [poPaymentTerm, setPoPaymentTerm] = useState("");
  const [paymentTermCustom, setPaymentTermCustom] = useState(false);
  const [poKeterangan, setPoKeterangan] = useState("");

  // Approval template
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);

  // Signature dialog
  const [isSignatureOpen, setIsSignatureOpen] = useState(false);

  useEffect(() => {
    fetchUser();
  }, []);

  useEffect(() => {
    fetchApprovedPRs();
  }, [debouncedPrSearch]);

  const fetchUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("*, cabang(id, nama_cabang), user_roles(roles(label))")
      .eq("id", user.id)
      .single();
    if (profile) {
      setUserProfile(profile);

      const { data: templateData } = await supabase
        .from("approval_templates")
        .select(
          "*, steps:approval_template_steps(*, profiles(id, nama, email))",
        )
        .eq("type", "Purchase Order")
        .or(`cabang_id.eq.${profile.cabang_id},cabang_id.is.null`)
        .order("name");
      setTemplates(templateData || []);
      if (templateData && templateData.length > 0) {
        setSelectedTemplateId(templateData[0].id.toString());
      }
    }
  };

  const fetchApprovedPRs = async () => {
    setLoading(true);
    let query = supabase
      .from("prs")
      .select(
        "id, pr_kode, pr_status, pr_tanggal, cabang(nama_cabang), profiles(nama)",
      )
      .eq("pr_status", "approved")
      .order("created_at", { ascending: false })
      .limit(50);

    if (debouncedPrSearch) {
      query = query.ilike("pr_kode", `%${debouncedPrSearch}%`);
    }

    const { data } = await query;
    setPrs(data || []);
    setLoading(false);
  };

  const searchVendors = async (idx: number, query: string) => {
    setVendorLoading((prev) => ({ ...prev, [idx]: true }));
    let q = supabase
      .from("vendors")
      .select("id, vendor_name, vendor_no")
      .order("vendor_name")
      .limit(15);
    if (query.trim()) {
      q = q.or(`vendor_name.ilike.%${query}%,vendor_no.ilike.%${query}%`);
    }
    const { data } = await q;
    setVendorResults((prev) => ({ ...prev, [idx]: data || [] }));
    setVendorLoading((prev) => ({ ...prev, [idx]: false }));
  };

  const handleSelectPR = async (pr: any) => {
    setSelectedPr(pr);
    setPrPopoverOpen(false);

    // Fetch PR items to build PO item list
    // Note: pr_items has no harga column; user enters harga in step 2
    const { data: items } = await supabase
      .from("pr_items")
      .select("id, mr_id, part_id, part_number, part_name, satuan, qty")
      .eq("pr_id", pr.id)
      .order("created_at");

    const poItemsList: POItem[] = (items || []).map((item: any) => ({
      mr_id: item.mr_id,
      part_id: item.part_id,
      part_number: item.part_number,
      part_name: item.part_name,
      satuan: item.satuan,
      qty: item.qty,
      harga: item.harga || 0,
      vendor_id: null,
    }));

    setPoItems(poItemsList);
    setStep(2);
  };

  const updateItemField = (index: number, field: keyof POItem, value: any) => {
    setPoItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const handleVendorSelect = (index: number, vendor: any) => {
    updateItemField(index, "vendor_id", vendor.id);
    setSelectedVendorMap((prev) => ({ ...prev, [index]: vendor }));
    setVendorPopoverOpen((prev) => ({ ...prev, [index]: false }));
  };

  const totalNilai = poItems.reduce((sum, it) => sum + it.qty * it.harga, 0);

  const handleSubmit = () => {
    if (!poKode.trim()) return toast.error("Kode PO wajib diisi");
    if (!selectedPr) return toast.error("Pilih PR terlebih dahulu");
    if (poItems.length === 0) return toast.error("Tidak ada item");
    if (!selectedTemplateId) return toast.error("Pilih Alur Approval");
    if (!templates.find((t) => t.id.toString() === selectedTemplateId))
      return toast.error("Template approval tidak valid");
    setIsSignatureOpen(true);
  };

  const handleConfirmSignature = async (signature: {
    id: string;
    image_url: string;
    label: string;
  }) => {
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

    setSubmitting(true);
    try {
      const result = await createPurchaseOrder({
        po_kode: poKode,
        pr_id: selectedPr.id,
        cabang_id: selectedPr.cabang_id ?? userProfile?.cabang_id,
        po_pic: userProfile?.nama || "",
        po_pic_id: userProfile?.id || "",
        po_tanggal: poTanggal,
        po_estimasi: poEstimasi || undefined,
        po_payment_term: poPaymentTerm || undefined,
        po_keterangan: poKeterangan || undefined,
        approvals: approvalData,
        items: poItems,
      });

      if (result.success) {
        toast.success("Purchase Order berhasil dibuat");
        router.push("/po");
      } else {
        toast.error(result.error || "Gagal membuat PO");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(n);

  return (
    <>
      {/* Header */}
      <Content>
        <div className="flex items-center gap-3">
          <Link href="/po">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
              Buat Purchase Order
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              {step === 1
                ? "Langkah 1 dari 3 — Pilih Purchase Request"
                : step === 2
                  ? "Langkah 2 dari 3 — Tentukan Vendor per Item"
                  : "Langkah 3 dari 3 — Isi Informasi PO"}
            </p>
          </div>
        </div>
      </Content>

      {/* Step Indicator */}
      <Content>
        <div className="flex items-center gap-0">
          {[
            { n: 1, label: "Pilih PR" },
            { n: 2, label: "Vendor & Harga" },
            { n: 3, label: "Informasi PO" },
          ].map((s, i) => (
            <React.Fragment key={s.n}>
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-black transition-colors",
                    step > s.n
                      ? "bg-success text-success-foreground"
                      : step === s.n
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {step > s.n ? <CheckCircle2 className="h-4 w-4" /> : s.n}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-bold uppercase hidden sm:block",
                    step === s.n ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
              </div>
              {i < 2 && (
                <div className="flex-1 h-0.5 mx-3 bg-border rounded-full" />
              )}
            </React.Fragment>
          ))}
        </div>
      </Content>

      {/* Step 1: Select PR */}
      {step === 1 && (
        <Content>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 bg-primary rounded-full" />
              <h3 className="text-[11px] font-bold uppercase">
                Pilih Purchase Request yang Telah Disetujui
              </h3>
            </div>

            <Popover open={prPopoverOpen} onOpenChange={setPrPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-10 font-bold text-xs"
                >
                  <Search className="h-4 w-4 text-muted-foreground" />
                  {selectedPr ? (
                    <span className="text-foreground">
                      {selectedPr.pr_kode}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Cari Kode PR...
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-105 p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder="Cari kode PR..."
                    value={prSearch}
                    onValueChange={setPrSearch}
                  />
                  <CommandList>
                    {loading ? (
                      <div className="py-6 flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : prs.length === 0 ? (
                      <CommandEmpty>
                        Tidak ada PR approved yang tersedia.
                      </CommandEmpty>
                    ) : (
                      prs.map((pr) => (
                        <CommandItem
                          key={pr.id}
                          value={pr.pr_kode}
                          onSelect={() => handleSelectPR(pr)}
                          className="gap-3 py-3"
                        >
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-xs uppercase">
                              {pr.pr_kode}
                            </p>
                            <p className="text-[9px] text-muted-foreground font-medium uppercase">
                              {pr.cabang?.nama_cabang} • {pr.profiles?.nama}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className="text-[9px] font-bold uppercase shrink-0"
                          >
                            {new Date(pr.pr_tanggal).toLocaleDateString(
                              "id-ID",
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              },
                            )}
                          </Badge>
                        </CommandItem>
                      ))
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {prs.length > 0 && !selectedPr && (
              <div className="text-[10px] text-muted-foreground font-medium">
                {prs.length} PR approved tersedia. Pilih satu untuk dilanjutkan.
              </div>
            )}
          </div>
        </Content>
      )}

      {/* Step 2: Vendor per item + Harga */}
      {step === 2 && (
        <>
          <Content>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-4 w-1 bg-primary rounded-full" />
                <h3 className="text-[11px] font-bold uppercase">
                  Tentukan Vendor & Harga per Item
                </h3>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase">
                <FileText className="h-3.5 w-3.5" />
                {selectedPr?.pr_kode}
              </div>
            </div>
          </Content>

          <Content className="overflow-x-auto">
            <div className="flex items-center gap-2 mb-4 p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <AlertCircle className="h-4 w-4 text-primary shrink-0" />
              <p className="text-[10px] font-bold text-primary uppercase">
                Item dengan vendor yang sama akan dikelompokkan sebagai satu
                Sub-PO saat mencetak dokumen.
              </p>
            </div>
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-10 hover:bg-transparent">
                  <TableHead className="text-[9px] font-black uppercase text-muted-foreground pl-4 w-28">
                    Part No.
                  </TableHead>
                  <TableHead className="text-[9px] font-black uppercase text-muted-foreground">
                    Nama Barang
                  </TableHead>
                  <TableHead className="text-[9px] font-black uppercase text-muted-foreground text-center w-20">
                    Qty
                  </TableHead>
                  <TableHead className="text-[9px] font-black uppercase text-muted-foreground w-36">
                    Harga Satuan
                  </TableHead>
                  <TableHead className="text-[9px] font-black uppercase text-muted-foreground w-48 pr-4">
                    Vendor
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poItems.map((item, idx) => {
                  const selectedVendor = selectedVendorMap[idx];
                  return (
                    <TableRow
                      key={idx}
                      className="border-b border-border/50 hover:bg-muted/20"
                    >
                      <TableCell className="pl-4 py-3 align-top">
                        <span className="text-[11px] font-black text-foreground font-mono uppercase tracking-wide">
                          {item.part_number}
                        </span>
                      </TableCell>
                      <TableCell className="py-3 align-top max-w-45">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase leading-snug wrap-break-word whitespace-normal">
                          {item.part_name}
                        </span>
                      </TableCell>
                      <TableCell className="text-center py-3 align-middle">
                        <span className="text-[11px] font-bold text-foreground">
                          {item.qty}{" "}
                          <span className="text-muted-foreground font-medium">
                            {item.satuan}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="py-2 align-middle">
                        <div className="flex items-center h-8 rounded-md border border-input bg-background overflow-hidden focus-within:ring-1 focus-within:ring-ring">
                          <span className="px-2 text-[10px] font-bold text-muted-foreground bg-muted border-r border-input h-full flex items-center shrink-0">
                            Rp
                          </span>
                          <input
                            type="text"
                            inputMode="numeric"
                            className="flex-1 h-full px-2 text-xs font-bold bg-transparent outline-none"
                            value={
                              item.harga === 0
                                ? ""
                                : new Intl.NumberFormat("id-ID").format(
                                    item.harga,
                                  )
                            }
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^0-9]/g, "");
                              updateItemField(
                                idx,
                                "harga",
                                raw ? parseInt(raw, 10) : 0,
                              );
                            }}
                            placeholder="0"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="py-2 pr-4 align-middle">
                        <Popover
                          open={vendorPopoverOpen[idx] || false}
                          onOpenChange={(val) => {
                            setVendorPopoverOpen((prev) => ({
                              ...prev,
                              [idx]: val,
                            }));
                            if (val)
                              searchVendors(idx, vendorSearch[idx] || "");
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-start gap-1.5 h-8 font-bold text-[10px] truncate"
                            >
                              <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="truncate">
                                {selectedVendor
                                  ? selectedVendor.vendor_name
                                  : "Pilih Vendor..."}
                              </span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 p-0" align="start">
                            <Command shouldFilter={false}>
                              <CommandInput
                                placeholder="Cari vendor..."
                                value={vendorSearch[idx] || ""}
                                onValueChange={(val) => {
                                  setVendorSearch((prev) => ({
                                    ...prev,
                                    [idx]: val,
                                  }));
                                  searchVendors(idx, val);
                                }}
                              />
                              <CommandList>
                                {vendorLoading[idx] ? (
                                  <div className="py-6 flex items-center justify-center">
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                  </div>
                                ) : (vendorResults[idx] || []).length === 0 ? (
                                  <CommandEmpty>
                                    Vendor tidak ditemukan.
                                  </CommandEmpty>
                                ) : (
                                  (vendorResults[idx] || []).map((v) => (
                                    <CommandItem
                                      key={v.id}
                                      value={v.id.toString()}
                                      onSelect={() =>
                                        handleVendorSelect(idx, v)
                                      }
                                      className="text-xs font-bold"
                                    >
                                      {v.vendor_name}
                                      {v.vendor_no && (
                                        <span className="ml-2 text-[9px] text-muted-foreground font-mono">
                                          {v.vendor_no}
                                        </span>
                                      )}
                                    </CommandItem>
                                  ))
                                )}
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between p-4 border-t border-border bg-muted/30 mt-2">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">
                Total Estimasi Nilai PO
              </span>
              <span className="text-sm font-black text-foreground">
                {formatCurrency(totalNilai)}
              </span>
            </div>

            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                className="gap-2 font-bold text-xs"
                onClick={() => setStep(1)}
              >
                <ArrowLeft className="h-4 w-4" /> Kembali
              </Button>
              <Button
                className="gap-2 font-bold text-xs uppercase"
                onClick={() => setStep(3)}
              >
                Lanjut ke Informasi PO <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </Content>
        </>
      )}

      {/* Step 3: PO Header */}
      {step === 3 && (
        <Content>
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 bg-primary rounded-full" />
              <h3 className="text-[11px] font-bold uppercase">
                Informasi Purchase Order
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Kode PO <span className="text-destructive">*</span>
                </Label>
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                  <Input
                    value={poKode}
                    onChange={(e) => setPoKode(e.target.value)}
                    placeholder="PO-XXX-0001"
                    className="h-10 font-bold text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  PIC / Pembuat
                </Label>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <div className="flex h-10 w-full items-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground">
                    {userProfile?.nama || "-"}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Tanggal PO <span className="text-destructive">*</span>
                </Label>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <DatePickerString
                    value={poTanggal}
                    onChange={setPoTanggal}
                    className="h-10 font-bold text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Estimasi Tanggal Penerimaan
                </Label>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <DatePickerString
                    value={poEstimasi}
                    onChange={setPoEstimasi}
                    className="h-10 font-bold text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Syarat Pembayaran (Payment Term)
                </Label>
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                  <Select
                    value={
                      paymentTermCustom ? "__custom__" : poPaymentTerm || ""
                    }
                    onValueChange={(val) => {
                      if (val === "__custom__") {
                        setPaymentTermCustom(true);
                        setPoPaymentTerm("");
                      } else {
                        setPaymentTermCustom(false);
                        setPoPaymentTerm(val);
                      }
                    }}
                  >
                    <SelectTrigger className="h-10 font-bold text-sm flex-1">
                      <SelectValue placeholder="Pilih syarat pembayaran..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cash / COD">Cash / COD</SelectItem>
                      <SelectItem value="NET 7">NET 7</SelectItem>
                      <SelectItem value="NET 14">NET 14</SelectItem>
                      <SelectItem value="NET 30">NET 30</SelectItem>
                      <SelectItem value="NET 45">NET 45</SelectItem>
                      <SelectItem value="NET 60">NET 60</SelectItem>
                      <SelectItem value="DP 30%">DP 30%</SelectItem>
                      <SelectItem value="DP 50%">DP 50%</SelectItem>
                      <SelectItem value="Kredit">Kredit</SelectItem>
                      <SelectItem value="__custom__">
                        Lainnya / Custom...
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {paymentTermCustom && (
                  <Input
                    value={poPaymentTerm}
                    onChange={(e) => setPoPaymentTerm(e.target.value)}
                    placeholder="Masukkan syarat pembayaran lainnya..."
                    className="h-10 font-bold text-sm"
                    autoFocus
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Lokasi / Cabang
                </Label>
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <div className="flex h-10 w-full items-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground">
                    {selectedPr?.cabang?.nama_cabang || "-"}
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Keterangan
                </Label>
                <Textarea
                  value={poKeterangan}
                  onChange={(e) => setPoKeterangan(e.target.value)}
                  placeholder="Keterangan tambahan, instruksi khusus, dll..."
                  className="resize-none min-h-20 font-medium text-sm"
                />
              </div>

              {/* Approval Template */}
              <div className="md:col-span-2 space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Alur Approval <span className="text-destructive">*</span>
                </Label>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1 space-y-3">
                    <Popover
                      open={templatePopoverOpen}
                      onOpenChange={setTemplatePopoverOpen}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start gap-2 h-10 font-bold text-xs"
                        >
                          <Search className="h-3.5 w-3.5 text-muted-foreground" />
                          <span
                            className={cn(
                              selectedTemplateId
                                ? "text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {selectedTemplateId
                              ? (templates.find(
                                  (t) => t.id.toString() === selectedTemplateId,
                                )?.name ?? "Pilih template...")
                              : "Pilih template approval..."}
                          </span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-0" align="start">
                        <Command>
                          <CommandInput
                            placeholder="Cari template..."
                            value={templateSearch}
                            onValueChange={setTemplateSearch}
                          />
                          <CommandList>
                            {templates.length === 0 ? (
                              <CommandEmpty>
                                Tidak ada template untuk PO.
                              </CommandEmpty>
                            ) : (
                              templates
                                .filter((t) =>
                                  t.name
                                    .toLowerCase()
                                    .includes(templateSearch.toLowerCase()),
                                )
                                .map((t) => (
                                  <CommandItem
                                    key={t.id}
                                    value={t.name}
                                    onSelect={() => {
                                      setSelectedTemplateId(t.id.toString());
                                      setTemplatePopoverOpen(false);
                                    }}
                                    className="text-xs font-bold gap-2"
                                  >
                                    <CheckCircle2
                                      className={cn(
                                        "h-3.5 w-3.5",
                                        selectedTemplateId === t.id.toString()
                                          ? "text-primary"
                                          : "text-transparent",
                                      )}
                                    />
                                    {t.name}
                                  </CommandItem>
                                ))
                            )}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {/* Step preview */}
                    {selectedTemplateId &&
                      (() => {
                        const tpl = templates.find(
                          (t) => t.id.toString() === selectedTemplateId,
                        );
                        if (!tpl) return null;
                        const sorted = [...(tpl.steps || [])].sort(
                          (a: any, b: any) => a.step_order - b.step_order,
                        );
                        return (
                          <div className="flex flex-col gap-1">
                            {sorted.map((step: any, i: number) => {
                              const isRequester =
                                step.approver_type === "requester";
                              const displayName = isRequester
                                ? userProfile?.nama || "Anda"
                                : step.profiles?.nama || "—";
                              return (
                                <div
                                  key={i}
                                  className="flex items-center gap-2"
                                >
                                  <div
                                    className={cn(
                                      "h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0",
                                      i === 0
                                        ? "bg-success text-success-foreground"
                                        : "bg-primary/10 text-primary",
                                    )}
                                  >
                                    {i + 1}
                                  </div>
                                  <span className="text-[10px] font-bold text-foreground">
                                    {displayName}
                                  </span>
                                  {isRequester && (
                                    <Badge
                                      variant="outline"
                                      className="text-[8px] font-bold uppercase px-1 py-0"
                                    >
                                      Requester
                                    </Badge>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                  </div>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="p-4 bg-muted/40 border border-border rounded-xl space-y-2">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                <span>Sumber PR</span>
                <span className="text-foreground font-mono">
                  {selectedPr?.pr_kode}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                <span>Jumlah Item</span>
                <span className="text-foreground">{poItems.length} item</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                <span>Jumlah Vendor</span>
                <span className="text-foreground">
                  {
                    new Set(poItems.map((i) => i.vendor_id).filter(Boolean))
                      .size
                  }{" "}
                  vendor
                </span>
              </div>
              <div className="flex items-center justify-between text-sm font-black uppercase pt-2 border-t border-border">
                <span>Total Estimasi Nilai</span>
                <span className="text-primary">
                  {formatCurrency(totalNilai)}
                </span>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                className="gap-2 font-bold text-xs"
                onClick={() => setStep(2)}
                disabled={submitting}
              >
                <ArrowLeft className="h-4 w-4" /> Kembali
              </Button>
              <Button
                className="gap-2 font-bold text-xs uppercase px-6"
                onClick={handleSubmit}
                disabled={submitting || !poKode.trim() || !selectedTemplateId}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Buat Purchase Order
                  </>
                )}
              </Button>
            </div>
          </div>
        </Content>
      )}

      <MRSignatureDialog
        open={isSignatureOpen}
        onOpenChange={setIsSignatureOpen}
        onConfirm={handleConfirmSignature}
      />
    </>
  );
}
