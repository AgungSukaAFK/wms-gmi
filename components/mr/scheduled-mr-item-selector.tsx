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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Search,
  Plus,
  Trash2,
  Package,
  Loader2,
  AlertTriangle,
  Send,
  Settings2,
  Check,
  ChevronsUpDown,
  MapPin,
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
import { cn } from "@/lib/utils";
import { getMrItemConstraint } from "@/services/procurement-actions";
import { requestStockSetting } from "@/services/stock-request-actions";

interface Barang {
  id: number;
  part_number: string;
  part_name: string;
  part_satuan: string;
}

export interface ScheduledMRItem {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty_request: number;
  item_due_date: string;
  item_priority: string;
  item_site_cabang_id: number | null;
  remarks?: string;
  qty_pr: number;
  qty_sharestock_total: number;
  sharestocks: { source_cabang_id: number | ""; qty: number }[];
}

interface StockCap {
  allowedMax: number | null;
  currentQty: number;
  maxQty: number;
  hasPolicy: boolean;
}

interface DupModalState {
  barang: Barang;
  codes: string[];
  cap: StockCap;
}

interface Props {
  items: ScheduledMRItem[];
  onItemsChange: (items: ScheduledMRItem[]) => void;
  /** Cabang tujuan MR (= cabang requester). */
  cabangId?: number | null;
  onCancelMR?: () => void;
  defaultDueDate?: string;
  defaultPriority?: string;
}

// Scheduled MR khusus perencanaan bulan depan atau lebih — due date item
// tidak boleh di bulan berjalan (dasar hitung sama dengan validasi server di
// services/scheduled-mr-actions.ts). Dipakai sebagai `min` date input supaya
// user tidak bisa pilih tanggal tidak valid dari awal.
const MIN_ITEM_DUE_DATE = (() => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
})();

const PRIORITY_COLOR: Record<string, string> = {
  P1: "text-destructive bg-destructive/10 border-destructive/30",
  P2: "text-warning bg-warning/10 border-warning/30",
  P3: "text-primary bg-primary/10 border-primary/30",
  P4: "text-muted-foreground bg-muted border-border",
};

/**
 * Combobox pencarian site tujuan — memakai daftar cabang yang sama dengan
 * "Lokasi Site" di form MR create & pemilihan cabang di Approval Templates
 * (bukan teks bebas / master data baru).
 */
function SiteCombobox({
  cabangs,
  value,
  onChange,
}: {
  cabangs: { id: number; nama_cabang: string }[];
  value: number | null;
  onChange: (cabangId: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = cabangs.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full justify-between text-xs font-normal"
        >
          <span className="truncate flex items-center gap-1.5">
            <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
            {selected ? selected.nama_cabang : "Pilih site..."}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Cari site..." className="text-xs" />
          <CommandList>
            <CommandEmpty>Site tidak ditemukan.</CommandEmpty>
            <CommandGroup>
              {cabangs.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.nama_cabang}
                  onSelect={() => {
                    onChange(c.id === value ? null : c.id);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5",
                      value === c.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {c.nama_cabang}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ScheduledMRItemSelector({
  items,
  onItemsChange,
  cabangId,
  onCancelMR,
  defaultDueDate,
  defaultPriority,
}: Props) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [results, setResults] = useState<Barang[]>([]);
  const [loading, setLoading] = useState(false);

  const [stockCaps, setStockCaps] = useState<Record<number, StockCap>>({});
  const [checkingPartId, setCheckingPartId] = useState<number | null>(null);
  const [dupModal, setDupModal] = useState<DupModalState | null>(null);
  const [stockReqModal, setStockReqModal] = useState<{
    barang: Barang;
    cap: StockCap;
    reason: "no_policy" | "limit_reached";
  } | null>(null);
  const [sendingStockReq, setSendingStockReq] = useState(false);

  const [cabangs, setCabangs] = useState<{ id: number; nama_cabang: string }[]>(
    [],
  );
  const [stockByPart, setStockByPart] = useState<
    Record<number, Record<number, number>>
  >({});
  const [allocDialogPartId, setAllocDialogPartId] = useState<number | null>(
    null,
  );
  const [allocDraft, setAllocDraft] = useState<{
    qty_pr: number;
    qty_sharestock_total: number;
    sharestocks: { source_cabang_id: number | ""; qty: number }[];
  } | null>(null);

  useEffect(() => {
    supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then(({ data }) => setCabangs(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchStockForPart = async (partId: number) => {
    const { data } = await supabase
      .from("stock")
      .select("cabang_id, qty")
      .eq("part_id", partId);
    const byCabang: Record<number, number> = {};
    (data || []).forEach((s: any) => {
      byCabang[s.cabang_id] = s.qty;
    });
    setStockByPart((prev) => ({ ...prev, [partId]: byCabang }));
  };

  const fetchItems = async (q: string) => {
    setLoading(true);
    let query = supabase.from("barang").select("*").limit(50);
    if (q) {
      const escaped = q.replace(/["\\]/g, "\\$&");
      query = query
        .or(`part_number.ilike."%${escaped}%",part_name.ilike."%${escaped}%"`)
        .order("part_number");
    } else {
      query = query.order("part_name");
    }
    const { data } = await query;
    setResults(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (open) fetchItems(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, open]);

  const addItemNow = (barang: Barang, cap: StockCap) => {
    if (items.some((i) => i.part_id === barang.id)) return;
    const qty = cap.allowedMax !== null ? Math.min(1, cap.allowedMax) : 1;
    const newItem: ScheduledMRItem = {
      part_id: barang.id,
      part_number: barang.part_number,
      part_name: barang.part_name,
      satuan: barang.part_satuan,
      qty_request: qty,
      item_due_date: defaultDueDate || "",
      item_priority: defaultPriority || "P3",
      item_site_cabang_id: null,
      qty_pr: qty,
      qty_sharestock_total: 0,
      sharestocks: [],
    };
    setStockCaps((prev) => ({ ...prev, [barang.id]: cap }));
    onItemsChange([...items, newItem]);
    fetchStockForPart(barang.id);
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
    setOpen(false);
    setSearch("");

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

    if (cap.allowedMax === 0) {
      const reason = !cap.hasPolicy ? "no_policy" : "limit_reached";
      setStockReqModal({ barang, cap, reason });
      return;
    }
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

  const updateItem = (part_id: number, updates: Partial<ScheduledMRItem>) => {
    onItemsChange(
      items.map((i) => {
        if (i.part_id !== part_id) return i;
        const merged = { ...i, ...updates };
        const cap = stockCaps[part_id];
        if (
          updates.qty_request !== undefined &&
          cap?.allowedMax !== null &&
          cap?.allowedMax !== undefined &&
          merged.qty_request > cap.allowedMax
        ) {
          merged.qty_request = cap.allowedMax;
        }
        // Qty request berubah -> reset split ke full PR supaya tidak nyangkut
        // di angka lama yang sudah tidak konsisten.
        if (
          updates.qty_request !== undefined &&
          merged.qty_pr + merged.qty_sharestock_total !== merged.qty_request
        ) {
          merged.qty_pr = merged.qty_request;
          merged.qty_sharestock_total = 0;
          merged.sharestocks = [];
        }
        return merged;
      }),
    );
  };

  const openAllocDialog = (item: ScheduledMRItem) => {
    setAllocDialogPartId(item.part_id);
    setAllocDraft({
      qty_pr: item.qty_pr,
      qty_sharestock_total: item.qty_sharestock_total,
      sharestocks:
        item.sharestocks.length > 0
          ? item.sharestocks
          : [],
    });
  };

  const saveAllocDialog = () => {
    if (!allocDialogPartId || !allocDraft) return;
    const item = items.find((i) => i.part_id === allocDialogPartId);
    if (!item) return;

    if (allocDraft.qty_pr + allocDraft.qty_sharestock_total !== item.qty_request) {
      toast.error(
        `Total PR (${allocDraft.qty_pr}) + Share Stock (${allocDraft.qty_sharestock_total}) harus sama dengan qty diminta (${item.qty_request}).`,
      );
      return;
    }
    if (allocDraft.qty_sharestock_total > 0) {
      const sum = allocDraft.sharestocks.reduce(
        (s, ss) => s + Number(ss.qty || 0),
        0,
      );
      if (sum !== allocDraft.qty_sharestock_total) {
        toast.error(
          `Total baris alokasi Share Stock (${sum}) tidak sama dengan qty Share Stock (${allocDraft.qty_sharestock_total}).`,
        );
        return;
      }
      const invalidRow = allocDraft.sharestocks.find(
        (ss) => !ss.source_cabang_id || ss.source_cabang_id === cabangId,
      );
      if (invalidRow) {
        toast.error(
          "Pilih gudang sumber (bukan gudang tujuan MR) untuk setiap baris Share Stock.",
        );
        return;
      }
    }

    updateItem(allocDialogPartId, {
      qty_pr: allocDraft.qty_pr,
      qty_sharestock_total: allocDraft.qty_sharestock_total,
      sharestocks:
        allocDraft.qty_sharestock_total > 0 ? allocDraft.sharestocks : [],
    });
    setAllocDialogPartId(null);
    setAllocDraft(null);
  };

  const allocItem = items.find((i) => i.part_id === allocDialogPartId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-slate-500" />
          <h3 className="font-semibold text-slate-900 text-sm">
            Daftar Barang ({items.length})
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
          </PopoverContent>
        </Popover>
      </div>

      <div className="border rounded-lg overflow-x-auto bg-white border-slate-200">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow className="h-10 hover:bg-transparent">
              <TableHead className="w-10 text-center font-semibold text-slate-500 text-xs">
                No
              </TableHead>
              <TableHead className="font-semibold text-slate-500 text-xs">
                Part
              </TableHead>
              <TableHead className="w-20 text-center font-semibold text-slate-500 text-xs">
                Qty
              </TableHead>
              <TableHead className="w-36 font-semibold text-slate-500 text-xs">
                Due Date
              </TableHead>
              <TableHead className="w-28 font-semibold text-slate-500 text-xs">
                Priority
              </TableHead>
              <TableHead className="w-36 font-semibold text-slate-500 text-xs">
                Site
              </TableHead>
              <TableHead className="w-44 font-semibold text-slate-500 text-xs">
                Alokasi (PR / Share Stock)
              </TableHead>
              <TableHead className="w-14 text-center font-semibold text-slate-500 text-xs">
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
                    className="hover:bg-slate-50/50 transition-colors align-top"
                  >
                    <TableCell className="text-center text-slate-400 text-xs font-medium pt-3">
                      {index + 1}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex flex-col">
                        <code className="text-sm font-bold text-slate-900">
                          {item.part_number}
                        </code>
                        <span className="text-[10px] text-slate-400 truncate max-w-40">
                          {item.part_name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <Input
                        type="number"
                        min={1}
                        max={hasCap ? cap.allowedMax! : undefined}
                        value={item.qty_request}
                        onChange={(e) =>
                          updateItem(item.part_id, {
                            qty_request: parseInt(e.target.value) || 0,
                          })
                        }
                        className="h-8 w-16 text-center text-xs"
                      />
                      {hasCap && (
                        <span className="block mt-0.5 text-[9px] font-medium text-amber-600">
                          Maks {cap.allowedMax}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <Input
                        type="date"
                        min={MIN_ITEM_DUE_DATE}
                        value={item.item_due_date}
                        onChange={(e) =>
                          updateItem(item.part_id, {
                            item_due_date: e.target.value,
                          })
                        }
                        className="h-8 text-xs"
                      />
                    </TableCell>
                    <TableCell className="py-2">
                      <Select
                        value={item.item_priority}
                        onValueChange={(v) =>
                          updateItem(item.part_id, { item_priority: v })
                        }
                      >
                        <SelectTrigger
                          className={`h-8 text-xs font-semibold ${PRIORITY_COLOR[item.item_priority] || ""}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="P1">P1 - Emergency</SelectItem>
                          <SelectItem value="P2">P2 - High</SelectItem>
                          <SelectItem value="P3">P3 - Normal</SelectItem>
                          <SelectItem value="P4">P4 - Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="py-2">
                      <SiteCombobox
                        cabangs={cabangs}
                        value={item.item_site_cabang_id}
                        onChange={(cabangId) =>
                          updateItem(item.part_id, {
                            item_site_cabang_id: cabangId,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="py-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full gap-1.5 text-[11px] font-medium justify-start"
                        onClick={() => openAllocDialog(item)}
                      >
                        <Settings2 className="h-3 w-3 shrink-0" />
                        PR {item.qty_pr} / SS {item.qty_sharestock_total}
                      </Button>
                    </TableCell>
                    <TableCell className="text-center py-2">
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
                <TableCell colSpan={8} className="text-center">
                  <span className="text-xs font-medium text-slate-400 italic">
                    Belum ada item. Tambahkan barang di atas.
                  </span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialog alokasi PR vs Share Stock per item */}
      <Dialog
        open={allocDialogPartId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setAllocDialogPartId(null);
            setAllocDraft(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Alokasi — {allocItem?.part_number}
            </DialogTitle>
            <DialogDescription>
              Tentukan berapa qty item ini yang dibeli lewat PR (Purchase
              Request) dan berapa yang diambil dari Share Stock cabang lain.
              Total harus sama dengan qty diminta ({allocItem?.qty_request}).
            </DialogDescription>
          </DialogHeader>

          {allocItem && allocDraft && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">
                    Qty PR
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={allocItem.qty_request}
                    value={allocDraft.qty_pr}
                    onChange={(e) => {
                      const qtyPr = Math.max(
                        0,
                        Math.min(allocItem.qty_request, parseInt(e.target.value) || 0),
                      );
                      setAllocDraft({
                        ...allocDraft,
                        qty_pr: qtyPr,
                        qty_sharestock_total: allocItem.qty_request - qtyPr,
                      });
                    }}
                    className="h-9 text-sm font-bold"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">
                    Qty Share Stock
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={allocItem.qty_request}
                    value={allocDraft.qty_sharestock_total}
                    onChange={(e) => {
                      const qtySs = Math.max(
                        0,
                        Math.min(allocItem.qty_request, parseInt(e.target.value) || 0),
                      );
                      setAllocDraft({
                        ...allocDraft,
                        qty_sharestock_total: qtySs,
                        qty_pr: allocItem.qty_request - qtySs,
                      });
                    }}
                    className="h-9 text-sm font-bold"
                  />
                </div>
              </div>

              {allocDraft.qty_sharestock_total > 0 && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">
                      Gudang Sumber Share Stock
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-[11px]"
                      onClick={() =>
                        setAllocDraft({
                          ...allocDraft,
                          sharestocks: [
                            ...allocDraft.sharestocks,
                            { source_cabang_id: "", qty: 0 },
                          ],
                        })
                      }
                    >
                      <Plus className="h-3 w-3" /> Tambah Baris
                    </Button>
                  </div>
                  {allocDraft.sharestocks.map((ss, idx) => {
                    const avail =
                      ss.source_cabang_id !== ""
                        ? stockByPart[allocItem.part_id]?.[
                            Number(ss.source_cabang_id)
                          ] ?? 0
                        : 0;
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <select
                          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                          value={ss.source_cabang_id}
                          onChange={(e) => {
                            const next = [...allocDraft.sharestocks];
                            next[idx] = {
                              ...next[idx],
                              source_cabang_id: e.target.value
                                ? Number(e.target.value)
                                : "",
                            };
                            setAllocDraft({ ...allocDraft, sharestocks: next });
                          }}
                        >
                          <option value="">Pilih gudang sumber...</option>
                          {cabangs
                            .filter((c) => c.id !== cabangId)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nama_cabang} —{" "}
                                {stockByPart[allocItem.part_id]?.[c.id] ?? 0}{" "}
                                stok
                              </option>
                            ))}
                        </select>
                        <Input
                          type="number"
                          min={0}
                          max={avail}
                          value={ss.qty}
                          onChange={(e) => {
                            const next = [...allocDraft.sharestocks];
                            next[idx] = {
                              ...next[idx],
                              qty: Math.max(
                                0,
                                Math.min(avail, parseInt(e.target.value) || 0),
                              ),
                            };
                            setAllocDraft({ ...allocDraft, sharestocks: next });
                          }}
                          className="h-8 w-20 text-center text-xs"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            const next = [...allocDraft.sharestocks];
                            next.splice(idx, 1);
                            setAllocDraft({ ...allocDraft, sharestocks: next });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                  <p className="text-[9px] text-muted-foreground italic">
                    Deadline share stock item ini mengikuti Due Date item ({allocItem.item_due_date || "-"}).
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setAllocDialogPartId(null);
                setAllocDraft(null);
              }}
            >
              Batal
            </Button>
            <Button onClick={saveAllocDialog}>Simpan Alokasi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Modal: item tidak bisa ditambah -> minta atur stok */}
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
                  belum punya kebijakan stok (min/max) di gudang Anda.
                </>
              ) : (
                <>
                  Stok{" "}
                  <span className="font-mono font-bold text-foreground">
                    {stockReqModal?.barang.part_number}
                  </span>{" "}
                  sudah mencapai batas maksimum di gudang Anda (
                  {stockReqModal?.cap.currentQty}/{stockReqModal?.cap.maxQty}).
                </>
              )}
            </DialogDescription>
          </DialogHeader>

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
