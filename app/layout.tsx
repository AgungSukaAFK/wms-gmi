import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { FONT_SIZE_BOOT_SCRIPT } from "@/lib/font-size";
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
  title: "WMS GMI - 2026",
  description: "Warehouse Management System - PT. Garuda Mart Indonesia",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // data-font-size dipasang FONT_SIZE_BOOT_SCRIPT sebelum hydration.
      suppressHydrationWarning
    >
      <Script id="font-size-boot" strategy="beforeInteractive">
        {FONT_SIZE_BOOT_SCRIPT}
      </Script>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
