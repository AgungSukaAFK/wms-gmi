"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ArrowLeftRight,
  Building2,
  Truck,
  Calendar as CalendarIcon,
  Search,
  Plus,
  Trash2,
  Loader2,
  ShieldCheck,
  Package,
  User,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { createTransferItem } from "@/services/transfer-actions";

interface TIItem {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  avail: number;
}

export default function CreateTransferItemPage() {
  const supabase = createClient();
  const router = useRouter();

  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [cabangs, setCabangs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  // PIC & Penerima (mengikuti Delivery)
  const [picUid, setPicUid] = useState<string>("");
  const [receiverUid, setReceiverUid] = useState<string>("");
  const [picSearch, setPicSearch] = useState("");
  const [receiverSearch, setReceiverSearch] = useState("");
  const [debouncedPicSearch] = useDebounce(picSearch, 300);
  const [debouncedReceiverSearch] = useDebounce(receiverSearch, 300);
  const [picPopoverOpen, setPicPopoverOpen] = useState(false);
  const [receiverPopoverOpen, setReceiverPopoverOpen] = useState(false);

  // Form
  const [tiKode, setTiKode] = useState("");
  const [tiTanggal, setTiTanggal] = useState(toYmdLocal());
  const [keCabang, setKeCabang] = useState<number | null>(null);
  const [items, setItems] = useState<TIItem[]>([]);
  const [remarks, setRemarks] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Shipment
  const [shipmentType, setShipmentType] = useState<
    "handcarry_internal" | "handcarry_eksternal" | "ekspedisi"
  >("ekspedisi");
  const [senderName, setSenderName] = useState("");
  const [eksternalProvider, setEksternalProvider] = useState("");
  const [eksternalId, setEksternalId] = useState("");
  const [ekspedisiCourier, setEkspedisiCourier] = useState("");
  const [jumlahKoli, setJumlahKoli] = useState(1);
  const [noResi, setNoResi] = useState("");
  const [estimasiHari, setEstimasiHari] = useState(5);

  // Item search
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [results, setResults] = useState<any[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // Signature
  const [isSignatureOpen, setIsSignatureOpen] = useState(false);

  useEffect(() => {
    const init = async () => {
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
        .select("*, cabang(id, nama_cabang)")
        .eq("id", user.id)
        .single();
      setUserProfile(profile);

      const { data: cabangData } = await supabase
        .from("cabang")
        .select("id, nama_cabang")
        .eq("is_active", true)
        .order("nama_cabang");
      setCabangs((cabangData || []).filter((c: any) => c.id !== profile?.cabang_id));

      const { data: usersData } = await supabase
        .from("profiles")
        .select("id, nama, cabang_id, cabang(nama_cabang)")
        .eq("is_active", true)
        .order("nama");
      setUsers(usersData || []);

      if (profile) {
        const { data: tpl } = await supabase
          .from("approval_templates")
          .select("*, steps:approval_template_steps(*, profiles(nama, email))")
          .eq("type", "Item Transfer")
          .or(`cabang_id.eq.${profile.cabang_id},cabang_id.is.null`)
          .order("name");
        setTemplates(tpl || []);
        if (tpl && tpl.length > 0) setSelectedTemplateId(tpl[0].id.toString());
      }
      setInitialLoading(false);
    };
    init();
  }, []);

  // Search barang
  useEffect(() => {
    if (!searchOpen) return;
    const run = async () => {
      let q = supabase.from("barang").select("*").order("part_name").limit(15);
      if (debouncedSearch)
        q = q.or(
          `part_number.ilike.%${debouncedSearch}%,part_name.ilike.%${debouncedSearch}%`,
        );
      const { data } = await q;
      setResults(data || []);
    };
    run();
  }, [debouncedSearch, searchOpen]);

  const addItem = async (barang: any) => {
    if (items.some((i) => i.part_id === barang.id)) return;
    if (!userProfile?.cabang_id) {
      toast.error("Cabang asal tidak diketahui.");
      return;
    }
    // Ambil stok PN ini di gudang asal
    const { data: stock } = await supabase
      .from("stock")
      .select("qty")
      .eq("part_id", barang.id)
      .eq("cabang_id", userProfile.cabang_id)
      .maybeSingle();
    const avail = stock?.qty ?? 0;
    if (avail <= 0) {
      toast.error(
        `Stok ${barang.part_number} di gudang Anda kosong. Tidak bisa ditransfer.`,
      );
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        part_id: barang.id,
        part_number: barang.part_number,
        part_name: barang.part_name,
        satuan: barang.part_satuan,
        qty: 1,
        avail,
      },
    ]);
    setSearchOpen(false);
    setSearch("");
  };

  const updateQty = (partId: number, qty: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.part_id === partId
          ? { ...i, qty: Math.max(1, Math.min(qty || 1, i.avail)) }
          : i,
      ),
    );
  };

  const removeItem = (partId: number) =>
    setItems((prev) => prev.filter((i) => i.part_id !== partId));

  const validate = () => {
    if (!tiKode.trim()) return "Kode Transfer Item wajib diisi.";
    if (!keCabang) return "Pilih gudang tujuan.";
    if (items.length === 0) return "Tambahkan minimal satu item.";
    if (!picUid) return "PIC harus dipilih.";
    if (!receiverUid) return "Penerima harus dipilih.";
    if (!selectedTemplateId) return "Pilih alur approval.";
    if (shipmentType === "ekspedisi" && !ekspedisiCourier.trim())
      return "Isi nama ekspedisi/kurir.";
    if (shipmentType === "handcarry_eksternal" && !eksternalProvider.trim())
      return "Pilih penyedia handcarry eksternal.";
    return null;
  };

  const handleSubmitClick = () => {
    const err = validate();
    if (err) return toast.error(err);
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
        };
      });

      const result = await createTransferItem({
        ti_kode: tiKode.trim(),
        ti_tanggal: tiTanggal,
        dari_cabang_id: userProfile.cabang_id,
        ke_cabang_id: keCabang!,
        shipment_type: shipmentType,
        ekspedisi:
          shipmentType === "ekspedisi"
            ? ekspedisiCourier
            : shipmentType === "handcarry_eksternal"
              ? eksternalProvider
              : "Handcarry Internal",
        sender_name:
          shipmentType === "handcarry_internal" ? senderName || undefined : undefined,
        eksternal_provider:
          shipmentType === "handcarry_eksternal" ? eksternalProvider || undefined : undefined,
        eksternal_id:
          shipmentType === "handcarry_eksternal" ? eksternalId || undefined : undefined,
        jumlah_koli: jumlahKoli,
        no_resi: shipmentType === "ekspedisi" ? noResi || undefined : undefined,
        estimasi_hari: estimasiHari,
        pic: picName || userProfile.nama,
        uid_pic: picUid || undefined,
        uid_receiver: receiverUid || undefined,
        remarks: remarks || undefined,
        signature_requester_id: signature.id,
        approvals: approvalData,
        items: items.map((i) => ({
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          satuan: i.satuan,
          qty: i.qty,
        })),
      });

      if (result.error) throw new Error(result.error);
      toast.success("Transfer Item berhasil dibuat");
      router.push("/transfer-item");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const selectedTemplate = templates.find(
    (t) => t.id.toString() === selectedTemplateId,
  );
  const picName = users.find((u) => u.id === picUid)?.nama;
  const receiverName = users.find((u) => u.id === receiverUid)?.nama;

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
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => router.back()}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <ArrowLeftRight className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
              Buat Transfer Item
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Pindahkan stok dari gudang Anda ke gudang lain
            </p>
          </div>
        </div>
      </Content>

      {/* Header form */}
      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Kode TI</Label>
            <Input
              placeholder="Input Kode TI..."
              value={tiKode}
              onChange={(e) => setTiKode(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Tanggal
            </Label>
            <DatePickerString value={tiTanggal} onChange={setTiTanggal} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Building2 className="h-3 w-3" /> Gudang Asal
            </Label>
            <div className="h-10 rounded-md border border-input bg-muted/40 px-3 flex items-center text-sm font-bold uppercase">
              {userProfile?.cabang?.nama_cabang || "-"}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Building2 className="h-3 w-3 text-success" /> Gudang Tujuan
            </Label>
            <Select value={keCabang?.toString()} onValueChange={(v) => setKeCabang(parseInt(v))}>
              <SelectTrigger className="h-10 text-sm font-bold">
                <SelectValue placeholder="Pilih gudang tujuan..." />
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
        </div>
      </Content>

      {/* Items */}
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
                      <span className="block text-[10px] text-muted-foreground truncate">
                        {r.part_name}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="p-6 text-center text-xs text-muted-foreground italic">
                    Barang tidak ditemukan.
                  </div>
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
                <TableHead className="w-24 text-center text-[10px] font-black uppercase text-muted-foreground">Unit</TableHead>
                <TableHead className="w-36 text-center text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                <TableHead className="w-14"></TableHead>
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
                      <div className="flex flex-col items-center gap-0.5">
                        <Input
                          type="number"
                          min={1}
                          max={item.avail}
                          value={item.qty}
                          onChange={(e) => updateQty(item.part_id, parseInt(e.target.value))}
                          className="h-8 w-20 text-center text-xs"
                        />
                        <span className="text-[9px] font-medium text-amber-600">
                          Maks {item.avail}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeItem(item.part_id)}>
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

      {/* Shipment details */}
      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Truck className="h-3 w-3" /> Jenis Pengiriman
            </Label>
            <Select
              value={shipmentType}
              onValueChange={(v) => {
                const t = v as typeof shipmentType;
                setShipmentType(t);
                setEstimasiHari(t === "ekspedisi" ? 5 : 1);
              }}
            >
              <SelectTrigger className="h-10 text-sm font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="handcarry_internal" className="text-xs font-bold">🚶 Handcarry Internal</SelectItem>
                <SelectItem value="handcarry_eksternal" className="text-xs font-bold">🛵 Handcarry Eksternal</SelectItem>
                <SelectItem value="ekspedisi" className="text-xs font-bold">📦 Ekspedisi</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {shipmentType === "ekspedisi" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                  <Truck className="h-3 w-3" /> Kurir
                </Label>
                <Select value={ekspedisiCourier} onValueChange={setEkspedisiCourier}>
                  <SelectTrigger className="h-10 text-sm font-bold">
                    <SelectValue placeholder="Pilih kurir..." />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "JNE",
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
                      <SelectItem key={c} value={c} className="font-bold text-xs">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">No. Resi</Label>
                <Input value={noResi} onChange={(e) => setNoResi(e.target.value)} placeholder="Opsional" className="h-10 text-sm" />
              </div>
            </>
          )}

          {shipmentType === "handcarry_internal" && (
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">Nama Pengantar</Label>
              <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Nama orang yg mengantar" className="h-10 text-sm" />
            </div>
          )}

          {shipmentType === "handcarry_eksternal" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Penyedia</Label>
                <Select value={eksternalProvider} onValueChange={setEksternalProvider}>
                  <SelectTrigger className="h-10 text-sm font-bold">
                    <SelectValue placeholder="Pilih penyedia" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Gojek">Gojek</SelectItem>
                    <SelectItem value="Grab">Grab</SelectItem>
                    <SelectItem value="Maxim">Maxim</SelectItem>
                    <SelectItem value="Lalamove">Lalamove</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Order / Booking ID</Label>
                <Input value={eksternalId} onChange={(e) => setEksternalId(e.target.value)} placeholder="Opsional" className="h-10 text-sm" />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Jumlah Koli</Label>
            <Input type="number" min={1} value={jumlahKoli} onChange={(e) => setJumlahKoli(Math.max(1, parseInt(e.target.value) || 1))} className="h-10 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Estimasi (Hari)
            </Label>
            <Input type="number" min={1} value={estimasiHari} onChange={(e) => setEstimasiHari(Math.max(1, parseInt(e.target.value) || 1))} className="h-10 text-sm" />
          </div>

          <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Keterangan</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Catatan tambahan (opsional)..." className="min-h-16 resize-none text-xs" />
          </div>
        </div>
      </Content>

      {/* PIC & Penerima */}
      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <User className="h-3 w-3" /> Penanggung Jawab (PIC)
            </Label>
            <Popover open={picPopoverOpen} onOpenChange={setPicPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 w-full justify-start font-bold text-sm bg-muted/40">
                  {picName || "Pilih PIC..."}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 overflow-hidden">
                <div className="p-2 border-b bg-muted/40">
                  <Input placeholder="Cari user..." className="h-9 text-xs" value={picSearch} onChange={(e) => setPicSearch(e.target.value)} />
                </div>
                <div className="max-h-62.5 overflow-y-auto p-1.5">
                  {users
                    .filter((u) => u.nama.toLowerCase().includes(debouncedPicSearch.toLowerCase()))
                    .map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setPicUid(u.id);
                          setPicPopoverOpen(false);
                          setPicSearch("");
                        }}
                        className="w-full text-left p-3 rounded-lg flex items-center justify-between group mb-1 hover:bg-muted"
                      >
                        <div className="flex flex-col">
                          <span className="font-bold text-xs uppercase">{u.nama}</span>
                          <span className="text-[9px] opacity-60">{u.cabang?.nama_cabang || "No Cabang"}</span>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                      </button>
                    ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <User className="h-3 w-3" /> Penerima
            </Label>
            <Popover open={receiverPopoverOpen} onOpenChange={setReceiverPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 w-full justify-start font-bold text-sm bg-muted/40">
                  {receiverName || "Pilih Penerima..."}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 overflow-hidden">
                <div className="p-2 border-b bg-muted/40">
                  <Input placeholder="Cari user..." className="h-9 text-xs" value={receiverSearch} onChange={(e) => setReceiverSearch(e.target.value)} />
                </div>
                <div className="max-h-62.5 overflow-y-auto p-1.5">
                  {users
                    .filter((u) => u.nama.toLowerCase().includes(debouncedReceiverSearch.toLowerCase()))
                    .map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setReceiverUid(u.id);
                          setReceiverPopoverOpen(false);
                          setReceiverSearch("");
                        }}
                        className="w-full text-left p-3 rounded-lg flex items-center justify-between group mb-1 hover:bg-muted"
                      >
                        <div className="flex flex-col">
                          <span className="font-bold text-xs uppercase">{u.nama}</span>
                          <span className="text-[9px] opacity-60">{u.cabang?.nama_cabang || "No Cabang"}</span>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                      </button>
                    ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </Content>

      {/* Approval + submit */}
      <Content>
        <div className="flex flex-col lg:flex-row justify-between gap-6">
          <div className="flex-1 space-y-1.5 max-w-full lg:max-w-125">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Alur Approval (Item Transfer)</Label>
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
                Belum ada template approval tipe &quot;Item Transfer&quot;. Minta moderator/admin membuatnya di Approval Templates.
              </p>
            )}
            {selectedTemplate && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[...(selectedTemplate.steps || [])]
                  .sort((a: any, b: any) => a.step_order - b.step_order)
                  .map((s: any) => (
                    <Badge key={s.id} variant="outline" className="text-[10px]">
                      {s.step_order}.{" "}
                      {s.approver_type === "requester"
                        ? userProfile?.nama
                        : s.profiles?.nama || "User"}
                    </Badge>
                  ))}
              </div>
            )}
          </div>

          <div className="w-full lg:w-70">
            <div className="bg-foreground p-5 rounded-lg flex flex-col items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-success" />
              <p className="text-[10px] text-background/60 text-center font-medium">
                Stok keluar dari gudang asal setelah TI disetujui penuh.
              </p>
              <Button
                className="w-full h-10 bg-background text-foreground hover:bg-muted font-bold text-sm"
                onClick={handleSubmitClick}
                disabled={loading}
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
