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
import {
  ChevronLeft,
  Truck,
  Building2,
  UsersRound,
  Calendar as CalendarIcon,
  Search,
  Plus,
  Trash2,
  Loader2,
  Package,
  User,
  ArrowRight,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import {
  type ShipmentType,
  isEkspedisi,
  defaultEstimasiHari,
} from "@/lib/shipment";
import { createDoReguler } from "@/services/do-reguler-actions";

interface DOItem {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  avail: number; // stok tersedia di gudang pengirim
}

export default function CreateDoRegulerPage() {
  const supabase = createClient();
  const router = useRouter();

  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);

  // Form
  const [doKode, setDoKode] = useState("");
  const [doTanggal, setDoTanggal] = useState(toYmdLocal());
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [kodePo, setKodePo] = useState("");
  const [items, setItems] = useState<DOItem[]>([]);
  const [remarks, setRemarks] = useState("");
  const [pic, setPic] = useState("");

  // Customer picker
  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedCustomerSearch] = useDebounce(customerSearch, 300);
  const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false);

  // Shipment
  const [shipmentType, setShipmentType] = useState<ShipmentType>("ekspedisi_laut");
  const [senderName, setSenderName] = useState("");
  const [eksternalProvider, setEksternalProvider] = useState("");
  const [eksternalId, setEksternalId] = useState("");
  const [ekspedisiCourier, setEkspedisiCourier] = useState("");
  const [jumlahKoli, setJumlahKoli] = useState(1);
  const [noResi, setNoResi] = useState("");
  const [estimasiHari, setEstimasiHari] = useState(14);

  // Item search
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [results, setResults] = useState<any[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

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

      setInitialLoading(false);
    };
    init();
  }, []);

  // Search customer (server-side, dibatasi 20 hasil — tidak get-all)
  useEffect(() => {
    if (!customerPopoverOpen) return;
    const run = async () => {
      let q = supabase
        .from("customers")
        .select("id, customer_no, customer_name")
        .eq("is_active", true)
        .order("customer_name")
        .limit(20);
      if (debouncedCustomerSearch)
        q = q.or(
          `customer_name.ilike.%${debouncedCustomerSearch}%,customer_no.ilike.%${debouncedCustomerSearch}%`,
        );
      const { data } = await q;
      setCustomers(data || []);
    };
    run();
  }, [debouncedCustomerSearch, customerPopoverOpen]);

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
      toast.error("Gudang pengirim tidak diketahui.");
      return;
    }
    // Ambil stok PN ini di gudang pengirim
    const { data: stock } = await supabase
      .from("stock")
      .select("qty")
      .eq("part_id", barang.id)
      .eq("cabang_id", userProfile.cabang_id)
      .maybeSingle();
    const avail = stock?.qty ?? 0;
    if (avail <= 0) {
      toast.error(
        `Stok ${barang.part_number} di gudang Anda kosong. Tidak bisa dikirim.`,
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
    const target = items.find((i) => i.part_id === partId);
    const requested = qty || 1;
    if (target && requested > target.avail) {
      toast.warning(
        `${target.part_number}: maksimal ${target.avail} (tidak boleh lebih dari stok gudang pengirim).`,
      );
    }
    setItems((prev) =>
      prev.map((i) =>
        i.part_id === partId
          ? { ...i, qty: Math.max(1, Math.min(requested, i.avail)) }
          : i,
      ),
    );
  };

  const removeItem = (partId: number) =>
    setItems((prev) => prev.filter((i) => i.part_id !== partId));

  const validate = () => {
    if (!doKode.trim()) return "Kode DO Reguler wajib diisi.";
    if (!userProfile?.cabang_id) return "Gudang pengirim tidak diketahui.";
    if (!customerId) return "Pilih customer tujuan.";
    if (items.length === 0) return "Tambahkan minimal satu item.";
    if (isEkspedisi(shipmentType) && !ekspedisiCourier.trim())
      return "Isi nama ekspedisi/kurir.";
    if (shipmentType === "handcarry_eksternal" && !eksternalProvider.trim())
      return "Pilih penyedia handcarry eksternal.";
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) return toast.error(err);
    setLoading(true);
    try {
      const result = await createDoReguler({
        do_kode: doKode.trim(),
        do_tanggal: doTanggal,
        dari_cabang_id: userProfile.cabang_id,
        customer_id: customerId!,
        kode_po: kodePo || undefined,
        shipment_type: shipmentType,
        ekspedisi:
          isEkspedisi(shipmentType)
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
        jumlah_koli: jumlahKoli,
        no_resi: isEkspedisi(shipmentType) ? noResi || undefined : undefined,
        estimasi_hari: estimasiHari,
        pic: pic || undefined,
        remarks: remarks || undefined,
        items: items.map((i) => ({
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          satuan: i.satuan,
          qty: i.qty,
        })),
      });

      if (result.error) throw new Error(result.error);
      toast.success("DO Reguler berhasil dibuat");
      router.push("/so-reguler/do");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

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
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
              Buat DO Reguler
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Kirim stok dari gudang Anda ke customer (tanpa SPB)
            </p>
          </div>
        </div>
      </Content>

      {/* Header form */}
      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Kode DO</Label>
            <Input
              placeholder="Input Kode DO..."
              value={doKode}
              onChange={(e) => setDoKode(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Tanggal
            </Label>
            <DatePickerString value={doTanggal} onChange={setDoTanggal} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Building2 className="h-3 w-3" /> Gudang Pengirim
            </Label>
            <div className="h-10 rounded-md border border-input bg-muted/40 px-3 flex items-center text-sm font-bold uppercase">
              {userProfile?.cabang?.nama_cabang || "-"}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <UsersRound className="h-3 w-3 text-success" /> Customer Tujuan
            </Label>
            <Popover open={customerPopoverOpen} onOpenChange={setCustomerPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 w-full justify-start font-bold text-sm">
                  {customerName || "Pilih customer..."}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 overflow-hidden" align="start">
                <div className="p-2 border-b bg-muted/40">
                  <Input
                    placeholder="Cari customer..."
                    className="h-9 text-xs"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-62.5 overflow-y-auto p-1.5">
                  {customers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setCustomerId(c.id);
                        setCustomerName(c.customer_name);
                        setCustomerPopoverOpen(false);
                        setCustomerSearch("");
                      }}
                      className="w-full text-left p-3 rounded-lg flex items-center justify-between group mb-1 hover:bg-muted"
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-xs uppercase">{c.customer_name}</span>
                        <span className="text-[9px] opacity-60">{c.customer_no}</span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                  {customers.length === 0 && (
                    <div className="p-6 text-center text-xs text-muted-foreground italic">
                      {debouncedCustomerSearch
                        ? "Customer tidak ditemukan."
                        : "Ketik untuk mencari customer..."}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </Content>

      {/* Kode PO + Items */}
      <Content>
        <div className="mb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> Kode PO
            </Label>
            <Input
              placeholder="Input Kode PO (opsional)..."
              value={kodePo}
              onChange={(e) => setKodePo(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
        </div>

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
                <TableHead className="w-20 text-center text-[10px] font-black uppercase text-muted-foreground">Unit</TableHead>
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
                          Stok gudang {item.avail}
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
                const t = v as ShipmentType;
                setShipmentType(t);
                setEstimasiHari(defaultEstimasiHari(t));
              }}
            >
              <SelectTrigger className="h-10 text-sm font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="handcarry_internal" className="text-xs font-bold">🚶 Handcarry Internal</SelectItem>
                <SelectItem value="handcarry_eksternal" className="text-xs font-bold">🛵 Handcarry Eksternal</SelectItem>
                <SelectItem value="ekspedisi_laut" className="text-xs font-bold">🚢 Ekspedisi Laut</SelectItem>
                <SelectItem value="ekspedisi_udara" className="text-xs font-bold">✈️ Ekspedisi Udara</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isEkspedisi(shipmentType) && (
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

          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <User className="h-3 w-3" /> PIC
            </Label>
            <Input value={pic} onChange={(e) => setPic(e.target.value)} placeholder="Penanggung jawab (opsional)" className="h-10 text-sm" />
          </div>

          <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Keterangan</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Catatan tambahan (opsional)..." className="min-h-16 resize-none text-xs" />
          </div>
        </div>
      </Content>

      {/* Submit */}
      <Content>
        <div className="flex flex-col lg:flex-row justify-between gap-6 lg:items-center">
          <p className="text-[11px] text-muted-foreground font-medium max-w-125">
            DO Reguler tanpa approval. Stok langsung keluar dari gudang pengirim
            saat DO dibuat. Pembatalan hanya oleh moderator (stok dikembalikan).
          </p>
          <Button
            className="h-10 lg:w-70 font-bold text-sm uppercase"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buat DO Reguler"}
          </Button>
        </div>
      </Content>
    </>
  );
}
