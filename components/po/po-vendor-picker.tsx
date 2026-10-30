"use client";

import { useState } from "react";
import { Building2, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type PoVendorOption = {
  id: number;
  vendor_name: string;
  vendor_no?: string | null;
};

// Picker vendor dengan pencarian ke master vendors. Dipakai untuk vendor
// dokumen (ukuran normal) maupun vendor per baris item (compact).
export function PoVendorPicker({
  value,
  onSelect,
  compact = false,
  placeholder = "Pilih Vendor...",
  className,
}: {
  value: PoVendorOption | null;
  onSelect: (vendor: PoVendorOption) => void;
  compact?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PoVendorOption[]>([]);
  const [loading, setLoading] = useState(false);

  const runSearch = async (query: string) => {
    setLoading(true);
    let q = supabase
      .from("vendors")
      .select("id, vendor_name, vendor_no")
      .is("deleted_at", null)
      .order("vendor_name")
      .limit(15);
    if (query.trim()) {
      q = q.or(`vendor_name.ilike.%${query}%,vendor_no.ilike.%${query}%`);
    }
    const { data } = await q;
    setResults((data as PoVendorOption[]) || []);
    setLoading(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (val) runSearch(search);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start gap-1.5 font-bold",
            compact ? "h-8 px-2 text-[11px]" : "h-10 text-sm",
            !value && "text-muted-foreground",
            className,
          )}
          title={value?.vendor_name}
        >
          <Building2
            className={cn(
              "shrink-0 text-muted-foreground",
              compact ? "h-3 w-3" : "h-3.5 w-3.5",
            )}
          />
          <span className="truncate">{value ? value.vendor_name : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Cari vendor..."
            value={search}
            onValueChange={(val) => {
              setSearch(val);
              runSearch(val);
            }}
          />
          <CommandList>
            {loading ? (
              <div className="py-6 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : results.length === 0 ? (
              <CommandEmpty>Vendor tidak ditemukan.</CommandEmpty>
            ) : (
              results.map((v) => (
                <CommandItem
                  key={v.id}
                  value={v.id.toString()}
                  onSelect={() => {
                    onSelect(v);
                    setOpen(false);
                  }}
                  className="text-xs font-bold gap-2"
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5",
                      value?.id === v.id ? "text-primary" : "text-transparent",
                    )}
                  />
                  <span className="flex-1">{v.vendor_name}</span>
                  {v.vendor_no && (
                    <span className="text-[9px] text-muted-foreground font-mono">
                      {v.vendor_no}
                    </span>
                  )}
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
