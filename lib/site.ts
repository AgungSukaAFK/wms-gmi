import type { Metadata } from "next";

// Konfigurasi situs untuk metadata/SEO. Override via NEXT_PUBLIC_SITE_URL
// (mis. untuk preview deploy); default ke domain production.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://wms.lourdes.cloud"
).replace(/\/+$/, "");

export const COMPANY_NAME = "PT. Garuda Mart Indonesia";
export const SITE_NAME = "WMS GMI";
export const SITE_TITLE = "WMS GMI - Warehouse Management System Garuda Mart Indonesia";
export const SITE_DESCRIPTION =
  "Warehouse Management System PT. Garuda Mart Indonesia — kelola material request, purchase order, delivery, dan stok gudang dalam satu alur terintegrasi.";

// Metadata halaman publik (boleh diindeks). Halaman lain mewarisi noindex dari
// app/layout.tsx. openGraph/twitter tidak di-merge dalam oleh Next, jadi field
// dan gambarnya harus ditulis lengkap di sini.
export function publicPageMetadata({
  path,
  title,
  description,
}: {
  path: string;
  /** Kosongkan untuk memakai SITE_TITLE. */
  title?: string;
  description: string;
}): Metadata {
  const socialTitle = title ? `${title} | ${SITE_NAME}` : SITE_TITLE;
  const images = [
    {
      url: "/opengraph-image",
      width: 1200,
      height: 630,
      alt: `${SITE_NAME} - Warehouse Management System ${COMPANY_NAME}`,
    },
  ];

  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    },
    openGraph: {
      type: "website",
      locale: "id_ID",
      siteName: SITE_NAME,
      url: path,
      title: socialTitle,
      description,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images,
    },
  };
}

// Copy branding untuk halaman autentikasi (panel kiri & footer AuthShell).
export const AUTH_BRANDING = {
  appName: SITE_NAME,
  subtitle: "Warehouse Management System",
  headline: "Stok gudang yang terkendali, dari permintaan hingga barang terkirim.",
  description:
    "Kelola Material Request, Purchase Order, penerimaan barang, transfer antar gudang, delivery, dan konsinyasi dalam satu sistem terpadu untuk seluruh cabang.",
  icon: "/gmi-logo.webp",
} as const;
