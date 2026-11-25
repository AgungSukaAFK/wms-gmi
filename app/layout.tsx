import type { Metadata } from "next";
import { FONT_SIZE_BOOT_SCRIPT } from "@/lib/font-size";
import { APPEARANCE_BOOT_SCRIPT, THEME_STORAGE_KEY, THEME_VALUES } from "@/lib/appearance";
import { fontVariables } from "@/lib/fonts";
import { CustomThemeProvider } from "@/lib/theme-provider";
import { COMPANY_NAME, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import "./globals.css";

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
  authors: [{ name: COMPANY_NAME }],
  creator: COMPANY_NAME,
  publisher: COMPANY_NAME,
  // Default noindex: ini aplikasi internal. Halaman publik (landing & login)
  // membuka indeks sendiri lewat publicPageMetadata().
  robots: { index: false, follow: false },
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
      className={`${fontVariables} h-full antialiased`}
      // data-font-size dipasang FONT_SIZE_BOOT_SCRIPT sebelum hydration.
      suppressHydrationWarning
    >
      <head>
        {/* Inline (bukan next/script) & di dalam <head>: React 19 menolak
            <script> sebagai anak langsung <html>. Jalan sinkron sebelum paint. */}
        <script dangerouslySetInnerHTML={{ __html: FONT_SIZE_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* Tema per perangkat (lib/theme-provider.tsx). Default Light supaya
            tampilan tidak berubah sampai user sendiri memilih tema lain. */}
        <CustomThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          themes={[...THEME_VALUES]}
          storageKey={THEME_STORAGE_KEY}
          disableTransitionOnChange
        >
          {children}
        </CustomThemeProvider>
      </body>
    </html>
  );
}
