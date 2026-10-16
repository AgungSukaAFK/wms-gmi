"use client";

import React, { Suspense, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
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
  ReceiptText,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import {
  type ShipmentType,
  type KoliFormState,
  isEkspedisi,
  defaultEstimasiHari,
  initialKoliForm,
  koliFormPayload,
  validateKoliForm,
} from "@/lib/shipment";
import { KoliDetailEditor } from "@/components/shipment/koli-detail-editor";
import { createDoReguler } from "@/services/do-reguler-actions";
import {
  computeSoItemRemaining,
  fetchSoItemFulfillment,
} from "@/lib/so-reguler";

interface DOItem {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  // Diisi kalau DO dibuat dari SO Reguler.
  so_item_id?: number;
  sisa_so?: number;
}

export default function CreateDoRegulerPage() {
  return (
    <Suspense
      fallback={
        <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CreateDoRegulerForm />
    </Suspense>
  );
}

function CreateDoRegulerForm() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSoId = Number(searchParams.get("so_id")) || null;

  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [cabangs, setCabangs] = useState<{ id: number; nama_cabang: string }[]>(
    [],
  );

  // Form
  const [doKode, setDoKode] = useState("");
  const [doTanggal, setDoTanggal] = useState(toYmdLocal());
  const [dariCabangId, setDariCabangId] = useState<string>("");
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [kodePo, setKodePo] = useState("");
  const [items, setItems] = useState<DOItem[]>([]);
  const [stockMap, setStockMap] = useState<Map<number, number>>(new Map());
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
  const [koli, setKoli] = useState<KoliFormState>(initialKoliForm);
  const [layananKurir, setLayananKurir] = useState("");
  const [ratePerKg, setRatePerKg] = useState(0);
  const [noResi, setNoResi] = useState("");
  const [estimasiHari, setEstimasiHari] = useState(14);

  // DO dari SO Reguler (opsional). Customer & item mengikuti SO.
  const [selectedSo, setSelectedSo] = useState<any | null>(null);
  const [soResults, setSoResults] = useState<any[]>([]);
  const [soSearch, setSoSearch] = useState("");
  const [debouncedSoSearch] = useDebounce(soSearch, 300);
  const [soPopoverOpen, setSoPopoverOpen] = useState(false);
  const [soLoading, setSoLoading] = useState(false);

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
        .select("cabang_id")
        .eq("id", user.id)
        .single();
      if (profile?.cabang_id) setDariCabangId(String(profile.cabang_id));

      const { data: cabangData } = await supabase
        .from("cabang")
        .select("id, nama_cabang")
        .eq("is_active", true)
        .order("nama_cabang");
      setCabangs(cabangData || []);

      if (initialSoId) await handleSelectSo(initialSoId);

      setInitialLoading(false);
    };
    init();
  }, []);

  // Search SO yang masih bisa dikirim (open/partial)
  useEffect(() => {
    if (!soPopoverOpen) return;
    const run = async () => {
      let q = supabase
        .from("so_reguler")
        .select(
          "id, so_kode, so_status, customer:customers!customer_id(customer_name)",
        )
        .in("so_status", ["open", "partial"])
        .order("created_at", { ascending: false })
        .limit(20);
      if (debouncedSoSearch) q = q.ilike("so_kode", `%${debouncedSoSearch}%`);
      const { data } = await q;
      setSoResults(data || []);
    };
    run();
  }, [debouncedSoSearch, soPopoverOpen]);

  const handleSelectSo = async (soId: number) => {
    setSoPopoverOpen(false);
    setSoSearch("");
    setSoLoading(true);
    const { data: so } = await supabase
      .from("so_reguler")
      .select(
        "id, so_kode, so_status, customer_id, customer:customers!customer_id(customer_name), so_reguler_items(id, part_id, part_number, part_name, satuan, qty)",
      )
      .eq("id", soId)
      .maybeSingle();
    if (!so || so.so_status === "cancelled" || so.so_status === "completed") {
      setSoLoading(false);
      toast.error(
        so ? `SO ${so.so_kode} sudah ${so.so_status === "cancelled" ? "dibatalkan" : "selesai"}.` : "SO tidak ditemukan.",
      );
      return;
    }
    const soItems: any[] = [...(so.so_reguler_items || [])].sort(
      (a, b) => a.id - b.id,
    );
    const fulfillment = await fetchSoItemFulfillment(
      supabase,
      soItems.map((i) => i.id),
    );
    // Gudang pengirim = pilihan saat ini (default gudang akun, boleh diganti).
    // Qty awal diisi min(sisa SO, stok gudang tsb).
    const { data: stockRows } = await supabase
      .from("stock")
      .select("part_id, qty")
      .eq("cabang_id", Number(dariCabangId) || -1)
      .in(
        "part_id",
        soItems.map((i) => i.part_id),
      );
    const stock = new Map<number, number>(
      (stockRows || []).map((r: any) => [r.part_id, Number(r.qty) || 0]),
    );
    const nextItems: DOItem[] = soItems
      .map((i) => {
        const { sisaDo } = computeSoItemRemaining(i.qty, fulfillment.get(i.id));
        return {
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          satuan: i.satuan,
          so_item_id: i.id,
          sisa_so: sisaDo,
          qty: Math.max(0, Math.min(sisaDo, stock.get(i.part_id) ?? 0)),
        };
      })
      .filter((i) => (i.sisa_so ?? 0) > 0);
    if (nextItems.length === 0) {
      setSoLoading(false);
      toast.error(`Semua item SO ${so.so_kode} sudah terkirim.`);
      return;
    }
    setSelectedSo(so);
    setCustomerId(so.customer_id);
    const soCustomer: any = Array.isArray(so.customer)
      ? so.customer[0]
      : so.customer;
    setCustomerName(soCustomer?.customer_name || "");
    setItems(nextItems);
    setSoLoading(false);
  };

  const clearSo = () => {
    setSelectedSo(null);
    setItems([]);
    setCustomerId(null);
    setCustomerName("");
  };

  // Stok gudang pengirim per item -- reaktif terhadap gudang & daftar item,
  // supaya kalau gudang pengirim diganti setelah item ditambahkan, qty
  // tersedia yang ditampilkan/divalidasi selalu yang terbaru (bukan stale).
  const itemPartIdsKey = items.map((i) => i.part_id).join(",");
  useEffect(() => {
    if (!dariCabangId || items.length === 0) {
      setStockMap(new Map());
      return;
    }
    let cancelled = false;
    supabase
      .from("stock")
      .select("part_id, qty")
      .eq("cabang_id", Number(dariCabangId))
      .in(
        "part_id",
        items.map((i) => i.part_id),
      )
      .then(({ data }) => {
        if (cancelled) return;
        const map = new Map<number, number>();
        for (const row of data || []) map.set(row.part_id, Number(row.qty) || 0);
        setStockMap(map);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dariCabangId, itemPartIdsKey]);

  // Mode SO: qty item ikut dibatasi stok gudang pengirim yang baru dipilih.
  useEffect(() => {
    if (!selectedSo) return;
    setItems((prev) =>
      prev.map((i) => ({
        ...i,
        qty: Math.min(i.qty, stockMap.get(i.part_id) ?? 0),
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockMap]);

  // Search customer (server-side, dibatasi 20 hasil — tidak get-all)
  useEffect(() => {
    if (!customerPopoverOpen) return;
    const run = async () => {
      let q = supabase
        .from("customers")
        .select("id, customer_no, customer_name")
        .eq("is_active", true)
        .in("customer_type", ["non_consignment", "both"])
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
    if (!dariCabangId) {
      toast.error("Pilih gudang pengirim terlebih dahulu.");
      return;
    }
    // Ambil stok PN ini di gudang pengirim terpilih
    const { data: stock } = await supabase
      .from("stock")
      .select("qty")
      .eq("part_id", barang.id)
      .eq("cabang_id", Number(dariCabangId))
      .maybeSingle();
    const avail = stock?.qty ?? 0;
    if (avail <= 0) {
      toast.error(
        `Stok ${barang.part_number} di gudang pengirim kosong. Tidak bisa dikirim.`,
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
      },
    ]);
    setSearchOpen(false);
    setSearch("");
  };

  const updateQty = (partId: number, qty: number) => {
    // Mode SO: qty 0 = item dilewati (belum dikirim di DO ini).
    const minQty = selectedSo ? 0 : 1;
    const requested = Number.isFinite(qty) ? qty : minQty;
    const avail = stockMap.get(partId) ?? 0;
    const sisaSo = items.find((i) => i.part_id === partId)?.sisa_so;
    const cap = sisaSo !== undefined ? Math.min(avail, sisaSo) : avail;
    if (requested > cap) {
      toast.warning(
        sisaSo !== undefined && sisaSo < avail
          ? `Maksimal ${cap} (sisa SO yang belum dikirim).`
          : `Maksimal ${avail} (tidak boleh lebih dari stok gudang pengirim).`,
      );
    }
    setItems((prev) =>
      prev.map((i) =>
        i.part_id === partId
          ? { ...i, qty: Math.max(minQty, Math.min(requested, cap)) }
          : i,
      ),
    );
  };

  const removeItem = (partId: number) =>
    setItems((prev) => prev.filter((i) => i.part_id !== partId));

  const validate = () => {
    if (!doKode.trim()) return "Kode DO Reguler wajib diisi.";
    if (!dariCabangId) return "Pilih gudang pengirim.";
    if (!customerId) return "Pilih customer tujuan.";
    if (items.filter((i) => i.qty > 0).length === 0)
      return selectedSo
        ? "Isi qty minimal satu item SO (stok gudang pengirim harus tersedia)."
        : "Tambahkan minimal satu item.";
    if (isEkspedisi(shipmentType) && !ekspedisiCourier.trim())
      return "Isi nama ekspedisi/kurir.";
    if (isEkspedisi(shipmentType) && !layananKurir.trim())
      return "Isi jenis layanan kurir.";
    if (isEkspedisi(shipmentType) && ratePerKg <= 0)
      return "Isi rate per kg kurir.";
    if (shipmentType === "handcarry_eksternal" && !eksternalProvider.trim())
      return "Pilih penyedia handcarry eksternal.";
    return validateKoliForm(koli, {
      requireBerat: isEkspedisi(shipmentType),
    });
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) return toast.error(err);
    setLoading(true);
    try {
      const result = await createDoReguler({
        do_kode: doKode.trim(),
        do_tanggal: doTanggal,
        dari_cabang_id: Number(dariCabangId),
        customer_id: customerId!,
        so_id: selectedSo?.id ?? null,
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
        ...koliFormPayload(koli),
        layanan_kurir: isEkspedisi(shipmentType) ? layananKurir.trim() : undefined,
        rate_per_kg: isEkspedisi(shipmentType) ? ratePerKg : undefined,
        no_resi: isEkspedisi(shipmentType) ? noResi || undefined : undefined,
        estimasi_hari: estimasiHari,
        pic: pic || undefined,
        remarks: remarks || undefined,
        items: items
          .filter((i) => i.qty > 0)
          .map((i) => ({
            part_id: i.part_id,
            part_number: i.part_number,
            part_name: i.part_name,
            satuan: i.satuan,
            qty: i.qty,
            so_item_id: i.so_item_id ?? null,
          })),
      });

      if (result.error) throw new Error(result.error);
      toast.success("DO Reguler berhasil dibuat");
      router.push(
        selectedSo ? `/so-reguler/so/${selectedSo.id}` : "/so-reguler/do",
      );
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
            <Select value={dariCabangId} onValueChange={setDariCabangId}>
              <SelectTrigger className="h-10 w-full text-sm font-bold">
                <SelectValue placeholder="Pilih gudang pengirim..." />
              </SelectTrigger>
              <SelectContent>
                {cabangs.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <UsersRound className="h-3 w-3 text-success" /> Customer Tujuan
            </Label>
            <Popover open={customerPopoverOpen} onOpenChange={setCustomerPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 w-full justify-start font-bold text-sm"
                  disabled={!!selectedSo}
                >
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

      {/* SO + Kode PO + Items */}
      <Content>
        <div className="mb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <ReceiptText className="h-3 w-3" /> Dari SO Reguler
            </Label>
            {selectedSo ? (
              <div className="flex h-10 items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3">
                <span className="text-sm font-bold uppercase">
                  {selectedSo.so_kode}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={clearSo}
                  title="Lepas SO (DO tanpa SO)"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Popover open={soPopoverOpen} onOpenChange={setSoPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-10 w-full justify-start font-bold text-sm"
                    disabled={soLoading}
                  >
                    {soLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className="text-muted-foreground">
                        Pilih SO (opsional)...
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0 overflow-hidden" align="start">
                  <div className="p-2 border-b bg-muted/40">
                    <Input
                      placeholder="Cari kode SO..."
                      className="h-9 text-xs"
                      value={soSearch}
                      onChange={(e) => setSoSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-62.5 overflow-y-auto p-1.5">
                    {soResults.map((so) => (
                      <button
                        key={so.id}
                        onClick={() => handleSelectSo(so.id)}
                        className="w-full text-left p-3 rounded-lg flex flex-col mb-1 hover:bg-muted"
                      >
                        <span className="font-bold text-xs uppercase">
                          {so.so_kode}
                        </span>
                        <span className="text-[9px] text-muted-foreground uppercase">
                          {so.customer?.customer_name}
                        </span>
                      </button>
                    ))}
                    {soResults.length === 0 && (
                      <div className="p-6 text-center text-xs text-muted-foreground italic">
                        Tidak ada SO open/partial.
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
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
          {!selectedSo && (
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
          )}
        </div>
        {selectedSo && (
          <p className="mb-3 text-[10px] font-medium text-muted-foreground">
            Item mengikuti SO {selectedSo.so_kode}. Qty dibatasi sisa SO &amp;
            stok gudang pengirim; isi 0 untuk item yang belum dikirim di DO ini
            (mis. masih menunggu PO).
          </p>
        )}
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
                items.map((item) => {
                  const avail = stockMap.get(item.part_id) ?? 0;
                  return (
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
                          min={selectedSo ? 0 : 1}
                          max={
                            item.sisa_so !== undefined
                              ? Math.min(avail, item.sisa_so)
                              : avail
                          }
                          value={item.qty}
                          onChange={(e) => updateQty(item.part_id, parseInt(e.target.value))}
                          className="h-8 w-20 text-center text-xs"
                        />
                        <span className="text-[9px] font-medium text-amber-600">
                          Stok gudang {avail}
                          {item.sisa_so !== undefined &&
                            ` · Sisa SO ${item.sisa_so}`}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={!!selectedSo} onClick={() => removeItem(item.part_id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  );
                })
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
                      "Indah Cargo",
                      "Flexo Fast",
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

          <div className="md:col-span-2 xl:col-span-3">
            <KoliDetailEditor
              koli={koli}
              onKoliChange={setKoli}
              shipmentType={shipmentType}
              layananKurir={layananKurir}
              onLayananKurirChange={setLayananKurir}
              ratePerKg={ratePerKg}
              onRatePerKgChange={setRatePerKg}
            />
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
