"use client";

import React, { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Search, Warehouse } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Content } from "@/components/content";
import { useDebounce } from "use-debounce";
import { getCustomerStockList } from "@/services/consignment-penerimaan-actions";

export default function CustomerStockPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);

  useEffect(() => {
    getCustomerStockList().then((res) => {
      setRows(res.data || []);
      setLoading(false);
    });
  }, []);

  const filtered = rows.filter((r) => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    return (
      r.customer_name?.toLowerCase().includes(q) ||
      r.part_number?.toLowerCase().includes(q) ||
      r.part_name?.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
            <Warehouse className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
              Stok di Customer
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Barang consignment yang sudah diterima & ada di gudang customer
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="relative min-w-0 flex-1 xl:max-w-100">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari customer, PN, atau nama part..."
            className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium"
          />
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Customer</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">PN Internal / Desc</TableHead>
                <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Update Terakhir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-xs text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Belum ada stok di customer
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs font-semibold">{r.customer_name}</TableCell>
                    <TableCell>
                      <code className="block text-xs font-bold">{r.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground">{r.part_name}</span>
                    </TableCell>
                    <TableCell className="text-right text-xs font-bold">
                      {r.qty} {r.part_satuan}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {r.updated_at ? new Date(r.updated_at).toLocaleString("id-ID") : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Content>
    </>
  );
}
