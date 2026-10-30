"use client";

import { Check, Type } from "lucide-react";
import { useCustomTheme } from "@/lib/theme-provider";
import { fontFamilies } from "@/lib/appearance";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function FontSwitcher() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" title="Jenis font">
          <Type className="text-muted-foreground" size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <FontSettingsPanel />
      </PopoverContent>
    </Popover>
  );
}

// Isi pengaturan jenis font - dipakai juga di menu Tampilan top bar.
// Ukuran font sengaja tidak di sini: itu setting per akun di halaman Profil
// (lib/font-size.ts), bukan per perangkat.
export function FontSettingsPanel() {
  const { fontFamily, setFontFamily } = useCustomTheme();

  return (
    <>
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
        Jenis Font
      </span>
      <div className="flex flex-col gap-0.5">
        {fontFamilies.map((f) => {
          const selected = fontFamily === f.name;
          return (
            <button
              key={f.name}
              type="button"
              onClick={() => setFontFamily(f.name)}
              className="relative isolate flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              style={{ fontFamily: f.preview }}
            >
              {/* Latar opsi terpilih - view-transition-name membuatnya
                  bergeser ke opsi baru saat ganti font (globals.css). */}
              {selected && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-accent"
                  style={{ viewTransitionName: "appearance-font" }}
                />
              )}
              <span className="flex-1">{f.label}</span>
              {selected && <Check className="h-4 w-4 shrink-0" />}
            </button>
          );
        })}
      </div>
    </>
  );
}
