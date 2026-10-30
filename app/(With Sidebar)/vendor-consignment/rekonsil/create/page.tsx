"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Scale, Loader2, Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { DatePickerString } from "@/components/date-picker-string";
import { formatDate, toYmdLocal } from "@/lib/utils";
import { VendorPicker, type VendorOption } from "@/components/vendor-consignment/vendor-picker";
import { createRekonsil, getRekonsilCandidates } from "@/services/vendor-consignment-actions";
import { useGoBack } from "@/hooks/use-go-back";

// Default periode rekonsil: 2 minggu terakhir s.d. hari ini.
function twoWeeksAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 13);
  return toYmdLocal(d);
}

export default function CreateRekonsilPage() {
  const supabase = createClient();
  const router = useRouter();
  const goBack = useGoBack("/vendor-consignment/rekonsil");
  const [cabangs, setCabangs] = useState<any[]>([]);
  const [cabangId, setCabangId] = useState<string>("");
  const [vendor, setVendor] = useState<VendorOption | null>(null);
  const [periodeAwal, setPeriodeAwal] = useState(twoWeeksAgo());
  const [periodeAkhir, setPeriodeAkhir] = useState(toYmdLocal());
  const [rkTanggal, setRkTanggal] = useState(toYmdLocal());
  const [picAdmin, setPicAdmin] = useState("");
  const [picPjo, setPicPjo] = useState("");
  const [catatan, setCatatan] = useState("");

  const [candidates, setCandidates] = useState<any[]>([]);
  const [skipped, setSkipped] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: profile } = user
        ? await supabase.from("profiles").select("nama, cabang_id").eq("id", user.id).single()
        : { data: null };
      if (profile?.cabang_id) setCabangId(String(profile.cabang_id));
      if (profile?.nama) setPicAdmin(profile.nama);
      const { data: cabangData } = await supabase
        .from("cabang")
        .select("id, nama_cabang")
        .eq("is_active", true)
        .order("nama_cabang");
      setCabangs(cabangData || []);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parameter berubah -> hasil tarikan lama tidak berlaku lagi.
  useEffect(() => {
    setLoaded(false);
    setCandidates([]);
    setSelected(new Set());
  }, [cabangId, vendor?.id, periodeAwal, periodeAkhir]);

  const loadCandidates = async () => {
    if (!cabangId || !vendor) return toast.error("Pilih site dan vendor dulu.");
    setLoading(true);
    const res = await getRekonsilCandidates({
      cabangId: Number(cabangId),
      vendorId: vendor.id,
      periodeAwal,
      periodeAkhir,
    });
    setLoading(false);
    if (res.error) return toast.error(res.error);
    setCandidates(res.data);
    setSkipped(res.skipped || []);
    setSelected(new Set(res.data.map((c: any) => c.spb_detail_id)));
    setLoaded(true);
  };

  const summary = useMemo(() => {
    const byPart = new Map<number, { part_number: string; part_name: string; satuan: string; qty: number }>();
    for (const c of candidates) {
      if (!selected.has(c.spb_detail_id)) continue;
      const cur = byPart.get(c.part_id) || { part_number: c.part_number, part_name: c.part_name, satuan: c.satuan, qty: 0 };
      cur.qty += c.qty;
      byPart.set(c.part_id, cur);
    }
    return Array.from(byPart.values()).sort((a, b) => a.part_number.localeCompare(b.part_number));
  }, [candidates, selected]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSave = async () => {
    if (selected.size === 0) return toast.error("Pilih minimal satu baris SPB.");
    setSaving(true);
    const res = await createRekonsil({
      rk_tanggal: rkTanggal,
      cabang_id: Number(cabangId),
      vendor_id: vendor!.id,
      periode_awal: periodeAwal,
      periode_akhir: periodeAkhir,
      pic_admin: picAdmin,
      pic_pjo: picPjo,
      catatan,
      spb_detail_ids: Array.from(selected),
    });
    setSaving(false);
    if (res.error) return toast.error(res.error);
    toast.success(`Rekonsil ${res.data?.rk_kode} dibuat (draft). Cetak BAST untuk ditandatangani.`);
    router.push("/vendor-consignment/rekonsil");
  };

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={goBack}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">Buat Rekonsil Site</h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Rekap pengeluaran barang konsinyasi (SPB Out) per periode · dasar BAST & PO ke vendor
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-end">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Site</Label>
            <Select value={cabangId} onValueChange={setCabangId}>
              <SelectTrigger className="h-10 text-sm font-bold">
                <SelectValue placeholder="Pilih site..." />
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
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Vendor</Label>
            <VendorPicker value={vendor} onChange={setVendor} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Periode Awal</Label>
            <DatePickerString value={periodeAwal} onChange={setPeriodeAwal} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Periode Akhir</Label>
            <DatePickerString value={periodeAkhir} onChange={setPeriodeAkhir} className="h-10" />
          </div>
          <Button className="h-10 gap-2 font-bold" onClick={loadCandidates} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Tarik Data SPB
          </Button>
        </div>
      </Content>

      {loaded && (
        <>
          <Content>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">
                SPB Out Konsinyasi belum direkonsil ({selected.size}/{candidates.length} dipilih)
              </h3>
            </div>
            {skipped.length > 0 && (
              <p className="mb-3 text-[11px] text-amber-700 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Dilewati: {skipped.map((s) => `${s.spb_no} ${s.part_number} (${s.alasan})`).join("; ")}
              </p>
            )}
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="h-10">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={candidates.length > 0 && selected.size === candidates.length}
                        onCheckedChange={(v) =>
                          setSelected(v ? new Set(candidates.map((c) => c.spb_detail_id)) : new Set())
                        }
                      />
                    </TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Tgl SPB</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">No. SPB</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Kode Unit</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-xs text-muted-foreground">
                        Tidak ada SPB Out Konsinyasi yang belum direkonsil di periode ini.
                      </TableCell>
                    </TableRow>
                  ) : (
                    candidates.map((c) => (
                      <TableRow key={c.spb_detail_id} className="h-11">
                        <TableCell>
                          <Checkbox checked={selected.has(c.spb_detail_id)} onCheckedChange={() => toggle(c.spb_detail_id)} />
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(c.spb_tanggal)}</TableCell>
                        <TableCell className="text-xs font-bold">{c.spb_no}</TableCell>
                        <TableCell className="text-xs">{c.kode_unit || "-"}</TableCell>
                        <TableCell>
                          <code className="block text-xs font-bold">{c.part_number}</code>
                          <span className="block text-[10px] text-muted-foreground">{c.part_name}</span>
                        </TableCell>
                        <TableCell className="text-right text-xs font-bold">
                          {c.qty} {c.satuan}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Content>

          <Content>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-sm mb-2">Rekap per Part</h3>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableBody>
                      {summary.length === 0 ? (
                        <TableRow>
                          <TableCell className="h-16 text-center text-xs text-muted-foreground">-</TableCell>
                        </TableRow>
                      ) : (
                        summary.map((s) => (
                          <TableRow key={s.part_number} className="h-10">
                            <TableCell>
                              <code className="text-xs font-bold">{s.part_number}</code>
                              <span className="ml-2 text-[10px] text-muted-foreground">{s.part_name}</span>
                            </TableCell>
                            <TableCell className="text-right text-xs font-bold">
                              {s.qty} {s.satuan}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tgl Rekonsil</Label>
                    <DatePickerString value={rkTanggal} onChange={setRkTanggal} className="h-10" />
                  </div>
                  <div />
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Admin Site</Label>
                    <Input value={picAdmin} onChange={(e) => setPicAdmin(e.target.value)} className="h-10 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">PJO</Label>
                    <Input value={picPjo} onChange={(e) => setPicPjo(e.target.value)} className="h-10 text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">Catatan</Label>
                  <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} className="min-h-16 resize-none text-xs" />
                </div>
                <div className="flex justify-end">
                  <Button className="h-10 px-6 font-bold" onClick={handleSave} disabled={saving || selected.size === 0}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Rekonsil (Draft)"}
                  </Button>
                </div>
              </div>
            </div>
          </Content>
        </>
      )}
    </>
  );
}
