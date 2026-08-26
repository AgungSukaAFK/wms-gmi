"use client";

// Dialog moderator untuk edit delivery yang sudah ada — info logistik
// (kurir/no resi/PIC/penerima/dll, resiko rendah) dan/atau item & qty barang
// (resiko tinggi, berdampak ke stok & alokasi share-stock). Item lama
// direverse dulu baru item baru divalidasi ulang di server
// (moderatorEditDelivery, services/inventory-actions.ts) — dialog ini cuma
// menyiapkan payload-nya, semua aritmatika stok terjadi di server.

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
import { Loader2, Plus, Trash2, Info, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  moderatorEditDelivery,
  getShareStockRemaining,
} from "@/services/inventory-actions";
import {
  isEkspedisi,
  SHIPMENT_LABEL,
  type ShipmentType,
} from "@/lib/shipment";

interface DeliveryItemRow {
  mr_item_id?: number;
  mr_kode?: string;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty_on_delivery: number;
}

interface EditDeliveryDialogProps {
  deliveryId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: () => void;
}

function itemsSignature(items: DeliveryItemRow[]): string {
  return JSON.stringify(
    items
      .filter((i) => i.qty_on_delivery > 0)
      .map((i) => [i.mr_item_id ?? null, i.part_id, i.qty_on_delivery])
      .sort(),
  );
}

export function EditDeliveryDialog({
  deliveryId,
  open,
  onOpenChange,
  onUpdated,
}: EditDeliveryDialogProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [delivery, setDelivery] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [shareStocks, setShareStocks] = useState<any[]>([]);
  const [remainingByItemId, setRemainingByItemId] = useState<
    Record<number, number>
  >({});

  const [dlvKode, setDlvKode] = useState("");
  const [ekspedisi, setEkspedisi] = useState("");
  const [shipmentType, setShipmentType] =
    useState<ShipmentType>("ekspedisi_laut");
  const [senderName, setSenderName] = useState("");
  const [eksternalProvider, setEksternalProvider] = useState("");
  const [eksternalId, setEksternalId] = useState("");
  const [noResi, setNoResi] = useState("");
  const [estimasiHari, setEstimasiHari] = useState(1);
  const [jumlahKoli, setJumlahKoli] = useState(1);
  const [picUid, setPicUid] = useState("");
  const [receiverUid, setReceiverUid] = useState("");

  const [items, setItems] = useState<DeliveryItemRow[]>([]);
  const [originalItemsKey, setOriginalItemsKey] = useState("");
  const [itemsTouched, setItemsTouched] = useState(false);
  const [shareStockSearch, setShareStockSearch] = useState("");
  const [shareStockPopoverOpen, setShareStockPopoverOpen] = useState(false);

  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open && deliveryId) {
      fetchData();
      setReason("");
      setItemsTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deliveryId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: dlvData } = await supabase
        .from("deliveries")
        .select("*")
        .eq("id", deliveryId)
        .single();
      setDelivery(dlvData);
      if (dlvData) {
        setDlvKode(dlvData.dlv_kode || "");
        setEkspedisi(dlvData.ekspedisi || "");
        setShipmentType(
          (dlvData.shipment_type as ShipmentType) || "ekspedisi_laut",
        );
        setSenderName(dlvData.sender_name || "");
        setEksternalProvider(dlvData.eksternal_provider || "");
        setEksternalId(dlvData.eksternal_id || "");
        setNoResi(dlvData.no_resi || "");
        setEstimasiHari(dlvData.estimasi_hari || 1);
        setJumlahKoli(dlvData.jumlah_koli || 1);
        setPicUid(dlvData.uid_pic || "");
        setReceiverUid(dlvData.uid_receiver || "");
      }

      const { data: usersData } = await supabase
        .from("profiles")
        .select("id, nama, cabang_id, cabang(nama_cabang)")
        .eq("is_active", true)
        .order("nama");
      setUsers(usersData || []);

      const { data: itemsData } = await supabase
        .from("delivery_items")
        .select(
          "mr_item_id, part_id, part_number, part_name, satuan, qty_on_delivery, mr_items(mrs(mr_kode))",
        )
        .eq("dlv_id", deliveryId)
        .order("created_at");
      const rows: DeliveryItemRow[] = (itemsData || []).map((i: any) => ({
        mr_item_id: i.mr_item_id ?? undefined,
        mr_kode: i.mr_items?.mrs?.mr_kode,
        part_id: i.part_id,
        part_number: i.part_number,
        part_name: i.part_name,
        satuan: i.satuan,
        qty_on_delivery: i.qty_on_delivery,
      }));
      setItems(rows);
      setOriginalItemsKey(itemsSignature(rows));

      if (dlvData) {
        const { data: ssData } = await supabase
          .from("mr_items")
          .select(
            "*, barang(part_number, part_name, part_satuan), mrs!inner(id, mr_kode, mr_status, cabang_id), mr_sharestock_allocations(id, source_cabang_id, qty)",
          )
          .gt("qty_sharestock_total", 0)
          .in("ss_status", ["open", "approved"])
          .eq("mrs.mr_status", "approved")
          .eq("mrs.is_frozen", false)
          .eq("mrs.cabang_id", dlvData.ke_cabang_id);
        setShareStocks(ssData || []);

        const mrItemIds = (ssData || []).map((s: any) => s.id);
        if (mrItemIds.length > 0) {
          const result = await getShareStockRemaining(
            mrItemIds,
            dlvData.dari_cabang_id,
          );
          if ("data" in result) {
            // Tambahkan kembali qty item yang SUDAH dipegang delivery ini
            // sendiri — supaya moderator bisa pertahankan/naikkan qty item
            // existing tanpa kena cap "sisa alokasi" seolah delivery ini
            // tidak pernah ada.
            const adjusted: Record<number, number> = { ...result.data };
            for (const row of rows) {
              if (row.mr_item_id) {
                adjusted[row.mr_item_id] =
                  (adjusted[row.mr_item_id] ?? 0) + row.qty_on_delivery;
              }
            }
            setRemainingByItemId(adjusted);
          }
        }
      }
    } catch (err) {
      console.error("Fetch edit delivery data error:", err);
      toast.error("Gagal memuat data delivery");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateQty = (idx: number, qty: number) => {
    setItems((prev) => {
      const next = [...prev];
      const item = next[idx];
      const cap = item.mr_item_id
        ? (remainingByItemId[item.mr_item_id] ?? Infinity)
        : Infinity;
      const safeQty = Number.isFinite(qty) ? qty : 0;
      const clamped = Math.min(Math.max(0, safeQty), Math.max(0, cap));
      next[idx] = { ...item, qty_on_delivery: clamped };
      return next;
    });
    setItemsTouched(true);
  };

  const handleRemoveItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
    setItemsTouched(true);
  };

  const handleAddShareStock = (ss: any) => {
    if (!delivery) return;
    if (items.find((i) => i.mr_item_id === ss.id)) {
      toast.error("Item sudah ada di delivery ini");
      return;
    }
    const myAlloc = (ss.mr_sharestock_allocations as any[])?.find(
      (a) => a.source_cabang_id === delivery.dari_cabang_id,
    );
    if (!myAlloc) {
      toast.error(
        "Cabang asal delivery ini tidak terdaftar sebagai pengirim untuk item ini.",
      );
      return;
    }
    const remaining = remainingByItemId[ss.id] ?? myAlloc.qty;
    if (remaining <= 0) {
      toast.error(`Alokasi share stock ${ss.barang.part_name} sudah habis.`);
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        mr_item_id: ss.id,
        mr_kode: ss.mrs.mr_kode,
        part_id: ss.part_id,
        part_number: ss.barang.part_number,
        part_name: ss.barang.part_name,
        satuan: ss.barang.part_satuan,
        qty_on_delivery: Math.min(remaining, 1),
      },
    ]);
    setShareStockPopoverOpen(false);
    setItemsTouched(true);
  };

  const handleSubmit = async () => {
    if (!delivery) return;
    if (!reason.trim()) {
      toast.error("Alasan perubahan wajib diisi");
      return;
    }
    if (!dlvKode.trim()) {
      toast.error("Nomor Delivery tidak boleh kosong");
      return;
    }

    const itemsChanged =
      itemsTouched && itemsSignature(items) !== originalItemsKey;
    const finalItems = items.filter((i) => i.qty_on_delivery > 0);
    if (itemsChanged && finalItems.length === 0) {
      toast.error(
        "Item delivery tidak boleh kosong — hapus delivery kalau memang mau dikosongkan.",
      );
      return;
    }

    const headerChanged =
      dlvKode.trim() !== (delivery.dlv_kode || "") ||
      ekspedisi !== (delivery.ekspedisi || "") ||
      shipmentType !== (delivery.shipment_type || "ekspedisi_laut") ||
      senderName !== (delivery.sender_name || "") ||
      eksternalProvider !== (delivery.eksternal_provider || "") ||
      eksternalId !== (delivery.eksternal_id || "") ||
      noResi !== (delivery.no_resi || "") ||
      estimasiHari !== (delivery.estimasi_hari || 1) ||
      jumlahKoli !== (delivery.jumlah_koli || 1) ||
      picUid !== (delivery.uid_pic || "") ||
      receiverUid !== (delivery.uid_receiver || "");

    if (!itemsChanged && !headerChanged) {
      toast.error("Tidak ada perubahan untuk disimpan");
      return;
    }

    setSaving(true);
    try {
      const result = await moderatorEditDelivery(deliveryId, {
        reason: reason.trim(),
        header: headerChanged
          ? {
              dlv_kode: dlvKode.trim(),
              ekspedisi,
              shipment_type: shipmentType,
              sender_name:
                shipmentType === "handcarry_internal"
                  ? senderName || null
                  : null,
              eksternal_provider:
                shipmentType === "handcarry_eksternal"
                  ? eksternalProvider || null
                  : null,
              eksternal_id:
                shipmentType === "handcarry_eksternal"
                  ? eksternalId || null
                  : null,
              no_resi: isEkspedisi(shipmentType) ? noResi || null : null,
              estimasi_hari: estimasiHari,
              jumlah_koli: jumlahKoli,
              uid_pic: picUid || null,
              uid_receiver: receiverUid || null,
            }
          : undefined,
        items: itemsChanged
          ? finalItems.map((i) => ({
              mr_item_id: i.mr_item_id,
              part_id: i.part_id,
              part_number: i.part_number,
              part_name: i.part_name,
              satuan: i.satuan,
              qty_on_delivery: i.qty_on_delivery,
            }))
          : undefined,
      });

      if (result.success) {
        toast.success("Delivery berhasil diubah");
        onOpenChange(false);
        onUpdated?.();
      } else {
        toast.error(result.error || "Gagal mengubah delivery");
      }
    } catch (err: any) {
      toast.error(err.message || "Terjadi kesalahan sistem");
    } finally {
      setSaving(false);
    }
  };

  const picName = users.find((u) => u.id === picUid)?.nama;
  const receiverName = users.find((u) => u.id === receiverUid)?.nama;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 rounded-xl border-border shadow-2xl overflow-hidden">
        <DialogHeader className="p-5 bg-warning/5 border-b border-warning/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-warning rounded-xl flex items-center justify-center shadow-sm shrink-0">
              <ShieldAlert className="h-5 w-5 text-warning-foreground" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                Edit Delivery
              </DialogTitle>
              <DialogDescription className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
                {delivery?.dlv_kode || "..."} — override moderator
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-5 max-h-[65vh] overflow-y-auto bg-background">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Info Logistik */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Info Logistik
                </h4>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase">
                    Nomor Delivery
                  </Label>
                  <Input
                    value={dlvKode}
                    onChange={(e) => setDlvKode(e.target.value)}
                    placeholder="DLV/XXXX/2026..."
                    className="h-9 font-bold text-xs uppercase text-primary"
                  />
                  <p className="text-[9px] font-medium text-muted-foreground/70">
                    Referensi lama (mis. di stock movement/riwayat sebelumnya)
                    tetap menampilkan nomor lama — cuma dokumen ini yang berganti nomor.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase">
                      Jenis Pengiriman
                    </Label>
                    <Select
                      value={shipmentType}
                      onValueChange={(v) => setShipmentType(v as ShipmentType)}
                    >
                      <SelectTrigger className="h-9 font-bold text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(SHIPMENT_LABEL)
                          .filter(([v]) => v !== "ekspedisi")
                          .map(([v, label]) => (
                            <SelectItem key={v} value={v} className="text-xs font-bold">
                              {label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase">
                      Estimasi (Hari)
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      value={estimasiHari}
                      onChange={(e) =>
                        setEstimasiHari(Math.max(1, parseInt(e.target.value) || 1))
                      }
                      className="h-9 font-bold text-xs"
                    />
                  </div>

                  {shipmentType === "handcarry_internal" && (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-[10px] font-bold uppercase">
                        Nama Pengirim
                      </Label>
                      <Input
                        value={senderName}
                        onChange={(e) => setSenderName(e.target.value)}
                        placeholder="Nama kurir/pengirim internal..."
                        className="h-9 font-bold text-xs"
                      />
                    </div>
                  )}

                  {shipmentType === "handcarry_eksternal" && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase">
                          Layanan
                        </Label>
                        <Select
                          value={eksternalProvider}
                          onValueChange={setEksternalProvider}
                        >
                          <SelectTrigger className="h-9 font-bold text-xs">
                            <SelectValue placeholder="Pilih layanan..." />
                          </SelectTrigger>
                          <SelectContent>
                            {["Gojek", "Grab", "Maxim", "Lalamove"].map((p) => (
                              <SelectItem key={p} value={p} className="text-xs font-bold">
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase">
                          ID Pengiriman
                        </Label>
                        <Input
                          value={eksternalId}
                          onChange={(e) => setEksternalId(e.target.value)}
                          className="h-9 font-bold text-xs"
                        />
                      </div>
                    </>
                  )}

                  {isEkspedisi(shipmentType) && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase">
                          Kurir
                        </Label>
                        <Input
                          value={ekspedisi}
                          onChange={(e) => setEkspedisi(e.target.value)}
                          placeholder="JNE, J&T, dll..."
                          className="h-9 font-bold text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase">
                          Nomor Resi
                        </Label>
                        <Input
                          value={noResi}
                          onChange={(e) => setNoResi(e.target.value)}
                          className="h-9 font-bold text-xs"
                        />
                      </div>
                    </>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase">
                      Jumlah Koli
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      value={jumlahKoli}
                      onChange={(e) =>
                        setJumlahKoli(Math.max(1, parseInt(e.target.value) || 1))
                      }
                      className="h-9 font-bold text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase">PIC</Label>
                    <Select value={picUid || undefined} onValueChange={setPicUid}>
                      <SelectTrigger className="h-9 font-bold text-xs">
                        <SelectValue placeholder="Pilih PIC...">
                          {picName}
                        </SelectValue>
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
                    <Label className="text-[10px] font-bold uppercase">
                      Penerima
                    </Label>
                    <Select
                      value={receiverUid || undefined}
                      onValueChange={setReceiverUid}
                    >
                      <SelectTrigger className="h-9 font-bold text-xs">
                        <SelectValue placeholder="Pilih penerima...">
                          {receiverName}
                        </SelectValue>
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
                </div>
              </div>

              {/* Item */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Item Delivery
                  </h4>
                  <Popover
                    open={shareStockPopoverOpen}
                    onOpenChange={setShareStockPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-[11px] font-bold"
                      >
                        <Plus className="h-3 w-3" /> Tambah Item
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[calc(100vw-2rem)] max-w-100 p-0 rounded-xl border-border shadow-xl overflow-hidden">
                      <div className="p-2 border-b border-border bg-muted/40">
                        <Input
                          placeholder="Cari item share stock..."
                          className="h-9 bg-background text-xs font-medium"
                          value={shareStockSearch}
                          onChange={(e) => setShareStockSearch(e.target.value)}
                        />
                      </div>
                      <div className="max-h-62.5 overflow-y-auto p-1.5 text-sm bg-background">
                        {shareStocks
                          .filter((ss) => {
                            const kw = shareStockSearch.toLowerCase();
                            return (
                              ss.barang.part_number.toLowerCase().includes(kw) ||
                              ss.barang.part_name.toLowerCase().includes(kw)
                            );
                          })
                          .map((ss) => (
                            <button
                              key={ss.id}
                              onClick={() => handleAddShareStock(ss)}
                              className="w-full text-left p-2.5 rounded-lg hover:bg-muted transition-all mb-1"
                            >
                              <span className="font-bold text-xs uppercase tracking-tight block">
                                {ss.barang.part_number} - {ss.barang.part_name}
                              </span>
                              <span className="text-[9px] uppercase font-medium opacity-60">
                                {ss.mrs.mr_kode} | Sisa: {remainingByItemId[ss.id] ?? 0}{" "}
                                {ss.barang.part_satuan}
                              </span>
                            </button>
                          ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {items.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-6 border border-dashed border-border rounded-xl">
                    Tidak ada item.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {items.map((item, idx) => {
                      const cap = item.mr_item_id
                        ? remainingByItemId[item.mr_item_id]
                        : undefined;
                      return (
                        <div
                          key={idx}
                          className="flex items-center gap-2 bg-muted/40 p-2.5 rounded-lg border border-border"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              {item.mr_kode && (
                                <Badge
                                  variant="outline"
                                  className="text-[8px] font-bold uppercase shrink-0"
                                >
                                  {item.mr_kode}
                                </Badge>
                              )}
                              <span className="font-mono text-[11px] font-bold uppercase truncate">
                                {item.part_number}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground truncate block">
                              {item.part_name}
                            </span>
                          </div>
                          <Input
                            type="number"
                            min={0}
                            max={typeof cap === "number" ? cap : undefined}
                            value={item.qty_on_delivery}
                            onChange={(e) =>
                              handleUpdateQty(idx, parseInt(e.target.value))
                            }
                            className="h-8 w-20 text-center font-bold text-xs shrink-0"
                          />
                          <span className="text-[9px] font-bold text-muted-foreground w-10 shrink-0">
                            {item.satuan}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => handleRemoveItem(idx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-[9px] font-bold uppercase text-muted-foreground/60 flex items-center gap-1.5">
                  <Info className="h-3 w-3" /> Qty 0 = item akan dihapus dari
                  delivery. Cabang asal/tujuan tidak bisa diubah dari sini.
                </p>
              </div>

              <div className="space-y-1.5 pt-1">
                <Label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                  <Info className="h-3 w-3" /> Alasan Perubahan (wajib)
                </Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Jelaskan kenapa delivery ini diubah..."
                  className="min-h-20 text-xs"
                  disabled={saving}
                />
              </div>
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
            disabled={saving || loading}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Perubahan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
