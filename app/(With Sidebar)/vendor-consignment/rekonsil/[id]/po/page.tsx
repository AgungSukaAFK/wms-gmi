"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, ShoppingCart, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
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
import { DatePickerString } from "@/components/date-picker-string";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { formatDate, toYmdLocal } from "@/lib/utils";
import { canViewPOPrice } from "@/lib/po-price-access";
import { PPN_RATE_OPTIONS, computePoTotals } from "@/lib/po-tax";
import { PO_CURRENCY_OPTIONS, formatPoMoney, type PoCurrency } from "@/lib/po-currency";
import { getRekonsilPoPreview } from "@/services/vendor-consignment-actions";
import { createPurchaseOrder } from "@/services/procurement-actions";
import { useGoBack } from "@/hooks/use-go-back";

export default function RekonsilPoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const goBack = useGoBack("/vendor-consignment/rekonsil");
  const supabase = createClient();
  const rekonsilId = Number(params.id);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [canPrice, setCanPrice] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const [poKode, setPoKode] = useState("");
  const [poTanggal, setPoTanggal] = useState(toYmdLocal());
  const [paymentTerm, setPaymentTerm] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [currency, setCurrency] = useState<PoCurrency>("IDR");
  const [ppnRate, setPpnRate] = useState(11);
  const [hargaTermasukPajak, setHargaTermasukPajak] = useState(false);
  // Harga per part (satu harga untuk semua baris FIFO part yang sama).
  const [hargaByPart, setHargaByPart] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [isSignatureOpen, setIsSignatureOpen] = useState(false);

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return router.push("/auth/login");
      const { data: profile } = await supabase
        .from("profiles")
        .select("*, cabang(id, nama_cabang), user_roles(roles(name, label))")
        .eq("id", user.id)
        .single();
      setUserProfile(profile);
      setCanPrice(
        canViewPOPrice(
          profile
            ? {
                ...profile,
                user_roles: (profile.user_roles || []).map((ur: any) => ({
                  roles: Array.isArray(ur.roles) ? ur.roles[0] : ur.roles,
                })),
              }
            : null,
        ),
      );

      const res = await getRekonsilPoPreview(rekonsilId);
      if (res.error || !res.data) {
        setError(res.error || "Rekonsil tidak ditemukan.");
        setLoading(false);
        return;
      }
      setPreview(res.data);
      setKeterangan(
        `PO Rekonsil Konsinyasi ${res.data.rekonsil.rk_kode} (${res.data.rekonsil.cabang?.nama_cabang}, ${formatDate(
          res.data.rekonsil.periode_awal,
        )} - ${formatDate(res.data.rekonsil.periode_akhir)})`,
      );

      const { data: tpl } = await supabase
        .from("approval_templates")
        .select("*, steps:approval_template_steps(*, profiles(id, nama, email))")
        .eq("type", "Purchase Order")
        .or(`${profile?.cabang_id ? `cabang_id.eq.${profile.cabang_id},` : ""}cabang_id.is.null`)
        .order("name");
      setTemplates(tpl || []);
      if (tpl && tpl.length > 0) setSelectedTemplateId(tpl[0].id.toString());
      setLoading(false);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rekonsilId]);

  const lines: any[] = useMemo(() => preview?.lines || [], [preview]);
  const parts = useMemo(() => {
    const map = new Map<number, { part_id: number; part_number: string; part_name: string; satuan: string; qty: number }>();
    for (const l of lines) {
      const cur = map.get(l.part_id) || { part_id: l.part_id, part_number: l.part_number, part_name: l.part_name, satuan: l.satuan, qty: 0 };
      cur.qty += l.qty;
      map.set(l.part_id, cur);
    }
    return Array.from(map.values());
  }, [lines]);

  const subtotal = parts.reduce((a, p) => a + p.qty * (hargaByPart[p.part_id] || 0), 0);
  const totals = computePoTotals({
    taxMode: "document",
    subtotal,
    diskonMode: "percent",
    diskonValue: 0,
    hargaTermasukPajak,
    ppnMode: "percent",
    ppnRate,
    ppnAmountManual: 0,
    ongkir: 0,
    pphMode: "percent",
    pphRate: 0,
    pphAmountManual: 0,
  });

  const validate = () => {
    if (!canPrice) return "Hanya user dengan akses harga (purchasing) yang bisa membuat PO.";
    if (!poKode.trim()) return "Kode PO wajib diisi.";
    if (preview?.shortages?.length) return "Ada part yang qty-nya melebihi PR Konsinyasi yang sudah diterima.";
    if (lines.length === 0) return "Tidak ada item untuk PO.";
    const noPrice = parts.filter((p) => !(hargaByPart[p.part_id] > 0));
    if (noPrice.length > 0) return `Harga wajib diisi untuk: ${noPrice.map((p) => p.part_number).join(", ")}`;
    if (!selectedTemplateId) return "Pilih alur approval.";
    return null;
  };

  const handleConfirmSignature = async (signature: { id: string; image_url: string }) => {
    const template = templates.find((t) => t.id.toString() === selectedTemplateId);
    if (!template) return toast.error("Template approval tidak valid");
    const sortedSteps = [...(template.steps || [])].sort((a: any, b: any) => a.step_order - b.step_order);
    // Bentuk approvals sama dengan PO biasa (components/po/po-form.tsx).
    const approvalData = sortedSteps.map((step: any, idx: number) => {
      const isFirst = idx === 0;
      const isRequester = step.approver_type === "requester";
      const profile = isRequester ? userProfile : step.profiles;
      return {
        type: isRequester ? "Requester" : profile?.nama || "Approver",
        status: isFirst ? "approved" : "pending",
        userid: profile?.id || "",
        nama: profile?.nama || "Unknown",
        email: profile?.email || "",
        level: step.step_order,
        processed_at: isFirst ? new Date().toISOString() : null,
        signature_url: isFirst ? signature.image_url : null,
        notes: null,
        snapshot: isFirst
          ? { nama: userProfile.nama, email: userProfile.email, lokasi: userProfile.cabang?.nama_cabang }
          : null,
      };
    });

    setSubmitting(true);
    const res = await createPurchaseOrder({
      po_kode: poKode.trim(),
      cabang_id: userProfile.cabang_id,
      po_pic: userProfile.nama,
      po_pic_id: userProfile.id,
      po_tanggal: poTanggal,
      po_payment_term: paymentTerm || undefined,
      po_keterangan: keterangan || undefined,
      po_currency: currency,
      po_tax_mode: "document",
      po_harga_termasuk_pajak: hargaTermasukPajak,
      po_ppn_mode: "percent",
      po_ppn_rate: ppnRate,
      po_jenis: "konsinyasi",
      vendor_consignment_rekonsil_id: rekonsilId,
      approvals: approvalData,
      // Server menghitung ulang alokasi FIFO dari rekonsil; baris ini cuma
      // membawa harga per part.
      items: lines.map((l) => ({
        part_id: l.part_id,
        part_number: l.part_number,
        part_name: l.part_name,
        satuan: l.satuan,
        qty: l.qty,
        harga: hargaByPart[l.part_id] || 0,
        vendor_id: preview.rekonsil.vendor_id,
        mr_id: null,
        pr_item_id: l.pr_item_id,
        pr_id: l.pr_id,
      })),
    });
    setSubmitting(false);
    if (res.error) return toast.error(res.error);
    toast.success(`PO ${res.data?.po_kode} dibuat dari rekonsil.`);
    router.push(`/po/${res.data?.id}`);
  };

  if (loading) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Content>
        <div className="py-12 text-center space-y-3">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => router.push("/vendor-consignment/rekonsil")}>
            Kembali ke Rekonsil
          </Button>
        </div>
      </Content>
    );
  }

  const rk = preview.rekonsil;
  const selectedTemplate = templates.find((t) => t.id.toString() === selectedTemplateId);

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={goBack}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">PO Rekonsil Konsinyasi</h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              {rk.rk_kode} · {rk.vendors?.vendor_name} · {rk.cabang?.nama_cabang}
            </p>
          </div>
        </div>
      </Content>

      {!canPrice && (
        <Content>
          <p className="text-xs text-destructive font-medium">
            Hanya user dengan akses harga (role purchasing) yang bisa membuat PO.
          </p>
        </Content>
      )}

      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Kode PO</Label>
            <Input value={poKode} onChange={(e) => setPoKode(e.target.value)} className="h-10 text-sm font-semibold uppercase" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tanggal PO</Label>
            <DatePickerString value={poTanggal} onChange={setPoTanggal} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Payment Term</Label>
            <Input value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)} placeholder="mis. 30 hari" className="h-10 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Mata Uang</Label>
            <Select value={currency} onValueChange={(v) => setCurrency(v as PoCurrency)}>
              <SelectTrigger className="h-10 text-sm font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PO_CURRENCY_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Keterangan</Label>
            <Textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} className="min-h-14 resize-none text-xs" />
          </div>
        </div>
      </Content>

      <Content>
        {preview.shortages.length > 0 && (
          <p className="mb-3 text-xs text-destructive flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Qty rekonsil melebihi qty PR Konsinyasi yang sudah diterima (GR) & belum ter-PO:{" "}
            {preview.shortages.map((s: any) => `${s.part_number} kurang ${s.kurang}`).join(", ")}. Periksa GR /
            stock opname, atau buat PR Konsinyasi + GR untuk selisihnya.
          </p>
        )}
        <h3 className="font-semibold text-sm mb-2">Harga per Part</h3>
        <div className="border rounded-lg overflow-x-auto mb-5">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10">
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                <TableHead className="w-44 text-[10px] font-black uppercase text-muted-foreground">Harga Satuan</TableHead>
                <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parts.map((p) => (
                <TableRow key={p.part_id} className="h-12">
                  <TableCell>
                    <code className="block text-xs font-bold">{p.part_number}</code>
                    <span className="block text-[10px] text-muted-foreground">{p.part_name}</span>
                  </TableCell>
                  <TableCell className="text-right text-xs font-bold">
                    {p.qty} {p.satuan}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      value={hargaByPart[p.part_id] ?? ""}
                      onChange={(e) =>
                        setHargaByPart((prev) => ({ ...prev, [p.part_id]: Number(e.target.value) || 0 }))
                      }
                      className="h-8 text-xs text-right"
                    />
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {formatPoMoney(p.qty * (hargaByPart[p.part_id] || 0), currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <h3 className="font-semibold text-sm mb-2">Alokasi FIFO ke PR Konsinyasi</h3>
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="h-9">
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">PR</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Tgl PR</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l: any) => (
                <TableRow key={l.pr_item_id} className="h-10">
                  <TableCell className="text-xs font-bold">{l.pr_kode}</TableCell>
                  <TableCell className="text-xs">{formatDate(l.pr_tanggal)}</TableCell>
                  <TableCell className="text-xs">
                    <code className="font-bold">{l.part_number}</code>
                  </TableCell>
                  <TableCell className="text-right text-xs font-bold">{l.qty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Content>
        <div className="flex flex-col lg:flex-row justify-between gap-6">
          <div className="flex-1 space-y-4 max-w-full lg:max-w-125">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">PPN</Label>
                <Select value={String(ppnRate)} onValueChange={(v) => setPpnRate(Number(v))}>
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PPN_RATE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs mt-6">
                <Checkbox checked={hargaTermasukPajak} onCheckedChange={(v) => setHargaTermasukPajak(Boolean(v))} />
                Harga sudah termasuk pajak
              </label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">Alur Approval (Purchase Order)</Label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger className="h-10 text-sm font-semibold">
                  <SelectValue placeholder="Pilih template approval..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id.toString()}>
                      {t.name} ({t.steps?.length || 0} langkah)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...(selectedTemplate.steps || [])]
                    .sort((a: any, b: any) => a.step_order - b.step_order)
                    .map((s: any) => (
                      <Badge key={s.id} variant="outline" className="text-[10px]">
                        {s.step_order}. {s.approver_type === "requester" ? userProfile?.nama : s.profiles?.nama || "User"}
                      </Badge>
                    ))}
                </div>
              )}
            </div>
          </div>
          <div className="w-full lg:w-80 space-y-3">
            <div className="rounded-lg border p-4 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatPoMoney(totals.subtotal, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span>PPN</span>
                <span>{formatPoMoney(totals.ppnAmount, currency)}</span>
              </div>
              <div className="flex justify-between font-bold text-sm border-t pt-1.5">
                <span>Total PO</span>
                <span>{formatPoMoney(totals.totalPo, currency)}</span>
              </div>
            </div>
            <div className="bg-foreground p-5 rounded-lg flex flex-col items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-success" />
              <p className="text-[10px] text-background/60 text-center font-medium">
                Barang sudah diterima lewat GR Konsinyasi, jadi PO ini tidak perlu Receive Item.
              </p>
              <Button
                className="w-full h-10 bg-background text-foreground hover:bg-muted font-bold text-sm"
                disabled={submitting}
                onClick={() => {
                  const err = validate();
                  if (err) return toast.error(err);
                  setIsSignatureOpen(true);
                }}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "SIGN & SUBMIT"}
              </Button>
            </div>
          </div>
        </div>
      </Content>

      <MRSignatureDialog open={isSignatureOpen} onOpenChange={setIsSignatureOpen} onConfirm={handleConfirmSignature} />
    </>
  );
}
