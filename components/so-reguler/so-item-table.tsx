"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "use-debounce";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Check,
  Loader2,
  Minus,
  Package,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SoFormItem {
  /** so_reguler_items.id -- hanya terisi untuk item lama saat Edit SO. */
  id?: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  remarks?: string;
}

interface Barang {
  id: number;
  part_number: string;
  part_name: string;
  part_satuan: string;
}

export interface PartStock {
  total: number;
  /** Stok > 0 per gudang, terbesar dulu. */
  gudang: { nama: string; qty: number }[];
}

export type StockCoverage = "full" | "partial" | "none";

/**
 * Edit SO: batas per item lama yang sudah dipakai PO/DO (key = part_id).
 * minQty = qty PO + qty DO dari stok (soItemMinQty); referenced = ada baris
 * PO/DO mana pun (termasuk PO rejected / DO cancelled) -> tidak bisa dihapus.
 */
export interface SoItemLock {
  minQty: number;
  qtyPo: number;
  qtyDo: number;
  referenced: boolean;
}

/** Pesan error qty item (null = valid). */
export function soItemQtyError(
  item: Pick<SoFormItem, "qty">,
  lock?: SoItemLock,
): string | null {
  if (!Number.isInteger(item.qty) || item.qty <= 0) return "Qty wajib > 0";
  if (lock && item.qty < lock.minQty) return `Min ${lock.minQty}`;
  return null;
}

/** Status pemenuhan indikatif: stok seluruh gudang aktif vs qty SO. */
export function stockCoverage(
  qty: number,
  stock: PartStock | undefined,
): StockCoverage | null {
  if (!stock) return null;
  if (stock.total <= 0) return "none";
  return stock.total >= qty ? "full" : "partial";
}

const fmt = (n: number) => n.toLocaleString("id-ID");

/**
 * Stok per part di semua gudang aktif. Hasil di-cache per halaman — cukup
 * sebagai informasi saat menyusun SO (stok bisa berubah sebelum DO dibuat).
 */
export function usePartStock(partIds: number[]) {
  const [stock, setStock] = useState<Record<number, PartStock>>({});
  const requested = useRef<Set<number>>(new Set());
  const key = [...new Set(partIds)].sort((a, b) => a - b).join(",");

  useEffect(() => {
    const missing = [...new Set(partIds)].filter(
      (id) => !requested.current.has(id),
    );
    if (missing.length === 0) return;
    missing.forEach((id) => requested.current.add(id));
    createClient()
      .from("stock")
      .select("part_id, qty, cabang:cabang_id(nama_cabang, is_active)")
      .in("part_id", missing)
      .gt("qty", 0)
      .then(({ data, error }) => {
        if (error) {
          missing.forEach((id) => requested.current.delete(id));
          return;
        }
        const next: Record<number, PartStock> = {};
        missing.forEach((id) => (next[id] = { total: 0, gudang: [] }));
        for (const row of (data || []) as any[]) {
          if (row.cabang && row.cabang.is_active === false) continue;
          const qty = Number(row.qty) || 0;
          const s = next[row.part_id];
          s.total += qty;
          s.gudang.push({ nama: row.cabang?.nama_cabang || "-", qty });
        }
        Object.values(next).forEach((s) =>
          s.gudang.sort((a, b) => b.qty - a.qty),
        );
        setStock((prev) => ({ ...prev, ...next }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return stock;
}

function CoverageBadge({
  qty,
  stock,
}: {
  qty: number;
  stock: PartStock | undefined;
}) {
  const c = stockCoverage(qty, stock);
  if (c === null)
    return (
      <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
    );
  if (c === "full")
    return (
      <Badge
        variant="outline"
        className="border-success/30 bg-success/10 text-success text-[10px] font-bold"
      >
        Siap DO
      </Badge>
    );
  if (c === "partial")
    return (
      <div className="flex flex-col items-center gap-0.5">
        <Badge
          variant="outline"
          className="border-warning/30 bg-warning/10 text-warning text-[10px] font-bold"
        >
          Sebagian
        </Badge>
        <span className="text-[9px] text-muted-foreground">
          kurang {fmt(qty - stock!.total)} → PO
        </span>
      </div>
    );
  return (
    <Badge
      variant="outline"
      className="border-destructive/30 bg-destructive/10 text-destructive text-[10px] font-bold"
    >
      Perlu PO
    </Badge>
  );
}

function StockCell({ stock }: { stock: PartStock | undefined }) {
  if (!stock)
    return <span className="text-[10px] text-muted-foreground">…</span>;
  if (stock.total === 0)
    return (
      <span className="text-xs font-semibold text-muted-foreground">0</span>
    );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold text-foreground underline decoration-dotted underline-offset-2 hover:bg-muted"
        >
          {fmt(stock.total)}
          <span className="text-[9px] font-medium text-muted-foreground no-underline">
            · {stock.gudang.length} gd
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="center">
        <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-2">
          <Warehouse className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] font-bold uppercase text-muted-foreground">
            Stok per gudang
          </span>
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {stock.gudang.map((g) => (
            <div
              key={g.nama}
              className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted"
            >
              <span className="truncate">{g.nama}</span>
              <span className="font-bold tabular-nums">{fmt(g.qty)}</span>
            </div>
          ))}
        </div>
        <p className="border-t px-3 py-2 text-[9px] italic text-muted-foreground">
          Gudang pengirim dipilih saat membuat DO Reguler.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function SoItemTable({
  items,
  onItemsChange,
  stock,
  showErrors,
  locks,
}: {
  items: SoFormItem[];
  onItemsChange: (items: SoFormItem[]) => void;
  stock: Record<number, PartStock>;
  /** Tandai qty yang tidak valid (setelah user mencoba menyimpan). */
  showErrors?: boolean;
  /** Edit SO: batas item yang sudah dipakai PO/DO, key = part_id. */
  locks?: Record<number, SoItemLock>;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [results, setResults] = useState<Barang[]>([]);
  const [resultStock, setResultStock] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [rowFilter, setRowFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      let query = supabase
        .from("barang")
        .select("id, part_number, part_name, part_satuan")
        .limit(30);
      const q = debouncedSearch.trim();
      if (q) {
        const escaped = q.replace(/["\\]/g, "\\$&");
        query = query
          .or(`part_number.ilike."%${escaped}%",part_name.ilike."%${escaped}%"`)
          .order("part_number");
      } else {
        query = query.order("part_name");
      }
      const { data } = await query;
      if (cancelled) return;
      const rows = (data || []) as Barang[];
      setResults(rows);
      setActiveIndex(0);
      setLoading(false);
      if (rows.length === 0) return;
      const { data: st } = await supabase
        .from("stock")
        .select("part_id, qty")
        .in(
          "part_id",
          rows.map((r) => r.id),
        )
        .gt("qty", 0);
      if (cancelled) return;
      const totals: Record<number, number> = {};
      for (const r of (st || []) as any[])
        totals[r.part_id] = (totals[r.part_id] || 0) + (Number(r.qty) || 0);
      setResultStock(totals);
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, open]);

  const flash = (partId: number) => {
    setFlashId(partId);
    setTimeout(() => setFlashId((cur) => (cur === partId ? null : cur)), 1500);
  };

  const addItem = (b: Barang) => {
    const existing = items.find((i) => i.part_id === b.id);
    if (existing) {
      // PN sudah ada → naikkan qty, bukan baris ganda.
      updateItem(b.id, { qty: existing.qty + 1 });
      toast.info(`${b.part_number} sudah ada — qty jadi ${existing.qty + 1}`);
    } else {
      onItemsChange([
        ...items,
        {
          part_id: b.id,
          part_number: b.part_number,
          part_name: b.part_name,
          satuan: b.part_satuan,
          qty: 1,
        },
      ]);
    }
    flash(b.id);
  };

  const updateItem = (partId: number, updates: Partial<SoFormItem>) =>
    onItemsChange(
      items.map((i) => (i.part_id === partId ? { ...i, ...updates } : i)),
    );

  const removeItem = (partId: number) => {
    if (locks?.[partId]?.referenced) return;
    const index = items.findIndex((i) => i.part_id === partId);
    const removed = items[index];
    if (!removed) return;
    const before = items;
    onItemsChange(items.filter((i) => i.part_id !== partId));
    toast(`${removed.part_number} dihapus`, {
      action: { label: "Urungkan", onClick: () => onItemsChange(before) },
    });
  };

  const clearAll = () => {
    const before = items;
    // Item yang sudah dipakai PO/DO tetap tinggal.
    const kept = items.filter((i) => locks?.[i.part_id]?.referenced);
    onItemsChange(kept);
    toast(`${before.length - kept.length} barang dihapus`, {
      action: { label: "Urungkan", onClick: () => onItemsChange(before) },
    });
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[activeIndex];
      if (r) addItem(r);
    }
  };

  const totalQty = items.reduce((s, i) => s + (i.qty > 0 ? i.qty : 0), 0);
  const filterText = rowFilter.trim().toLowerCase();
  const visibleItems = filterText
    ? items.filter(
        (i) =>
          i.part_number.toLowerCase().includes(filterText) ||
          i.part_name.toLowerCase().includes(filterText),
      )
    : items;

  const addButton = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5 font-semibold">
          <Plus className="h-3.5 w-3.5" /> Tambah Barang
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] max-w-md overflow-hidden p-0"
        align="end"
      >
        <div className="border-b bg-muted/40 p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari part number / nama barang..."
              className="h-9 pl-8 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
              autoFocus
            />
          </div>
          <p className="mt-1.5 px-0.5 text-[9px] text-muted-foreground">
            ↑↓ pilih · Enter tambah · klik beberapa barang sekaligus, popup
            tetap terbuka
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Mencari...
            </div>
          ) : results.length > 0 ? (
            results.map((r, idx) => {
              const added = items.find((i) => i.part_id === r.id);
              const st = resultStock[r.id] ?? 0;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => addItem(r)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={cn(
                    "w-full rounded-md p-2 text-left transition-colors",
                    idx === activeIndex ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <code className="mb-0.5 text-xs font-bold leading-none text-foreground">
                        {r.part_number}
                      </code>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {r.part_name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={cn(
                          "text-[10px] font-semibold tabular-nums",
                          st > 0 ? "text-success" : "text-muted-foreground",
                        )}
                      >
                        Stok {fmt(st)} {r.part_satuan}
                      </span>
                      {added && (
                        <Badge className="h-4 gap-0.5 bg-primary/10 px-1 text-[9px] text-primary hover:bg-primary/10">
                          <Check className="h-2.5 w-2.5" /> {added.qty}
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="p-8 text-center text-xs italic text-muted-foreground">
              Barang tidak ditemukan.
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t bg-muted/40 px-3 py-2">
          <span className="text-[10px] text-muted-foreground">
            {items.length} barang di SO
          </span>
          <Link
            href="/request-barang-baru"
            className="text-[10px] font-medium text-primary hover:underline"
          >
            Barang belum ada? Request Item Baru
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            Daftar Barang
          </h3>
          {items.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {items.length} item · {fmt(totalQty)} qty
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {items.length > 5 && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Saring daftar..."
                value={rowFilter}
                onChange={(e) => setRowFilter(e.target.value)}
                className="h-8 w-40 pl-7 text-xs"
              />
            </div>
          )}
          {items.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-destructive"
              onClick={clearAll}
            >
              Kosongkan
            </Button>
          )}
          {addButton}
        </div>
      </div>

      {items.length === 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors hover:border-primary/40 hover:bg-primary/5",
            showErrors ? "border-destructive/50" : "border-border",
          )}
        >
          <PackagePlus className="h-8 w-8 text-muted-foreground/60" />
          <span className="text-sm font-semibold text-foreground">
            Belum ada barang
          </span>
          <span className="max-w-sm text-xs text-muted-foreground">
            Klik di sini atau tombol <b>Tambah Barang</b> untuk mencari part.
            Stok di semua gudang langsung terlihat supaya tahu item mana yang
            bisa langsung dikirim dan mana yang perlu PO.
          </span>
        </button>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table containerClassName="max-h-[60vh] overflow-y-auto">
            <TableHeader>
              <TableRow className="h-10 hover:bg-transparent">
                <TableHead className="sticky top-0 z-10 w-10 bg-muted text-center text-xs">
                  No
                </TableHead>
                <TableHead className="sticky top-0 z-10 min-w-48 bg-muted text-xs">
                  Part Number & Nama
                </TableHead>
                <TableHead className="sticky top-0 z-10 w-36 bg-muted text-center text-xs">
                  Qty
                </TableHead>
                <TableHead className="sticky top-0 z-10 w-24 bg-muted text-center text-xs">
                  Stok Gudang
                </TableHead>
                <TableHead className="sticky top-0 z-10 w-28 bg-muted text-center text-xs">
                  Pemenuhan
                </TableHead>
                <TableHead className="sticky top-0 z-10 min-w-44 bg-muted text-xs">
                  Catatan
                </TableHead>
                <TableHead className="sticky top-0 z-10 w-12 bg-muted" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((item) => {
                const lock = locks?.[item.part_id];
                const minQty = Math.max(1, lock?.minQty ?? 1);
                const qtyError = soItemQtyError(item, lock);
                const invalid = qtyError !== null;
                // Qty di bawah batas PO/DO langsung ditandai, tanpa tunggu submit.
                const showQtyError = invalid && (showErrors || !!lock);
                return (
                  <TableRow
                    key={item.part_id}
                    className={cn(
                      "transition-colors duration-700",
                      flashId === item.part_id && "bg-primary/10",
                    )}
                  >
                    <TableCell className="text-center text-xs text-muted-foreground">
                      {items.indexOf(item) + 1}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex flex-col">
                        <code className="text-xs font-bold text-foreground">
                          {item.part_number}
                        </code>
                        <span className="text-[11px] text-muted-foreground">
                          {item.part_name}
                        </span>
                        {lock && (lock.qtyPo > 0 || lock.qtyDo > 0) && (
                          <span
                            className="mt-0.5 text-[9px] font-semibold text-primary"
                            title="Qty tidak bisa diturunkan di bawah qty yang sudah di-PO / dikirim dari stok"
                          >
                            Sudah PO {fmt(lock.qtyPo)} · DO {fmt(lock.qtyDo)} ·
                            min {fmt(lock.minQty)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-7 rounded-r-none"
                            disabled={item.qty <= minQty}
                            onClick={() =>
                              updateItem(item.part_id, {
                                qty: Math.max(minQty, item.qty - 1),
                              })
                            }
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <Input
                            type="number"
                            min={minQty}
                            step={1}
                            inputMode="numeric"
                            value={item.qty || ""}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) =>
                              updateItem(item.part_id, {
                                qty: parseInt(e.target.value) || 0,
                              })
                            }
                            className={cn(
                              "h-8 w-14 rounded-none border-x-0 px-1 text-center text-xs font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                              showQtyError &&
                                "border-destructive ring-1 ring-destructive",
                            )}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-7 rounded-l-none"
                            onClick={() =>
                              updateItem(item.part_id, {
                                qty: (item.qty || 0) + 1,
                              })
                            }
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <span
                          className={cn(
                            "text-[9px] uppercase",
                            showQtyError
                              ? "font-semibold text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {showQtyError ? qtyError : item.satuan}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <StockCell stock={stock[item.part_id]} />
                    </TableCell>
                    <TableCell className="text-center">
                      <CoverageBadge
                        qty={item.qty}
                        stock={stock[item.part_id]}
                      />
                    </TableCell>
                    <TableCell className="py-2">
                      <Input
                        placeholder="Opsional..."
                        value={item.remarks || ""}
                        onChange={(e) =>
                          updateItem(item.part_id, { remarks: e.target.value })
                        }
                        className="h-8 text-xs"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(item.part_id)}
                        disabled={lock?.referenced}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title={
                          lock?.referenced
                            ? "Tidak bisa dihapus: sudah dipakai PO/DO"
                            : "Hapus barang"
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {visibleItems.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={7}
                    className="py-6 text-center text-xs italic text-muted-foreground"
                  >
                    Tidak ada barang yang cocok dengan “{rowFilter}”.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {items.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          <b>Pemenuhan</b> bersifat informasi — dihitung dari total stok semua
          gudang aktif saat ini. SO tetap bisa disimpan walau stok kurang;
          kekurangannya dipenuhi lewat PO.
        </p>
      )}
    </div>
  );
}
