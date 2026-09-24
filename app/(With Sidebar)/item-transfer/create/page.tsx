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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
  PackageCheck,
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
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { createItemTransfer } from "@/services/item-transfer-actions";

interface ITItem {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  avail: number; // stok tersedia di gudang asal
  dest_qty: number; // stok saat ini di gudang tujuan
  dest_max: number; // max_qty di gudang tujuan
  // Terisi kalau item ini ditambahkan lewat picker "Cari dari RI" --
  // referensi ke MR yang direferensikan + RI asalnya (lihat komentar di
  // services/item-transfer-actions.ts createItemTransfer).
  mr_item_id?: number | null;
  receive_item_id?: number | null;
  mr_kode?: string;
  ri_kode?: string;
}

interface RiLine {
  receive_item_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty_sisa: number; // qty RI - qty yang sudah masuk IT lain (non-rejected)
  qty_pilih: number;
  mr_item_id: number | null;
  mr_kode: string;
  selected: boolean;
}

export default function CreateItemTransferPage() {
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
  const [itKode, setItKode] = useState("");
  const [itTanggal, setItTanggal] = useState(toYmdLocal());
  const [keCabang, setKeCabang] = useState<number | null>(null);
  const [items, setItems] = useState<ITItem[]>([]);
  const [remarks, setRemarks] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

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

  // Cari dari RI
  const [riDialogOpen, setRiDialogOpen] = useState(false);
  const [riSearch, setRiSearch] = useState("");
  const [debouncedRiSearch] = useDebounce(riSearch, 300);
  const [riResults, setRiResults] = useState<any[]>([]);
  const [selectedRi, setSelectedRi] = useState<any>(null);
  const [riLines, setRiLines] = useState<RiLine[]>([]);
  const [riLinesLoading, setRiLinesLoading] = useState(false);

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

  // Search RI completed yang gudang penerima salah satu item-nya = gudang
  // asal (cabang) user ini -- cuma RI yang barangnya "mendarat" di cabang
  // kita yang bisa jadi sumber IT.
  useEffect(() => {
    if (!riDialogOpen || !userProfile?.cabang_id) return;
    const run = async () => {
      let q = supabase
        .from("receives")
        .select("id, ri_kode, ri_tanggal, receive_items!inner(cabang_penerima_id)")
        .eq("ri_status", "completed")
        .eq("receive_items.cabang_penerima_id", userProfile.cabang_id)
        .order("ri_tanggal", { ascending: false })
        .limit(20);
      if (debouncedRiSearch) q = q.ilike("ri_kode", `%${debouncedRiSearch}%`);
      const { data } = await q;
      // Dedup (join bisa gandakan header kalau lebih dari 1 item match)
      const seen = new Set<number>();
      const uniq = (data || []).filter((r: any) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
      setRiResults(uniq);
    };
    run();
  }, [debouncedRiSearch, riDialogOpen, userProfile?.cabang_id]);

  const selectRi = async (ri: any) => {
    setSelectedRi(ri);
    setRiLinesLoading(true);
    setRiLines([]);

    const { data: lines } = await supabase
      .from("receive_items")
      .select(
        "id, part_id, part_number, part_name, satuan, qty, mr_id, mrs(mr_kode)",
      )
      .eq("ri_id", ri.id)
      .eq("cabang_penerima_id", userProfile.cabang_id);

    const receiveItemIds = (lines || []).map((l: any) => l.id);
    const { data: usedRows } =
      receiveItemIds.length > 0
        ? await supabase
            .from("item_transfer_items")
            .select("receive_item_id, qty, item_transfers!inner(status)")
            .in("receive_item_id", receiveItemIds)
            .neq("item_transfers.status", "rejected")
        : { data: [] as any[] };
    const usedMap = new Map<number, number>();
    for (const row of usedRows || []) {
      usedMap.set(
        row.receive_item_id,
        (usedMap.get(row.receive_item_id) || 0) + row.qty,
      );
    }

    // Resolve mr_item_id per baris via mr_id+part_id (pola yang sama dipakai
    // applyReceiveCompletion sebelum revisi ini).
    const mrIds = Array.from(new Set((lines || []).map((l: any) => l.mr_id)));
    const { data: mrItemRows } =
      mrIds.length > 0
        ? await supabase
            .from("mr_items")
            .select("id, mr_id, part_id")
            .in("mr_id", mrIds)
        : { data: [] as any[] };
    const mrItemMap = new Map<string, number>();
    for (const mi of mrItemRows || []) {
      mrItemMap.set(`${mi.mr_id}:${mi.part_id}`, mi.id);
    }

    const draft: RiLine[] = (lines || [])
      .map((l: any) => {
        const sisa = l.qty - (usedMap.get(l.id) || 0);
        return {
          receive_item_id: l.id,
          part_id: l.part_id,
          part_number: l.part_number,
          part_name: l.part_name,
          satuan: l.satuan,
          qty_sisa: sisa,
          qty_pilih: sisa,
          mr_item_id: mrItemMap.get(`${l.mr_id}:${l.part_id}`) ?? null,
          mr_kode: l.mrs?.mr_kode || "-",
          selected: sisa > 0,
        };
      })
      .filter((l: RiLine) => l.qty_sisa > 0);

    setRiLines(draft);
    setRiLinesLoading(false);
  };

  const toggleRiLine = (receiveItemId: number) => {
    setRiLines((prev) =>
      prev.map((l) =>
        l.receive_item_id === receiveItemId
          ? { ...l, selected: !l.selected }
          : l,
      ),
    );
  };

  const updateRiLineQty = (receiveItemId: number, qty: number) => {
    setRiLines((prev) =>
      prev.map((l) =>
        l.receive_item_id === receiveItemId
          ? { ...l, qty_pilih: Math.max(0, Math.min(l.qty_sisa, qty)) }
          : l,
      ),
    );
  };

  const addSelectedRiItems = async () => {
    const chosen = riLines.filter((l) => l.selected && l.qty_pilih > 0);
    if (chosen.length === 0) {
      toast.error("Pilih minimal satu item.");
      return;
    }
    if (!keCabang) {
      toast.error("Pilih gudang tujuan terlebih dahulu.");
      return;
    }

    const skipped: string[] = [];
    const toAdd: ITItem[] = [];
    for (const line of chosen) {
      if (items.some((i) => i.part_id === line.part_id)) {
        skipped.push(`${line.part_number} (sudah ada di daftar)`);
        continue;
      }
      const { data: destStock } = await supabase
        .from("stock")
        .select("qty, max_qty")
        .eq("part_id", line.part_id)
        .eq("cabang_id", keCabang)
        .maybeSingle();
      const destQty = destStock?.qty ?? 0;
      const destMax = destStock?.max_qty ?? 0;
      if (destMax <= 0) {
        skipped.push(`${line.part_number} (belum ada batas max di tujuan)`);
        continue;
      }
      const headroom = Math.max(0, destMax - destQty);
      if (headroom <= 0) {
        skipped.push(`${line.part_number} (stok tujuan penuh)`);
        continue;
      }
      toAdd.push({
        part_id: line.part_id,
        part_number: line.part_number,
        part_name: line.part_name,
        satuan: line.satuan,
        qty: Math.min(line.qty_pilih, line.qty_sisa, headroom),
        avail: line.qty_sisa,
        dest_qty: destQty,
        dest_max: destMax,
        mr_item_id: line.mr_item_id,
        receive_item_id: line.receive_item_id,
        mr_kode: line.mr_kode,
        ri_kode: selectedRi?.ri_kode,
      });
    }

    if (toAdd.length > 0) setItems((prev) => [...prev, ...toAdd]);
    if (skipped.length > 0)
      toast.warning(`Dilewati: ${skipped.join(", ")}`);
    if (toAdd.length > 0) {
      toast.success(`${toAdd.length} item ditambahkan dari ${selectedRi?.ri_kode}.`);
      setRiDialogOpen(false);
      setSelectedRi(null);
      setRiLines([]);
      setRiSearch("");
    }
  };

  const addItem = async (barang: any) => {
    if (items.some((i) => i.part_id === barang.id)) return;
    if (!userProfile?.cabang_id) {
      toast.error("Cabang asal tidak diketahui.");
      return;
    }
    if (!keCabang) {
      toast.error("Pilih gudang tujuan terlebih dahulu.");
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
    // Ambil stok & batas max di gudang tujuan
    const { data: destStock } = await supabase
      .from("stock")
      .select("qty, max_qty")
      .eq("part_id", barang.id)
      .eq("cabang_id", keCabang)
      .maybeSingle();
    const destQty = destStock?.qty ?? 0;
    const destMax = destStock?.max_qty ?? 0;
    if (destMax <= 0) {
      toast.error(
        `${barang.part_number} belum punya batas max stok di gudang tujuan. Belum bisa ditransfer.`,
      );
      return;
    }
    const headroom = destMax - destQty;
    if (headroom <= 0) {
      toast.error(
        `Stok ${barang.part_number} di gudang tujuan sudah penuh (${destQty}/${destMax}).`,
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
        dest_qty: destQty,
        dest_max: destMax,
      },
    ]);
    setSearchOpen(false);
    setSearch("");
  };

  // Batas maksimal qty yang boleh dikirim: stok asal & sisa kapasitas tujuan
  const maxSendable = (i: ITItem) =>
    Math.max(0, Math.min(i.avail, i.dest_max - i.dest_qty));

  const updateQty = (partId: number, qty: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.part_id === partId
          ? { ...i, qty: Math.max(1, Math.min(qty || 1, maxSendable(i))) }
          : i,
      ),
    );
  };

  const removeItem = (partId: number) =>
    setItems((prev) => prev.filter((i) => i.part_id !== partId));

  const validate = () => {
    if (!itKode.trim()) return "Kode Item Transfer wajib diisi.";
    if (!keCabang) return "Pilih gudang tujuan.";
    if (items.length === 0) return "Tambahkan minimal satu item.";
    if (!picUid) return "PIC harus dipilih.";
    if (!receiverUid) return "Penerima harus dipilih.";
    if (!selectedTemplateId) return "Pilih alur approval.";
    if (isEkspedisi(shipmentType) && !ekspedisiCourier.trim())
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

      const result = await createItemTransfer({
        it_kode: itKode.trim(),
        it_tanggal: itTanggal,
        dari_cabang_id: userProfile.cabang_id,
        ke_cabang_id: keCabang!,
        shipment_type: shipmentType,
        ekspedisi:
          isEkspedisi(shipmentType)
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
        no_resi: isEkspedisi(shipmentType) ? noResi || undefined : undefined,
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
          mr_item_id: i.mr_item_id ?? undefined,
          receive_item_id: i.receive_item_id ?? undefined,
        })),
      });

      if (result.error) throw new Error(result.error);
      toast.success("Item Transfer berhasil dibuat");
      router.push("/item-transfer");
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
              Buat Item Transfer
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
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Kode IT</Label>
            <Input
              placeholder="Input Kode IT..."
              value={itKode}
              onChange={(e) => setItKode(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Tanggal
            </Label>
            <DatePickerString value={itTanggal} onChange={setItTanggal} className="h-10" />
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
            <Select
              value={keCabang?.toString()}
              onValueChange={(v) => {
                setKeCabang(parseInt(v));
                if (items.length > 0) {
                  setItems([]);
                  toast.info(
                    "Daftar item direset karena gudang tujuan berubah.",
                  );
                }
              }}
            >
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
          <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2"
            disabled={!keCabang}
            title={!keCabang ? "Pilih gudang tujuan terlebih dahulu" : undefined}
            onClick={() => setRiDialogOpen(true)}
          >
            <PackageCheck className="h-3.5 w-3.5" /> Cari dari RI
          </Button>
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                disabled={!keCabang}
                title={
                  !keCabang ? "Pilih gudang tujuan terlebih dahulu" : undefined
                }
              >
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
        </div>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10 hover:bg-transparent">
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                <TableHead className="w-20 text-center text-[10px] font-black uppercase text-muted-foreground">Unit</TableHead>
                <TableHead className="w-28 text-center text-[10px] font-black uppercase text-muted-foreground">Stok Tujuan</TableHead>
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
                      {item.receive_item_id && (
                        <Badge variant="outline" className="mt-1 text-[9px] font-bold gap-1">
                          <PackageCheck className="h-2.5 w-2.5" />
                          {item.ri_kode} &rarr; {item.mr_kode}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center text-[10px] font-medium text-muted-foreground uppercase">
                      {item.satuan}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center leading-tight">
                        <span className="text-xs font-bold text-foreground">
                          {item.dest_qty} / {item.dest_max}
                        </span>
                        <span className="text-[9px] font-medium text-muted-foreground">
                          sisa {item.dest_max - item.dest_qty}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-center gap-0.5">
                        <Input
                          type="number"
                          min={1}
                          max={maxSendable(item)}
                          value={item.qty}
                          onChange={(e) => updateQty(item.part_id, parseInt(e.target.value))}
                          className="h-8 w-20 text-center text-xs"
                        />
                        <span className="text-[9px] font-medium text-amber-600">
                          Maks {maxSendable(item)} (asal {item.avail})
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
                  <TableCell colSpan={5} className="text-center text-xs italic text-muted-foreground">
                    {keCabang
                      ? "Belum ada item."
                      : "Pilih gudang tujuan dulu untuk menambahkan barang."}
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
                Stok keluar dari gudang asal setelah IT disetujui penuh.
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

      <Dialog
        open={riDialogOpen}
        onOpenChange={(open) => {
          setRiDialogOpen(open);
          if (!open) {
            setSelectedRi(null);
            setRiLines([]);
            setRiSearch("");
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4" /> Cari dari RI
            </DialogTitle>
            <DialogDescription>
              Pilih RI yang sudah selesai dan gudang penerimanya cabang Anda
              (
              {userProfile?.cabang?.nama_cabang}
              ). Item yang dipilih otomatis bawa referensi MR asalnya.
            </DialogDescription>
          </DialogHeader>

          {!selectedRi ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Cari kode RI..."
                  className="pl-8 h-9 text-xs"
                  value={riSearch}
                  onChange={(e) => setRiSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="max-h-80 overflow-y-auto space-y-1">
                {riResults.length > 0 ? (
                  riResults.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => selectRi(r)}
                      className="w-full text-left p-3 hover:bg-muted rounded-lg border border-transparent hover:border-border"
                    >
                      <span className="font-bold text-xs uppercase font-mono">
                        {r.ri_kode}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {r.ri_tanggal}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground italic">
                    Tidak ada RI completed dengan gudang penerima cabang Anda.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="font-mono text-xs">
                  {selectedRi.ri_kode}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[10px]"
                  onClick={() => {
                    setSelectedRi(null);
                    setRiLines([]);
                  }}
                >
                  &larr; Pilih RI lain
                </Button>
              </div>

              {riLinesLoading ? (
                <div className="py-8 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : riLines.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground italic">
                  Tidak ada item RI ini yang gudang penerimanya cabang Anda
                  dan masih ada sisa belum ditransfer.
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow className="h-9">
                        <TableHead className="w-8"></TableHead>
                        <TableHead className="text-[10px] font-black uppercase">Part / MR</TableHead>
                        <TableHead className="w-28 text-center text-[10px] font-black uppercase">Sisa</TableHead>
                        <TableHead className="w-28 text-center text-[10px] font-black uppercase">Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {riLines.map((l) => (
                        <TableRow key={l.receive_item_id} className="h-12">
                          <TableCell>
                            <Checkbox
                              checked={l.selected}
                              onCheckedChange={() => toggleRiLine(l.receive_item_id)}
                            />
                          </TableCell>
                          <TableCell>
                            <span className="font-semibold text-xs">{l.part_name}</span>
                            <code className="block text-[10px] text-muted-foreground">
                              {l.part_number}
                            </code>
                            <Badge variant="outline" className="mt-1 text-[9px] font-bold">
                              MR {l.mr_kode}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center text-xs font-bold">
                            {l.qty_sisa} {l.satuan}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              max={l.qty_sisa}
                              value={l.qty_pilih}
                              disabled={!l.selected}
                              onChange={(e) =>
                                updateRiLineQty(
                                  l.receive_item_id,
                                  parseInt(e.target.value) || 0,
                                )
                              }
                              className="h-8 text-center text-xs"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {selectedRi && (
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRiDialogOpen(false)}>
                Batal
              </Button>
              <Button onClick={addSelectedRiItems}>
                Tambahkan Item Terpilih
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
