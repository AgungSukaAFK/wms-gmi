"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronLeft,
  Calendar as CalendarIcon,
  Building2,
  Loader2,
  ReceiptText,
  Clock,
  ArrowRight,
  AlertTriangle,
  UsersRound,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { MRItemSelector, MRItem } from "@/components/mr/mr-item-selector";
import { createSoReguler } from "@/services/so-reguler-actions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import { SO_KATEGORI_OPTIONS, canCreateSO } from "@/lib/so-reguler";

const PRIORITY_COLOR: Record<string, string> = {
  P1: "text-destructive bg-destructive/10 border-destructive/30",
  P2: "text-warning bg-warning/10 border-warning/30",
  P3: "text-primary bg-primary/10 border-primary/30",
  P4: "text-muted-foreground bg-muted border-border",
};

export default function CreateSoRegulerPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const [userProfile, setUserProfile] = useState<any>(null);
  const [cabangs, setCabangs] = useState<{ id: number; nama_cabang: string }[]>(
    [],
  );

  // Form
  const [soKode, setSoKode] = useState("");
  const [soTanggal, setSoTanggal] = useState(toYmdLocal());
  const [soDueDate, setSoDueDate] = useState("");
  const [defaultPriority, setDefaultPriority] = useState("P3");
  const [kategori, setKategori] = useState("");
  const [cabangId, setCabangId] = useState<string>("");
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [items, setItems] = useState<MRItem[]>([]);

  // Customer picker
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedCustomerSearch] = useDebounce(customerSearch, 300);
  const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false);

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
        .select("*, cabang(id, nama_cabang), roles:user_roles(roles(name))")
        .eq("id", user.id)
        .single();

      if (
        profile &&
        !canCreateSO((profile.roles as any[])?.map((r: any) => r.roles?.name))
      ) {
        toast.error("Akses ditolak. Role Anda tidak diizinkan membuat SO.");
        router.push("/so-reguler/so");
        return;
      }

      setUserProfile(profile);
      if (profile?.cabang_id) setCabangId(String(profile.cabang_id));

      const { data: cabangData } = await supabase
        .from("cabang")
        .select("id, nama_cabang")
        .eq("is_active", true)
        .order("nama_cabang");
      setCabangs(cabangData || []);
      setInitialLoading(false);
    };
    init();
  }, []);

  // Search customer (server-side, dibatasi 20 hasil). SO reguler hanya untuk
  // customer non-consignment, sama seperti DO Reguler.
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

  const validateForm = () => {
    if (!soKode.trim()) return "Nomor Dokumen harus diisi";
    if (!soTanggal) return "Tanggal SO harus diisi";
    if (!soDueDate) return "Due Date harus diisi";
    if (!kategori) return "Kategori SO harus dipilih";
    if (!cabangId) return "Lokasi site harus dipilih";
    if (!customerId) return "Customer harus dipilih";
    if (items.length === 0) return "Daftar barang tidak boleh kosong";
    const zeroQtyItems = items.filter((item) => !item.qty || item.qty <= 0);
    if (zeroQtyItems.length > 0) {
      const names = zeroQtyItems.map((item) => item.part_number).join(", ");
      return `Semua qty barang tidak boleh 0. Periksa: ${names}`;
    }
    return null;
  };

  const handleSubmit = async () => {
    const error = validateForm();
    if (error) {
      toast.error(error);
      return;
    }
    setLoading(true);
    try {
      const result = await createSoReguler({
        so_kode: soKode.trim(),
        so_tanggal: soTanggal,
        so_due_date: soDueDate,
        kategori,
        cabang_id: Number(cabangId),
        customer_id: customerId!,
        remarks: remarks || undefined,
        items: items.map((item) => ({
          part_id: item.part_id,
          part_number: item.part_number,
          part_name: item.part_name,
          satuan: item.satuan,
          qty: item.qty,
          item_priority: item.item_priority,
          remarks: item.remarks?.trim() || undefined,
        })),
      });
      if (result.error) throw new Error(result.error);
      toast.success("SO Reguler berhasil dibuat");
      router.push(`/so-reguler/so/${result.data.id}`);
    } catch (err: any) {
      toast.error(err.message);
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
      {/* Header */}
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
              <ReceiptText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                BUAT SO REGULER
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Sales Order ke Customer — Tanpa Approval
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1 w-full md:w-auto">
            <Label className="text-[10px] font-semibold uppercase text-muted-foreground">
              Nomor Dokumen
            </Label>
            <Input
              placeholder="Input Kode SO..."
              className="h-9 w-full rounded-md border-input bg-background px-3 text-xs font-semibold uppercase text-foreground md:w-60"
              value={soKode}
              onChange={(e) => setSoKode(e.target.value)}
            />
          </div>
        </div>
      </Content>

      {/* Form + Items */}
      <Content>
        <div className="grid grid-cols-1 gap-x-6 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
          {/* Column 1: PIC + Priority + Kategori */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Pembuat (PIC)
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
                <AlertTriangle className="h-3 w-3 text-warning" /> Prioritas
                Default Item
              </Label>
              <Select value={defaultPriority} onValueChange={setDefaultPriority}>
                <SelectTrigger
                  className={`h-9 w-full rounded-md border-input bg-background text-xs font-semibold ${PRIORITY_COLOR[defaultPriority] || ""}`}
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
              <p className="text-[9px] text-muted-foreground italic">
                Nilai awal tiap item baru, bisa diubah per barang di tabel
                Daftar Barang.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Kategori
              </Label>
              <Select value={kategori} onValueChange={setKategori}>
                <SelectTrigger className="h-9 w-full rounded-md border-input bg-background text-xs font-semibold">
                  <SelectValue placeholder="Pilih kategori..." />
                </SelectTrigger>
                <SelectContent>
                  {SO_KATEGORI_OPTIONS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Column 2: Customer + Lokasi */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                <UsersRound className="h-3 w-3 text-success" /> Customer
              </Label>
              <Popover
                open={customerPopoverOpen}
                onOpenChange={setCustomerPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-9 w-full justify-start text-xs font-semibold"
                  >
                    {customerName || "Pilih customer..."}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-80 p-0 overflow-hidden"
                  align="start"
                >
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
                          <span className="font-bold text-xs uppercase">
                            {c.customer_name}
                          </span>
                          <span className="text-[9px] opacity-60">
                            {c.customer_no}
                          </span>
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
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                <Building2 className="h-3 w-3" /> Lokasi Site
              </Label>
              <Select value={cabangId} onValueChange={setCabangId}>
                <SelectTrigger className="h-9 w-full text-xs font-semibold uppercase">
                  <SelectValue placeholder="Pilih lokasi site..." />
                </SelectTrigger>
                <SelectContent>
                  {cabangs.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nama_cabang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[9px] text-muted-foreground italic">
                Default lokasi Anda. Jadi gudang penerima PO dari SO ini dan
                gudang pengirim default DO.
              </p>
            </div>
          </div>

          {/* Column 3: Dates + Remarks */}
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
                    value={soTanggal}
                    onChange={setSoTanggal}
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
                    value={soDueDate}
                    onChange={setSoDueDate}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Keterangan
              </Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Catatan tambahan (opsional)..."
                className="min-h-16 resize-none text-xs"
              />
            </div>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="min-h-50">
          {/* cabangId sengaja null: cek min/max stok & duplikat MR tidak
              berlaku untuk SO (penjualan ke customer). */}
          <MRItemSelector
            items={items}
            onItemsChange={setItems}
            cabangId={null}
            defaultPriority={defaultPriority}
          />
        </div>
      </Content>

      {/* Submit */}
      <Content>
        <div className="flex flex-col lg:flex-row justify-between gap-6 lg:items-center">
          <p className="text-[11px] text-muted-foreground font-medium max-w-125">
            SO Reguler tanpa approval. Setelah dibuat, tiap item bisa langsung
            dikirim lewat DO Reguler (dari stok) atau di-PO dulu — boleh
            dipecah per qty.
          </p>
          <Button
            className="h-10 lg:w-70 font-bold text-sm uppercase gap-2"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" /> Simpan SO
              </>
            )}
          </Button>
        </div>
      </Content>
    </>
  );
}
