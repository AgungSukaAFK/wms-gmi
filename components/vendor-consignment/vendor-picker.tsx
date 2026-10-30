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

export type VendorOption = { id: number; vendor_name: string; vendor_no: string };

// Picker vendor dengan pencarian ke server (vendor ribuan baris). Kalau
// `stockCabangId` diisi, yang tampil hanya vendor yang punya stok konsinyasi
// (qty > 0) di gudang itu -- dipakai IT & SPB konsinyasi.
export function VendorPicker({
  value,
  onChange,
  stockCabangId,
  disabled,
  placeholder = "Pilih vendor...",
  className,
}: {
  value: VendorOption | null;
  onChange: (vendor: VendorOption | null) => void;
  stockCabangId?: number | null;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search, 300);
  const [options, setOptions] = useState<VendorOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const run = async () => {
      setLoading(true);
      const keyword = debounced.trim();
      if (stockCabangId) {
        const { data } = await supabase
          .from("vendor_consignment_stock")
          .select("vendor_id, vendors(id, vendor_name, vendor_no)")
          .eq("cabang_id", stockCabangId)
          .gt("qty", 0)
          .limit(1000);
        const seen = new Map<number, VendorOption>();
        for (const row of data || []) {
          const v: any = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors;
          if (v && !seen.has(v.id)) seen.set(v.id, v);
        }
        const k = keyword.toLowerCase();
        setOptions(
          Array.from(seen.values())
            .filter(
              (v) =>
                !k ||
                v.vendor_name.toLowerCase().includes(k) ||
                v.vendor_no.toLowerCase().includes(k),
            )
            .sort((a, b) => a.vendor_name.localeCompare(b.vendor_name)),
        );
      } else {
        let q = supabase
          .from("vendors")
          .select("id, vendor_name, vendor_no")
          .is("deleted_at", null)
          .eq("is_active", true)
          .order("vendor_name")
          .limit(20);
        if (keyword) q = q.or(`vendor_name.ilike.%${keyword}%,vendor_no.ilike.%${keyword}%`);
        const { data } = await q;
        setOptions((data || []) as VendorOption[]);
      }
      setLoading(false);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debounced, stockCabangId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={`w-full justify-between font-semibold ${className ?? "h-10 text-sm"}`}
        >
          <span className="truncate">
            {value ? `${value.vendor_name} (${value.vendor_no})` : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[calc(100vw-2rem)] max-w-96 p-0" align="start">
        <div className="p-2 border-b bg-muted/40">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari nama / kode vendor..."
              className="pl-8 h-8 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {loading ? (
            <div className="p-4 flex justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : options.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground italic">
              {stockCabangId
                ? "Tidak ada vendor dengan stok konsinyasi di gudang ini."
                : "Vendor tidak ditemukan."}
            </div>
          ) : (
            options.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  onChange(v);
                  setOpen(false);
                  setSearch("");
                }}
                className="w-full text-left p-2 hover:bg-muted rounded-md"
              >
                <span className="block text-xs font-bold truncate">{v.vendor_name}</span>
                <code className="block text-[10px] text-muted-foreground">{v.vendor_no}</code>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
