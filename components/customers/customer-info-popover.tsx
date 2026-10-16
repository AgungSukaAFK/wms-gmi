"use client";

import React, { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, MapPin, Phone, User } from "lucide-react";

type CustomerDetail = {
  customer_no: string;
  customer_name: string;
  telephone: string | null;
  contact_name: string | null;
  is_active: boolean;
  customer_sites: {
    id: number;
    site_name: string;
    alamat: string | null;
    is_active: boolean;
    cabang: { nama_cabang: string } | null;
  }[];
};

/**
 * Nama customer yang bisa diklik untuk melihat detail customer (kontak &
 * lokasi/site bila ada). Detail baru diambil saat popover dibuka. Klik tidak
 * diteruskan ke baris tabel (yang biasanya membuka halaman detail dokumen).
 */
export function CustomerInfoPopover({
  customerId,
  customerName,
  className,
}: {
  customerId: number | null | undefined;
  customerName: string | null | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);

  if (!customerId) return <span className={className}>{customerName || "-"}</span>;

  const handleOpenChange = async (next: boolean) => {
    setOpen(next);
    if (!next || detail) return;
    setLoading(true);
    const { data } = await createClient()
      .from("customers")
      .select(
        "customer_no, customer_name, telephone, contact_name, is_active, customer_sites(id, site_name, alamat, is_active, cabang:cabang!cabang_id(nama_cabang))",
      )
      .eq("id", customerId)
      .maybeSingle();
    setDetail((data as unknown as CustomerDetail) ?? null);
    setLoading(false);
  };

  const sites = (detail?.customer_sites || []).filter((s) => s.is_active);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={`text-left underline decoration-dotted underline-offset-4 hover:decoration-solid ${className ?? ""}`}
        >
          {customerName || "-"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex items-center justify-center p-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !detail ? (
          <div className="p-4 text-xs text-muted-foreground italic">
            Data customer tidak ditemukan.
          </div>
        ) : (
          <div className="text-xs">
            <div className="border-b bg-muted/40 p-3">
              <p className="font-bold uppercase text-foreground">
                {detail.customer_name}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {detail.customer_no}
                {!detail.is_active && (
                  <span className="ml-1.5 font-bold text-destructive">
                    · NONAKTIF
                  </span>
                )}
              </p>
            </div>
            <div className="space-y-2 p-3">
              <p className="flex items-start gap-2">
                <User className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <span>{detail.contact_name || "-"}</span>
              </p>
              <p className="flex items-start gap-2">
                <Phone className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <span>{detail.telephone || "-"}</span>
              </p>
            </div>
            {sites.length > 0 && (
              <div className="border-t p-3">
                <p className="mb-2 text-[10px] font-bold uppercase text-muted-foreground">
                  Lokasi / Site
                </p>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {sites.map((s) => (
                    <div key={s.id} className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="font-semibold">{s.site_name}</p>
                        {s.alamat && (
                          <p className="text-[10px] text-muted-foreground whitespace-pre-wrap">
                            {s.alamat}
                          </p>
                        )}
                        {s.cabang?.nama_cabang && (
                          <p className="text-[10px] text-muted-foreground">
                            Gudang: {s.cabang.nama_cabang}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
