"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import {
  Plus,
  Search,
  Loader2,
  Scale,
  Eye,
  Trash2,
  Printer,
  CheckCircle2,
  Undo2,
  ShoppingCart,
  Receipt,
} from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DatePickerString } from "@/components/date-picker-string";
import { formatDate, toYmdLocal } from "@/lib/utils";
import {
  deleteRekonsil,
  finalizeRekonsil,
  getRekonsilDetail,
  getRekonsilList,
  reopenRekonsil,
  updateRekonsilBilling,
} from "@/services/vendor-consignment-actions";

// Feedback rekonsil maksimal H+3 dari tanggal rekonsil (flowchart).
function feedbackDeadline(rkTanggal: string) {
  const d = new Date(`${rkTanggal}T00:00:00`);
  d.setDate(d.getDate() + 3);
  return toYmdLocal(d);
}

function statusOf(rk: any): { label: string; tone: string } {
  if (rk.payment_status === "paid") return { label: "Lunas", tone: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800" };
  if (rk.invoice_no) return { label: "Invoice", tone: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-800" };
  if (rk.po_id) return { label: "PO dibuat", tone: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800" };
  if (rk.status === "final") return { label: "BAST Final", tone: "bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-900/40 dark:text-cyan-300 dark:border-cyan-800" };
  return { label: "Draft", tone: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800" };
}

export default function RekonsilPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 300);

  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "finalize" | "reopen" | "delete"; rk: any } | null>(null);
  const [busy, setBusy] = useState(false);

  const [billingRk, setBillingRk] = useState<any | null>(null);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceTanggal, setInvoiceTanggal] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"unpaid" | "paid">("unpaid");
  const [paidAt, setPaidAt] = useState("");

  const isMod = roles.some((r) => r === "moderator" || r === "admin");
  const canPo = roles.includes("purchasing");
  const canBilling = roles.some((r) => ["purchasing", "finance", "moderator", "admin"].includes(r));
  const canReopen = roles.some((r) => ["purchasing", "moderator", "admin"].includes(r));

  const load = async () => {
    setLoading(true);
    const res = await getRekonsilList();
    if (res.error) toast.error(res.error);
    setRows(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data: roleRows } = await supabase.from("user_roles").select("roles(name)").eq("user_id", user.id);
      setRoles((roleRows || []).map((r: any) => r.roles?.name).filter(Boolean));
    };
    init();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = rows.filter((rk) => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    return (
      rk.rk_kode?.toLowerCase().includes(q) ||
      rk.vendors?.vendor_name?.toLowerCase().includes(q) ||
      rk.cabang?.nama_cabang?.toLowerCase().includes(q) ||
      rk.pos?.po_kode?.toLowerCase().includes(q) ||
      rk.invoice_no?.toLowerCase().includes(q)
    );
  });

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setDetail({ id });
    const res = await getRekonsilDetail(id);
    setDetailLoading(false);
    if (res.error) {
      setDetail(null);
      return toast.error(res.error);
    }
    setDetail(res.data);
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    const fn =
      confirm.kind === "finalize" ? finalizeRekonsil : confirm.kind === "reopen" ? reopenRekonsil : deleteRekonsil;
    const res = await fn(confirm.rk.id);
    setBusy(false);
    if (res.error) return toast.error(res.error);
    toast.success(
      confirm.kind === "finalize"
        ? "Rekonsil final, siap dibuatkan PO oleh purchasing."
        : confirm.kind === "reopen"
          ? "Rekonsil dikembalikan ke draft."
          : "Rekonsil dihapus.",
    );
    setConfirm(null);
    load();
  };

  const openBilling = (rk: any) => {
    setBillingRk(rk);
    setInvoiceNo(rk.invoice_no || "");
    setInvoiceTanggal(rk.invoice_tanggal || "");
    setPaymentStatus(rk.payment_status || "unpaid");
    setPaidAt(rk.paid_at || toYmdLocal());
  };

  const saveBilling = async () => {
    if (!billingRk) return;
    setBusy(true);
    const res = await updateRekonsilBilling(billingRk.id, {
      invoice_no: invoiceNo,
      invoice_tanggal: invoiceTanggal || null,
      payment_status: paymentStatus,
      paid_at: paymentStatus === "paid" ? paidAt : null,
    });
    setBusy(false);
    if (res.error) return toast.error(res.error);
    toast.success("Tagihan diperbarui.");
    setBillingRk(null);
    load();
  };

  const today = toYmdLocal();

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">Rekonsil & BAST Konsinyasi</h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Rekonsil site per 2 minggu → BAST → PO Rekonsil (FIFO PR) → invoice → payment
              </p>
            </div>
          </div>
          <Link href="/vendor-consignment/rekonsil/create">
            <Button className="h-9 gap-2 text-xs font-bold uppercase">
              <Plus className="h-4 w-4" /> Buat Rekonsil
            </Button>
          </Link>
        </div>
      </Content>

      <Content>
        <div className="relative min-w-0 flex-1 xl:max-w-100">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari kode rekonsil, vendor, site, PO, invoice..."
            className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium"
          />
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Kode</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Site / Vendor</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Periode</TableHead>
                <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Status</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">PO / Invoice</TableHead>
                <TableHead className="w-56" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Belum ada rekonsil
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((rk) => {
                  const st = statusOf(rk);
                  const qty = (rk.vendor_consignment_rekonsil_items || []).reduce((a: number, i: any) => a + i.qty, 0);
                  const deadline = feedbackDeadline(rk.rk_tanggal);
                  const canDelete = !rk.po_id && (isMod || (rk.status === "draft" && rk.created_by === userId));
                  return (
                    <TableRow key={rk.id}>
                      <TableCell className="text-xs">
                        <span className="font-bold">{rk.rk_kode}</span>
                        <span className="block text-[10px] text-muted-foreground">{formatDate(rk.rk_tanggal)}</span>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-semibold">{rk.cabang?.nama_cabang}</span>
                        <span className="block text-[10px] text-muted-foreground">{rk.vendors?.vendor_name}</span>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDate(rk.periode_awal)} – {formatDate(rk.periode_akhir)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold">{qty}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] font-bold ${st.tone}`}>
                          {st.label}
                        </Badge>
                        {rk.status === "draft" && (
                          <span
                            className={`block mt-1 text-[10px] ${deadline < today ? "text-destructive font-bold" : "text-muted-foreground"}`}
                          >
                            Feedback s.d. {formatDate(deadline)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {rk.pos ? (
                          <Link href={`/po/${rk.po_id}`} className="font-semibold hover:underline">
                            {rk.pos.po_kode}
                          </Link>
                        ) : (
                          "-"
                        )}
                        {rk.invoice_no && (
                          <span className="block text-[10px] text-muted-foreground">Inv {rk.invoice_no}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end flex-wrap">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Detail" onClick={() => openDetail(rk.id)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Link href={`/vendor-consignment/rekonsil/${rk.id}/print`} target="_blank" title="Cetak BAST">
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                          {rk.status === "draft" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 text-[10px] font-bold"
                              onClick={() => setConfirm({ kind: "finalize", rk })}
                            >
                              <CheckCircle2 className="h-3 w-3" /> BAST Final
                            </Button>
                          )}
                          {rk.status === "final" && !rk.po_id && canPo && (
                            <Link href={`/vendor-consignment/rekonsil/${rk.id}/po`}>
                              <Button size="sm" className="h-7 gap-1 text-[10px] font-bold">
                                <ShoppingCart className="h-3 w-3" /> Buat PO
                              </Button>
                            </Link>
                          )}
                          {rk.status === "final" && !rk.po_id && canReopen && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Kembalikan ke draft"
                              onClick={() => setConfirm({ kind: "reopen", rk })}
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {rk.po_id && canBilling && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 text-[10px] font-bold"
                              onClick={() => openBilling(rk)}
                            >
                              <Receipt className="h-3 w-3" /> Tagihan
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setConfirm({ kind: "delete", rk })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.rk_kode || "Rekonsil"}</DialogTitle>
            <DialogDescription>
              {detail?.cabang?.nama_cabang} · {detail?.vendors?.vendor_name}
              {detail?.periode_awal
                ? ` · ${formatDate(detail.periode_awal)} – ${formatDate(detail.periode_akhir)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="border rounded-lg overflow-auto max-h-[60vh]">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="h-9">
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Tgl SPB</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">No. SPB</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detail?.vendor_consignment_rekonsil_items || []).map((i: any) => (
                    <TableRow key={i.id} className="h-10">
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(i.spb_tanggal)}</TableCell>
                      <TableCell className="text-xs font-bold">{i.spb_no}</TableCell>
                      <TableCell>
                        <code className="text-xs font-bold">{i.part_number}</code>
                        <span className="ml-2 text-[10px] text-muted-foreground">{i.part_name}</span>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold">
                        {i.qty} {i.satuan}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!billingRk} onOpenChange={(o) => !o && setBillingRk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tagihan {billingRk?.rk_kode}</DialogTitle>
            <DialogDescription>
              PO {billingRk?.pos?.po_kode} · {billingRk?.vendors?.vendor_name}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className="text-xs">No. Invoice Vendor</Label>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            </div>
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className="text-xs">Tgl Invoice</Label>
              <DatePickerString value={invoiceTanggal} onChange={setInvoiceTanggal} />
            </div>
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className="text-xs">Status Payment</Label>
              <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as "unpaid" | "paid")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">Belum dibayar</SelectItem>
                  <SelectItem value="paid">Sudah dibayar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {paymentStatus === "paid" && (
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label className="text-xs">Tgl Bayar</Label>
                <DatePickerString value={paidAt} onChange={setPaidAt} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBillingRk(null)}>
              Batal
            </Button>
            <Button onClick={saveBilling} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "finalize"
                ? `Finalkan BAST ${confirm.rk.rk_kode}?`
                : confirm?.kind === "reopen"
                  ? `Kembalikan ${confirm?.rk.rk_kode} ke draft?`
                  : `Hapus rekonsil ${confirm?.rk.rk_kode}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "finalize"
                ? "Pastikan BAST sudah ditandatangani admin site, PJO, dan supplier. Setelah final, purchasing bisa membuat PO Rekonsil."
                : confirm?.kind === "reopen"
                  ? "Dipakai kalau ada feedback/koreksi. Rekonsil bisa dihapus & dibuat ulang selama belum ada PO."
                  : "Baris SPB-nya kembali bisa direkonsil ulang. Tindakan ini tidak bisa dibatalkan."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirm} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lanjutkan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
