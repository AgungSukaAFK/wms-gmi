"use client";

// Dialog moderator/admin untuk edit metadata DO Reguler (info dokumen &
// pengiriman), tanpa menyentuh item/stok (updateDoReguler,
// services/do-reguler-actions.ts). Input pengiriman sama seperti form create
// & edit Item Transfer: jenis/kurir/penyedia pakai dropdown, field yang tidak
// relevan dengan jenis pengiriman dikosongkan saat simpan.
//
// DO hasil import masih ber-shipment_type lama 'ekspedisi' tanpa kurir —
// nilai itu tetap jadi pilihan "(data lama)" supaya moderator bisa edit field
// lain tanpa dipaksa melengkapi kurir.

import React, { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { DatePickerString } from "@/components/date-picker-string";
import { KoliDetailEditor } from "@/components/shipment/koli-detail-editor";
import { updateDoReguler } from "@/services/do-reguler-actions";
import {
  SHIPMENT_LABEL,
  defaultEstimasiHari,
  isEkspedisi,
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
const SHIPMENT_TYPES = [
  "handcarry_internal",
  "handcarry_eksternal",
  "ekspedisi_laut",
  "ekspedisi_udara",
];

interface EditDoRegulerDialogProps {
  doRow: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function EditDoRegulerDialog({
  doRow,
  open,
  onOpenChange,
  onSaved,
}: EditDoRegulerDialogProps) {
  const [saving, setSaving] = useState(false);

  const [doTanggal, setDoTanggal] = useState("");
  const [kodePo, setKodePo] = useState("");
  const [pic, setPic] = useState("");
  const [remarks, setRemarks] = useState("");

  const [shipmentType, setShipmentType] = useState("ekspedisi_laut");
  const [kurir, setKurir] = useState("");
  const [senderName, setSenderName] = useState("");
  const [eksternalProvider, setEksternalProvider] = useState("");
  const [eksternalId, setEksternalId] = useState("");
  const [noResi, setNoResi] = useState("");
  const [estimasiHari, setEstimasiHari] = useState(1);
  const [koli, setKoli] = useState<KoliFormState>(initialKoliForm);
  const [layananKurir, setLayananKurir] = useState("");
  const [ratePerKg, setRatePerKg] = useState(0);

  // Jenis pengiriman di luar 4 pilihan sekarang (mis. 'ekspedisi' lama).
  const origShipmentType: string = doRow?.shipment_type || "";
  const legacyShipmentType =
    origShipmentType && !SHIPMENT_TYPES.includes(origShipmentType)
      ? origShipmentType
      : null;

  useEffect(() => {
    if (!open || !doRow) return;
    const t = doRow.shipment_type || "ekspedisi_laut";
    setDoTanggal(doRow.do_tanggal ? String(doRow.do_tanggal).slice(0, 10) : "");
    setKodePo(doRow.kode_po || "");
    setPic(doRow.pic || "");
    setRemarks(doRow.remarks || "");
    setShipmentType(t);
    setKurir(isEkspedisi(t) ? doRow.ekspedisi || "" : "");
    setSenderName(doRow.sender_name || "");
    setEksternalProvider(
      doRow.eksternal_provider ||
        (t === "handcarry_eksternal" ? doRow.ekspedisi || "" : ""),
    );
    setEksternalId(doRow.eksternal_id || "");
    setNoResi(doRow.no_resi || "");
    setEstimasiHari(doRow.estimasi_hari || 1);
    setKoli(koliFormFromDoc(doRow));
    setLayananKurir(doRow.layanan_kurir || "");
    setRatePerKg(Number(doRow.rate_per_kg) || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doRow?.id]);

  const handleSubmit = async () => {
    if (!doRow) return;
    if (!doTanggal) return toast.error("Tanggal DO wajib diisi.");
    // Kurir wajib untuk ekspedisi laut/udara (sama seperti form create);
    // 'ekspedisi' lama boleh tetap tanpa kurir.
    if (
      isEkspedisi(shipmentType) &&
      shipmentType !== legacyShipmentType &&
      !kurir.trim()
    )
      return toast.error("Pilih kurir ekspedisi.");
    if (shipmentType === "handcarry_eksternal" && !eksternalProvider.trim())
      return toast.error("Pilih penyedia handcarry eksternal.");
    // Berat tidak diwajibkan: DO lama belum punya detail koli.
    const koliErr = validateKoliForm(koli, { requireBerat: false });
    if (koliErr) return toast.error(koliErr);

    const ekspedisi = isEkspedisi(shipmentType);
    setSaving(true);
    try {
      const res = await updateDoReguler(doRow.id, {
        do_tanggal: doTanggal,
        kode_po: kodePo,
        shipment_type: shipmentType,
        ekspedisi: ekspedisi
          ? kurir
          : shipmentType === "handcarry_eksternal"
            ? eksternalProvider
            : "Handcarry Internal",
        sender_name: shipmentType === "handcarry_internal" ? senderName : undefined,
        eksternal_provider:
          shipmentType === "handcarry_eksternal" ? eksternalProvider : undefined,
        eksternal_id: shipmentType === "handcarry_eksternal" ? eksternalId : undefined,
        no_resi: ekspedisi ? noResi : undefined,
        estimasi_hari: estimasiHari,
        ...koliFormPayload(koli),
        layanan_kurir: ekspedisi ? layananKurir : undefined,
        rate_per_kg: ekspedisi ? ratePerKg : undefined,
        pic,
        remarks,
      });
      if ((res as any).error) return toast.error((res as any).error);
      toast.success("DO Reguler berhasil diperbarui");
      onOpenChange(false);
      onSaved?.();
    } catch (err: any) {
      toast.error(err.message || "Terjadi kesalahan sistem");
    } finally {
      setSaving(false);
    }
  };

  const courierOptions = Array.from(new Set([...COURIERS, ...(kurir ? [kurir] : [])]));
  const providerOptions = Array.from(
    new Set([...HANDCARRY_PROVIDERS, ...(eksternalProvider ? [eksternalProvider] : [])]),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 rounded-xl border-border shadow-2xl overflow-hidden">
        <DialogHeader className="p-5 bg-primary/5 border-b border-primary/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded-xl flex items-center justify-center shadow-sm shrink-0">
              <Pencil className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                Edit DO Reguler
              </DialogTitle>
              <DialogDescription className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
                {doRow?.do_kode || "..."} — info dokumen & pengiriman (item tidak berubah)
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto bg-background">
          {/* Info Dokumen */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Info Dokumen
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase">Tanggal DO</Label>
                <DatePickerString value={doTanggal} onChange={setDoTanggal} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase">Nomor PO Customer</Label>
                <Input
                  value={kodePo}
                  onChange={(e) => setKodePo(e.target.value)}
                  placeholder="Opsional"
                  className="h-9 font-bold text-xs"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-[10px] font-bold uppercase">PIC</Label>
                <Input
                  value={pic}
                  onChange={(e) => setPic(e.target.value)}
                  placeholder="Penanggung jawab (opsional)"
                  className="h-9 font-bold text-xs"
                />
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
                  onValueChange={(t) => {
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
                    {legacyShipmentType && (
                      <SelectItem value={legacyShipmentType} className="text-xs font-bold">
                        {SHIPMENT_LABEL[legacyShipmentType] || legacyShipmentType} (data lama)
                      </SelectItem>
                    )}
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
                        {providerOptions.map((p) => (
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
            disabled={saving || !doRow}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Perubahan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
