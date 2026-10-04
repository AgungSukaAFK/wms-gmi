// Konfigurasi situs untuk metadata/SEO. Override via NEXT_PUBLIC_SITE_URL
// (mis. untuk preview deploy); default ke domain production.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://wms.lourdes.cloud"
).replace(/\/+$/, "");

export const SITE_NAME = "WMS GMI";
export const SITE_TITLE = "WMS GMI - Warehouse Management System";
export const SITE_DESCRIPTION =
  "Warehouse Management System PT. Garuda Mart Indonesia — kelola material request, purchase request, purchase order, delivery, dan stok gudang dalam satu alur kerja terintegrasi.";

// Copy branding untuk halaman autentikasi (panel kiri & footer AuthShell).
export const AUTH_BRANDING = {
  appName: SITE_NAME,
  subtitle: "Warehouse Management System",
  headline: "Stok gudang yang terkendali, dari permintaan hingga barang terkirim.",
  description:
    "Kelola Material Request, Purchase Order, penerimaan barang, transfer antar gudang, delivery, dan konsinyasi dalam satu sistem terpadu untuk seluruh cabang.",
  icon: "/gmi-logo.webp",
} as const;
