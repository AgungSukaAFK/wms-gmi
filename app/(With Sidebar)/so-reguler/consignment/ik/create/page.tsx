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
  CalendarRange,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import {
  createConsignmentIk,
  getConsignmentSoRemainingToShip,
  getStockByCabang,
} from "@/services/consignment-ik-actions";
import { getCustomerSites } from "@/services/master-actions";
import { getIkPlanRows } from "@/services/consignment-ik-plan-actions";
import type { IkPlanRow } from "@/lib/consignment-plan";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGoBack } from "@/hooks/use-go-back";
import { orIlikePattern } from "@/lib/supabase/search-filter";

type CabangOption = { id: number; nama_cabang: string };
type SiteOption = { id: number; site_name: string };

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
  // Mode planning: baris planning yang direalisasikan + sisa plan-nya.
  plan_item_id?: number;
  plan_sisa?: number;
  plan_notes?: string | null;
}

type Mode = "plan" | "so";
// Grup eksekusi planning: 1 IK = 1 SO + 1 site.
const groupKey = (r: { so_id: number; site_id: number }) => `${r.so_id}:${r.site_id}`;

export default function CreateConsignmentIkPage() {
  const supabase = createClient();
  const router = useRouter();
  const goBack = useGoBack("/so-reguler/consignment/ik");

  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("plan");
  const [planRows, setPlanRows] = useState<IkPlanRow[]>([]);
  const [planRowsLoading, setPlanRowsLoading] = useState(true);
  const [planId, setPlanId] = useState<string>("");
  const [planGroup, setPlanGroup] = useState<string>("");
  const [cabangs, setCabangs] = useState<CabangOption[]>([]);
  // Site (gudang customer) aktif milik customer SO terpilih = tujuan IK.
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);

  // Header
  const [ikTanggal, setIkTanggal] = useState(toYmdLocal());
  const [dariCabangId, setDariCabangId] = useState<string>("");
  const [keSiteId, setKeSiteId] = useState<string>("");
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
    getIkPlanRows({ openOnly: true }).then((res) => {
      if (res.error) toast.error(res.error);
      const rows = res.data || [];
      setPlanRows(rows);
      setPlanRowsLoading(false);
      // ?plan=<id> dari halaman Planning IK -> langsung pilih planning-nya.
      const fromUrl = new URLSearchParams(window.location.search).get("plan");
      if (fromUrl && rows.some((r) => String(r.plan_id) === fromUrl)) setPlanId(fromUrl);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Daftar planning open yang masih punya sisa.
  const planOptions = [
    ...new Map(
      planRows.map((r) => [
        r.plan_id,
        { id: r.plan_id, kode: r.plan_kode, customer: r.customer_name, gudang: r.dari_cabang_name },
      ]),
    ).values(),
  ];
  const groupOptions = [
    ...new Map(
      planRows
        .filter((r) => String(r.plan_id) === planId)
        .map((r) => [
          groupKey(r),
          {
            key: groupKey(r),
            label: `${r.no_po || r.so_no} → ${r.site_name}`,
            count: planRows.filter((x) => String(x.plan_id) === planId && groupKey(x) === groupKey(r)).length,
          },
        ]),
    ).values(),
  ];

  const resetSelection = () => {
    setSelectedSo(null);
    setItems([]);
    setSites([]);
    setKeSiteId("");
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    setPlanId("");
    setPlanGroup("");
    resetSelection();
  };

  const selectPlan = (id: string) => {
    setPlanId(id);
    setPlanGroup("");
    resetSelection();
    const first = planRows.find((r) => String(r.plan_id) === id);
    if (first) setDariCabangId(String(first.dari_cabang_id));
  };

  const selectPlanGroup = async (key: string) => {
    setPlanGroup(key);
    const rows = planRows.filter((r) => String(r.plan_id) === planId && groupKey(r) === key);
    if (rows.length === 0) return;
    const head = rows[0];
    setSelectedSo({
      id: head.so_id,
      so_no: head.so_no,
      no_po: head.no_po,
      customer_id: head.customer_id,
      customer: { customer_name: head.customer_name },
    });
    // Site dikunci ke site di planning.
    setSites([{ id: head.site_id, site_name: head.site_name }]);
    setKeSiteId(String(head.site_id));
    setItemsLoading(true);
    const res = await getConsignmentSoRemainingToShip(head.so_id);
    if (res.error) {
      toast.error(res.error);
      setItems([]);
    } else {
      const soItemById = new Map((res.data || []).map((i: any) => [i.id, i]));
      setItems(
        rows.flatMap((r) => {
          const i: any = soItemById.get(r.so_item_id);
          if (!i) return [];
          return [
            {
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
              plan_item_id: r.plan_item_id,
              plan_sisa: r.sisa_plan,
              plan_notes: r.notes,
            },
          ];
        }),
      );
    }
    setItemsLoading(false);
  };

  useEffect(() => {
    if (!soPopoverOpen) return;
    const run = async () => {
      let q = supabase
        .from("consignment_so")
        .select(
          "id, so_no, no_po, customer_id, site_id, site, customer:customers!customer_id(customer_name)",
        )
        .order("so_tanggal_input", { ascending: false })
        .order("id", { ascending: false })
        .limit(20);
      if (debouncedSoSearch)
        q = q.or(`so_no.ilike.${orIlikePattern(debouncedSoSearch)},no_po.ilike.${orIlikePattern(debouncedSoSearch)}`);
      const { data } = await q;
      setSoResults(data || []);
    };
    run();
  }, [debouncedSoSearch, soPopoverOpen]);

  const loadSites = async (so: any) => {
    setSitesLoading(true);
    setKeSiteId("");
    const res = await getCustomerSites(so.customer_id, { activeOnly: true });
    const rows = (res.data as any[]).map((site) => ({ id: site.id, site_name: site.site_name }));
    setSites(rows);
    // Default ke site SO, kalau masih aktif
    if (rows.some((site) => site.id === so.site_id)) setKeSiteId(String(so.site_id));
    setSitesLoading(false);
  };

  const selectSo = async (so: any) => {
    setSelectedSo(so);
    setSoPopoverOpen(false);
    setSoSearch("");
    loadSites(so);
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

  const maxKirim = (i: ShipItemRow) =>
    Math.min(i.qty_remaining, stockAsalMap.get(i.part_id) ?? 0, i.plan_sisa ?? Infinity);

  const updateQtyKirim = (soItemId: number, qty: number) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== soItemId) return i;
        const maxQty = maxKirim(i);
        return { ...i, qty_kirim: Math.max(0, Math.min(qty, maxQty)) };
      }),
    );
  };

  const handleSubmit = async () => {
    if (mode === "plan" && (!planId || !planGroup))
      return toast.error("Pilih Planning IK dan No PO / site yang mau dikirim.");
    if (!selectedSo) return toast.error("Pilih SO Consignment terlebih dahulu.");
    if (!dariCabangId || !keSiteId)
      return toast.error("Gudang asal dan site tujuan wajib dipilih.");

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
        ik_tanggal: ikTanggal,
        so_id: selectedSo.id,
        dari_cabang_id: Number(dariCabangId),
        ke_site_id: Number(keSiteId),
        no_awb: noAwb || undefined,
        no_po: selectedSo.no_po || undefined,
        remarks: remarks || undefined,
        plan_id: mode === "plan" && planId ? Number(planId) : undefined,
        items: toShip.map((i) => ({
          so_item_id: i.id,
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          part_number_customer: i.part_number_customer || undefined,
          satuan: i.satuan,
          qty: i.qty_kirim,
          plan_item_id: mode === "plan" ? i.plan_item_id : undefined,
        })),
      });

      if (result.error) throw new Error(result.error);
      toast.success(
        `Item Konsinyasi ${result.data?.ik_kode || ""} berhasil dibuat, stok gudang asal sudah dipotong.`,
      );
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
            onClick={goBack}
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
              Pengiriman Fisik Barang Consignment ke Site Customer — Memotong Stok
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <Tabs value={mode} onValueChange={(v) => changeMode(v as Mode)}>
            <TabsList>
              <TabsTrigger value="plan" className="text-xs font-bold gap-1.5">
                <CalendarRange className="h-3.5 w-3.5" /> Dari Planning IK
              </TabsTrigger>
              <TabsTrigger value="so" className="text-xs font-bold">
                Langsung dari SO
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="text-[11px] text-muted-foreground">
            {mode === "plan"
              ? "Item & site mengikuti planning. Qty kirim maksimal sisa plan."
              : "Tanpa planning: pilih SO lalu isi qty kirim per item."}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">No. IK</Label>
            <div className="h-10 flex items-center rounded-md border border-dashed border-input bg-muted/40 px-3 text-sm font-semibold text-muted-foreground">
              Dibuat otomatis saat disimpan
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tgl IK</Label>
            <DatePickerString value={ikTanggal} onChange={setIkTanggal} className="h-10" />
          </div>
          {mode === "plan" ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Planning IK</Label>
                <Select value={planId} onValueChange={selectPlan} disabled={planRowsLoading}>
                  <SelectTrigger className="h-10 w-full text-sm font-semibold">
                    <SelectValue
                      placeholder={
                        planRowsLoading
                          ? "Memuat planning..."
                          : planOptions.length === 0
                            ? "Tidak ada planning yang masih berjalan"
                            : "Pilih planning..."
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {planOptions.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.kode} — {p.customer || "-"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">No. PO → Site</Label>
                <Select value={planGroup} onValueChange={selectPlanGroup} disabled={!planId}>
                  <SelectTrigger className="h-10 w-full text-sm font-semibold">
                    <SelectValue placeholder={planId ? "Pilih No. PO / site..." : "Pilih planning dulu..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {groupOptions.map((g) => (
                      <SelectItem key={g.key} value={g.key}>
                        {g.label} ({g.count} item)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
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
          )}
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
              <Truck className="h-3 w-3" /> Site Tujuan (Gudang Customer)
            </Label>
            <Select
              value={keSiteId}
              onValueChange={setKeSiteId}
              disabled={mode === "plan" || !selectedSo || sitesLoading || sites.length === 0}
            >
              <SelectTrigger className="h-10 w-full text-sm font-semibold">
                <SelectValue
                  placeholder={
                    !selectedSo
                      ? mode === "plan"
                        ? "Ikut planning..."
                        : "Pilih SO dulu..."
                      : sitesLoading
                        ? "Memuat site customer..."
                        : "Pilih site tujuan..."
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={String(site.id)}>
                    {site.site_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedSo && !sitesLoading && sites.length === 0 && (
              <p className="text-[10px] text-warning font-semibold">
                Customer ini belum punya site aktif. Tambahkan di Master
                Customer → Kelola Site.
              </p>
            )}
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
                  {mode === "plan" && (
                    <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Sisa Plan</TableHead>
                  )}
                  <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Stok Gudang Asal</TableHead>
                  <TableHead className="w-32 text-center text-[10px] font-black uppercase text-muted-foreground">Qty Kirim</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length > 0 ? (
                  items.map((item) => {
                    const stokAsal = stockAsalMap.get(item.part_id) ?? 0;
                    const maxQty = maxKirim(item);
                    return (
                    <TableRow key={item.id} className="h-14">
                      <TableCell>
                        <code className="block text-sm font-bold">{item.part_number}</code>
                        <span className="block text-[10px] text-muted-foreground truncate max-w-50">
                          {item.part_name}
                        </span>
                        {item.plan_notes && (
                          <span className="block text-[10px] text-primary truncate max-w-50">
                            Catatan plan: {item.plan_notes}
                          </span>
                        )}
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
                      {mode === "plan" && (
                        <TableCell className="text-center text-xs font-bold text-primary">
                          {item.plan_sisa ?? "-"}
                        </TableCell>
                      )}
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
                    <TableCell colSpan={8} className="text-center text-xs italic text-muted-foreground">
                      {selectedSo
                        ? "Tidak ada item yang bisa dikirim."
                        : mode === "plan"
                          ? "Pilih Planning IK dan No. PO / site untuk melihat itemnya."
                          : "Pilih SO Consignment untuk melihat itemnya."}
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
            IK memotong stok sungguhan: stok Gudang Asal langsung berkurang
            begitu disimpan — tanpa approval. Barang masuk stok customer saat
            Penerimaan dicatat. Pastikan data sudah benar sebelum submit.
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
