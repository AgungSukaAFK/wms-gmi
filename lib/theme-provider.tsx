"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ThemeProvider as NextThemesProvider,
  ThemeProviderProps,
} from "next-themes";
import {
  ACCENT_STORAGE_KEY,
  accentThemes,
  applyAccent,
  applyFontFamily,
  DEFAULT_ACCENT,
  DEFAULT_FONT_FAMILY,
  FONT_FAMILY_STORAGE_KEY,
  fontFamilies,
  isPrintPath,
  type AccentTheme,
  type FontFamily,
} from "@/lib/appearance";
import { runViewTransition } from "@/lib/view-transition";

export { accentThemes };

interface CustomThemeContextType {
  accent: AccentTheme;
  setAccent: (accent: AccentTheme) => void;
  fontFamily: FontFamily;
  setFontFamily: (font: FontFamily) => void;
}

const CustomThemeContext = createContext<CustomThemeContextType | undefined>(
  undefined,
);

function readStored<T extends string>(
  key: string,
  options: readonly { name: string }[],
  fallback: T,
): T {
  try {
    const v = localStorage.getItem(key);
    return (options.find((o) => o.name === v)?.name as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage diblokir - berlaku di sesi ini saja
  }
}

/**
 * Tema per perangkat: mode terang/gelap (next-themes), warna aksen, dan
 * jenis font. Halaman cetak (lib/font-size.ts isPrintPath) selalu Light +
 * aksen & font standar, apa pun pilihan user.
 */
export function CustomThemeProvider({
  children,
  ...props
}: ThemeProviderProps) {
  const pathname = usePathname();
  const printing = isPrintPath(pathname);
  // null = belum dibaca dari localStorage, supaya nilai yang sudah dipasang
  // script anti-kedip (lib/appearance.ts) tidak tertimpa default dulu.
  const [accent, setAccentState] = useState<AccentTheme | null>(null);
  const [fontFamily, setFontFamilyState] = useState<FontFamily | null>(null);

  useEffect(() => {
    // Sinkron dari localStorage sekali setelah mount (nilainya sudah
    // terpasang di <html> oleh boot script, jadi tidak ada kedipan).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccentState(readStored(ACCENT_STORAGE_KEY, accentThemes, DEFAULT_ACCENT));
    setFontFamilyState(
      readStored(FONT_FAMILY_STORAGE_KEY, fontFamilies, DEFAULT_FONT_FAMILY),
    );
  }, []);

  useEffect(() => {
    if (!accent) return;
    applyAccent(printing ? null : accent);
  }, [accent, printing]);

  useEffect(() => {
    if (!fontFamily) return;
    applyFontFamily(printing ? null : fontFamily);
  }, [fontFamily, printing]);

  const setAccent = (next: AccentTheme) =>
    // Cross-fade; flushSync di runViewTransition memastikan class <html>
    // sudah terpasang sebelum potret "sesudah" diambil.
    runViewTransition(() => {
      setAccentState(next);
      writeStored(ACCENT_STORAGE_KEY, next);
      applyAccent(next);
    });

  const setFontFamily = (next: FontFamily) =>
    runViewTransition(() => {
      setFontFamilyState(next);
      writeStored(FONT_FAMILY_STORAGE_KEY, next);
      applyFontFamily(next);
    });

  return (
    <CustomThemeContext.Provider
      value={{
        accent: accent ?? DEFAULT_ACCENT,
        setAccent,
        fontFamily: fontFamily ?? DEFAULT_FONT_FAMILY,
        setFontFamily,
      }}
    >
      <NextThemesProvider {...props} forcedTheme={printing ? "light" : undefined}>
        {children}
      </NextThemesProvider>
    </CustomThemeContext.Provider>
  );
}

export const useCustomTheme = () => {
  const context = useContext(CustomThemeContext);
  if (context === undefined) {
    throw new Error("useCustomTheme must be used within a CustomThemeProvider");
  }
  return context;
};
