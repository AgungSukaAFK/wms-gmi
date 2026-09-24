// Util bersama untuk fitur "Cetak Barcode" (dialog konfigurasi + halaman cetak),
// supaya perhitungan grid sticker di kertas A4 selalu identik antara preview
// dan hasil cetak sebenarnya.

export const A4_MM = { width: 210, height: 297 };

// Margin aman kertas A4 (kebanyakan printer rumahan/kantor butuh margin
// minimal ~5mm) + jarak antar sticker biar mudah dipotong manual.
export const SHEET_MARGIN_MM = 8;
export const SHEET_GAP_MM = 2;

export const STICKER_SIZE_TEMPLATES = {
  S: { label: "S — Mini", width: 40, height: 20 },
  M: { label: "M — Kartu Nama", width: 90, height: 54 },
  L: { label: "L — Besar", width: 100, height: 70 },
  XL: { label: "XL — Ekstra Besar", width: 150, height: 100 },
} as const;

export type StickerTemplateKey = keyof typeof STICKER_SIZE_TEMPLATES;
export type Orientation = "portrait" | "landscape";

export function getPageSizeMm(orientation: Orientation) {
  return orientation === "landscape"
    ? { width: A4_MM.height, height: A4_MM.width }
    : { width: A4_MM.width, height: A4_MM.height };
}

export interface StickerGrid {
  cols: number;
  rows: number;
  perPage: number;
  page: { width: number; height: number };
  usableWidth: number;
  usableHeight: number;
}

export function computeStickerGrid(
  orientation: Orientation,
  stickerWidthMm: number,
  stickerHeightMm: number,
): StickerGrid {
  const page = getPageSizeMm(orientation);
  const usableWidth = page.width - SHEET_MARGIN_MM * 2;
  const usableHeight = page.height - SHEET_MARGIN_MM * 2;

  const cols =
    stickerWidthMm > 0
      ? Math.max(
          0,
          Math.floor(
            (usableWidth + SHEET_GAP_MM) / (stickerWidthMm + SHEET_GAP_MM),
          ),
        )
      : 0;
  const rows =
    stickerHeightMm > 0
      ? Math.max(
          0,
          Math.floor(
            (usableHeight + SHEET_GAP_MM) / (stickerHeightMm + SHEET_GAP_MM),
          ),
        )
      : 0;

  return { cols, rows, perPage: cols * rows, page, usableWidth, usableHeight };
}
