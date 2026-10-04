import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { FONT_SIZE_BOOT_SCRIPT } from "@/lib/font-size";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "WMS",
    "Warehouse Management System",
    "Garuda Mart Indonesia",
    "GMI",
    "manajemen gudang",
    "material request",
    "purchase order",
    "stok gudang",
  ],
  authors: [{ name: "PT. Garuda Mart Indonesia" }],
  creator: "PT. Garuda Mart Indonesia",
  publisher: "PT. Garuda Mart Indonesia",
  openGraph: {
    type: "website",
    locale: "id_ID",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // data-font-size dipasang FONT_SIZE_BOOT_SCRIPT sebelum hydration.
      suppressHydrationWarning
    >
      <head>
        {/* Inline (bukan next/script) & di dalam <head>: React 19 menolak
            <script> sebagai anak langsung <html>. Jalan sinkron sebelum paint. */}
        <script dangerouslySetInnerHTML={{ __html: FONT_SIZE_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
