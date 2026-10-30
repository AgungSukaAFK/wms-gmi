"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { Search, Loader2, Warehouse, History, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatDateTime } from "@/lib/utils";
import { VendorPicker, type VendorOption } from "@/components/vendor-consignment/vendor-picker";
import {
  adjustConsignmentStock,
  getConsignmentMovements,
  getConsignmentStockList,
} from "@/services/vendor-consignment-actions";

const MOVE_LABEL: Record<string, { label: string; tone: string }> = {
  GR: { label: "GR Konsinyasi", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  GR_CANCEL: { label: "Batal GR", tone: "bg-muted text-foreground/80" },
  IT_OUT: { label: "IT Keluar", tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  IT_IN: { label: "IT Masuk", tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  SPB_OUT: { label: "SPB Out", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
  SPB_CANCEL: { label: "SPB Batal", tone: "bg-muted text-foreground/80" },
  SPB_ROLLBACK: { label: "SPB Rollback", tone: "bg-muted text-foreground/80" },
  SPB_RETURN: { label: "Return SPB", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  ADJUSTMENT: { label: "Stock Opname", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
};

export default function ConsignmentStockPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [cabangs, setCabangs] = useState<any[]>([]);
  const [vendor, setVendor] = useState<VendorOption | null>(null);
  const [cabangId, setCabangId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 300);
  const [isModeratorOrAdmin, setIsModeratorOrAdmin] = useState(false);

  const [historyRow, setHistoryRow] = useState<any | null>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [movesLoading, setMovesLoading] = useState(false);

  const [opnameRow, setOpnameRow] = useState<any | null>(null);
  const [opnameQty, setOpnameQty] = useState("");
  const [opnameNote, setOpnameNote] = useState("");
  const [opnameSaving, setOpnameSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await getConsignmentStockList({
      vendorId: vendor?.id ?? null,
      cabangId: cabangId === "all" ? null : Number(cabangId),
    });
    if (res.error) toast.error(res.error);
    setRows(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const { data: cabangData } = await supabase
        .from("cabang")
        .select("id, nama_cabang")
        .eq("is_active", true)
        .order("nama_cabang");
      setCabangs(cabangData || []);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: roleRows } = await supabase.from("user_roles").select("roles(name)").eq("user_id", user.id);
      const roleNames = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
      setIsModeratorOrAdmin(roleNames.some((r: string) => r === "moderator" || r === "admin"));
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?.id, cabangId]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return rows.filter(
      (r) =>
        !q ||
        r.barang?.part_number?.toLowerCase().includes(q) ||
        r.barang?.part_name?.toLowerCase().includes(q) ||
        r.vendors?.vendor_name?.toLowerCase().includes(q),
    );
  }, [rows, debouncedSearch]);

  const totalQty = filtered.reduce((a, r) => a + (Number(r.qty) || 0), 0);

  const openHistory = async (row: any) => {
    setHistoryRow(row);
    setMovesLoading(true);
    const res = await getConsignmentMovements({
      vendorId: row.vendor_id,
      cabangId: row.cabang_id,
      partId: row.part_id,
    });
    if (res.error) toast.error(res.error);
    setMoves(res.data || []);
    setMovesLoading(false);
  };

  // Saldo dihitung mundur dari qty saat ini (sama seperti riwayat /stock).
  const movesWithSaldo = useMemo(() => {
    let saldo = Number(historyRow?.qty) || 0;
    return moves.map((m) => {
      const after = saldo;
      saldo -= Number(m.qty_change) || 0;
      return { ...m, saldo_after: after };
    });
  }, [moves, historyRow]);

  const handleOpname = async () => {
    if (!opnameRow) return;
    setOpnameSaving(true);
    const res = await adjustConsignmentStock({
      vendorId: opnameRow.vendor_id,
      cabangId: opnameRow.cabang_id,
      partId: opnameRow.part_id,
      qtyAktual: Number(opnameQty),
      catatan: opnameNote,
    });
    setOpnameSaving(false);
    if (res.error) return toast.error(res.error);
    toast.success(res.delta ? `Stok disesuaikan (${res.delta > 0 ? "+" : ""}${res.delta}).` : "Qty aktual sama, tidak ada perubahan.");
    setOpnameRow(null);
    load();
  };

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
            <Warehouse className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">Stok Konsinyasi</h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Barang titipan vendor di gudang GMI (terpisah dari stok GMI) · stock opname per 3 bulan
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Vendor</Label>
            <div className="flex gap-2">
              <VendorPicker value={vendor} onChange={setVendor} placeholder="Semua vendor" className="h-9 text-xs" />
              {vendor && (
                <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => setVendor(null)}>
                  Reset
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Gudang</Label>
            <Select value={cabangId} onValueChange={setCabangId}>
              <SelectTrigger className="h-9 text-xs font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua gudang</SelectItem>
                {cabangs.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Cari</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Part number / nama part / vendor..."
                className="h-9 bg-muted/40 pl-9 text-xs"
              />
            </div>
          </div>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="mb-2 text-xs text-muted-foreground">
          {filtered.length} baris · total qty <span className="font-bold text-foreground">{totalQty}</span>
        </div>
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Vendor</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Gudang</TableHead>
                <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Update Terakhir</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Tidak ada stok konsinyasi
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <code className="block text-xs font-bold">{r.barang?.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground">{r.barang?.part_name}</span>
                    </TableCell>
                    <TableCell className="text-xs">{r.vendors?.vendor_name}</TableCell>
                    <TableCell className="text-xs">{r.cabang?.nama_cabang}</TableCell>
                    <TableCell className={`text-right text-sm font-bold ${r.qty < 0 ? "text-destructive" : ""}`}>
                      {r.qty} <span className="text-[10px] font-medium text-muted-foreground">{r.barang?.part_satuan}</span>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateTime(r.updated_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Kartu stok" onClick={() => openHistory(r)}>
                          <History className="h-3.5 w-3.5" />
                        </Button>
                        {isModeratorOrAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Stock opname"
                            onClick={() => {
                              setOpnameRow(r);
                              setOpnameQty(String(r.qty));
                              setOpnameNote("");
                            }}
                          >
                            <ClipboardCheck className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Dialog open={!!historyRow} onOpenChange={(o) => !o && setHistoryRow(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Kartu Stok {historyRow?.barang?.part_number}
            </DialogTitle>
            <DialogDescription>
              {historyRow?.vendors?.vendor_name} · {historyRow?.cabang?.nama_cabang} · saldo {historyRow?.qty}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg overflow-auto max-h-[60vh]">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-9">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Waktu</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Jenis</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Dokumen</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Saldo</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Keterangan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movesLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : movesWithSaldo.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center text-xs text-muted-foreground">
                      Belum ada mutasi.
                    </TableCell>
                  </TableRow>
                ) : (
                  movesWithSaldo.map((m) => {
                    const meta = MOVE_LABEL[m.type] || { label: m.type, tone: "bg-muted text-foreground/80" };
                    return (
                      <TableRow key={m.id} className="h-10">
                        <TableCell className="text-[11px] whitespace-nowrap">{formatDateTime(m.created_at)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[9px] font-bold border-0 ${meta.tone}`}>
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[11px] font-mono">{m.reference_id || "-"}</TableCell>
                        <TableCell
                          className={`text-right text-xs font-bold ${m.qty_change < 0 ? "text-destructive" : "text-green-700"}`}
                        >
                          {m.qty_change > 0 ? "+" : ""}
                          {m.qty_change}
                        </TableCell>
                        <TableCell className="text-right text-xs">{m.saldo_after}</TableCell>
                        <TableCell className="text-[11px] text-muted-foreground max-w-64">{m.notes || "-"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!opnameRow} onOpenChange={(o) => !o && setOpnameRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Stock Opname Konsinyasi</DialogTitle>
            <DialogDescription>
              {opnameRow?.barang?.part_number} · {opnameRow?.vendors?.vendor_name} · {opnameRow?.cabang?.nama_cabang}.
              Qty sistem saat ini: {opnameRow?.qty}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Qty aktual (hasil hitung fisik)</Label>
              <Input type="number" min={0} value={opnameQty} onChange={(e) => setOpnameQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Catatan</Label>
              <Input
                value={opnameNote}
                onChange={(e) => setOpnameNote(e.target.value)}
                placeholder="mis. Opname Q4 2026, selisih rusak"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpnameRow(null)}>
              Batal
            </Button>
            <Button onClick={handleOpname} disabled={opnameSaving || opnameQty === ""}>
              {opnameSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
