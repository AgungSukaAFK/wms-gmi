"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Plus,
  Trash2,
  Package,
  Loader2,
  AlertTriangle,
  Send,
} from "lucide-react";
import { useDebounce } from "use-debounce";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import Link from "next/link";
import { getMrItemConstraint } from "@/services/procurement-actions";
import { requestStockSetting } from "@/services/stock-request-actions";

interface Barang {
  id: number;
  part_number: string;
  part_name: string;
  part_satuan: string;
}

export interface MRItem {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
}

interface StockCap {
  allowedMax: number | null; // null = tidak diketahui (cabang tujuan tak tersedia)
  currentQty: number;
  maxQty: number;
  hasPolicy: boolean; // false = max_qty belum dikonfigurasi (belum ada kebijakan)
}

interface DupModalState {
  barang: Barang;
  codes: string[];
  cap: StockCap;
}

interface MRItemSelectorProps {
  items: MRItem[];
  onItemsChange: (items: MRItem[]) => void;
  /** Cabang tujuan MR (= cabang requester). Dipakai untuk deteksi duplikat & batas max stock. */
  cabangId?: number | null;
  /** Dipanggil jika user memilih membatalkan seluruh pembuatan MR dari modal duplikat. */
  onCancelMR?: () => void;
}

export function MRItemSelector({
  items,
  onItemsChange,
  cabangId,
  onCancelMR,
}: MRItemSelectorProps) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [results, setResults] = useState<Barang[]>([]);
  const [loading, setLoading] = useState(false);

  // Batas max stock per part_id
  const [stockCaps, setStockCaps] = useState<Record<number, StockCap>>({});
  // part_id yang sedang dicek constraint-nya (loading)
  const [checkingPartId, setCheckingPartId] = useState<number | null>(null);
  // Modal informasi duplikat PN
  const [dupModal, setDupModal] = useState<DupModalState | null>(null);
  const [stockReqModal, setStockReqModal] = useState<{
    barang: Barang;
    cap: StockCap;
    reason: "no_policy" | "limit_reached";
  } | null>(null);
  const [sendingStockReq, setSendingStockReq] = useState(false);

  const fetchItems = async (q: string) => {
    setLoading(true);
    let query = supabase
      .from("barang")
      .select("*")
      .order("part_name")
      .limit(15);

    if (q) {
      query = query.or(`part_number.ilike.%${q}%,part_name.ilike.%${q}%`);
    }

    const { data } = await query;
    setResults(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (open) {
      fetchItems(debouncedSearch);
    }
  }, [debouncedSearch, open]);

  // Tambahkan item ke daftar (dengan menyimpan batas max stock-nya).
  const addItemNow = (barang: Barang, cap: StockCap) => {
    if (items.some((i) => i.part_id === barang.id)) return;

    const initialQty =
      cap.allowedMax !== null ? Math.min(1, cap.allowedMax) : 1;

    const newItem: MRItem = {
      part_id: barang.id,
      part_number: barang.part_number,
      part_name: barang.part_name,
      satuan: barang.part_satuan,
      qty: initialQty,
    };

    setStockCaps((prev) => ({ ...prev, [barang.id]: cap }));
    onItemsChange([...items, newItem]);
  };

  const sendStockRequest = async (
    barang: Barang,
    cap: StockCap,
    reason: "no_policy" | "limit_reached",
  ) => {
    if (!cabangId) {
      toast.error("Pilih cabang tujuan terlebih dahulu.");
      return;
    }
    setSendingStockReq(true);
    const res = await requestStockSetting({
      part_id: barang.id,
      part_number: barang.part_number,
      part_name: barang.part_name,
      cabang_id: cabangId,
      reason,
      current_qty: cap.currentQty,
      max_qty: cap.maxQty,
    });
    setSendingStockReq(false);
    if (res?.success) {
      toast.success(
        res.alreadyExists
          ? `${barang.part_number} sudah pernah diminta — menunggu atasan.`
          : `Request pengaturan stok ${barang.part_number} terkirim ke atasan.`,
      );
      setStockReqModal(null);
    } else {
      toast.error(res?.error || "Gagal mengirim request");
    }
  };

  const handleAddItem = async (barang: Barang) => {
    if (items.some((i) => i.part_id === barang.id)) return;

    // Tutup popover pencarian dulu
    setOpen(false);
    setSearch("");

    // Tanpa cabang tujuan, tidak bisa cek constraint — tambahkan langsung.
    if (!cabangId) {
      addItemNow(barang, {
        allowedMax: null,
        currentQty: 0,
        maxQty: 0,
        hasPolicy: false,
      });
      return;
    }

    setCheckingPartId(barang.id);
    let res;
    try {
      res = await getMrItemConstraint(cabangId, barang.id);
    } catch {
      toast.error("Gagal memeriksa stok / duplikat. Coba lagi.");
      setCheckingPartId(null);
      return;
    }
    setCheckingPartId(null);

    const cap: StockCap = {
      allowedMax: res.stock.allowedMax,
      currentQty: res.stock.currentQty,
      maxQty: res.stock.maxQty,
      hasPolicy: res.stock.hasPolicy,
    };

    // allowedMax 0 → tidak bisa diminta sama sekali. Tampilkan modal.
    if (cap.allowedMax === 0) {
      const reason = !cap.hasPolicy ? "no_policy" : "limit_reached";
      setStockReqModal({ barang, cap, reason });
      return;
    }

    // Ada MR aktif yang sudah mengandung PN ini → tampilkan modal konfirmasi.
    if (res.duplicateMrCodes.length > 0) {
      setDupModal({ barang, codes: res.duplicateMrCodes, cap });
      return;
    }

    addItemNow(barang, cap);
  };

  const removeItem = (part_id: number) => {
    onItemsChange(items.filter((i) => i.part_id !== part_id));
    setStockCaps((prev) => {
      const next = { ...prev };
      delete next[part_id];
      return next;
    });
  };

  const updateItem = (part_id: number, updates: Partial<MRItem>) => {
    onItemsChange(
      items.map((i) => {
        if (i.part_id !== part_id) return i;
        const merged = { ...i, ...updates };
        // Clamp qty ke batas max stock jika ada kebijakan max.
        const cap = stockCaps[part_id];
        if (
          updates.qty !== undefined &&
          cap?.allowedMax !== null &&
          cap?.allowedMax !== undefined &&
          merged.qty > cap.allowedMax
        ) {
          merged.qty = cap.allowedMax;
        }
        return merged;
      }),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-slate-500" />
          <h3 className="font-semibold text-slate-900 text-sm">
            Daftar Barang
          </h3>
        </div>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 font-medium"
              disabled={checkingPartId !== null}
            >
              {checkingPartId !== null ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}{" "}
              Tambah Barang
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[calc(100vw-2rem)] max-w-100 p-0 rounded-lg border-slate-200 shadow-xl overflow-hidden"
            align="end"
          >
            <div className="p-2 border-b border-slate-100 bg-slate-50/50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Cari Barang..."
                  className="pl-8 h-8 bg-white border-slate-200 focus:ring-slate-900 rounded-md text-xs"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-[300px] overflow-y-auto p-1">
              {loading ? (
                <div className="p-8 text-center bg-slate-50/30">
                  <span className="text-[10px] font-medium text-slate-400">
                    Searching...
                  </span>
                </div>
              ) : results.length > 0 ? (
                results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleAddItem(r)}
                    disabled={items.some((i) => i.part_id === r.id)}
                    className="w-full text-left p-2 hover:bg-slate-50 transition-all rounded-md group disabled:opacity-50"
                  >
                    <div className="flex justify-between items-center gap-4">
                      <div className="flex flex-col min-w-0">
                        <code className="text-xs font-bold text-slate-900 leading-none mb-0.5">
                          {r.part_number}
                        </code>
                        <span className="text-[10px] text-slate-400 truncate">
                          {r.part_name}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-medium text-slate-400 h-4 px-1"
                      >
                        {r.part_satuan}
                      </Badge>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-8 text-center text-slate-400 text-xs italic">
                  Barang tidak ditemukan.
                </div>
              )}
            </div>
            <div className="p-2 bg-slate-50/80 border-t border-slate-100 flex justify-center">
              <Link
                href="/request-barang-baru"
                className="text-[10px] font-medium text-blue-600 hover:underline"
              >
                Request Item Baru
              </Link>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white border-slate-200">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow className="h-10 hover:bg-transparent">
              <TableHead className="w-[50px] text-center font-semibold text-slate-500 text-xs">
                No
              </TableHead>
              <TableHead className="font-semibold text-slate-500 text-xs">
                Part Name & Number
              </TableHead>
              <TableHead className="w-[100px] font-semibold text-slate-500 text-xs text-center">
                Unit
              </TableHead>
              <TableHead className="w-35 font-semibold text-slate-500 text-xs text-center">
                Quantity
              </TableHead>
              <TableHead className="w-[60px] text-center font-semibold text-slate-500 text-xs">
                Aksi
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length > 0 ? (
              items.map((item, index) => {
                const cap = stockCaps[item.part_id];
                const hasCap =
                  cap?.allowedMax !== null && cap?.allowedMax !== undefined;
                return (
                  <TableRow
                    key={item.part_id}
                    className="h-12 hover:bg-slate-50/50 transition-colors"
                  >
                    <TableCell className="text-center text-slate-400 text-xs font-medium">
                      {index + 1}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-900 text-xs">
                          {item.part_name}
                        </span>
                        <code className="text-[10px] text-slate-400">
                          {item.part_number}
                        </code>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-[10px] font-medium text-slate-500 uppercase">
                        {item.satuan}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-center gap-0.5">
                        <Input
                          type="number"
                          min="1"
                          max={hasCap ? cap.allowedMax! : undefined}
                          value={item.qty}
                          onChange={(e) =>
                            updateItem(item.part_id, {
                              qty: parseInt(e.target.value) || 0,
                            })
                          }
                          className="h-8 w-20 text-center font-medium text-xs rounded-md bg-white border-slate-200"
                        />
                        {hasCap && (
                          <span className="text-[9px] font-medium text-amber-600">
                            Maks {cap.allowedMax} (stok {cap.currentQty}/
                            {cap.maxQty})
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(item.part_id)}
                        className="h-7 w-7 text-slate-300 hover:text-red-500 rounded-md"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow className="h-32 hover:bg-transparent">
                <TableCell colSpan={5} className="text-center">
                  <span className="text-xs font-medium text-slate-400 italic">
                    No items added yet.
                  </span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Modal informasi duplikat PN */}
      <Dialog
        open={dupModal !== null}
        onOpenChange={(o) => {
          if (!o) setDupModal(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" /> PN Sudah Ada di MR Aktif
            </DialogTitle>
            <DialogDescription className="text-left">
              PN{" "}
              <span className="font-bold text-foreground">
                {dupModal?.barang.part_number}
              </span>{" "}
              ({dupModal?.barang.part_name}) sudah terdapat pada MR aktif di
              gudang tujuan Anda. Cek apakah permintaan ini benar-benar perlu
              agar tidak terjadi pemesanan ganda.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-1.5">
              Terdapat di MR:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {dupModal?.codes.map((code) => (
                <Badge
                  key={code}
                  variant="outline"
                  className="border-amber-300 bg-white text-amber-700 font-bold text-xs"
                >
                  {code}
                </Badge>
              ))}
            </div>
            <p className="text-[9px] text-amber-600/70 mt-2 italic">
              Hanya kode MR yang ditampilkan. MR tersebut bisa jadi milik
              departemen lain.
            </p>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <Button
              className="w-full"
              onClick={() => {
                if (dupModal) addItemNow(dupModal.barang, dupModal.cap);
                setDupModal(null);
              }}
            >
              Tetap Tambahkan PN Ini
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setDupModal(null)}
            >
              Jangan Tambahkan PN Ini
            </Button>
            <Button
              variant="ghost"
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/5"
              onClick={() => {
                setDupModal(null);
                onCancelMR?.();
              }}
            >
              Batalkan Pembuatan MR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: item tidak bisa ditambah → minta atur stok */}
      <Dialog
        open={stockReqModal !== null}
        onOpenChange={(o) => {
          if (!o) setStockReqModal(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" /> Item Belum Bisa Ditambahkan
            </DialogTitle>
            <DialogDescription className="text-left">
              {stockReqModal?.reason === "no_policy" ? (
                <>
                  <span className="font-mono font-bold text-foreground">
                    {stockReqModal?.barang.part_number}
                  </span>{" "}
                  belum punya kebijakan stok (min/max) di gudang Anda, jadi belum
                  bisa diminta.
                </>
              ) : (
                <>
                  Stok{" "}
                  <span className="font-mono font-bold text-foreground">
                    {stockReqModal?.barang.part_number}
                  </span>{" "}
                  sudah mencapai batas maksimum di gudang Anda (
                  {stockReqModal?.cap.currentQty}/{stockReqModal?.cap.maxQty}),
                  jadi belum bisa diminta.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-[11px] font-medium text-amber-800">
            Kirim permintaan ke moderator/PPIC untuk mengatur stok PN ini.
            Setelah diatur, item bisa langsung ditambahkan ke MR.
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="ghost"
              className="text-xs font-bold"
              onClick={() => setStockReqModal(null)}
              disabled={sendingStockReq}
            >
              Tutup
            </Button>
            <Button
              className="gap-2 text-xs font-bold"
              onClick={() =>
                stockReqModal &&
                sendStockRequest(
                  stockReqModal.barang,
                  stockReqModal.cap,
                  stockReqModal.reason,
                )
              }
              disabled={sendingStockReq}
            >
              {sendingStockReq ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Minta Atur Stok
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
