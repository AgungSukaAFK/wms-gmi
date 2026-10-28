"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ChevronLeft, PackageCheck, Loader2, Calendar as CalendarIcon, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import {
  createConsignmentGr,
  getConsignmentPrOptionsForGr,
} from "@/services/vendor-consignment-actions";

interface GrLine {
  pr_item_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty_pr: number;
  sisa: number;
  qty_kirim: number;
  qty_terima: number;
  komplain: boolean;
  catatan_komplain: string;
}

function CreateConsignmentGrForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prOptions, setPrOptions] = useState<any[]>([]);
  const [prId, setPrId] = useState<string>(searchParams.get("pr") || "");
  const [grTanggal, setGrTanggal] = useState(toYmdLocal());
  const [noSj, setNoSj] = useState("");
  const [catatan, setCatatan] = useState("");
  const [lines, setLines] = useState<GrLine[]>([]);

  useEffect(() => {
    getConsignmentPrOptionsForGr().then((res) => {
      if (res.error) toast.error(res.error);
      setPrOptions(res.data || []);
      setLoading(false);
    });
  }, []);

  const selectedPr = prOptions.find((p) => String(p.id) === prId);

  useEffect(() => {
    if (!selectedPr) {
      setLines([]);
      return;
    }
    setLines(
      (selectedPr.pr_items || [])
        .filter((i: any) => i.sisa_gr > 0)
        .map((i: any) => ({
          pr_item_id: i.id,
          part_number: i.part_number,
          part_name: i.part_name,
          satuan: i.satuan,
          qty_pr: Number(i.qty) || 0,
          sisa: i.sisa_gr,
          qty_kirim: i.sisa_gr,
          qty_terima: i.sisa_gr,
          komplain: false,
          catatan_komplain: "",
        })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prId, prOptions]);

  const update = (id: number, patch: Partial<GrLine>) =>
    setLines((prev) =>
      prev.map((l) => {
        if (l.pr_item_id !== id) return l;
        const next = { ...l, ...patch };
        next.qty_kirim = Math.max(0, next.qty_kirim || 0);
        next.qty_terima = Math.max(0, Math.min(next.qty_terima || 0, next.qty_kirim, next.sisa));
        if (next.qty_terima < next.qty_kirim) next.komplain = true;
        return next;
      }),
    );

  const handleSubmit = async () => {
    if (!selectedPr) return toast.error("Pilih PR Konsinyasi.");
    if (!noSj.trim()) return toast.error("No. surat jalan supplier wajib diisi.");
    const active = lines.filter((l) => l.qty_kirim > 0);
    if (active.length === 0) return toast.error("Isi qty kirim minimal satu item.");
    const noNote = active.find((l) => l.komplain && !l.catatan_komplain.trim());
    if (noNote) return toast.error(`Isi catatan komplain untuk ${noNote.part_number}.`);

    setSaving(true);
    const res = await createConsignmentGr({
      gr_tanggal: grTanggal,
      pr_id: selectedPr.id,
      no_surat_jalan: noSj,
      catatan,
      items: active.map((l) => ({
        pr_item_id: l.pr_item_id,
        qty_kirim: l.qty_kirim,
        qty_terima: l.qty_terima,
        status: l.komplain ? "komplain" : "sesuai",
        catatan_komplain: l.catatan_komplain,
      })),
    });
    setSaving(false);
    if (res.error) return toast.error(res.error);
    toast.success(`GR ${res.data?.gr_kode} tersimpan, barang sesuai masuk stok konsinyasi.`);
    router.push("/vendor-consignment/gr");
  };

  if (loading) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalTerima = lines.reduce((a, l) => a + (l.qty_kirim > 0 ? l.qty_terima : 0), 0);
  const totalTolak = lines.reduce((a, l) => a + (l.qty_kirim > 0 ? l.qty_kirim - l.qty_terima : 0), 0);

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => router.back()}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">GR Konsinyasi</h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Warehouse menerima & cek barang titipan supplier sesuai PR
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5 xl:col-span-2">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">PR Konsinyasi</Label>
            <Select value={prId} onValueChange={setPrId}>
              <SelectTrigger className="h-10 text-sm font-bold">
                <SelectValue placeholder="Pilih PR Konsinyasi yang masih punya sisa..." />
              </SelectTrigger>
              <SelectContent>
                {prOptions.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.pr_kode} · {p.vendors?.vendor_name} · {p.cabang?.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {prOptions.length === 0 && (
              <p className="text-[10px] text-muted-foreground">
                Tidak ada PR Konsinyasi approved yang masih punya sisa barang belum diterima.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Tanggal Terima
            </Label>
            <DatePickerString value={grTanggal} onChange={setGrTanggal} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">No. Surat Jalan Supplier</Label>
            <Input
              value={noSj}
              onChange={(e) => setNoSj(e.target.value)}
              placeholder="Surat jalan distempel & ditandatangani"
              className="h-10 text-sm"
            />
          </div>
          {selectedPr && (
            <div className="md:col-span-2 xl:col-span-4 flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Vendor: {selectedPr.vendors?.vendor_name}</Badge>
              <Badge variant="outline">Gudang penerima: {selectedPr.cabang?.nama_cabang}</Badge>
            </div>
          )}
        </div>
      </Content>

      <Content>
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10 hover:bg-transparent">
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                <TableHead className="w-24 text-center text-[10px] font-black uppercase text-muted-foreground">Sisa PR</TableHead>
                <TableHead className="w-28 text-center text-[10px] font-black uppercase text-muted-foreground">Qty Kirim</TableHead>
                <TableHead className="w-28 text-center text-[10px] font-black uppercase text-muted-foreground">Qty Sesuai</TableHead>
                <TableHead className="w-24 text-center text-[10px] font-black uppercase text-muted-foreground">Komplain</TableHead>
                <TableHead className="min-w-56 text-[10px] font-black uppercase text-muted-foreground">Catatan Komplain / Retur</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow className="h-24 hover:bg-transparent">
                  <TableCell colSpan={6} className="text-center text-xs italic text-muted-foreground">
                    {selectedPr ? "Semua item PR ini sudah diterima." : "Pilih PR Konsinyasi dulu."}
                  </TableCell>
                </TableRow>
              ) : (
                lines.map((l) => (
                  <TableRow key={l.pr_item_id} className="h-14">
                    <TableCell>
                      <span className="font-semibold text-xs">{l.part_name}</span>
                      <code className="block text-[10px] text-muted-foreground">{l.part_number}</code>
                    </TableCell>
                    <TableCell className="text-center text-xs font-bold">
                      {l.sisa} {l.satuan}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={l.qty_kirim}
                        onChange={(e) => update(l.pr_item_id, { qty_kirim: parseInt(e.target.value) || 0 })}
                        className="h-8 w-20 mx-auto text-center text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        max={Math.min(l.qty_kirim, l.sisa)}
                        value={l.qty_terima}
                        disabled={l.qty_kirim <= 0}
                        onChange={(e) => update(l.pr_item_id, { qty_terima: parseInt(e.target.value) || 0 })}
                        className="h-8 w-20 mx-auto text-center text-xs"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={l.komplain}
                        disabled={l.qty_kirim <= 0 || l.qty_terima < l.qty_kirim}
                        onCheckedChange={(v) => update(l.pr_item_id, { komplain: Boolean(v) })}
                      />
                    </TableCell>
                    <TableCell>
                      {l.komplain ? (
                        <Input
                          value={l.catatan_komplain}
                          onChange={(e) => update(l.pr_item_id, { catatan_komplain: e.target.value })}
                          placeholder={
                            l.qty_terima < l.qty_kirim
                              ? `${l.qty_kirim - l.qty_terima} tidak sesuai: rusak / salah part / ...`
                              : "Keterangan komplain..."
                          }
                          className="h-8 text-xs"
                        />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
          Hanya qty sesuai yang masuk stok konsinyasi. Selisih qty kirim - qty sesuai dicatat sebagai
          komplain & retur ke supplier (revisi maks. 1x24 jam); kiriman pengganti diterima lewat GR baru.
        </p>
      </Content>

      <Content>
        <div className="flex flex-col md:flex-row gap-4 md:items-end justify-between">
          <div className="flex-1 space-y-1.5 max-w-xl">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Catatan</Label>
            <Textarea
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Opsional (lokasi rak khusus consignment, dll)"
              className="min-h-16 resize-none text-xs"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-xs">
              <div>
                Masuk stok: <span className="font-bold">{totalTerima}</span>
              </div>
              <div className="text-muted-foreground">
                Komplain/retur: <span className="font-bold">{totalTolak}</span>
              </div>
            </div>
            <Button className="h-10 px-6 font-bold" onClick={handleSubmit} disabled={saving || !selectedPr}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan GR"}
            </Button>
          </div>
        </div>
      </Content>
    </>
  );
}

export default function CreateConsignmentGrPage() {
  return (
    <Suspense
      fallback={
        <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CreateConsignmentGrForm />
    </Suspense>
  );
}
