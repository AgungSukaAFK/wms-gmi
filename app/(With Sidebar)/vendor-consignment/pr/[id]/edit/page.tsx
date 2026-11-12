"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useDebounce } from "use-debounce";
import {
  Briefcase,
  Building2,
  Calendar as CalendarIcon,
  ChevronLeft,
  Info,
  Loader2,
  Lock,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { createClient } from "@/lib/supabase/client";
import { orIlikePattern } from "@/lib/supabase/search-filter";
import { isConsignmentManager } from "@/lib/vendor-consignment-roles";
import { Content } from "@/components/content";
import { DatePickerString } from "@/components/date-picker-string";
import { StatusBadge } from "@/components/status-badge";
import { VendorPicker, type VendorOption } from "@/components/vendor-consignment/vendor-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { useGoBack } from "@/hooks/use-go-back";
import {
  getConsignmentPrDetail,
  updateConsignmentPr,
} from "@/services/vendor-consignment-actions";

type EditItem = {
  key: string;
  id?: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  qty_gr: number;
  qty_po: number;
  rejected: boolean;
};

const HEAD = "text-[10px] font-black uppercase text-muted-foreground";

export default function EditConsignmentPrPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const prId = Number(params.id);
  const goBack = useGoBack("/vendor-consignment/pr");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [pr, setPr] = useState<any | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cabangs, setCabangs] = useState<any[]>([]);

  const [prKode, setPrKode] = useState("");
  const [prTanggal, setPrTanggal] = useState("");
  const [cabangId, setCabangId] = useState<number | null>(null);
  const [vendor, setVendor] = useState<VendorOption | null>(null);
  const [items, setItems] = useState<EditItem[]>([]);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [results, setResults] = useState<any[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  const resetForm = (data: any) => {
    setPrKode(data.pr_kode || "");
    setPrTanggal(String(data.pr_tanggal || "").slice(0, 10));
    setCabangId(data.cabang_id ?? null);
    setVendor(data.vendors ? { ...data.vendors, id: data.pr_vendor_id } : null);
    setItems(
      (data.pr_items || []).map((i: any) => ({
        key: `old-${i.id}`,
        id: i.id,
        part_id: i.part_id,
        part_number: i.part_number,
        part_name: i.part_name,
        satuan: i.satuan,
        qty: Number(i.qty) || 0,
        qty_gr: Number(i.qty_gr) || 0,
        qty_po: Number(i.qty_po) || 0,
        rejected: !!i.rejected,
      })),
    );
  };

  const load = async () => {
    setLoading(true);
    const res = await getConsignmentPrDetail(prId);
    if (res.error || !res.data) {
      setLoadError(res.error || "PR Konsinyasi tidak ditemukan.");
    } else {
      setPr(res.data);
      resetForm(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }
      const [{ data: roleRows }, { data: cabangData }] = await Promise.all([
        supabase.from("user_roles").select("roles(name)").eq("user_id", user.id),
        supabase.from("cabang").select("id, nama_cabang").eq("is_active", true).order("nama_cabang"),
      ]);
      const roleNames = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
      setCanManage(isConsignmentManager(roleNames));
      setCabangs(cabangData || []);
    };
    init();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prId]);

  useEffect(() => {
    if (!searchOpen) return;
    const run = async () => {
      let q = supabase
        .from("barang")
        .select("id, part_number, part_name, part_satuan")
        .is("deleted_at", null)
        .order("part_name")
        .limit(15);
      if (debouncedSearch)
        q = q.or(
          `part_number.ilike.${orIlikePattern(debouncedSearch)},part_name.ilike.${orIlikePattern(debouncedSearch)}`,
        );
      const { data } = await q;
      setResults(data || []);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, searchOpen]);

  // Gudang & vendor terkunci begitu PR sudah punya GR / PO (stok konsinyasi
  // sudah tercatat per vendor+gudang).
  const locked = !!pr && (pr.gr_count > 0 || pr.has_po);
  const minQty = (i: EditItem) => Math.max(1, i.qty_gr, i.qty_po);
  const isUsed = (i: EditItem) => i.qty_gr > 0 || i.qty_po > 0;

  const addItem = (b: any) => {
    if (items.some((i) => i.part_id === b.id)) return;
    setItems((prev) => [
      ...prev,
      {
        key: `new-${b.id}`,
        part_id: b.id,
        part_number: b.part_number,
        part_name: b.part_name,
        satuan: b.part_satuan,
        qty: 1,
        qty_gr: 0,
        qty_po: 0,
        rejected: false,
      },
    ]);
    setSearchOpen(false);
    setSearch("");
  };

  const validate = () => {
    if (!prKode.trim()) return "Kode PR wajib diisi.";
    if (!prTanggal) return "Tanggal PR wajib diisi.";
    if (!cabangId) return "Pilih gudang penerima.";
    if (!vendor) return "Pilih vendor (supplier).";
    if (items.length === 0) return "Daftar item tidak boleh kosong.";
    const bad = items.find((i) => !(i.qty >= minQty(i)));
    if (bad) return `${bad.part_number}: qty minimal ${minQty(bad)}.`;
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) return toast.error(err);
    setSaving(true);
    const res = await updateConsignmentPr(prId, {
      pr_kode: prKode.trim(),
      pr_tanggal: prTanggal,
      cabang_id: cabangId!,
      vendor_id: vendor!.id,
      items: items.map((i) => ({ id: i.id, part_id: i.part_id, qty: i.qty })),
    });
    setSaving(false);
    if (res.error) return toast.error(res.error);
    toast.success(`PR ${prKode.trim()} berhasil diperbarui.`);
    router.push("/vendor-consignment/pr");
  };

  if (loading || canManage === null) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError || !canManage) {
    return (
      <Content>
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-bold text-foreground uppercase">
              {loadError ? "PR tidak ditemukan" : "Akses ditolak"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {loadError || "Hanya moderator, admin, atau PPIC yang dapat mengedit PR Konsinyasi."}
            </p>
          </div>
          <Link href="/vendor-consignment/pr">
            <Button variant="outline" className="gap-2">
              <ChevronLeft className="h-4 w-4" /> Kembali ke PR Konsinyasi
            </Button>
          </Link>
        </div>
      </Content>
    );
  }

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full shrink-0" onClick={goBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center text-primary-foreground shrink-0">
              <Pencil className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                  Edit PR Konsinyasi
                </h1>
                <StatusBadge status={pr.pr_status} tone="solid" />
              </div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 truncate">
                {pr.pr_kode} · dibuat oleh {pr.profiles?.nama || "-"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
              onClick={() => resetForm(pr)}
              disabled={saving}
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
            <Button size="sm" className="gap-2 font-semibold" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Simpan Perubahan
            </Button>
          </div>
        </div>
      </Content>

      {locked && (
        <Content>
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-[11px] font-medium text-warning">
            <Info className="h-4 w-4 shrink-0 mt-px" />
            <p>
              PR ini sudah punya {pr.gr_count > 0 ? `${pr.gr_count} GR Konsinyasi` : ""}
              {pr.gr_count > 0 && pr.has_po ? " dan " : ""}
              {pr.has_po ? "PO Rekonsil" : ""}. Gudang & vendor dikunci, qty item tidak bisa di
              bawah yang sudah diterima / ter-PO, dan item yang sudah dipakai tidak bisa dihapus.
            </p>
          </div>
        </Content>
      )}

      <Content title="Informasi PR">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Kode PR</Label>
            <Input
              value={prKode}
              onChange={(e) => setPrKode(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Tanggal
            </Label>
            <DatePickerString value={prTanggal} onChange={setPrTanggal} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Building2 className="h-3 w-3" /> Gudang Penerima
              {locked && <Lock className="h-3 w-3" />}
            </Label>
            <Select
              value={cabangId?.toString()}
              onValueChange={(v) => setCabangId(parseInt(v))}
              disabled={locked}
            >
              <SelectTrigger className="h-10 text-sm font-bold">
                <SelectValue placeholder="Pilih gudang..." />
              </SelectTrigger>
              <SelectContent>
                {cabangs.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Briefcase className="h-3 w-3" /> Vendor (Supplier)
              {locked && <Lock className="h-3 w-3" />}
            </Label>
            <VendorPicker value={vendor} onChange={setVendor} disabled={locked} />
          </div>
        </div>
      </Content>

      <Content>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Daftar Item</h3>
            <Badge variant="outline" className="text-[10px]">
              {items.length}
            </Badge>
          </div>
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <Plus className="h-3.5 w-3.5" /> Tambah Item
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[calc(100vw-2rem)] max-w-100 p-0" align="end">
              <div className="p-2 border-b bg-muted/40">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Cari barang..."
                    className="pl-8 h-8 text-xs"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-75 overflow-y-auto p-1">
                {results.length > 0 ? (
                  results.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => addItem(r)}
                      disabled={items.some((i) => i.part_id === r.id)}
                      className="w-full text-left p-2 hover:bg-muted rounded-md disabled:opacity-50"
                    >
                      <code className="text-xs font-bold">{r.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground truncate">{r.part_name}</span>
                    </button>
                  ))
                ) : (
                  <div className="p-6 text-center text-xs text-muted-foreground italic">
                    Barang tidak ditemukan.
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10 hover:bg-transparent">
                <TableHead className={HEAD}>Part</TableHead>
                <TableHead className={`w-20 text-center ${HEAD}`}>Unit</TableHead>
                <TableHead className={`w-32 text-center ${HEAD}`}>Qty PR</TableHead>
                <TableHead className={`w-24 text-right ${HEAD}`}>Diterima</TableHead>
                <TableHead className={`w-24 text-right ${HEAD}`}>Ter-PO</TableHead>
                <TableHead className="w-14" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length > 0 ? (
                items.map((item) => {
                  const used = isUsed(item);
                  return (
                    <TableRow key={item.key} className="h-12">
                      <TableCell>
                        <span className="font-semibold text-xs">{item.part_name}</span>
                        <code className="block text-[10px] text-muted-foreground">{item.part_number}</code>
                        <div className="flex gap-1 mt-1">
                          {!item.id && (
                            <Badge variant="outline" className="text-[9px] border-primary/40 text-primary">
                              Baru
                            </Badge>
                          )}
                          {item.rejected && (
                            <Badge variant="destructive" className="text-[9px]">
                              Ditolak
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-[10px] font-medium text-muted-foreground uppercase">
                        {item.satuan}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={minQty(item)}
                          value={item.qty}
                          onChange={(e) => {
                            const qty = Math.max(0, parseInt(e.target.value) || 0);
                            setItems((prev) => prev.map((i) => (i.key === item.key ? { ...i, qty } : i)));
                          }}
                          className={`h-8 w-24 mx-auto text-center text-xs ${
                            item.qty < minQty(item) ? "border-destructive text-destructive" : ""
                          }`}
                        />
                        {used && (
                          <p className="text-[9px] text-muted-foreground text-center mt-0.5">
                            min. {minQty(item)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">{item.qty_gr}</TableCell>
                      <TableCell className="text-right text-xs">{item.qty_po}</TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          disabled={used}
                          title={used ? "Sudah ada GR / PO, tidak bisa dihapus" : "Hapus item"}
                          onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow className="h-24 hover:bg-transparent">
                  <TableCell colSpan={6} className="text-center text-xs italic text-muted-foreground">
                    Belum ada item.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          Jalur & status approval tidak diubah di halaman ini. Riwayat perubahan tercatat di halaman{" "}
          <Link href={`/pr/${prId}`} className="text-primary hover:underline">
            detail PR
          </Link>
          .
        </p>
      </Content>
    </>
  );
}
