"use client";

// Dialog edit Item Transfer, dipakai dua mode:
//  - "regular": Edit biasa oleh pembuat / approver "menyetujui" yang sedang
//    giliran selama IT masih menunggu approval. Approval diulang dari tahap 2
//    (editItemTransfer).
//  - "moderator": Moderator Edit — header, item, dan jalur/status approval di
//    luar giliran (moderatorEditItemTransfer). Field yang dikunci mengikuti
//    posisi stok (lihat komentar di services/item-transfer-actions.ts).
// Semua validasi qty/stok tetap di server; dialog ini cuma menyiapkan payload.

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "use-debounce";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Info,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { DatePickerString } from "@/components/date-picker-string";
import { KoliDetailEditor } from "@/components/shipment/koli-detail-editor";
import { ApprovalFlowEditor } from "@/components/moderator/approval-flow-editor";
import {
  editItemTransfer,
  moderatorEditItemTransfer,
  type ItemTransferEditPayload,
} from "@/services/item-transfer-actions";
import type { ModeratorApprovalStep } from "@/services/moderator-edit-actions";
import {
  defaultEstimasiHari,
  isEkspedisi,
  type ShipmentType,
  type KoliFormState,
  initialKoliForm,
  koliFormFromDoc,
  koliFormPayload,
  validateKoliForm,
} from "@/lib/shipment";

const COURIERS = [
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
];
const HANDCARRY_PROVIDERS = ["Gojek", "Grab", "Maxim", "Lalamove"];

interface EditRow {
  key: string;
  id?: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  orig_qty: number; // 0 untuk baris baru
  mr_kode?: string;
  ri_kode?: string;
  from_ri: boolean;
  from_mr: boolean;
}

type StockInfo = { avail: number; destQty: number; destMax: number };

interface EditItemTransferDialogProps {
  itId: number;
  mode: "regular" | "moderator";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const one = (v: any) => (Array.isArray(v) ? v[0] : v);

function itemsSignature(rows: EditRow[]) {
  return JSON.stringify(rows.map((r) => [r.id ?? null, r.part_id, r.qty]));
}

const normalizeItApprovalStep = (a: any): ModeratorApprovalStep => ({
  userid: a.user_id || a.userid || "",
  nama: a.nama || "",
  email: a.email || "",
  approval_role:
    (a.level ?? a.approval_role) === "mengetahui" ? "mengetahui" : "menyetujui",
  status: a.status || "pending",
  processed_at: a.processed_at ?? null,
  signature_url: a.signature_url ?? null,
  notes: a.notes ?? null,
  role: a.role ?? null,
  step_id: a.step_id ?? null,
});

export function EditItemTransferDialog({
  itId,
  mode,
  open,
  onOpenChange,
  onSaved,
}: EditItemTransferDialogProps) {
  const supabase = createClient();
  const isModeratorMode = mode === "moderator";
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [it, setIt] = useState<any>(null);
  const [cabangs, setCabangs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  const [itKode, setItKode] = useState("");
  const [itTanggal, setItTanggal] = useState("");
  const [dariCabang, setDariCabang] = useState<number | null>(null);
  const [keCabang, setKeCabang] = useState<number | null>(null);
  const [picUid, setPicUid] = useState("");
  const [receiverUid, setReceiverUid] = useState("");
  const [remarks, setRemarks] = useState("");

  const [shipmentType, setShipmentType] =
    useState<ShipmentType>("ekspedisi_laut");
  const [kurir, setKurir] = useState("");
  const [senderName, setSenderName] = useState("");
  const [eksternalProvider, setEksternalProvider] = useState("");
  const [eksternalId, setEksternalId] = useState("");
  const [noResi, setNoResi] = useState("");
  const [estimasiHari, setEstimasiHari] = useState(1);
  const [koli, setKoli] = useState<KoliFormState>(initialKoliForm);
  const [layananKurir, setLayananKurir] = useState("");
  const [ratePerKg, setRatePerKg] = useState(0);

  const [items, setItems] = useState<EditRow[]>([]);
  const [originalItemsKey, setOriginalItemsKey] = useState("");
  const [stockInfo, setStockInfo] = useState<Record<number, StockInfo>>({});

  const [barangSearch, setBarangSearch] = useState("");
  const [debouncedBarangSearch] = useDebounce(barangSearch, 300);
  const [barangResults, setBarangResults] = useState<any[]>([]);
  const [barangOpen, setBarangOpen] = useState(false);
  const [barangLoading, setBarangLoading] = useState(false);

  const [approvals, setApprovals] = useState<ModeratorApprovalStep[]>([]);
  const [rejectionReason, setRejectionReason] = useState("");
  const [reason, setReason] = useState("");

  const released = Boolean(it?.stock_released);
  const completed = it?.status === "completed";
  const isConsignment = Boolean(it?.it_is_consignment);
  const hasRiRows = items.some((r) => r.from_ri);
  const hasMrRows = items.some((r) => r.from_mr && !r.from_ri);
  const kodeChanged = !!it && itKode.trim() !== it.it_kode;
  const dariLocked = released || hasRiRows;
  const keLocked = released || (isConsignment && hasMrRows);
  const itemsLocked = completed;

  useEffect(() => {
    if (open && itId) {
      fetchData();
      setReason("");
      setBarangSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itId]);

  const loadStockInfo = async (
    partIds: number[],
    dari: number | null,
    ke: number | null,
    itRow: any,
  ) => {
    const ids = Array.from(new Set(partIds.filter(Boolean)));
    if (ids.length === 0 || !dari || !ke || !itRow) return;
    const map: Record<number, StockInfo> = {};
    if (itRow.it_is_consignment) {
      const { data: src } = await supabase
        .from("vendor_consignment_stock")
        .select("part_id, qty")
        .eq("vendor_id", itRow.it_vendor_id)
        .eq("cabang_id", dari)
        .in("part_id", ids);
      for (const id of ids) map[id] = { avail: 0, destQty: 0, destMax: 0 };
      (src || []).forEach((s: any) => (map[s.part_id].avail = Number(s.qty) || 0));
    } else {
      const [{ data: src }, { data: dest }] = await Promise.all([
        supabase.from("stock").select("part_id, qty").eq("cabang_id", dari).in("part_id", ids),
        supabase
          .from("stock")
          .select("part_id, qty, max_qty")
          .eq("cabang_id", ke)
          .in("part_id", ids),
      ]);
      for (const id of ids) map[id] = { avail: 0, destQty: 0, destMax: 0 };
      (src || []).forEach((s: any) => (map[s.part_id].avail = Number(s.qty) || 0));
      (dest || []).forEach((s: any) => {
        map[s.part_id].destQty = Number(s.qty) || 0;
        map[s.part_id].destMax = Number(s.max_qty) || 0;
      });
    }
    setStockInfo((prev) => ({ ...prev, ...map }));
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [{ data: itData }, { data: itemData }, { data: cabangData }, { data: usersData }] =
        await Promise.all([
          supabase.from("item_transfers").select("*").eq("id", itId).single(),
          supabase
            .from("item_transfer_items")
            .select(
              "id, part_id, part_number, part_name, satuan, qty, mr_item_id, receive_item_id, receive_items(receives(ri_kode)), mr_items(mrs(mr_kode))",
            )
            .eq("it_id", itId)
            .order("created_at"),
          supabase
            .from("cabang")
            .select("id, nama_cabang")
            .eq("is_active", true)
            .order("nama_cabang"),
          supabase
            .from("profiles")
            .select("id, nama")
            .eq("is_active", true)
            .order("nama"),
        ]);
      setIt(itData);
      setCabangs(cabangData || []);
      setUsers(usersData || []);
      if (!itData) return;

      setItKode(itData.it_kode || "");
      setItTanggal(itData.it_tanggal ? String(itData.it_tanggal).slice(0, 10) : "");
      setDariCabang(itData.dari_cabang_id);
      setKeCabang(itData.ke_cabang_id);
      setPicUid(itData.uid_pic || "");
      setReceiverUid(itData.uid_receiver || "");
      setRemarks(itData.remarks || "");
      const t = (itData.shipment_type as ShipmentType) || "ekspedisi_laut";
      setShipmentType(t);
      setKurir(isEkspedisi(t) ? itData.ekspedisi || "" : "");
      setSenderName(itData.sender_name || "");
      setEksternalProvider(itData.eksternal_provider || "");
      setEksternalId(itData.eksternal_id || "");
      setNoResi(itData.no_resi || "");
      setEstimasiHari(itData.estimasi_hari || 1);
      setKoli(koliFormFromDoc(itData));
      setLayananKurir(itData.layanan_kurir || "");
      setRatePerKg(Number(itData.rate_per_kg) || 0);

      const rows: EditRow[] = (itemData || []).map((r: any) => ({
        key: `row-${r.id}`,
        id: r.id,
        part_id: r.part_id,
        part_number: r.part_number,
        part_name: r.part_name,
        satuan: r.satuan,
        qty: r.qty,
        orig_qty: r.qty,
        ri_kode: one(one(r.receive_items)?.receives)?.ri_kode,
        mr_kode: one(one(r.mr_items)?.mrs)?.mr_kode,
        from_ri: Boolean(r.receive_item_id),
        from_mr: Boolean(r.mr_item_id),
      }));
      setItems(rows);
      setOriginalItemsKey(itemsSignature(rows));
      setStockInfo({});
      loadStockInfo(
        rows.map((r) => r.part_id),
        itData.dari_cabang_id,
        itData.ke_cabang_id,
        itData,
      );

      setApprovals((itData.approvals || []).map(normalizeItApprovalStep));
      setRejectionReason(itData.rejection_reason || "");
    } catch (err) {
      console.error("Fetch edit item transfer error:", err);
      toast.error("Gagal memuat data Item Transfer");
    } finally {
      setLoading(false);
    }
  };

  // Gudang berubah -> info stok tiap baris dimuat ulang.
  useEffect(() => {
    if (!it || loading) return;
    setStockInfo({});
    loadStockInfo(
      items.map((r) => r.part_id),
      dariCabang,
      keCabang,
      it,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dariCabang, keCabang]);

  // Cari barang (IT konsinyasi: hanya part yang ada stok titipan vendor di
  // gudang asal, sama seperti form create).
  useEffect(() => {
    if (!barangOpen || !it) return;
    const run = async () => {
      setBarangLoading(true);
      try {
        if (it.it_is_consignment) {
          if (!dariCabang) return setBarangResults([]);
          let q = supabase
            .from("vendor_consignment_stock")
            .select("qty, barang!inner(id, part_number, part_name, part_satuan)")
            .eq("vendor_id", it.it_vendor_id)
            .eq("cabang_id", dariCabang)
            .gt("qty", 0)
            .limit(15);
          if (debouncedBarangSearch)
            q = q.or(
              `part_number.ilike.%${debouncedBarangSearch}%,part_name.ilike.%${debouncedBarangSearch}%`,
              { referencedTable: "barang" },
            );
          const { data } = await q;
          setBarangResults((data || []).map((r: any) => one(r.barang)));
          return;
        }
        let q = supabase
          .from("barang")
          .select("id, part_number, part_name, part_satuan")
          .is("deleted_at", null)
          .order("part_name")
          .limit(15);
        if (debouncedBarangSearch)
          q = q.or(
            `part_number.ilike.%${debouncedBarangSearch}%,part_name.ilike.%${debouncedBarangSearch}%`,
          );
        const { data } = await q;
        setBarangResults(data || []);
      } finally {
        setBarangLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedBarangSearch, barangOpen, dariCabang]);

  const addItem = async (barang: any) => {
    if (!dariCabang || !keCabang) return;
    if (items.some((r) => r.part_id === barang.id && !r.from_ri && !r.from_mr)) {
      toast.error(`${barang.part_number} sudah ada di daftar.`);
      return;
    }
    // Cek awal sama seperti form create; validasi final tetap di server.
    if (isConsignment) {
      const { data: src } = await supabase
        .from("vendor_consignment_stock")
        .select("qty")
        .eq("vendor_id", it.it_vendor_id)
        .eq("cabang_id", dariCabang)
        .eq("part_id", barang.id)
        .maybeSingle();
      if (!(Number(src?.qty) > 0)) {
        toast.error(`Stok konsinyasi ${barang.part_number} di gudang asal kosong.`);
        return;
      }
    } else {
      const [{ data: src }, { data: dest }] = await Promise.all([
        supabase
          .from("stock")
          .select("qty")
          .eq("part_id", barang.id)
          .eq("cabang_id", dariCabang)
          .maybeSingle(),
        supabase
          .from("stock")
          .select("qty, max_qty")
          .eq("part_id", barang.id)
          .eq("cabang_id", keCabang)
          .maybeSingle(),
      ]);
      if (!(Number(src?.qty) > 0)) {
        toast.error(`Stok ${barang.part_number} di gudang asal kosong. Tidak bisa ditransfer.`);
        return;
      }
      const destMax = Number(dest?.max_qty) || 0;
      const destQty = Number(dest?.qty) || 0;
      if (destMax <= 0) {
        toast.error(`${barang.part_number} belum punya batas max stok di gudang tujuan.`);
        return;
      }
      if (destMax - destQty <= 0) {
        toast.error(`Stok ${barang.part_number} di gudang tujuan sudah penuh (${destQty}/${destMax}).`);
        return;
      }
    }
    setItems((prev) => [
      ...prev,
      {
        key: `new-${barang.id}-${Date.now()}`,
        part_id: barang.id,
        part_number: barang.part_number,
        part_name: barang.part_name,
        satuan: barang.part_satuan,
        qty: 1,
        orig_qty: 0,
        from_ri: false,
        from_mr: false,
      },
    ]);
    loadStockInfo([barang.id], dariCabang, keCabang, it);
    setBarangOpen(false);
    setBarangSearch("");
  };

  const updateQty = (key: string, raw: string) => {
    const qty = Math.max(0, parseInt(raw) || 0);
    setItems((prev) => prev.map((r) => (r.key === key ? { ...r, qty } : r)));
  };

  const removeItem = (key: string) =>
    setItems((prev) => prev.filter((r) => r.key !== key));

  const handleSubmit = async () => {
    if (!it) return;
    if (!itKode.trim()) return toast.error("Kode Item Transfer wajib diisi.");
    if (!itTanggal) return toast.error("Tanggal wajib diisi.");
    if (!dariCabang || !keCabang) return toast.error("Pilih gudang asal dan tujuan.");
    if (dariCabang === keCabang)
      return toast.error("Gudang asal dan tujuan tidak boleh sama.");
    if (isEkspedisi(shipmentType) && !kurir.trim())
      return toast.error("Isi nama ekspedisi/kurir.");
    if (shipmentType === "handcarry_eksternal" && !eksternalProvider.trim())
      return toast.error("Pilih penyedia handcarry eksternal.");
    // Berat tidak diwajibkan: IT lama belum punya detail koli.
    const koliErr = validateKoliForm(koli, { requireBerat: false });
    if (koliErr) return toast.error(koliErr);

    const itemsChanged = itemsSignature(items) !== originalItemsKey;
    if (itemsChanged) {
      if (items.length === 0) return toast.error("Daftar item tidak boleh kosong.");
      const bad = items.find((r) => !(r.qty > 0));
      if (bad) return toast.error(`Qty ${bad.part_number} minimal 1 (hapus barisnya kalau tidak dikirim).`);
    }

    let willReject = false;
    if (isModeratorMode) {
      if (approvals.length === 0) return toast.error("Jalur approval tidak boleh kosong.");
      if (approvals.some((a) => !a.userid || !a.nama))
        return toast.error("Setiap tahap approval harus punya approver yang dipilih.");
      willReject = approvals.some((a) => a.status === "rejected");
      if (willReject && !rejectionReason.trim())
        return toast.error("Alasan penolakan wajib diisi.");
      if (!reason.trim()) return toast.error("Alasan perubahan wajib diisi.");
    }

    const payload: ItemTransferEditPayload = {
      it_kode: itKode.trim(),
      it_tanggal: itTanggal,
      dari_cabang_id: dariCabang,
      ke_cabang_id: keCabang,
      shipment_type: shipmentType,
      ekspedisi: isEkspedisi(shipmentType)
        ? kurir
        : shipmentType === "handcarry_eksternal"
          ? eksternalProvider
          : "Handcarry Internal",
      sender_name: shipmentType === "handcarry_internal" ? senderName || null : null,
      eksternal_provider:
        shipmentType === "handcarry_eksternal" ? eksternalProvider || null : null,
      eksternal_id: shipmentType === "handcarry_eksternal" ? eksternalId || null : null,
      no_resi: isEkspedisi(shipmentType) ? noResi || null : null,
      estimasi_hari: estimasiHari,
      ...koliFormPayload(koli),
      layanan_kurir: isEkspedisi(shipmentType) ? layananKurir || null : null,
      rate_per_kg: isEkspedisi(shipmentType) ? ratePerKg || null : null,
      pic: users.find((u) => u.id === picUid)?.nama || it.pic || null,
      uid_pic: picUid || null,
      uid_receiver: receiverUid || null,
      remarks: remarks || null,
      items: itemsChanged
        ? items.map((r) => ({
            id: r.id,
            part_id: r.part_id,
            part_number: r.part_number,
            part_name: r.part_name,
            satuan: r.satuan,
            qty: r.qty,
          }))
        : undefined,
    };

    setSaving(true);
    try {
      const res = isModeratorMode
        ? await moderatorEditItemTransfer(itId, {
            ...payload,
            approvals,
            rejection_reason: willReject ? rejectionReason : undefined,
            reason: reason.trim(),
          })
        : await editItemTransfer(itId, payload);
      if ((res as any).error) {
        toast.error((res as any).error);
        return;
      }
      toast.success(
        isModeratorMode
          ? "Moderator Edit berhasil disimpan."
          : "Perubahan disimpan. Approval diulang dari tahap ke-2.",
      );
      onOpenChange(false);
      onSaved?.();
    } catch (err: any) {
      toast.error(err.message || "Terjadi kesalahan sistem");
    } finally {
      setSaving(false);
    }
  };

  const picName = users.find((u) => u.id === picUid)?.nama;
  const receiverName = users.find((u) => u.id === receiverUid)?.nama;
  const courierOptions = Array.from(new Set([...COURIERS, ...(kurir ? [kurir] : [])]));

  const lockNote = !it
    ? null
    : !isModeratorMode
      ? "Setelah disimpan, approval diulang dari tahap ke-2 dan approver dinotifikasi ulang."
      : completed
        ? "IT sudah selesai (barang diterima). Hanya kode, info dokumen & pengiriman yang bisa diubah; item, gudang, penerima, dan status approval dikunci."
        : released
          ? "Stok sudah keluar dari gudang asal. Gudang dikunci, status approval harus tetap Approved semua, dan perubahan qty langsung dikoreksi ke stok gudang asal."
          : "Kalau semua tahap approval di-set Approved, stok gudang asal langsung dikeluarkan seperti approve normal.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 rounded-xl border-border shadow-2xl overflow-hidden">
        <DialogHeader
          className={
            isModeratorMode
              ? "p-5 bg-warning/5 border-b border-warning/20"
              : "p-5 bg-primary/5 border-b border-primary/20"
          }
        >
          <div className="flex items-center gap-3">
            <div
              className={
                isModeratorMode
                  ? "h-10 w-10 bg-warning rounded-xl flex items-center justify-center shadow-sm shrink-0"
                  : "h-10 w-10 bg-primary rounded-xl flex items-center justify-center shadow-sm shrink-0"
              }
            >
              {isModeratorMode ? (
                <ShieldAlert className="h-5 w-5 text-warning-foreground" />
              ) : (
                <Pencil className="h-5 w-5 text-primary-foreground" />
              )}
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                {isModeratorMode ? "Moderator Edit Item Transfer" : "Edit Item Transfer"}
              </DialogTitle>
              <DialogDescription className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
                {it?.it_kode || "..."}
                {isModeratorMode ? " — override moderator" : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto bg-background">
          {loading || !it ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {lockNote && (
                <div
                  className={
                    isModeratorMode
                      ? "flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-[11px] font-medium text-foreground"
                      : "flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-[11px] font-medium text-foreground"
                  }
                >
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {lockNote}
                </div>
              )}

              {/* Info Dokumen */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Info Dokumen
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase">Kode Item Transfer</Label>
                    <Input
                      value={itKode}
                      onChange={(e) => setItKode(e.target.value)}
                      className="h-9 font-bold text-xs uppercase text-primary"
                    />
                    {kodeChanged && (
                      <p className="text-[9px] font-medium text-muted-foreground">
                        Kode lama <span className="font-bold">{it.it_kode}</span> tercatat di
                        Riwayat Kode.
                        {released &&
                          " Referensi di riwayat stok / kartu stok konsinyasi ikut diganti ke kode baru."}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase">Tanggal</Label>
                    <DatePickerString value={itTanggal} onChange={setItTanggal} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase flex items-center gap-1">
                      Gudang Asal {dariLocked && <Lock className="h-2.5 w-2.5" />}
                    </Label>
                    <Select
                      value={dariCabang ? String(dariCabang) : undefined}
                      onValueChange={(v) => setDariCabang(Number(v))}
                      disabled={dariLocked}
                    >
                      <SelectTrigger className="h-9 font-bold text-xs">
                        <SelectValue placeholder="Pilih gudang asal..." />
                      </SelectTrigger>
                      <SelectContent>
                        {cabangs.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)} className="text-xs font-bold">
                            {c.nama_cabang}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!released && hasRiRows && (
                      <p className="text-[9px] text-muted-foreground">
                        Ada item dari RI — gudang asal harus tetap gudang penerima RI.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase flex items-center gap-1">
                      Gudang Tujuan {keLocked && <Lock className="h-2.5 w-2.5" />}
                    </Label>
                    <Select
                      value={keCabang ? String(keCabang) : undefined}
                      onValueChange={(v) => setKeCabang(Number(v))}
                      disabled={keLocked}
                    >
                      <SelectTrigger className="h-9 font-bold text-xs">
                        <SelectValue placeholder="Pilih gudang tujuan..." />
                      </SelectTrigger>
                      <SelectContent>
                        {cabangs
                          .filter((c) => c.id !== dariCabang)
                          .map((c) => (
                            <SelectItem key={c.id} value={String(c.id)} className="text-xs font-bold">
                              {c.nama_cabang}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {!released && isConsignment && hasMrRows && (
                      <p className="text-[9px] text-muted-foreground">
                        Ada item dari MR site — gudang tujuan harus tetap gudang MR.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase">PIC</Label>
                    <Select value={picUid || undefined} onValueChange={setPicUid}>
                      <SelectTrigger className="h-9 font-bold text-xs">
                        <SelectValue placeholder={it.pic || "Pilih PIC..."}>{picName}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id} className="text-xs font-bold">
                            {u.nama}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase flex items-center gap-1">
                      Penerima {completed && <Lock className="h-2.5 w-2.5" />}
                    </Label>
                    <Select
                      value={receiverUid || undefined}
                      onValueChange={setReceiverUid}
                      disabled={completed}
                    >
                      <SelectTrigger className="h-9 font-bold text-xs">
                        <SelectValue placeholder="Pilih penerima...">{receiverName}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id} className="text-xs font-bold">
                            {u.nama}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-[10px] font-bold uppercase">Keterangan</Label>
                    <Textarea
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="Catatan tambahan (opsional)..."
                      className="min-h-16 resize-none text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Info Pengiriman */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Info Pengiriman
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase">Jenis Pengiriman</Label>
                    <Select
                      value={shipmentType}
                      onValueChange={(v) => {
                        const t = v as ShipmentType;
                        setShipmentType(t);
                        setEstimasiHari(defaultEstimasiHari(t));
                      }}
                    >
                      <SelectTrigger className="h-9 font-bold text-xs">
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
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase">Estimasi (Hari)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={estimasiHari}
                      onChange={(e) => setEstimasiHari(Math.max(1, parseInt(e.target.value) || 1))}
                      className="h-9 font-bold text-xs"
                    />
                  </div>

                  {isEkspedisi(shipmentType) && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase">Kurir</Label>
                        <Select value={kurir || undefined} onValueChange={setKurir}>
                          <SelectTrigger className="h-9 font-bold text-xs">
                            <SelectValue placeholder="Pilih kurir..." />
                          </SelectTrigger>
                          <SelectContent>
                            {courierOptions.map((c) => (
                              <SelectItem key={c} value={c} className="text-xs font-bold">
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase">No. Resi</Label>
                        <Input
                          value={noResi}
                          onChange={(e) => setNoResi(e.target.value)}
                          placeholder="Opsional"
                          className="h-9 font-bold text-xs"
                        />
                      </div>
                    </>
                  )}

                  {shipmentType === "handcarry_internal" && (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-[10px] font-bold uppercase">Nama Pengantar</Label>
                      <Input
                        value={senderName}
                        onChange={(e) => setSenderName(e.target.value)}
                        placeholder="Nama orang yg mengantar"
                        className="h-9 font-bold text-xs"
                      />
                    </div>
                  )}

                  {shipmentType === "handcarry_eksternal" && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase">Penyedia</Label>
                        <Select value={eksternalProvider || undefined} onValueChange={setEksternalProvider}>
                          <SelectTrigger className="h-9 font-bold text-xs">
                            <SelectValue placeholder="Pilih penyedia" />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from(
                              new Set([...HANDCARRY_PROVIDERS, ...(eksternalProvider ? [eksternalProvider] : [])]),
                            ).map((p) => (
                              <SelectItem key={p} value={p} className="text-xs font-bold">
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase">Order / Booking ID</Label>
                        <Input
                          value={eksternalId}
                          onChange={(e) => setEksternalId(e.target.value)}
                          placeholder="Opsional"
                          className="h-9 font-bold text-xs"
                        />
                      </div>
                    </>
                  )}

                  <div className="col-span-full">
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
                </div>
              </div>

              {/* Item */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                    Item {itemsLocked && <Lock className="h-2.5 w-2.5" />}
                  </h4>
                  {!itemsLocked && (
                    <Popover open={barangOpen} onOpenChange={setBarangOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px] font-bold">
                          <Plus className="h-3 w-3" /> Tambah Barang
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-[calc(100vw-2rem)] max-w-96 p-0 rounded-xl border-border shadow-xl overflow-hidden"
                      >
                        <div className="p-2 border-b border-border bg-muted/40">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              autoFocus
                              placeholder={
                                isConsignment
                                  ? "Cari stok konsinyasi vendor di gudang asal..."
                                  : "Cari part number / nama barang..."
                              }
                              className="h-9 pl-8 bg-background text-xs font-medium"
                              value={barangSearch}
                              onChange={(e) => setBarangSearch(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto p-1.5 bg-background">
                          {barangLoading ? (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : barangResults.length === 0 ? (
                            <p className="text-center text-[11px] text-muted-foreground py-4 italic">
                              Barang tidak ditemukan.
                            </p>
                          ) : (
                            barangResults.map((b) => (
                              <button
                                key={b.id}
                                onClick={() => addItem(b)}
                                className="w-full text-left p-2.5 rounded-lg hover:bg-muted transition-all"
                              >
                                <span className="font-mono font-bold text-xs uppercase block">
                                  {b.part_number}
                                </span>
                                <span className="text-[10px] text-muted-foreground">{b.part_name}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                {items.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-6 border border-dashed border-border rounded-xl">
                    Tidak ada item.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {items.map((r) => {
                      const s = stockInfo[r.part_id];
                      return (
                        <div
                          key={r.key}
                          className="flex items-center gap-2 bg-muted/40 p-2.5 rounded-lg border border-border"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-[11px] font-bold uppercase truncate">
                                {r.part_number}
                              </span>
                              {r.ri_kode && (
                                <Badge variant="outline" className="text-[8px] font-bold uppercase">
                                  {r.ri_kode}
                                </Badge>
                              )}
                              {r.mr_kode && (
                                <Badge variant="outline" className="text-[8px] font-bold uppercase">
                                  {r.mr_kode}
                                </Badge>
                              )}
                              {r.id === undefined && (
                                <Badge className="text-[8px] font-bold uppercase bg-success/10 text-success border-none">
                                  Baru
                                </Badge>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground truncate block">
                              {r.part_name}
                            </span>
                            {s && (
                              <span className="text-[9px] font-semibold text-muted-foreground/80 block">
                                {released
                                  ? `Sisa stok asal ${s.avail} (qty bisa ditambah s/d +${s.avail})`
                                  : `Stok asal ${s.avail}`}
                                {!isConsignment && ` · Tujuan ${s.destQty}/${s.destMax || "-"}`}
                              </span>
                            )}
                          </div>
                          <Input
                            type="number"
                            min={1}
                            value={r.qty}
                            onChange={(e) => updateQty(r.key, e.target.value)}
                            disabled={itemsLocked}
                            className="h-8 w-20 text-center font-bold text-xs shrink-0"
                          />
                          <span className="text-[9px] font-bold text-muted-foreground w-10 shrink-0 uppercase">
                            {r.satuan}
                          </span>
                          {!itemsLocked && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => removeItem(r.key)}
                              disabled={released && isConsignment && r.id !== undefined}
                              title={
                                released && isConsignment && r.id !== undefined
                                  ? "IT konsinyasi dalam pengiriman: kurangi qty saja"
                                  : "Hapus item"
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Approval (moderator) */}
              {isModeratorMode && (
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Jalur & Status Approval
                  </h4>
                  <ApprovalFlowEditor
                    steps={approvals}
                    onChange={setApprovals}
                    templateType="Item Transfer"
                    templateCabangId={dariCabang}
                    requesterId={it?.uid_requester ?? it?.created_by ?? null}
                  />
                  {approvals.some((a) => a.status === "rejected") && (
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-bold uppercase">
                        Alasan Penolakan (wajib)
                      </Label>
                      <Textarea
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        placeholder="Alasan IT ini ditolak..."
                        className="min-h-16 resize-none text-xs"
                      />
                    </div>
                  )}
                </div>
              )}

              {isModeratorMode && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                    <Info className="h-3 w-3" /> Alasan Perubahan (wajib)
                  </Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Jelaskan kenapa Item Transfer ini diubah..."
                    className="min-h-20 text-xs"
                    disabled={saving}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="p-5 bg-muted/30 border-t border-border gap-2 sm:flex-row">
          <Button
            variant="ghost"
            className="flex-1 h-10 font-semibold text-sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Batal
          </Button>
          <Button
            className="flex-1 h-10 font-bold text-sm"
            onClick={handleSubmit}
            disabled={saving || loading || !it}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isModeratorMode ? (
              "Simpan Moderator Edit"
            ) : (
              "Simpan Perubahan"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
