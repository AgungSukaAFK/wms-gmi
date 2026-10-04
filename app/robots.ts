import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Aplikasi internal: hanya landing & login yang boleh di-crawl.
// Halaman lain butuh login (proxy.ts redirect ke /auth/login).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/auth/login"],
      disallow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
