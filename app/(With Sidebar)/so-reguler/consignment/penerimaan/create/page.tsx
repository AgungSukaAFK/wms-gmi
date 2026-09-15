"use client";

import React, { useEffect, useState } from "react";
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
  PackageCheck,
  Search,
  Loader2,
  Package,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import {
  createConsignmentPenerimaan,
  getIkForPenerimaan,
  getIkPendingPenerimaan,
} from "@/services/consignment-penerimaan-actions";

interface PenerimaanItemRow {
  ik_item_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty_kirim: number;
  qty_terima: number;
  status: "sesuai" | "komplain";
  catatan_komplain: string;
}

export default function CreateConsignmentPenerimaanPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  // Header
  const [kode, setKode] = useState("");
  const [tanggalTerima, setTanggalTerima] = useState(toYmdLocal());
  const [namaPenerima, setNamaPenerima] = useState("");
  const [catatan, setCatatan] = useState("");

  // IK picker
  const [ikSearch, setIkSearch] = useState("");
  const [debouncedIkSearch] = useDebounce(ikSearch, 300);
  const [ikPopoverOpen, setIkPopoverOpen] = useState(false);
  const [ikOptions, setIkOptions] = useState<any[]>([]);
  const [selectedIk, setSelectedIk] = useState<any | null>(null);

  const [items, setItems] = useState<PenerimaanItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  useEffect(() => {
    if (!ikPopoverOpen) return;
    getIkPendingPenerimaan().then((res) => setIkOptions(res.data || []));
  }, [ikPopoverOpen]);

  const filteredIkOptions = ikOptions.filter((ik) => {
    const q = debouncedIkSearch.toLowerCase();
    if (!q) return true;
    return (
      ik.ik_kode?.toLowerCase().includes(q) ||
      ik.no_awb?.toLowerCase().includes(q) ||
      ik.so?.so_no?.toLowerCase().includes(q)
    );
  });

  const selectIk = async (ik: any) => {
    setIkPopoverOpen(false);
    setIkSearch("");
    setItemsLoading(true);
    const res = await getIkForPenerimaan(ik.id);
    if (res.error || !res.data) {
      toast.error(res.error || "Gagal memuat IK.");
      setSelectedIk(null);
      setItems([]);
    } else {
      setSelectedIk(ik);
      setItems(
        (res.data.consignment_ik_items || []).map((i: any) => ({
          ik_item_id: i.id,
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          satuan: i.satuan,
          qty_kirim: i.qty,
          qty_terima: i.qty,
          status: "sesuai" as const,
          catatan_komplain: "",
        })),
      );
    }
    setItemsLoading(false);
  };

  const updateItem = (ikItemId: number, patch: Partial<PenerimaanItemRow>) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.ik_item_id !== ikItemId) return i;
        const next = { ...i, ...patch };
        if ("qty_terima" in patch) {
          next.qty_terima = Math.max(0, Math.min(next.qty_terima, next.qty_kirim));
        }
        return next;
      }),
    );
  };

  const handleSubmit = async () => {
    if (!kode.trim()) return toast.error("No. Penerimaan wajib diisi.");
    if (!selectedIk) return toast.error("Pilih IK terlebih dahulu.");
    if (!namaPenerima.trim()) return toast.error("Nama penerima wajib diisi.");
    if (items.length === 0) return toast.error("IK ini tidak punya item.");

    const komplainTanpaCatatan = items.filter(
      (i) => i.status === "komplain" && !i.catatan_komplain.trim(),
    );
    if (komplainTanpaCatatan.length > 0)
      return toast.error(
        `Isi catatan komplain untuk: ${komplainTanpaCatatan.map((i) => i.part_number).join(", ")}.`,
      );

    setLoading(true);
    try {
      const result = await createConsignmentPenerimaan({
        penerimaan_kode: kode.trim(),
        tanggal_terima: tanggalTerima,
        ik_id: selectedIk.id,
        nama_penerima: namaPenerima.trim(),
        catatan: catatan || undefined,
        items: items.map((i) => ({
          ik_item_id: i.ik_item_id,
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          satuan: i.satuan,
          qty_kirim: i.qty_kirim,
          qty_terima: i.qty_terima,
          status: i.status,
          catatan_komplain: i.catatan_komplain || undefined,
        })),
      });

      if (result.error) throw new Error(result.error);
      toast.success("Penerimaan berhasil disimpan.");
      router.push("/so-reguler/consignment/penerimaan");
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
            <PackageCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
              Penerimaan Konsinyasi
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Konfirmasi Barang Diterima Customer
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">No. Penerimaan</Label>
            <Input
              placeholder="Input No. Penerimaan..."
              value={kode}
              onChange={(e) => setKode(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tgl Terima</Label>
            <DatePickerString value={tanggalTerima} onChange={setTanggalTerima} className="h-10" />
          </div>
          <div className="space-y-1.5 xl:col-span-2">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Item Konsinyasi (IK)</Label>
            <Popover open={ikPopoverOpen} onOpenChange={setIkPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 w-full justify-start font-bold text-sm">
                  {selectedIk
                    ? `${selectedIk.ik_kode} — ${selectedIk.so?.customer?.customer_name || "-"}`
                    : "Pilih IK yang sudah dikirim..."}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-100 p-0 overflow-hidden" align="start">
                <div className="p-2 border-b bg-muted/40">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Cari No. IK / No. AWB / No. SO..."
                      className="pl-8 h-9 text-xs"
                      value={ikSearch}
                      onChange={(e) => setIkSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="max-h-62.5 overflow-y-auto p-1.5">
                  {filteredIkOptions.map((ik) => (
                    <button
                      key={ik.id}
                      onClick={() => selectIk(ik)}
                      className="w-full text-left p-3 rounded-lg flex items-center justify-between group mb-1 hover:bg-muted"
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-xs uppercase">{ik.ik_kode}</span>
                        <span className="text-[9px] opacity-60">
                          {ik.so?.customer?.customer_name || "-"} · {ik.cabang_tujuan?.nama_cabang || "-"}
                          {ik.no_awb ? ` · AWB: ${ik.no_awb}` : ""}
                        </span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                  {filteredIkOptions.length === 0 && (
                    <div className="p-6 text-center text-xs text-muted-foreground italic">
                      Tidak ada IK yang menunggu konfirmasi penerimaan.
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Nama Penerima (Customer)</Label>
            <Input
              placeholder="Nama PIC customer yang menerima..."
              value={namaPenerima}
              onChange={(e) => setNamaPenerima(e.target.value)}
              className="h-10 text-sm font-semibold"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Catatan (opsional)</Label>
            <Input
              placeholder="Catatan tambahan..."
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              className="h-10 text-sm"
            />
          </div>
        </div>
      </Content>

      <Content>
        <div className="flex items-center gap-2 mb-3">
          <Package className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Item yang Dikonfirmasi</h3>
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
                  <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Qty Kirim</TableHead>
                  <TableHead className="w-32 text-center text-[10px] font-black uppercase text-muted-foreground">Qty Terima</TableHead>
                  <TableHead className="w-36 text-center text-[10px] font-black uppercase text-muted-foreground">Status</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Catatan Komplain</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length > 0 ? (
                  items.map((item) => (
                    <TableRow key={item.ik_item_id} className="h-14">
                      <TableCell>
                        <code className="block text-sm font-bold">{item.part_number}</code>
                        <span className="block text-[10px] text-muted-foreground truncate max-w-50">
                          {item.part_name}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-xs font-semibold">
                        {item.qty_kirim} {item.satuan}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={item.qty_kirim}
                          value={item.qty_terima}
                          onChange={(e) =>
                            updateItem(item.ik_item_id, {
                              qty_terima: parseInt(e.target.value) || 0,
                            })
                          }
                          className="h-8 w-24 mx-auto text-center text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={item.status}
                          onValueChange={(val: "sesuai" | "komplain") =>
                            updateItem(item.ik_item_id, { status: val })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sesuai">Sesuai</SelectItem>
                            <SelectItem value="komplain">Komplain</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          placeholder={
                            item.status === "komplain" ? "Wajib diisi..." : "-"
                          }
                          disabled={item.status !== "komplain"}
                          value={item.catatan_komplain}
                          onChange={(e) =>
                            updateItem(item.ik_item_id, {
                              catatan_komplain: e.target.value,
                            })
                          }
                          className="h-8 text-xs"
                        />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="h-24 hover:bg-transparent">
                    <TableCell colSpan={5} className="text-center text-xs italic text-muted-foreground">
                      {selectedIk ? "IK ini tidak punya item." : "Pilih IK untuk melihat itemnya."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Content>

      <Content>
        <div className="flex flex-col lg:flex-row justify-between gap-6 lg:items-center">
          <p className="text-[11px] text-muted-foreground font-medium max-w-125">
            Qty terima langsung dipindahkan ke stok gudang customer (dikurangi
            dari stok gudang tujuan IK). Selisih qty kirim - qty terima tetap
            jadi stok gudang tujuan, ditindaklanjuti manual.
          </p>
          <Button
            className="h-10 lg:w-70 font-bold text-sm uppercase"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Penerimaan"}
          </Button>
        </div>
      </Content>
    </>
  );
}
