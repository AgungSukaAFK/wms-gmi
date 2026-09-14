"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  ChevronLeft,
  ClipboardList,
  Search,
  Loader2,
  Package,
  ArrowRight,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import {
  createConsignmentIk,
  getConsignmentSoRemainingToShip,
  getStockByCabang,
} from "@/services/consignment-ik-actions";

interface ShipItemRow {
  id: number; // so_item_id
  part_id: number;
  part_number: string;
  part_name: string;
  part_number_customer: string | null;
  satuan: string;
  qty: number; // qty SO
  qty_shipped: number;
  qty_remaining: number;
  qty_kirim: number;
}

export default function CreateConsignmentIkPage() {
  const supabase = createClient();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [cabangs, setCabangs] = useState<{ id: number; nama_cabang: string }[]>([]);

  // Header
  const [ikKode, setIkKode] = useState("");
  const [ikTanggal, setIkTanggal] = useState(toYmdLocal());
  const [dariCabangId, setDariCabangId] = useState<string>("");
  const [keCabangId, setKeCabangId] = useState<string>("");
  const [noAwb, setNoAwb] = useState("");
  const [remarks, setRemarks] = useState("");

  // SO picker
  const [soSearch, setSoSearch] = useState("");
  const [debouncedSoSearch] = useDebounce(soSearch, 300);
  const [soPopoverOpen, setSoPopoverOpen] = useState(false);
  const [soResults, setSoResults] = useState<any[]>([]);
  const [selectedSo, setSelectedSo] = useState<any | null>(null);

  const [items, setItems] = useState<ShipItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [stockAsalMap, setStockAsalMap] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then(({ data }) => setCabangs(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!soPopoverOpen) return;
    const run = async () => {
      let q = supabase
        .from("consignment_so")
        .select("id, so_no, no_po, customer:customers!customer_id(customer_name)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (debouncedSoSearch)
        q = q.or(`so_no.ilike.%${debouncedSoSearch}%,no_po.ilike.%${debouncedSoSearch}%`);
      const { data } = await q;
      setSoResults(data || []);
    };
    run();
  }, [debouncedSoSearch, soPopoverOpen]);

  const selectSo = async (so: any) => {
    setSelectedSo(so);
    setSoPopoverOpen(false);
    setSoSearch("");
    setItemsLoading(true);
    const res = await getConsignmentSoRemainingToShip(so.id);
    if (res.error) {
      toast.error(res.error);
      setItems([]);
    } else {
      setItems(
        (res.data || []).map((i: any) => ({
          id: i.id,
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          part_number_customer: i.part_number_customer,
          satuan: i.satuan,
          qty: i.qty,
          qty_shipped: i.qty_shipped,
          qty_remaining: i.qty_remaining,
          qty_kirim: 0,
        })),
      );
    }
    setItemsLoading(false);
  };

  const partIdsKey = items.map((i) => i.part_id).join(",");

  useEffect(() => {
    if (!dariCabangId || items.length === 0) {
      setStockAsalMap(new Map());
      return;
    }
    let cancelled = false;
    getStockByCabang(
      Number(dariCabangId),
      items.map((i) => i.part_id),
    ).then((res) => {
      if (cancelled) return;
      const map = new Map<number, number>();
      for (const row of res.data || []) map.set(row.part_id, row.qty);
      setStockAsalMap(map);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dariCabangId, partIdsKey]);

  const updateQtyKirim = (soItemId: number, qty: number) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== soItemId) return i;
        const stokAsal = stockAsalMap.get(i.part_id) ?? 0;
        const maxQty = Math.min(i.qty_remaining, stokAsal);
        return { ...i, qty_kirim: Math.max(0, Math.min(qty, maxQty)) };
      }),
    );
  };

  const handleSubmit = async () => {
    if (!ikKode.trim()) return toast.error("Kode IK wajib diisi.");
    if (!selectedSo) return toast.error("Pilih SO Consignment terlebih dahulu.");
    if (!dariCabangId || !keCabangId)
      return toast.error("Gudang asal dan tujuan wajib dipilih.");
    if (dariCabangId === keCabangId)
      return toast.error("Gudang asal dan tujuan tidak boleh sama.");

    const toShip = items.filter((i) => i.qty_kirim > 0);
    if (toShip.length === 0)
      return toast.error("Isi qty kirim minimal untuk satu item.");

    const zeroStock = toShip.filter((i) => (stockAsalMap.get(i.part_id) ?? 0) <= 0);
    if (zeroStock.length > 0)
      return toast.error(
        `Stok gudang asal 0 untuk: ${zeroStock.map((i) => i.part_number).join(", ")}.`,
      );

    setLoading(true);
    try {
      const result = await createConsignmentIk({
        ik_kode: ikKode.trim(),
        ik_tanggal: ikTanggal,
        so_id: selectedSo.id,
        dari_cabang_id: Number(dariCabangId),
        ke_cabang_id: Number(keCabangId),
        no_awb: noAwb || undefined,
        no_po: selectedSo.no_po || undefined,
        remarks: remarks || undefined,
        items: toShip.map((i) => ({
          so_item_id: i.id,
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          part_number_customer: i.part_number_customer || undefined,
          satuan: i.satuan,
          qty: i.qty_kirim,
        })),
      });

      if (result.error) throw new Error(result.error);
      toast.success("Item Konsinyasi berhasil dibuat, stok sudah dipindahkan.");
      router.push("/so-reguler/consignment/ik");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => router.back()}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
              Buat Item Konsinyasi
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Pengiriman Fisik Barang Consignment — Memindahkan Stok
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">No. IK</Label>
            <Input
              placeholder="Input No. IK..."
              value={ikKode}
              onChange={(e) => setIkKode(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tgl IK</Label>
            <DatePickerString value={ikTanggal} onChange={setIkTanggal} className="h-10" />
          </div>
          <div className="space-y-1.5 xl:col-span-2">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">SO Consignment</Label>
            <Popover open={soPopoverOpen} onOpenChange={setSoPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 w-full justify-start font-bold text-sm">
                  {selectedSo
                    ? `${selectedSo.so_no} — ${selectedSo.customer?.customer_name || "-"}`
                    : "Pilih SO Consignment..."}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-100 p-0 overflow-hidden" align="start">
                <div className="p-2 border-b bg-muted/40">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Cari No. SO / No. PO..."
                      className="pl-8 h-9 text-xs"
                      value={soSearch}
                      onChange={(e) => setSoSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="max-h-62.5 overflow-y-auto p-1.5">
                  {soResults.map((so) => (
                    <button
                      key={so.id}
                      onClick={() => selectSo(so)}
                      className="w-full text-left p-3 rounded-lg flex items-center justify-between group mb-1 hover:bg-muted"
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-xs uppercase">{so.so_no}</span>
                        <span className="text-[9px] opacity-60">
                          {so.customer?.customer_name || "-"} {so.no_po ? `· PO: ${so.no_po}` : ""}
                        </span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                  {soResults.length === 0 && (
                    <div className="p-6 text-center text-xs text-muted-foreground italic">
                      {debouncedSoSearch ? "SO tidak ditemukan." : "Ketik untuk mencari SO..."}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Truck className="h-3 w-3" /> Gudang Asal
            </Label>
            <Select value={dariCabangId} onValueChange={setDariCabangId}>
              <SelectTrigger className="h-10 w-full text-sm font-semibold">
                <SelectValue placeholder="Pilih gudang asal..." />
              </SelectTrigger>
              <SelectContent>
                {cabangs.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Truck className="h-3 w-3" /> Gudang Tujuan
            </Label>
            <Select value={keCabangId} onValueChange={setKeCabangId}>
              <SelectTrigger className="h-10 w-full text-sm font-semibold">
                <SelectValue placeholder="Pilih gudang tujuan..." />
              </SelectTrigger>
              <SelectContent>
                {cabangs.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">No. AWB</Label>
            <Input
              placeholder="Input No. AWB..."
              value={noAwb}
              onChange={(e) => setNoAwb(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">No. PO (dari SO)</Label>
            <div className="h-10 flex items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-semibold text-muted-foreground">
              {selectedSo?.no_po || "-"}
            </div>
          </div>
        </div>
      </Content>

      <Content>
        <div className="flex items-center gap-2 mb-3">
          <Package className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Item yang Dikirim</h3>
        </div>
        {itemsLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-10 hover:bg-transparent">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">PN Internal / Desc</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">PN Cust</TableHead>
                  <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Qty SO</TableHead>
                  <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Sudah Dikirim</TableHead>
                  <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Sisa</TableHead>
                  <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Stok Gudang Asal</TableHead>
                  <TableHead className="w-32 text-center text-[10px] font-black uppercase text-muted-foreground">Qty Kirim</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length > 0 ? (
                  items.map((item) => {
                    const stokAsal = stockAsalMap.get(item.part_id) ?? 0;
                    const maxQty = Math.min(item.qty_remaining, stokAsal);
                    return (
                    <TableRow key={item.id} className="h-14">
                      <TableCell>
                        <code className="block text-sm font-bold">{item.part_number}</code>
                        <span className="block text-[10px] text-muted-foreground truncate max-w-50">
                          {item.part_name}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{item.part_number_customer || "-"}</TableCell>
                      <TableCell className="text-center text-xs font-semibold">
                        {item.qty} {item.satuan}
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">
                        {item.qty_shipped}
                      </TableCell>
                      <TableCell className="text-center text-xs font-bold">
                        {item.qty_remaining}
                      </TableCell>
                      <TableCell
                        className={`text-center text-xs font-bold ${
                          dariCabangId && stokAsal === 0 ? "text-destructive" : ""
                        }`}
                      >
                        {!dariCabangId ? "-" : stokAsal}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={maxQty}
                          value={item.qty_kirim}
                          disabled={!dariCabangId || maxQty === 0}
                          onChange={(e) =>
                            updateQtyKirim(item.id, parseInt(e.target.value) || 0)
                          }
                          className="h-8 w-24 mx-auto text-center text-xs"
                        />
                      </TableCell>
                    </TableRow>
                    );
                  })
                ) : (
                  <TableRow className="h-24 hover:bg-transparent">
                    <TableCell colSpan={7} className="text-center text-xs italic text-muted-foreground">
                      {selectedSo ? "SO ini tidak punya item." : "Pilih SO Consignment untuk melihat itemnya."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="space-y-1.5 mt-4">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground">Catatan (opsional)</Label>
          <Input
            placeholder="Catatan tambahan..."
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="h-10 text-sm"
          />
        </div>
      </Content>

      <Content>
        <div className="flex flex-col lg:flex-row justify-between gap-6 lg:items-center">
          <p className="text-[11px] text-muted-foreground font-medium max-w-125">
            IK memindahkan stok sungguhan: stok Gudang Asal langsung berkurang
            dan Gudang Tujuan bertambah begitu disimpan — tanpa approval.
            Pastikan data sudah benar sebelum submit.
          </p>
          <Button
            className="h-10 lg:w-70 font-bold text-sm uppercase"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buat Item Konsinyasi"}
          </Button>
        </div>
      </Content>
    </>
  );
}
