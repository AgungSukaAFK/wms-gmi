/**
 * Preferensi ukuran font UI per akun (profiles.ui_font_size).
 *
 * "medium" = ukuran bawaan aplikasi. "large" = teks naik ±1px (lihat
 * globals.css, blok `html[data-font-size="large"]`) — spacing/layout tidak
 * ikut membesar supaya tetap lega di laptop layar kecil.
 *
 * Halaman cetak (PDF) SELALU pakai medium, apapun preferensi user.
 */
export const FONT_SIZES = ["medium", "large"] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const DEFAULT_FONT_SIZE: FontSize = "medium";

/** Atribut di <html> yang dibaca globals.css. */
export const FONT_SIZE_ATTR = "data-font-size";

/** Key localStorage zustand auth store (stores/auth-store.ts). */
const AUTH_STORE_KEY = "wms-auth-session";

/**
 * Route halaman cetak: `/print`, `/print/...`, `/print-barcode`, dan
 * `/material-release` (WO). Dipakai juga oleh inline script, jadi cukup
 * regex sederhana.
 */
const PRINT_PATH_RE = /\/(print|material-release)(?=[\/-]|$)/;

export function isPrintPath(pathname: string): boolean {
  return PRINT_PATH_RE.test(pathname);
}

export function normalizeFontSize(value: unknown): FontSize {
  return value === "large" ? "large" : DEFAULT_FONT_SIZE;
}

/** Pasang/lepas atribut ukuran font di <html>. */
export function applyFontSize(size: FontSize | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (size && size !== DEFAULT_FONT_SIZE) {
    root.setAttribute(FONT_SIZE_ATTR, size);
  } else {
    root.removeAttribute(FONT_SIZE_ATTR);
  }
}

/**
 * Inline script (root layout, sebelum hydration) supaya user "large" tidak
 * sempat melihat tampilan medium sesaat setelah refresh. Membaca profil yang
 * sudah di-cache auth store di localStorage.
 */
export const FONT_SIZE_BOOT_SCRIPT = `(function(){try{
if(${PRINT_PATH_RE.toString()}.test(location.pathname))return;
var s=JSON.parse(localStorage.getItem(${JSON.stringify(AUTH_STORE_KEY)})||"null");
var f=s&&s.state&&s.state.profile&&s.state.profile.ui_font_size;
if(f==="large")document.documentElement.setAttribute(${JSON.stringify(FONT_SIZE_ATTR)},f);
}catch(e){}})();`;
