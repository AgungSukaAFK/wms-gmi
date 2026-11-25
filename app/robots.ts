import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Aplikasi internal: hanya landing, /auth/*, dan aset yang boleh di-crawl.
// - Aset wajib terbuka supaya Google bisa merender halaman dan bot sosial bisa
//   mengambil gambar Open Graph & ikon.
// - /auth/* selain login bertanda noindex; harus bisa di-crawl agar terbaca.
// - Halaman lain butuh login (proxy.ts redirect ke /auth/login).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/$",
        "/auth/",
        "/_next/static/",
        "/_next/image",
        "/opengraph-image",
        "/favicon.ico",
        "/icon",
        "/apple-icon",
        "/manifest.webmanifest",
        "/*.webp$",
        "/*.png$",
      ],
      disallow: ["/", "/auth/confirm"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
