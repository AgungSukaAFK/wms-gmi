"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export interface MultiSelectOption {
  label: string;
  value: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  /** Nilai-nilai yang terpilih. Kosong = "Semua" (tidak memfilter). */
  selected: string[];
  onChange: (values: string[]) => void;
  /** Teks saat belum ada yang dipilih, mis. "Semua Lokasi". */
  placeholder?: string;
  /** Ikon kecil di kiri trigger (opsional). */
  icon?: React.ReactNode;
  /** Tampilkan kotak pencarian (untuk daftar panjang seperti cabang). */
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Semua",
  icon,
  searchable = false,
  disabled = false,
  className,
  contentClassName,
  align = "start",
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const filtered =
    searchable && search
      ? options.filter((o) =>
          o.label.toLowerCase().includes(search.toLowerCase()),
        )
      : options;

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? "1 dipilih")
        : `${selected.length} dipilih`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn(
            "h-9 justify-between border-input bg-background text-xs font-semibold text-foreground",
            selected.length === 0 && "font-medium text-muted-foreground",
            className,
          )}
        >
          <span className="flex items-center gap-2 truncate">
            {icon}
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn("w-56 rounded-md p-0", contentClassName)}
      >
        {searchable && (
          <div className="border-b border-border p-2">
            <Input
              placeholder="Cari..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        )}
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-xs italic text-muted-foreground">
              Tidak ada opsi
            </div>
          ) : (
            filtered.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={checked}
                  tabIndex={0}
                  onClick={() => toggle(opt.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(opt.value);
                    }
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
                >
                  <Checkbox checked={checked} className="pointer-events-none" />
                  <span className="truncate">{opt.label}</span>
                </div>
              );
            })
          )}
        </div>
        {selected.length > 0 && (
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full rounded-sm px-2 py-1.5 text-left text-xs font-semibold text-destructive hover:bg-destructive/5"
            >
              Bersihkan ({selected.length})
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
