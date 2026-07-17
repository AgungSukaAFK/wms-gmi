"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  PackageCheck,
  Building2,
  Calendar,
  Loader2,
  CheckCircle2,
  User,
  ShoppingCart,
  AlertCircle,
  Package,
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
import { createReceive } from "@/services/procurement-actions";
import { useDebounce } from "use-debounce";
import Link from "next/link";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";

interface ReceiveItem {
  po_item_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty_po: number;
  qty_received: number;
  qty_sisa: number;
  mr_id: number;
  vendor_name: string | null;
  qty_receive: number; // how many to receive in this RI
}

export default function CreateReceivePage() {
  const router = useRouter();
  const supabase = createClient();
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  // User
  const [userProfile, setUserProfile] = useState<any>(null);

  // PO selection
  const [pos, setPos] = useState<any[]>([]);
  const [poSearch, setPoSearch] = useState("");
  const [debouncedPoSearch] = useDebounce(poSearch, 300);
  const [poPopoverOpen, setPoPopoverOpen] = useState(false);
  const [selectedPo, setSelectedPo] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Items
  const [items, setItems] = useState<ReceiveItem[]>([]);

  // RI Header
  const [riKode, setRiKode] = useState("");
  const [riTanggal, setRiTanggal] = useState(toYmdLocal());
  const [riKeterangan, setRiKeterangan] = useState("");

  useEffect(() => {
    fetchUser();
  }, []);

  useEffect(() => {
    fetchApprovedPOs();
  }, [debouncedPoSearch]);

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
      .select("*, cabang(id, nama_cabang)")
      .eq("id", user.id)
      .single();

    if (profile) {
      setUserProfile(profile);

      const { data: templateData } = await supabase
        .from("approval_templates")
        .select("id, name")
        .eq("type", "Receive Item")
        .or(`cabang_id.eq.${profile.cabang_id},cabang_id.is.null`)
        .order("name", { ascending: true });

      const safeTemplates = templateData || [];
      setTemplates(safeTemplates);
      if (safeTemplates.length > 0) {
        setSelectedTemplateId(String(safeTemplates[0].id));
      }
    }
  };

  const fetchApprovedPOs = async () => {
    setLoading(true);
    let query = supabase
      .from("pos")
      .select(
        "id, po_kode, po_tanggal, po_receive_status, prs!inner(cabang_id, cabang(nama_cabang))",
      )
      .eq("po_status", "approved")
      .neq("po_receive_status", "complete")
      .order("created_at", { ascending: false })
      .limit(50);

    if (debouncedPoSearch) {
      query = query.ilike("po_kode", `%${debouncedPoSearch}%`);
    }

    const { data } = await query;
    setPos(data || []);
    setLoading(false);
  };

  const handleSelectPO = async (po: any) => {
    setSelectedPo(po);
    setPoPopoverOpen(false);

    // Fetch PO items that still have qty to receive
    const { data: poItems } = await supabase
      .from("po_items")
      .select(
        "id, part_id, part_number, part_name, satuan, qty, qty_received, mr_id, vendor_id, vendors(vendor_name)",
      )
      .eq("po_id", po.id)
      .order("id");

    const receiveItems: ReceiveItem[] = (poItems || [])
      .map((item: any) => ({
        po_item_id: item.id,
        part_id: item.part_id,
        part_number: item.part_number,
        part_name: item.part_name,
        satuan: item.satuan,
        qty_po: item.qty,
        qty_received: item.qty_received ?? 0,
        qty_sisa: item.qty - (item.qty_received ?? 0),
        mr_id: item.mr_id,
        vendor_name: item.vendors?.vendor_name ?? null,
        qty_receive: item.qty - (item.qty_received ?? 0), // default to full remaining
      }))
      .filter((i: ReceiveItem) => i.qty_sisa > 0);

    setItems(receiveItems);
  };

  const updateQty = (idx: number, value: number) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i === idx
          ? {
              ...item,
              qty_receive: Math.max(0, Math.min(item.qty_sisa, value)),
            }
          : item,
      ),
    );
  };

  const handleSubmit = async () => {
    if (!riKode.trim()) return toast.error("Kode RI wajib diisi");
    if (!selectedPo) return toast.error("Pilih Purchase Order");
    if (!selectedTemplateId)
      return toast.error("Template approval wajib dipilih");
    const activeItems = items.filter((i) => i.qty_receive > 0);
    if (activeItems.length === 0)
      return toast.error("Tidak ada item yang akan diterima (qty = 0 semua)");

    setSubmitting(true);
    try {
      const result = await createReceive({
        ri_kode: riKode,
        po_id: selectedPo.id,
        cabang_id: selectedPo.prs?.cabang_id ?? userProfile?.cabang_id,
        ri_pic: userProfile?.nama || "",
        ri_pic_id: userProfile?.id || undefined,
        ri_tanggal: riTanggal,
        ri_keterangan: riKeterangan || undefined,
        approval_template_id: Number(selectedTemplateId),
        items: activeItems.map((item) => ({
          part_id: item.part_id,
          part_number: item.part_number,
          part_name: item.part_name,
          satuan: item.satuan,
          qty: item.qty_receive,
          po_id: selectedPo.id,
          mr_id: item.mr_id,
          po_item_id: item.po_item_id,
        })),
      });

      if (result.success) {
        toast.success("Penerimaan barang berhasil dicatat");
        router.push("/receive");
      } else {
        toast.error(result.error || "Gagal menyimpan penerimaan");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const totalItemsToReceive = items.filter((i) => i.qty_receive > 0).length;

  return (
    <>
      {/* Header */}
      <Content>
        <div className="flex items-center gap-3">
          <Link href="/receive">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
              Buat Penerimaan Barang
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Receive Item dari Purchase Order yang disetujui
            </p>
          </div>
        </div>
      </Content>

      {/* Section 1: Header Info */}
      <Content>
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 bg-primary rounded-full" />
            <h3 className="text-xs font-bold text-foreground uppercase">
              Informasi Penerimaan
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Kode RI */}
            <div className="space-y-2">
              <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                Kode Receive Item <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <PackageCheck className="w-4 h-4 text-muted-foreground shrink-0" />
                <Input
                  value={riKode}
                  onChange={(e) => setRiKode(e.target.value)}
                  placeholder="RI-XXX-0001"
                  className="h-10 font-bold text-sm"
                />
              </div>
            </div>

            {/* PIC */}
            <div className="space-y-2">
              <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                PIC / Penerima
              </Label>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex h-10 w-full items-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground">
                  {userProfile?.nama || "-"}
                </div>
              </div>
            </div>

            {/* Tanggal */}
            <div className="space-y-2">
              <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                Tanggal Penerimaan <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                <DatePickerString
                  value={riTanggal}
                  onChange={setRiTanggal}
                  className="h-10 font-bold text-sm"
                />
              </div>
            </div>

            {/* Approval Template */}
            <div className="space-y-2">
              <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                Template Approval <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <Select
                  value={selectedTemplateId}
                  onValueChange={setSelectedTemplateId}
                >
                  <SelectTrigger className="h-10 font-bold text-xs">
                    <SelectValue placeholder="Pilih template approval" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.length === 0 ? (
                      <SelectItem value="__no_template__" disabled>
                        Template Receive Item belum tersedia
                      </SelectItem>
                    ) : (
                      templates.map((template) => (
                        <SelectItem
                          key={template.id}
                          value={String(template.id)}
                        >
                          {template.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* PO Selection */}
            <div className="space-y-2">
              <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                Purchase Order <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-muted-foreground shrink-0" />
                <Popover open={poPopoverOpen} onOpenChange={setPoPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="flex-1 justify-start gap-2 h-10 font-bold text-xs"
                    >
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      {selectedPo ? (
                        <span className="text-foreground">
                          {selectedPo.po_kode}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Cari Kode PO...
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96 p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Cari kode PO..."
                        value={poSearch}
                        onValueChange={setPoSearch}
                      />
                      <CommandList>
                        {loading ? (
                          <div className="py-6 flex items-center justify-center">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : pos.length === 0 ? (
                          <CommandEmpty>
                            Tidak ada PO approved yang belum selesai diterima.
                          </CommandEmpty>
                        ) : (
                          pos.map((po) => (
                            <CommandItem
                              key={po.id}
                              value={po.po_kode}
                              onSelect={() => handleSelectPO(po)}
                              className="gap-3 py-3"
                            >
                              <ShoppingCart className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-xs uppercase">
                                  {po.po_kode}
                                </p>
                                <p className="text-[9px] text-muted-foreground font-medium uppercase">
                                  {po.prs?.cabang?.nama_cabang}
                                </p>
                              </div>
                              <Badge
                                variant="outline"
                                className="text-[9px] font-bold shrink-0 capitalize"
                              >
                                {po.po_receive_status}
                              </Badge>
                            </CommandItem>
                          ))
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Keterangan */}
            <div className="md:col-span-2 space-y-2">
              <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                Keterangan
              </Label>
              <Textarea
                value={riKeterangan}
                onChange={(e) => setRiKeterangan(e.target.value)}
                placeholder="Catatan penerimaan, kondisi barang, dll..."
                className="resize-none min-h-16 font-medium text-sm"
              />
            </div>
          </div>
        </div>
      </Content>

      {/* Section 2: Items */}
      {selectedPo && (
        <Content>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-4 w-1 bg-primary rounded-full" />
                <h3 className="text-xs font-bold text-foreground uppercase">
                  Daftar Item yang Diterima
                </h3>
              </div>
              {items.length > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[10px] font-bold gap-1"
                >
                  <Package className="h-3 w-3" />
                  {totalItemsToReceive} / {items.length} item aktif
                </Badge>
              )}
            </div>

            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                <AlertCircle className="h-8 w-8 opacity-30" />
                <p className="text-xs font-medium">
                  Semua item pada PO ini sudah diterima penuh.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <AlertCircle className="h-4 w-4 text-primary shrink-0" />
                  <p className="text-[10px] font-bold text-primary uppercase">
                    Set qty menjadi 0 untuk melewati item tersebut. Qty tidak
                    boleh melebihi sisa yang belum diterima.
                  </p>
                </div>

                <div className="rounded-xl border border-border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow className="h-10 hover:bg-transparent">
                        <TableHead className="text-[9px] font-black uppercase text-muted-foreground pl-4">
                          Part No.
                        </TableHead>
                        <TableHead className="text-[9px] font-black uppercase text-muted-foreground">
                          Nama Barang
                        </TableHead>
                        <TableHead className="text-[9px] font-black uppercase text-muted-foreground text-center w-20">
                          Qty PO
                        </TableHead>
                        <TableHead className="text-[9px] font-black uppercase text-muted-foreground text-center w-24">
                          Sudah Terima
                        </TableHead>
                        <TableHead className="text-[9px] font-black uppercase text-muted-foreground text-center w-20">
                          Sisa
                        </TableHead>
                        <TableHead className="text-[9px] font-black uppercase text-muted-foreground w-32 pr-4">
                          Qty Diterima
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, idx) => (
                        <TableRow
                          key={idx}
                          className="border-b border-border/50 hover:bg-muted/20"
                        >
                          <TableCell className="pl-4 py-3 align-top">
                            <span className="text-[11px] font-black text-foreground font-mono uppercase">
                              {item.part_number}
                            </span>
                          </TableCell>
                          <TableCell className="py-3 align-top max-w-45">
                            <span className="text-[10px] font-medium text-muted-foreground uppercase leading-snug wrap-break-word whitespace-normal">
                              {item.part_name}
                            </span>
                            {item.vendor_name && (
                              <p className="text-[9px] text-muted-foreground/60 font-medium mt-0.5">
                                {item.vendor_name}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-center py-3">
                            <span className="text-xs font-bold">
                              {item.qty_po}{" "}
                              <span className="text-muted-foreground font-medium text-[10px]">
                                {item.satuan}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="text-center py-3">
                            <span
                              className={
                                item.qty_received > 0
                                  ? "text-xs font-bold text-amber-600"
                                  : "text-xs font-bold text-muted-foreground"
                              }
                            >
                              {item.qty_received}
                            </span>
                          </TableCell>
                          <TableCell className="text-center py-3">
                            <span className="text-xs font-bold text-primary">
                              {item.qty_sisa}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 pr-4 align-middle">
                            <div className="flex items-center h-8 rounded-md border border-input bg-background overflow-hidden focus-within:ring-1 focus-within:ring-ring">
                              <input
                                type="text"
                                inputMode="numeric"
                                className="flex-1 h-full px-2 text-xs font-bold bg-transparent outline-none text-center"
                                value={
                                  item.qty_receive === 0 ? "" : item.qty_receive
                                }
                                onChange={(e) => {
                                  const raw = e.target.value.replace(
                                    /[^0-9]/g,
                                    "",
                                  );
                                  updateQty(idx, raw ? parseInt(raw, 10) : 0);
                                }}
                                placeholder="0"
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    className="gap-2 font-bold text-xs uppercase px-6 h-10"
                    onClick={handleSubmit}
                    disabled={
                      submitting || !riKode.trim() || totalItemsToReceive === 0
                    }
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Menyimpan...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Simpan & Ajukan Approval
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Content>
      )}
    </>
  );
}
