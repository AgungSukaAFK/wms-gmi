"use client";

import React, { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Printer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrCodeSvg } from "@/components/barang/qr-code-svg";
import {
  SHEET_GAP_MM,
  SHEET_MARGIN_MM,
  computeStickerGrid,
  type Orientation,
} from "@/lib/barcode-sheet";

const clampMm = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function BarcodePrintContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const partNumber = searchParams.get("pn") || "";
  const partName = searchParams.get("name") || "";
  const satuan = searchParams.get("satuan") || "";
  const qty = Math.max(1, parseInt(searchParams.get("qty") || "0", 10) || 0);
  const width = parseFloat(searchParams.get("w") || "0");
  const height = parseFloat(searchParams.get("h") || "0");
  const orientation: Orientation =
    searchParams.get("orientation") === "landscape"
      ? "landscape"
      : "portrait";

  const grid = useMemo(
    () => computeStickerGrid(orientation, width, height),
    [orientation, width, height],
  );

  const totalPages = grid.perPage > 0 ? Math.ceil(qty / grid.perPage) : 0;

  useEffect(() => {
    if (partNumber && grid.perPage > 0) {
      const t = setTimeout(() => window.print(), 700);
      return () => clearTimeout(t);
    }
  }, [partNumber, grid.perPage]);

  if (!partNumber || !width || !height) {
    return (
      <div className="p-20 text-center">
        <h1 className="text-xl font-bold">Data cetak tidak lengkap</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Buka halaman ini lewat tombol "Cetak QR Code" di list Barang.
        </p>
        <Button onClick={() => router.back()} className="mt-4">
          Kembali
        </Button>
      </div>
    );
  }

  if (grid.perPage <= 0) {
    return (
      <div className="p-20 text-center">
        <h1 className="text-xl font-bold">
          Ukuran sticker terlalu besar
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Sticker {width}mm x {height}mm tidak muat di kertas A4 (
          {orientation}). Perkecil ukuran sticker.
        </p>
        <Button onClick={() => router.back()} className="mt-4">
          Kembali
        </Button>
      </div>
    );
  }

  // Sticker hitam-putih: QR di kiri, di kanan badge merek (bg hitam, teks
  // putih) lalu Part Number (paling ditonjolkan), Part Name, dan Satuan
  // (ukuran disamakan dengan Part Name, cuma beda urutan/posisi).
  const headerSizeMm = clampMm(height * 0.09, 1.4, 2.6);
  const pnSizeMm = clampMm(height * 0.2, 2.6, 5.5);
  const nameSizeMm = clampMm(height * 0.1, 1.4, 2.6);
  const satuanSizeMm = nameSizeMm;
  const paddingMm = clampMm(Math.min(width, height) * 0.06, 0.8, 2.5);
  const badgePadVMm = clampMm(paddingMm * 0.5, 0.4, 1.2);
  const badgePadHMm = clampMm(paddingMm * 0.8, 0.6, 2);
  const qrSizeMm = Math.max(
    8,
    Math.min(height - paddingMm * 2, width * 0.42),
  );

  return (
    <div
      className="bg-slate-200 min-h-screen py-8"
      style={{ colorScheme: "only light" }}
    >
      {/* Beberapa browser/OS punya "auto dark mode for websites" yang bisa
          diam-diam invert warna (termasuk inline style seperti badge hitam
          di bawah). Meta tag ini eksplisit bilang: halaman ini cuma didesain
          untuk light, jangan di-invert/di-darken otomatis.
          NB: urutan katanya "only light", bukan "light only". */}
      <meta name="color-scheme" content="only light" />
      <div className="fixed top-4 left-4 print:hidden flex gap-2 z-10">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.back()}
          className="gap-2 bg-white"
        >
          <ChevronLeft className="h-4 w-4" /> Kembali
        </Button>
        <Button
          size="sm"
          onClick={() => window.print()}
          className="gap-2 bg-blue-600 text-white"
        >
          <Printer className="h-4 w-4" /> Cetak Ulang
        </Button>
      </div>

      {Array.from({ length: totalPages }).map((_, pageIndex) => {
        const startIdx = pageIndex * grid.perPage;
        const itemsOnPage = Math.min(grid.perPage, qty - startIdx);

        return (
          <div
            key={pageIndex}
            className="mx-auto shadow-lg print:shadow-none"
            style={{
              width: `${grid.page.width}mm`,
              height: `${grid.page.height}mm`,
              padding: `${SHEET_MARGIN_MM}mm`,
              boxSizing: "border-box",
              background: "#ffffff",
              colorScheme: "only light",
              marginBottom:
                pageIndex < totalPages - 1 ? `${SHEET_MARGIN_MM}mm` : 0,
              pageBreakAfter:
                pageIndex < totalPages - 1 ? "always" : "auto",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${grid.cols}, ${width}mm)`,
                gap: `${SHEET_GAP_MM}mm`,
                alignContent: "start",
                justifyContent: "start",
              }}
            >
              {Array.from({ length: itemsOnPage }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: `${width}mm`,
                    height: `${height}mm`,
                    border: "0.25mm dashed #000000",
                    padding: `${paddingMm}mm`,
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    gap: `${paddingMm}mm`,
                    overflow: "hidden",
                    fontFamily: "var(--font-geist-sans), sans-serif",
                  }}
                >
                  <div
                    style={{
                      flex: `0 0 ${qrSizeMm}mm`,
                      width: `${qrSizeMm}mm`,
                      height: `${qrSizeMm}mm`,
                    }}
                  >
                    <QrCodeSvg value={partNumber} />
                  </div>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        background: "#000000",
                        color: "#ffffff",
                        WebkitPrintColorAdjust: "exact",
                        printColorAdjust: "exact",
                        padding: `${badgePadVMm}mm ${badgePadHMm}mm`,
                        fontSize: `${headerSizeMm}mm`,
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        textAlign: "center",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      Lourdes Autoparts
                    </div>
                    <div
                      style={{
                        fontSize: `${pnSizeMm}mm`,
                        fontWeight: 900,
                        color: "#000000",
                        lineHeight: 1.05,
                        textAlign: "center",
                        wordBreak: "break-all",
                        marginTop: `${paddingMm * 0.4}mm`,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {partNumber}
                    </div>
                    {partName && (
                      <div
                        style={{
                          fontSize: `${nameSizeMm}mm`,
                          color: "#000000",
                          lineHeight: 1.15,
                          marginTop: `${paddingMm * 0.35}mm`,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {partName}
                      </div>
                    )}
                    {satuan && (
                      <div
                        style={{
                          fontSize: `${satuanSizeMm}mm`,
                          color: "#000000",
                          marginTop: `${paddingMm * 0.35}mm`,
                          textTransform: "uppercase",
                        }}
                      >
                        {satuan}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <style jsx global>{`
        :root {
          color-scheme: only light;
        }
        @media print {
          @page {
            size: A4 ${orientation};
            margin: 0;
          }
          html,
          body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            color-scheme: only light !important;
          }
          /* Browser default-nya SKIP background-color pas print/save-as-PDF
             demi hemat tinta (kecuali user manual centang "Background
             graphics"). Badge "Lourdes Autoparts" butuh ini supaya bg hitam
             + teks putihnya beneran ikut ke-print, bukan cuma tampil di layar. */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
  );
}

export default function BarcodePrintPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-full flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
        </div>
      }
    >
      <BarcodePrintContent />
    </Suspense>
  );
}
