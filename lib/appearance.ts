// Preferensi tampilan per perangkat (localStorage): warna aksen & jenis font.
// Mode terang/gelap diurus next-themes (lib/theme-provider.tsx). Ukuran font
// TIDAK di sini - itu per akun di DB (lib/font-size.ts).
//
// File ini sengaja bukan client module supaya bisa dipakai root layout
// (server) untuk script anti-kedip.

import { isPrintPath } from "@/lib/font-size";

// `color` = warna primary mode terang, dipakai utk swatch preview.
// `group: "company"` = warna khusus perusahaan, ditampilkan terpisah di atas.
// CSS-nya: .theme-<name> di globals.css.
export const accentThemes = [
  { name: "gmi", label: "GMI", color: "#242365", group: "company" },
  { name: "gis", label: "GIS", color: "rgb(23 88 49)", group: "company" },
  { name: "zinc", label: "Zinc (Default)", color: "hsl(240 5.9% 10%)", group: "general" },
  { name: "blue", label: "Blue", color: "hsl(217.2 91.2% 59.8%)", group: "general" },
  { name: "sky", label: "Sky", color: "hsl(200.4 98% 39.4%)", group: "general" },
  { name: "cyan", label: "Cyan", color: "hsl(191.6 91.4% 36.5%)", group: "general" },
  { name: "teal", label: "Teal", color: "hsl(174.7 83.9% 31.6%)", group: "general" },
  { name: "emerald", label: "Emerald", color: "hsl(161.4 93.5% 30.4%)", group: "general" },
  { name: "green", label: "Green", color: "hsl(142.1 76.2% 36.3%)", group: "general" },
  { name: "amber", label: "Amber", color: "hsl(37.7 92.1% 50.2%)", group: "general" },
  { name: "orange", label: "Orange", color: "hsl(20.5 90.2% 48.2%)", group: "general" },
  { name: "red", label: "Red", color: "hsl(0 72.2% 50.6%)", group: "general" },
  { name: "rose", label: "Rose", color: "hsl(346.8 77.2% 49.8%)", group: "general" },
  { name: "pink", label: "Pink", color: "hsl(333.3 71.4% 50.6%)", group: "general" },
  { name: "fuchsia", label: "Fuchsia", color: "hsl(292.2 84.1% 60.6%)", group: "general" },
  { name: "purple", label: "Purple", color: "hsl(271.5 81.3% 55.9%)", group: "general" },
  { name: "violet", label: "Violet", color: "hsl(262.1 83.3% 57.8%)", group: "general" },
  { name: "indigo", label: "Indigo", color: "hsl(243.4 75.4% 58.6%)", group: "general" },
] as const;

export type AccentTheme = (typeof accentThemes)[number]["name"];
export const DEFAULT_ACCENT: AccentTheme = "zinc";

// `preview` = font-family utk contoh teks di menu. Penerapan ke seluruh app
// lewat html[data-font=<name>] di globals.css (variable dari lib/fonts.ts).
// Default "system" = font yang memang dipakai wms-gmi selama ini (stack
// bawaan Tailwind), jadi tampilan tidak berubah sampai user memilih.
export const fontFamilies = [
  { name: "system", label: "Font Sistem (Default)", preview: "ui-sans-serif, system-ui, sans-serif" },
  { name: "geist", label: "Geist", preview: "var(--font-geist-sans)" },
  { name: "inter", label: "Inter", preview: "var(--font-inter)" },
  { name: "jakarta", label: "Plus Jakarta Sans", preview: "var(--font-jakarta)" },
  { name: "poppins", label: "Poppins", preview: "var(--font-poppins)" },
  { name: "nunito", label: "Nunito", preview: "var(--font-nunito)" },
  { name: "roboto", label: "Roboto", preview: "var(--font-roboto)" },
  { name: "atkinson", label: "Atkinson Hyperlegible", preview: "var(--font-atkinson)" },
] as const;

export type FontFamily = (typeof fontFamilies)[number]["name"];
export const DEFAULT_FONT_FAMILY: FontFamily = "system";

export const ACCENT_STORAGE_KEY = "wms:accent-theme";
export const FONT_FAMILY_STORAGE_KEY = "wms:font-family";
/** Key localStorage next-themes (mode terang/gelap). */
export const THEME_STORAGE_KEY = "wms:theme";

export const THEME_VALUES = ["light", "soft-light", "dark", "soft-dark"] as const;

/** Pasang/lepas class aksen di <html>. */
export function applyAccent(accent: AccentTheme | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  accentThemes.forEach((t) => root.classList.remove(`theme-${t.name}`));
  if (accent && accent !== DEFAULT_ACCENT) root.classList.add(`theme-${accent}`);
}

/** Pasang/lepas atribut jenis font di <html>. */
export function applyFontFamily(font: FontFamily | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (font && font !== DEFAULT_FONT_FAMILY) root.dataset.font = font;
  else delete root.dataset.font;
}

export { isPrintPath };

/**
 * Inline script (root layout, sebelum hydration) supaya aksen & font pilihan
 * user tidak sempat tampil default sesaat setelah refresh. Halaman cetak
 * selalu tampilan standar.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{
if(/\\/(print|material-release)(?=[\\/-]|$)/.test(location.pathname))return;
var d=document.documentElement;
var a=localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)});
if(a&&a!==${JSON.stringify(DEFAULT_ACCENT)}&&${JSON.stringify(accentThemes.map((t) => t.name))}.indexOf(a)>-1)d.classList.add("theme-"+a);
var f=localStorage.getItem(${JSON.stringify(FONT_FAMILY_STORAGE_KEY)});
if(f&&f!==${JSON.stringify(DEFAULT_FONT_FAMILY)}&&${JSON.stringify(fontFamilies.map((f) => f.name))}.indexOf(f)>-1)d.dataset.font=f;
}catch(e){}})();`;
