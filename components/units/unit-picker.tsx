"use client";

import React, { useEffect, useState } from "react";
import { ChevronsUpDown, Search, Loader2 } from "lucide-react";
import { useDebounce } from "use-debounce";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// id null = kode unit lama (SPB sebelum ada master Unit) yang tidak terdaftar.
export type UnitOption = {
  id: number | null;
  kode_unit: string;
  tipe_unit: string;
  brand: string | null;
};

const SAMPLE_SIZE = 15;
const SEARCH_LIMIT = 30;
const COLUMNS = "id, kode_unit, tipe_unit, brand";

// Jumlah unit aktif di-cache per sesi tab: cukup buat menentukan offset acak,
// gak perlu dihitung ulang tiap picker dibuka.
let activeUnitCount: number | null = null;

// Picker master Unit (ribuan baris). Tanpa ketikan: 15 unit acak (satu
// potongan berurutan dari offset acak -> 1 query kecil). Saat mengetik:
// cari ke server di kode/tipe/brand, kode yang diawali kata kunci ditaruh atas.
export function UnitPicker({
  value,
  onChange,
  disabled,
  placeholder = "Pilih kode unit...",
  className,
}: {
  value: UnitOption | null;
  onChange: (unit: UnitOption) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search, 300);
  const [options, setOptions] = useState<UnitOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      // Kode/tipe unit banyak mengandung "(", "," -> nilai or() wajib di-quote.
      const keyword = debounced.replace(/["\\]/g, "").trim();
      let rows: UnitOption[] = [];

      if (keyword) {
        // 2 query paralel: kode berawalan kata kunci (prioritas) + yang
        // mengandung kata kunci di kode/tipe/brand, digabung tanpa duplikat.
        const [prefixRes, containsRes] = await Promise.all([
          supabase
            .from("units")
            .select(COLUMNS)
            .eq("is_active", true)
            .ilike("kode_unit", `${keyword}%`)
            .order("kode_unit")
            .limit(SEARCH_LIMIT),
          supabase
            .from("units")
            .select(COLUMNS)
            .eq("is_active", true)
            .or(
              `kode_unit.ilike."%${keyword}%",tipe_unit.ilike."%${keyword}%",brand.ilike."%${keyword}%"`,
            )
            .order("kode_unit")
            .limit(SEARCH_LIMIT),
        ]);
        const merged = new Map<number, UnitOption>();
        for (const row of [
          ...((prefixRes.data || []) as UnitOption[]),
          ...((containsRes.data || []) as UnitOption[]),
        ]) {
          if (row.id !== null && !merged.has(row.id)) merged.set(row.id, row);
        }
        rows = Array.from(merged.values()).slice(0, SEARCH_LIMIT);
      } else {
        if (activeUnitCount === null) {
          const { count } = await supabase
            .from("units")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true);
          activeUnitCount = count ?? 0;
        }
        const maxOffset = Math.max(0, activeUnitCount - SAMPLE_SIZE);
        const offset = Math.floor(Math.random() * (maxOffset + 1));
        const { data } = await supabase
          .from("units")
          .select(COLUMNS)
          .eq("is_active", true)
          .order("id")
          .range(offset, offset + SAMPLE_SIZE - 1);
        rows = (data || []) as UnitOption[];
      }

      if (!cancelled) {
        setOptions(rows);
        setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debounced]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={`w-full justify-between font-semibold ${className ?? "h-10 text-sm"}`}
        >
          <span className={`truncate ${value ? "" : "text-muted-foreground font-normal"}`}>
            {value ? value.kode_unit : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[calc(100vw-2rem)] max-w-96 p-0" align="start">
        <div className="p-2 border-b bg-muted/40">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Ketik kode / tipe / brand unit..."
              className="pl-8 h-8 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          {!search.trim() && (
            <p className="mt-1.5 px-0.5 text-[10px] text-muted-foreground">
              Menampilkan {SAMPLE_SIZE} unit acak — ketik untuk mencari.
            </p>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {loading ? (
            <div className="p-4 flex justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : options.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground italic">
              {search.trim()
                ? "Unit tidak ditemukan di Data Master Unit."
                : "Belum ada data unit."}
            </div>
          ) : (
            options.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  onChange(u);
                  setOpen(false);
                  setSearch("");
                }}
                className="w-full text-left p-2 hover:bg-muted rounded-md"
              >
                <code className="block text-xs font-bold truncate">{u.kode_unit}</code>
                <span className="block text-[10px] text-muted-foreground truncate">
                  {u.tipe_unit} · {u.brand || "Brand belum diisi"}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
