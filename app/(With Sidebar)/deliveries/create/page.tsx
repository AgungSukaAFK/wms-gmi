"use client";

import React, { useState, useEffect, useMemo } from "react";
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
  Plus,
  Trash2,
  Signature,
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
import { createDelivery } from "@/services/inventory-actions";
import { cn, toYmdLocal } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SignatureSelector } from "@/components/delivery/signature-selector";
import { DatePickerString } from "@/components/date-picker-string";

interface DeliveryItem {
  mr_item_id?: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty_on_delivery: number;
}

export default function CreateDeliveryPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // User & Data State
  const [userProfile, setUserProfile] = useState<any>(null);
  const [shareStocks, setShareStocks] = useState<any[]>([]);
  const [cabangs, setCabangs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  // Form State
  const [dlvKode, setDlvKode] = useState("");
  const [dlvTanggal, setDlvTanggal] = useState(toYmdLocal());
  const [dariCabang, setDariCabang] = useState<number | null>(null);
  const [keCabang, setKeCabang] = useState<number | null>(null);
  // Shipment type
  const [shipmentType, setShipmentType] = useState<
    "handcarry_internal" | "handcarry_eksternal" | "ekspedisi"
  >("ekspedisi");
  const [senderName, setSenderName] = useState("");
  const [eksternalProvider, setEksternalProvider] = useState("");
  const [eksternalId, setEksternalId] = useState("");
  const [ekspedisiCourier, setEkspedisiCourier] = useState("");
  const [jumlahKoli, setJumlahKoli] = useState(1);
  const [picUid, setPicUid] = useState<string>("");
  const [receiverUid, setReceiverUid] = useState<string>("");
  const [senderSignatureId, setSenderSignatureId] = useState<string>("");
  const [noResi, setNoResi] = useState("");

  // Delivery Items
  const [deliveryItems, setDeliveryItems] = useState<DeliveryItem[]>([]);

  // MR Selector
  const [selectedMrId, setSelectedMrId] = useState<number | null>(null);
  const [mrSearch, setMrSearch] = useState("");
  const [mrPopoverOpen, setMrPopoverOpen] = useState(false);
  const [debouncedMrSearch] = useDebounce(mrSearch, 300);

  // Share Stock Selection Search
  const [shareStockSearch, setShareStockSearch] = useState("");
  const [debouncedShareStockSearch] = useDebounce(shareStockSearch, 300);
  const [shareStockPopoverOpen, setShareStockPopoverOpen] = useState(false);

  // User Selectors
  const [picSearch, setPicSearch] = useState("");
  const [debouncedPicSearch] = useDebounce(picSearch, 300);
  const [picPopoverOpen, setPicPopoverOpen] = useState(false);

  const [receiverSearch, setReceiverSearch] = useState("");
  const [debouncedReceiverSearch] = useDebounce(receiverSearch, 300);
  const [receiverPopoverOpen, setReceiverPopoverOpen] = useState(false);

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
      setPicUid(user.id);
      setDariCabang(profile.cabang_id);
    }

    // Fetch cabangs
    const { data: cabangData } = await supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang");
    setCabangs(cabangData || []);

    // Fetch all active users
    const { data: usersData } = await supabase
      .from("profiles")
      .select("id, nama, cabang_id, cabang(nama_cabang)")
      .eq("is_active", true)
      .order("nama");
    setUsers(usersData || []);

    // Fetch approved share stocks with mr info
    const { data: ssData } = await supabase
      .from("mr_items")
      .select(
        "*, barang(part_number, part_name, part_satuan), mrs!inner(id, mr_kode, mr_status, cabang_id, cabang(nama_cabang)), mr_sharestock_allocations(id, source_cabang_id, qty, source_cabang:cabang(nama_cabang))",
      )
      .gt("qty_sharestock_total", 0)
      .in("ss_status", ["open", "approved"])
      .eq("mrs.mr_status", "approved");
    setShareStocks(ssData || []);

    setInitialLoading(false);
  };

  const handleAddShareStock = async (mrItem: any) => {
    // Find the allocation where current branch is the source/supplier
    const myAllocation = (mrItem.mr_sharestock_allocations as any[])?.find(
      (a) => a.source_cabang_id === dariCabang,
    );
    if (dariCabang && !myAllocation) {
      toast.error(
        "Cabang Anda tidak terdaftar sebagai pengirim untuk item ini.",
      );
      return;
    }

    const existing = deliveryItems.find((i) => i.mr_item_id === mrItem.id);
    if (existing) {
      toast.error("Item sudah ditambahkan ke delivery");
      return;
    }

    // Check available qty at THIS branch (source/supplier), not the requester's branch
    const { data: stock } = await supabase
      .from("stock")
      .select("qty")
      .eq("part_id", mrItem.part_id)
      .eq("cabang_id", dariCabang)
      .maybeSingle();

    const sourceName = userProfile?.cabang?.nama_cabang ?? "cabang Anda";
    if (!stock || stock.qty <= 0) {
      toast.error(
        `Stok ${mrItem.barang.part_name} tidak tersedia di ${sourceName}`,
      );
      return;
    }

    const maxQty = Math.min(
      stock.qty,
      myAllocation?.qty ?? mrItem.qty_sharestock_total,
    );

    setDeliveryItems([
      ...deliveryItems,
      {
        mr_item_id: mrItem.id,
        part_id: mrItem.part_id,
        part_number: mrItem.barang.part_number,
        part_name: mrItem.barang.part_name,
        satuan: mrItem.barang.part_satuan,
        qty_on_delivery: Math.min(maxQty, 1),
      },
    ]);

    setShareStockPopoverOpen(false);
  };

  // Group shareStocks by MR — only show MRs that have allocations from current source cabang
  const uniqueMrs = useMemo(() => {
    const map = new Map<number, any>();
    for (const ss of shareStocks) {
      if (!ss.mrs || !ss.mr_id) continue;
      const hasAlloc =
        !dariCabang ||
        (ss.mr_sharestock_allocations as any[])?.some(
          (a) => a.source_cabang_id === dariCabang,
        );
      if (!hasAlloc) continue;
      if (!map.has(ss.mr_id)) {
        map.set(ss.mr_id, {
          ...ss.mrs,
          id: ss.mr_id,
          items: [],
        });
      }
      map.get(ss.mr_id).items.push(ss);
    }
    return Array.from(map.values());
  }, [shareStocks, dariCabang]);

  const selectedMr = uniqueMrs.find((m) => m.id === selectedMrId) ?? null;

  const handleSelectMR = (mr: any) => {
    setSelectedMrId(mr.id);
    // Auto-fill destination cabang
    setKeCabang(mr.cabang_id);
    setMrPopoverOpen(false);
    setMrSearch("");

    // Pre-populate items from this MR for current source cabang
    const newItems: DeliveryItem[] = [];
    for (const mrItem of mr.items as any[]) {
      if (deliveryItems.find((i) => i.mr_item_id === mrItem.id)) continue;
      const myAlloc = (mrItem.mr_sharestock_allocations as any[])?.find(
        (a) => a.source_cabang_id === dariCabang,
      );
      if (!myAlloc) continue;
      newItems.push({
        mr_item_id: mrItem.id,
        part_id: mrItem.part_id,
        part_number: mrItem.barang.part_number,
        part_name: mrItem.barang.part_name,
        satuan: mrItem.barang.part_satuan,
        qty_on_delivery: myAlloc.qty,
      });
    }

    setDeliveryItems((prev) => [
      ...prev.filter(
        (i) => !newItems.find((n) => n.mr_item_id === i.mr_item_id),
      ),
      ...newItems,
    ]);

    if (newItems.length > 0) {
      toast.success(`${newItems.length} item dari ${mr.mr_kode} ditambahkan`);
    } else {
      toast.error(
        "Tidak ada item dari MR ini yang dialokasikan untuk cabang Anda",
      );
    }
  };

  const handleRemoveItem = (index: number) => {
    setDeliveryItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateItemQty = (index: number, qty: number) => {
    setDeliveryItems((prev) => {
      const newItems = [...prev];
      newItems[index].qty_on_delivery = Math.max(1, qty);
      return newItems;
    });
  };

  const handleSave = async () => {
    // Validation
    if (!dlvKode) return toast.error("Kode Delivery harus diisi");
    if (!dariCabang) return toast.error("Cabang asal harus dipilih");
    if (!keCabang) return toast.error("Cabang tujuan harus dipilih");
    if (dariCabang === keCabang)
      return toast.error("Cabang asal dan tujuan tidak boleh sama");
    if (shipmentType === "ekspedisi" && !ekspedisiCourier)
      return toast.error("Pilih kurir ekspedisi");
    if (shipmentType === "handcarry_eksternal" && !eksternalProvider)
      return toast.error("Pilih layanan handcarry eksternal");
    if (!picUid) return toast.error("PIC harus dipilih");
    if (!receiverUid) return toast.error("Penerima harus dipilih");
    if (!senderSignatureId)
      return toast.error("Tanda tangan pengirim harus ada");
    if (deliveryItems.length === 0)
      return toast.error("Tidak ada item delivery");

    setLoading(true);
    try {
      const result = await createDelivery({
        dlv_kode: dlvKode,
        dari_cabang_id: dariCabang,
        ke_cabang_id: keCabang,
        shipment_type: shipmentType,
        ekspedisi:
          shipmentType === "ekspedisi"
            ? ekspedisiCourier
            : shipmentType === "handcarry_eksternal"
              ? eksternalProvider
              : "Handcarry Internal",
        sender_name:
          shipmentType === "handcarry_internal"
            ? senderName || undefined
            : undefined,
        eksternal_provider:
          shipmentType === "handcarry_eksternal"
            ? eksternalProvider || undefined
            : undefined,
        eksternal_id:
          shipmentType === "handcarry_eksternal"
            ? eksternalId || undefined
            : undefined,
        no_resi: shipmentType === "ekspedisi" ? noResi || undefined : undefined,
        jumlah_koli: jumlahKoli,
        uid_pic: picUid,
        uid_receiver: receiverUid,
        signature_sender_id: senderSignatureId,
        items: deliveryItems,
      });

      if (result.success) {
        toast.success("Delivery berhasil dibuat");
        router.push("/deliveries");
      } else {
        toast.error(result.error || "Gagal membuat delivery");
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

  const picName = users.find((u) => u.id === picUid)?.nama;
  const receiverName = users.find((u) => u.id === receiverUid)?.nama;

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
              className="h-8 w-8 rounded-full"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                BUAT DELIVERY
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Inter-Warehouse Transfer
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1 w-full md:w-auto">
            <Label className="text-[10px] font-semibold uppercase text-muted-foreground px-1">
              Nomor Delivery
            </Label>
            <Input
              placeholder="Masukkan nomor delivery (manual)"
              className="h-10 w-full bg-muted/40 border-input rounded-md font-bold text-sm uppercase text-primary md:w-70"
              value={dlvKode}
              onChange={(e) => setDlvKode(e.target.value)}
            />
          </div>
        </div>
      </Content>

      {/* Section 2: Form Fields */}
      <Content>
        {/* MR Selector — full width, above main grid */}
        <div className="mb-6 space-y-1.5">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
            <FileText className="h-3 w-3" /> Berdasarkan Material Request
            <span className="text-muted-foreground/50 font-medium normal-case">
              (opsional — auto-isi tujuan & item)
            </span>
          </Label>
          <Popover open={mrPopoverOpen} onOpenChange={setMrPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="h-10 w-full justify-start font-bold text-sm border-input bg-muted/40 rounded-lg gap-2 text-left"
              >
                {selectedMr ? (
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    <Badge className="text-[9px] font-black uppercase shrink-0 bg-primary/10 text-primary border-0">
                      {selectedMr.mr_kode}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-medium truncate">
                      → {selectedMr.cabang?.nama_cabang}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60 font-medium ml-auto shrink-0">
                      {selectedMr.items?.length} item
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground font-medium text-sm">
                    Pilih MR yang sudah disetujui...
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[calc(100vw-2rem)] max-w-lg p-0 rounded-xl border border-border shadow-xl overflow-hidden">
              <div className="p-2 border-b border-border bg-muted/40">
                <Input
                  placeholder="Cari kode MR atau cabang tujuan..."
                  className="h-9 bg-background border-input rounded-md text-xs font-medium"
                  value={mrSearch}
                  onChange={(e) => setMrSearch(e.target.value)}
                />
              </div>
              {uniqueMrs.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-xs font-bold text-muted-foreground/60 uppercase">
                    {dariCabang
                      ? "Tidak ada MR dengan alokasi dari cabang ini"
                      : "Pilih cabang asal terlebih dahulu"}
                  </p>
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto p-1.5 bg-background">
                  {uniqueMrs
                    .filter((mr) => {
                      const kw = debouncedMrSearch.toLowerCase();
                      return (
                        mr.mr_kode?.toLowerCase().includes(kw) ||
                        mr.cabang?.nama_cabang?.toLowerCase().includes(kw)
                      );
                    })
                    .map((mr) => (
                      <button
                        key={mr.id}
                        onClick={() => handleSelectMR(mr)}
                        className="w-full text-left p-3 rounded-lg hover:bg-muted transition-all flex items-center justify-between group mb-1"
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-xs uppercase tracking-tight text-foreground">
                              {mr.mr_kode}
                            </span>
                            <Badge
                              variant="secondary"
                              className="text-[8px] font-bold uppercase h-4 px-1.5"
                            >
                              {mr.items?.length} item
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                            <Building2 className="h-3 w-3" />
                            <span>
                              {cabangs.find((c) => c.id === dariCabang)
                                ?.nama_cabang ?? "Cabang Anda"}
                            </span>
                            <ArrowRight className="h-2.5 w-2.5" />
                            <span className="font-bold text-primary">
                              {mr.cabang?.nama_cabang}
                            </span>
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-all" />
                      </button>
                    ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Column 1: Lokasi & Pic */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                <Building2 className="h-3 w-3" /> Cabang Asal
              </Label>
              <Select
                value={dariCabang?.toString()}
                onValueChange={(val) => setDariCabang(parseInt(val))}
              >
                <SelectTrigger className="h-10 font-bold text-sm border-input bg-muted/40 focus:bg-background rounded-lg">
                  <SelectValue placeholder="Pilih cabang asal..." />
                </SelectTrigger>
                <SelectContent className="rounded-md">
                  {cabangs.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.nama_cabang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                <Building2 className="h-3 w-3" /> Cabang Tujuan
                {selectedMr && (
                  <Badge className="text-[8px] font-bold bg-primary/10 text-primary border-0 ml-1">
                    dari MR
                  </Badge>
                )}
              </Label>
              <Select
                value={keCabang?.toString()}
                onValueChange={(val) => setKeCabang(parseInt(val))}
              >
                <SelectTrigger className="h-10 font-bold text-sm border-input bg-muted/40 focus:bg-background rounded-lg">
                  <SelectValue placeholder="Pilih cabang tujuan..." />
                </SelectTrigger>
                <SelectContent className="rounded-md">
                  {cabangs.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.nama_cabang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Column 2: Tanggal & Ekspedisi */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                <CalendarIcon className="h-3 w-3" /> Tanggal Pengiriman
              </Label>
              <DatePickerString
                className="h-10 font-bold text-sm border-input bg-muted/40 focus:bg-background rounded-lg"
                value={dlvTanggal}
                onChange={setDlvTanggal}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                <Truck className="h-3 w-3" /> Jenis Pengiriman
              </Label>
              <Select
                value={shipmentType}
                onValueChange={(v) =>
                  setShipmentType(
                    v as
                      | "handcarry_internal"
                      | "handcarry_eksternal"
                      | "ekspedisi",
                  )
                }
              >
                <SelectTrigger className="h-10 font-bold text-sm border-input bg-muted/40 focus:bg-background rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="handcarry_internal"
                    className="font-bold text-xs"
                  >
                    🚶 Handcarry Internal
                  </SelectItem>
                  <SelectItem
                    value="handcarry_eksternal"
                    className="font-bold text-xs"
                  >
                    🛵 Handcarry Eksternal
                  </SelectItem>
                  <SelectItem value="ekspedisi" className="font-bold text-xs">
                    📦 Ekspedisi
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Column 3: Submit Box */}
          <div className="flex items-end">
            <div className="w-full bg-foreground rounded-xl p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                <span className="text-xs font-bold text-background uppercase tracking-tight">
                  Simpan Delivery
                </span>
              </div>
              <p className="text-[10px] text-background/50 font-medium">
                Pastikan item dan lokasi sudah benar sebelum menyimpan.
              </p>
              <Button
                className="w-full h-11 bg-background text-foreground hover:bg-background/90 font-bold text-xs uppercase gap-2 transition-all active:scale-95 rounded-lg mt-1"
                onClick={handleSave}
                disabled={
                  loading || deliveryItems.length === 0 || !senderSignatureId
                }
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> SIMPAN DELIVERY
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </Content>

      {/* Section 3: PIC, Receiver & Additional */}
      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* PIC User Selector */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
              <User className="h-3 w-3" /> Penanggung Jawab (PIC)
            </Label>
            <Popover open={picPopoverOpen} onOpenChange={setPicPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 w-full text-left justify-start font-bold text-sm border-input bg-muted/40 rounded-lg"
                >
                  {picName || "Pilih PIC..."}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 rounded-xl border border-border shadow-xl overflow-hidden">
                <div className="p-2 border-b border-border bg-muted/40">
                  <Input
                    placeholder="Cari user..."
                    className="h-9 bg-background border-input rounded-md text-xs font-medium"
                    value={picSearch}
                    onChange={(e) => setPicSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-62.5 overflow-y-auto p-1.5 bg-background">
                  {users
                    .filter((u) =>
                      u.nama
                        .toLowerCase()
                        .includes(debouncedPicSearch.toLowerCase()),
                    )
                    .map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setPicUid(u.id);
                          setPicPopoverOpen(false);
                          setPicSearch("");
                        }}
                        className="w-full text-left p-3 rounded-lg transition-all flex items-center justify-between group mb-1 hover:bg-muted text-foreground"
                      >
                        <div className="flex flex-col">
                          <span className="font-bold text-xs uppercase tracking-tight">
                            {u.nama}
                          </span>
                          <span className="text-[9px] opacity-60">
                            {u.cabang?.nama_cabang || "No Cabang"}
                          </span>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-all" />
                      </button>
                    ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Receiver User Selector */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
              <User className="h-3 w-3" /> Penerima Delivery
            </Label>
            <Popover
              open={receiverPopoverOpen}
              onOpenChange={setReceiverPopoverOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 w-full text-left justify-start font-bold text-sm border-input bg-muted/40 rounded-lg"
                >
                  {receiverName || "Pilih Penerima..."}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 rounded-xl border border-border shadow-xl overflow-hidden">
                <div className="p-2 border-b border-border bg-muted/40">
                  <Input
                    placeholder="Cari user..."
                    className="h-9 bg-background border-input rounded-md text-xs font-medium"
                    value={receiverSearch}
                    onChange={(e) => setReceiverSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-62.5 overflow-y-auto p-1.5 bg-background">
                  {users
                    .filter((u) =>
                      u.nama
                        .toLowerCase()
                        .includes(debouncedReceiverSearch.toLowerCase()),
                    )
                    .map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setReceiverUid(u.id);
                          setReceiverPopoverOpen(false);
                          setReceiverSearch("");
                        }}
                        className="w-full text-left p-3 rounded-lg transition-all flex items-center justify-between group mb-1 hover:bg-muted text-foreground"
                      >
                        <div className="flex flex-col">
                          <span className="font-bold text-xs uppercase tracking-tight">
                            {u.nama}
                          </span>
                          <span className="text-[9px] opacity-60">
                            {u.cabang?.nama_cabang || "No Cabang"}
                          </span>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-all" />
                      </button>
                    ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Signature Selector */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
              <Signature className="h-3 w-3" /> Tanda Tangan Pengirim
            </Label>
            <SignatureSelector
              value={senderSignatureId}
              onChange={setSenderSignatureId}
            />
          </div>

          {/* Shipment type-specific fields */}
          {shipmentType === "handcarry_internal" && (
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                <User className="h-3 w-3" /> Nama Pengirim
              </Label>
              <Input
                placeholder="Nama kurir/pengirim internal..."
                className="h-10 font-bold text-sm border-input bg-muted/40 rounded-lg"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
              />
            </div>
          )}

          {shipmentType === "handcarry_eksternal" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                  <Truck className="h-3 w-3" /> Layanan
                </Label>
                <Select
                  value={eksternalProvider}
                  onValueChange={setEksternalProvider}
                >
                  <SelectTrigger className="h-10 font-bold text-sm border-input bg-muted/40 rounded-lg">
                    <SelectValue placeholder="Pilih layanan..." />
                  </SelectTrigger>
                  <SelectContent>
                    {["Gojek", "Grab", "Maxim", "Lalamove"].map((p) => (
                      <SelectItem
                        key={p}
                        value={p}
                        className="font-bold text-xs"
                      >
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                  <FileText className="h-3 w-3" /> ID Pengiriman
                </Label>
                <Input
                  placeholder="Order ID / kode booking..."
                  className="h-10 font-bold text-sm border-input bg-muted/40 rounded-lg"
                  value={eksternalId}
                  onChange={(e) => setEksternalId(e.target.value)}
                />
              </div>
            </>
          )}

          {shipmentType === "ekspedisi" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                  <Truck className="h-3 w-3" /> Kurir
                </Label>
                <Select
                  value={ekspedisiCourier}
                  onValueChange={setEkspedisiCourier}
                >
                  <SelectTrigger className="h-10 font-bold text-sm border-input bg-muted/40 rounded-lg">
                    <SelectValue placeholder="Pilih kurir..." />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "NE",
                      "J&T Express",
                      "SiCepat",
                      "Pos Indonesia",
                      "Anteraja",
                      "TIKI",
                      "Lion Parcel",
                      "Ninja Xpress",
                      "Wahana",
                      "SAP Express",
                    ].map((c) => (
                      <SelectItem
                        key={c}
                        value={c}
                        className="font-bold text-xs"
                      >
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
                  <FileText className="h-3 w-3" /> Nomor Resi
                </Label>
                <Input
                  placeholder="Nomor resi / tracking..."
                  className="h-10 font-bold text-sm border-input bg-muted/40 rounded-lg"
                  value={noResi}
                  onChange={(e) => setNoResi(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Jumlah Koli */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5 px-0.5">
              <Package className="h-3 w-3" /> Jumlah Koli
            </Label>
            <Input
              type="number"
              min="1"
              className="h-10 font-bold text-sm border-input bg-muted/40 rounded-lg"
              value={jumlahKoli}
              onChange={(e) =>
                setJumlahKoli(Math.max(1, parseInt(e.target.value)))
              }
            />
          </div>
        </div>
      </Content>

      {/* Section 4: Items Selection */}
      <Content>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 bg-primary rounded-full" />
              <h3 className="text-xs font-bold text-foreground uppercase">
                Pilih Item Share Stock
              </h3>
              {selectedMr && (
                <Badge className="text-[9px] font-black bg-primary/10 text-primary border-0">
                  {selectedMr.mr_kode}
                </Badge>
              )}
            </div>
            <Popover
              open={shareStockPopoverOpen}
              onOpenChange={setShareStockPopoverOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 font-bold text-xs h-8"
                >
                  <Plus className="h-3 w-3" /> Tambah Item
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[calc(100vw-2rem)] max-w-112.5 p-0 rounded-xl border border-border shadow-xl overflow-hidden">
                <div className="p-2 border-b border-border bg-muted/40">
                  <Input
                    placeholder="Cari item share stock..."
                    className="h-9 bg-background border-input rounded-md text-xs font-medium"
                    value={shareStockSearch}
                    onChange={(e) => setShareStockSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-62.5 overflow-y-auto p-1.5 text-sm bg-background">
                  {shareStocks
                    .filter((ss) => {
                      const matchesSource =
                        !dariCabang ||
                        (ss.mr_sharestock_allocations as any[])?.some(
                          (a) => a.source_cabang_id === dariCabang,
                        );
                      const keyword = debouncedShareStockSearch.toLowerCase();
                      const matchesSearch =
                        ss.barang.part_number.toLowerCase().includes(keyword) ||
                        ss.barang.part_name.toLowerCase().includes(keyword);

                      return matchesSource && matchesSearch;
                    })
                    .map((ss) => (
                      <button
                        key={ss.id}
                        onClick={() => handleAddShareStock(ss)}
                        className="w-full text-left p-3 rounded-lg transition-all flex items-center justify-between group mb-1 hover:bg-muted text-foreground"
                      >
                        <div className="flex flex-col">
                          <span className="font-bold text-xs uppercase tracking-tight">
                            {ss.barang.part_number} - {ss.barang.part_name}
                          </span>
                          <span className="text-[9px] uppercase font-medium mt-1 opacity-60">
                            Qty:{" "}
                            {(ss.mr_sharestock_allocations as any[])?.find(
                              (a) => a.source_cabang_id === dariCabang,
                            )?.qty ?? ss.qty_sharestock_total}{" "}
                            {ss.barang.part_satuan}
                            {" | Tujuan: "} {ss.mrs.cabang.nama_cabang}
                          </span>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-all" />
                      </button>
                    ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {deliveryItems.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-12 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-xs font-bold text-muted-foreground/50 uppercase">
                Tidak ada item ditambahkan
              </p>
            </div>
          ) : (
            <div className="border border-border rounded-xl overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="hover:bg-transparent h-10">
                    <TableHead className="text-[9px] font-bold uppercase text-muted-foreground pl-4">
                      Part Info
                    </TableHead>
                    <TableHead className="text-[9px] font-bold uppercase text-muted-foreground">
                      Nama Barang
                    </TableHead>
                    <TableHead className="text-[9px] font-bold uppercase text-muted-foreground text-center">
                      Qty
                    </TableHead>
                    <TableHead className="text-[9px] font-bold uppercase text-muted-foreground text-center w-20">
                      Satuan
                    </TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveryItems.map((item, idx) => (
                    <TableRow
                      key={idx}
                      className="hover:bg-muted/30 border-b border-border/50 h-14"
                    >
                      <TableCell className="pl-4 font-mono text-[10px] font-bold text-muted-foreground uppercase">
                        {item.part_number}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-bold text-foreground uppercase">
                          {item.part_name}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number"
                          min="1"
                          className="h-8 w-16 text-center font-bold text-sm border-input"
                          value={item.qty_on_delivery}
                          onChange={(e) =>
                            handleUpdateItemQty(idx, parseInt(e.target.value))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-center font-bold text-[10px] text-muted-foreground uppercase">
                        {item.satuan}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive rounded-md"
                          onClick={() => handleRemoveItem(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </Content>
    </>
  );
}
