"use client";

import React, { useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QrCode, Printer, AlertTriangle } from "lucide-react";
import { QrCodeSvg } from "@/components/barang/qr-code-svg";
import {
  STICKER_SIZE_TEMPLATES,
  StickerTemplateKey,
  Orientation,
  computeStickerGrid,
} from "@/lib/barcode-sheet";

interface BarcodePrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barang: {
    part_number: string;
    part_name: string | null;
    part_satuan: string | null;
  } | null;
}

type TemplateChoice = StickerTemplateKey | "custom";

export function BarcodePrintDialog({
  open,
  onOpenChange,
  barang,
}: BarcodePrintDialogProps) {
  // String, bukan number — supaya field-nya bisa dikosongkan total waktu
  // diketik ulang, tidak dipaksa balik ke 1.
  const [qtyInput, setQtyInput] = useState("20");
  const [template, setTemplate] = useState<TemplateChoice>("M");
  const [customWidth, setCustomWidth] = useState(90);
  const [customHeight, setCustomHeight] = useState(54);
  const [orientation, setOrientation] = useState<Orientation>("portrait");

  useEffect(() => {
    if (open) {
      setQtyInput("20");
      setTemplate("M");
      setOrientation("portrait");
      setCustomWidth(90);
      setCustomHeight(54);
    }
  }, [open, barang?.part_number]);

  const qty = Math.max(0, parseInt(qtyInput, 10) || 0);

  const { width, height } = useMemo(() => {
    if (template === "custom") {
      return { width: customWidth || 0, height: customHeight || 0 };
    }
    const t = STICKER_SIZE_TEMPLATES[template];
    return { width: t.width, height: t.height };
  }, [template, customWidth, customHeight]);

  const grid = useMemo(
    () => computeStickerGrid(orientation, width, height),
    [orientation, width, height],
  );
  const totalPages =
    grid.perPage > 0 && qty > 0 ? Math.ceil(qty / grid.perPage) : 0;
  const canPrint = grid.perPage > 0 && qty > 0;

  if (!barang) return null;

  const handlePrint = () => {
    if (!canPrint) return;
    const params = new URLSearchParams({
      pn: barang.part_number,
      name: barang.part_name || "",
      satuan: barang.part_satuan || "",
      qty: String(qty),
      w: String(width),
      h: String(height),
      orientation,
    });
    window.open(`/barang/print-barcode?${params.toString()}`, "_blank");
    onOpenChange(false);
  };

  // Skala mini A4 buat schematic preview (px per mm), dibuat cukup besar
  // biar keliatan tapi tetap muat di dialog.
  const previewScale = orientation === "landscape" ? 220 / grid.page.width : 160 / grid.page.width;
  const previewPageW = grid.page.width * previewScale;
  const previewPageH = grid.page.height * previewScale;
  const previewStickerW = width * previewScale;
  const previewStickerH = height * previewScale;
  const previewMargin = 8 * previewScale;
  const previewGap = 2 * previewScale;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 rounded-xl overflow-hidden">
        <DialogHeader className="p-5 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg shrink-0">
              <QrCode className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                Cetak QR Code
              </DialogTitle>
              <DialogDescription className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
                {barang.part_number} — {barang.part_name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[70vh] overflow-y-auto">
          {/* Form kontrol */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                Jumlah Sticker (Qty)
              </Label>
              <Input
                type="number"
                min={1}
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                placeholder="Isi jumlah..."
                className="h-10"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                Ukuran Template
              </Label>
              <Select
                value={template}
                onValueChange={(v) => setTemplate(v as TemplateChoice)}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.entries(STICKER_SIZE_TEMPLATES) as [
                      StickerTemplateKey,
                      (typeof STICKER_SIZE_TEMPLATES)[StickerTemplateKey],
                    ][]
                  ).map(([key, t]) => (
                    <SelectItem key={key} value={key}>
                      {t.label} ({t.width} × {t.height} mm)
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom...</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {template === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                    Panjang (mm)
                  </Label>
                  <Input
                    type="number"
                    min={5}
                    value={customWidth}
                    onChange={(e) =>
                      setCustomWidth(parseFloat(e.target.value) || 0)
                    }
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                    Lebar (mm)
                  </Label>
                  <Input
                    type="number"
                    min={5}
                    value={customHeight}
                    onChange={(e) =>
                      setCustomHeight(parseFloat(e.target.value) || 0)
                    }
                    className="h-10"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                Orientasi Kertas A4
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={orientation === "portrait" ? "default" : "outline"}
                  className="h-10"
                  onClick={() => setOrientation("portrait")}
                >
                  Portrait
                </Button>
                <Button
                  type="button"
                  variant={
                    orientation === "landscape" ? "default" : "outline"
                  }
                  className="h-10"
                  onClick={() => setOrientation("landscape")}
                >
                  Landscape
                </Button>
              </div>
            </div>

            {/* Contoh 1 sticker */}
            <div className="space-y-1.5 pt-2">
              <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                Contoh Sticker
              </Label>
              <div
                className="border border-dashed mx-auto"
                style={{
                  width: `${Math.min(width, 90) * 2}px`,
                  height: `${Math.min(height, 90) * 2}px`,
                  maxWidth: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem",
                  // Inline hex + colorScheme "only light" supaya preview ini
                  // kebal dari dark mode (baik tema app maupun force-dark
                  // browser) — sebelumnya pakai class Tailwind bg-black/
                  // text-white yang ternyata masih bisa ke-override.
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  borderColor: "#000000",
                  colorScheme: "only light",
                }}
              >
                <div
                  className="shrink-0"
                  style={{
                    width: `${Math.min(height, width * 0.42) * 2 * 0.8}px`,
                    height: `${Math.min(height, width * 0.42) * 2 * 0.8}px`,
                  }}
                >
                  <QrCodeSvg value={barang.part_number} />
                </div>
                <div className="min-w-0 flex-1 h-full flex flex-col justify-center overflow-hidden">
                  <div
                    className="w-full truncate text-center text-[6px] font-black uppercase px-1 py-0.5"
                    style={{ backgroundColor: "#000000", color: "#ffffff" }}
                  >
                    Lourdes Autoparts
                  </div>
                  <div
                    className="text-[10px] font-black leading-tight mt-0.5 text-center line-clamp-2 break-all"
                    style={{ color: "#000000" }}
                  >
                    {barang.part_number}
                  </div>
                  {barang.part_name && (
                    <div
                      className="text-[7px] leading-tight mt-0.5 line-clamp-2"
                      style={{ color: "#000000" }}
                    >
                      {barang.part_name}
                    </div>
                  )}
                  {barang.part_satuan && (
                    <div
                      className="text-[7px] uppercase mt-0.5"
                      style={{ color: "#000000" }}
                    >
                      {barang.part_satuan}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Preview layout A4 */}
          <div className="space-y-2">
            <Label className="text-[11px] font-bold uppercase text-muted-foreground">
              Preview Susunan di Kertas A4
            </Label>
            <div className="flex flex-col items-center gap-2 bg-slate-100 rounded-lg p-4">
              <div
                className="bg-white shadow-sm relative"
                style={{
                  width: `${previewPageW}px`,
                  height: `${previewPageH}px`,
                }}
              >
                {grid.perPage > 0 &&
                  Array.from({ length: Math.min(grid.perPage, 60) }).map(
                    (_, i) => {
                      const col = i % grid.cols;
                      const row = Math.floor(i / grid.cols);
                      return (
                        <div
                          key={i}
                          className="absolute bg-primary/10 border border-primary/40 rounded-[1px]"
                          style={{
                            left: previewMargin + col * (previewStickerW + previewGap),
                            top: previewMargin + row * (previewStickerH + previewGap),
                            width: previewStickerW,
                            height: previewStickerH,
                          }}
                        />
                      );
                    },
                  )}
              </div>

              {grid.perPage <= 0 ? (
                <p className="text-[11px] font-semibold text-center text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Ukuran sticker terlalu besar untuk kertas A4 (
                  {orientation}).
                </p>
              ) : qty <= 0 ? (
                <p className="text-[11px] font-semibold text-center text-muted-foreground">
                  {grid.cols} kolom × {grid.rows} baris ={" "}
                  <span className="text-primary font-black">
                    {grid.perPage} sticker/lembar
                  </span>
                  . Isi jumlah sticker dulu.
                </p>
              ) : (
                <p className="text-[11px] font-semibold text-center text-muted-foreground">
                  {grid.cols} kolom × {grid.rows} baris ={" "}
                  <span className="text-primary font-black">
                    {grid.perPage} sticker/lembar
                  </span>{" "}
                  — butuh{" "}
                  <span className="text-primary font-black">
                    {totalPages} lembar A4
                  </span>{" "}
                  untuk {qty} sticker.
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="p-5 bg-slate-50/50 border-t border-slate-100 gap-2 sm:flex-row">
          <Button
            variant="ghost"
            className="flex-1 h-10 text-slate-400 font-semibold text-sm hover:text-slate-600 rounded-lg order-2 sm:order-1"
            onClick={() => onOpenChange(false)}
          >
            Batal
          </Button>
          <Button
            className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 font-bold text-sm text-white rounded-lg shadow-md transition-all active:scale-95 order-1 sm:order-2 gap-2"
            onClick={handlePrint}
            disabled={!canPrint}
          >
            <Printer className="h-3.5 w-3.5" /> Cetak
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
