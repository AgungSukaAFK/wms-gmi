"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { applyFontSize, isPrintPath, normalizeFontSize } from "@/lib/font-size";

/**
 * Terapkan preferensi ukuran font akun (profiles.ui_font_size) ke <html>.
 * Dipasang di layout (With Sidebar); halaman cetak selalu medium.
 */
export function FontSizeSync() {
  const pathname = usePathname();
  const fontSize = useAuthStore((s) => normalizeFontSize(s.profile?.ui_font_size));

  useEffect(() => {
    applyFontSize(isPrintPath(pathname) ? null : fontSize);
  }, [pathname, fontSize]);

  // Lepas saat keluar dari layout (mis. ke route group (print) / login).
  useEffect(() => () => applyFontSize(null), []);

  return null;
}
