"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDebounce } from "use-debounce";
import { createClient } from "@/lib/supabase/client";
import { cn, formatDate, toYmdLocal } from "@/lib/utils";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DatePickerString } from "@/components/date-picker-string";
import { toast } from "@/lib/toast";
import { useGoBack } from "@/hooks/use-go-back";
import { orIlikePattern } from "@/lib/supabase/search-filter";
import { getCustomerSites } from "@/services/master-actions";
import {
  createIkPlan,
  getIkPlanCandidates,
  type IkPlanCandidate,
} from "@/services/consignment-ik-plan-actions";
import { daysToDue, isDefaultPlanCabang, isIkPlanner } from "@/lib/consignment-plan";
import { ArrowRight, CalendarRange, ChevronLeft, Loader2, Search, Truck, UsersRound } from "lucide-react";

type RowState = { checked: boolean; qty: number; siteId: string; notes: string };

const TH = "text-[10px] font-black uppercase text-muted-foreground whitespace-nowrap";
const NUM = "text-right text-xs tabular-nums";

export default function CreateIkPlanningPage() {
  const supabase = createClient();
  const router = useRouter();
  const goBack = useGoBack("/so-reguler/consignment/planning");

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const [planTanggal, setPlanTanggal] = useState(toYmdLocal());
  const [catatan, setCatatan] = useState("");
  const [cabangs, setCabangs] = useState<{ id: number; nama_cabang: string }[]>([]);
  const [cabangId, setCabangId] = useState("");

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedCustomerSearch] = useDebounce(customerSearch, 300);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);

  const [sites, setSites] = useState<{ id: number; site_name: string }[]>([]);
  const [candidates, setCandidates] = useState<IkPlanCandidate[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [rowState, setRowState] = useState<Map<number, RowState>>(new Map());
  const [filter, setFilter] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return setAllowed(false);
      const { data } = await supabase.from("user_roles").select("roles(name)").eq("user_id", user.id);
      setAllowed(isIkPlanner((data || []).map((r: any) => r.roles?.name).filter(Boolean)));
    });
    supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then(({ data }) => {
        const list = data || [];
        setCabangs(list);
        const def = list.find((c) => isDefaultPlanCabang(c.nama_cabang));
        if (def) setCabangId(String(def.id));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!customerOpen) return;
    let q = supabase
      .from("customers")
      .select("id, customer_no, customer_name")
      .eq("is_active", true)
      .in("customer_type", ["consignment", "both"])
      .order("customer_name")
      .limit(20);
    if (debouncedCustomerSearch)
      q = q.or(
        `customer_name.ilike.${orIlikePattern(debouncedCustomerSearch)},customer_no.ilike.${orIlikePattern(debouncedCustomerSearch)}`,
      );
    q.then(({ data }) => setCustomers(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedCustomerSearch, customerOpen]);

  // Customer / gudang berubah -> muat ulang item outstanding + site.
  useEffect(() => {
    setCandidates([]);
    setRowState(new Map());
    if (!customerId || !cabangId) return;
    let cancelled = false;
    setCandLoading(true);
    Promise.all([
      getIkPlanCandidates(customerId, Number(cabangId)),
      getCustomerSites(customerId, { activeOnly: true }),
    ]).then(([cand, siteRes]) => {
      if (cancelled) return;
      if (cand.error) toast.error(cand.error);
      setCandidates(cand.data);
      setSites((siteRes.data as any[]).map((s) => ({ id: s.id, site_name: s.site_name })));
      setCandLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, cabangId]);

  const defaultSite = (c: IkPlanCandidate) => {
    if (c.so_site_id && sites.some((s) => s.id === c.so_site_id)) return String(c.so_site_id);
    const byName = sites.find((s) => s.site_name === (c.so_site || "").toUpperCase());
    if (byName) return String(byName.id);
    return sites.length === 1 ? String(sites[0].id) : "";
  };

  const updateRow = (c: IkPlanCandidate, patch: Partial<RowState>) => {
    setRowState((prev) => {
      const next = new Map(prev);
      const cur = next.get(c.so_item_id) || {
        checked: false,
        qty: c.plannable,
        siteId: defaultSite(c),
        notes: "",
      };
      const merged = { ...cur, ...patch };
      merged.qty = Math.max(0, Math.min(Math.floor(merged.qty || 0), c.plannable));
      next.set(c.so_item_id, merged);
      return next;
    });
  };

  // Selisih SOH kumulatif per part (urutan tampil = due date terdekat dulu),
  // setelah dikurangi sisa plan aktif lain di gudang yang sama.
  const selisihByItem = useMemo(() => {
    const used = new Map<number, number>();
    const out = new Map<number, number>();
    for (const c of candidates) {
      const st = rowState.get(c.so_item_id);
      if (!st?.checked) continue;
      const cum = (used.get(c.part_id) || 0) + st.qty;
      used.set(c.part_id, cum);
      out.set(c.so_item_id, c.soh - c.soh_reserved - cum);
    }
    return out;
  }, [candidates, rowState]);

  const visible = candidates.filter((c) => {
    if (selectedOnly && !rowState.get(c.so_item_id)?.checked) return false;
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return [c.no_po, c.so_no, c.part_number, c.part_name, c.part_number_customer].some((v) =>
      v?.toLowerCase().includes(q),
    );
  });

  const selected = candidates.filter((c) => rowState.get(c.so_item_id)?.checked);
  const totalPlan = selected.reduce((s, c) => s + (rowState.get(c.so_item_id)?.qty || 0), 0);
  const allVisibleChecked =
    visible.filter((c) => c.plannable > 0).length > 0 &&
    visible.filter((c) => c.plannable > 0).every((c) => rowState.get(c.so_item_id)?.checked);

  const toggleAllVisible = (checked: boolean) => {
    for (const c of visible) if (c.plannable > 0) updateRow(c, { checked });
  };

  const handleSubmit = async () => {
    if (!customerId) return toast.error("Pilih customer dulu.");
    if (!cabangId) return toast.error("Pilih gudang asal.");
    if (selected.length === 0) return toast.error("Centang minimal satu item.");
    for (const c of selected) {
      const st = rowState.get(c.so_item_id)!;
      if (!st.qty) return toast.error(`${c.no_po || c.so_no} ${c.part_number}: plan qty masih 0.`);
      if (!st.siteId) return toast.error(`${c.no_po || c.so_no} ${c.part_number}: site tujuan belum dipilih.`);
    }
    setSaving(true);
    const res = await createIkPlan({
      plan_tanggal: planTanggal,
      customer_id: customerId,
      dari_cabang_id: Number(cabangId),
      catatan,
      items: selected.map((c) => {
        const st = rowState.get(c.so_item_id)!;
        return { so_item_id: c.so_item_id, site_id: Number(st.siteId), plan_qty: st.qty, notes: st.notes };
      }),
    });
    setSaving(false);
    if (res.error) return toast.error(res.error);
    toast.success(`Planning ${res.data?.plan_kode ?? ""} dibuat.`);
    router.push(`/so-reguler/consignment/planning?search=${encodeURIComponent(res.data?.plan_kode ?? "")}`);
  };

  const cabangName = cabangs.find((c) => String(c.id) === cabangId)?.nama_cabang || "gudang";

  if (allowed === false)
    return (
      <Content>
        <p className="text-sm text-muted-foreground">
          Hanya PPIC, marketing, admin, dan moderator yang bisa membuat Planning IK.
        </p>
      </Content>
    );

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={goBack}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <CalendarRange className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">Buat Planning IK</h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Rencana kirim per customer — belum memotong stok
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Kode Planning</Label>
            <div className="h-10 flex items-center rounded-md border border-dashed border-input bg-muted/40 px-3 text-sm font-semibold text-muted-foreground">
              Dibuat otomatis (PIK-xxxxx)
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tgl Planning</Label>
            <DatePickerString value={planTanggal} onChange={setPlanTanggal} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <UsersRound className="h-3 w-3" /> Customer
            </Label>
            <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 w-full justify-start font-bold text-sm truncate">
                  {customerName || "Pilih customer..."}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 overflow-hidden" align="start">
                <div className="p-2 border-b bg-muted/40">
                  <Input
                    placeholder="Cari customer..."
                    className="h-9 text-xs"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-62.5 overflow-y-auto p-1.5">
                  {customers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setCustomerId(c.id);
                        setCustomerName(c.customer_name);
                        setCustomerOpen(false);
                        setCustomerSearch("");
                      }}
                      className="w-full text-left p-3 rounded-lg flex items-center justify-between group mb-1 hover:bg-muted"
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-xs uppercase">{c.customer_name}</span>
                        <span className="text-[9px] opacity-60">{c.customer_no}</span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                  {customers.length === 0 && (
                    <div className="p-6 text-center text-xs text-muted-foreground italic">
                      {debouncedCustomerSearch ? "Customer tidak ditemukan." : "Ketik untuk mencari customer..."}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Truck className="h-3 w-3" /> Gudang Asal (SOH)
            </Label>
            <Select value={cabangId} onValueChange={setCabangId}>
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
        </div>
        <div className="space-y-1.5 mt-4">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground">Catatan (opsional)</Label>
          <Input
            placeholder="Catatan planning..."
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            className="h-10 text-sm"
          />
        </div>
      </Content>

      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter No. PO / SO / Part Number / PN Cust..."
              className="pl-8 h-9 text-xs"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold">
            <Switch checked={selectedOnly} onCheckedChange={setSelectedOnly} />
            Hanya yang dicentang ({selected.length})
          </label>
        </div>
        {customerId && !candLoading && sites.length === 0 && (
          <p className="mb-3 text-[11px] text-warning font-semibold">
            Customer ini belum punya site aktif. Tambahkan di Master Customer → Kelola Site.
          </p>
        )}

        <div className="border rounded-lg overflow-auto max-h-[65vh]">
          <Table className="min-w-[1750px]">
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10 hover:bg-transparent">
                <TableHead className="sticky top-0 z-10 bg-muted w-10">
                  <Checkbox
                    checked={allVisibleChecked}
                    onCheckedChange={(v) => toggleAllVisible(Boolean(v))}
                    disabled={visible.length === 0}
                  />
                </TableHead>
                {[
                  ["No. PO", ""],
                  ["Part Number", ""],
                  ["PN Cust", ""],
                  ["Qty PO", "text-right"],
                  ["Outstanding", "text-right"],
                  ["Sudah Diplan", "text-right"],
                  [`SOH ${cabangName}`, "text-right"],
                  ["Tgl PO", ""],
                  ["Due Date PO", ""],
                  ["Sisa Due", ""],
                  ["Plan Qty", "text-center"],
                  ["Site Tujuan", ""],
                  ["SOH − Plan", "text-right"],
                  ["Notes", ""],
                ].map(([label, cls]) => (
                  <TableHead key={label} className={cn(TH, cls, "sticky top-0 z-10 bg-muted")}>
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {candLoading ? (
                <TableRow>
                  <TableCell colSpan={15} className="h-32 text-center">
                    <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={15} className="h-24 text-center text-xs italic text-muted-foreground">
                    {!customerId
                      ? "Pilih customer untuk melihat item SO yang masih outstanding."
                      : candidates.length === 0
                        ? "Tidak ada item outstanding untuk customer ini."
                        : "Tidak ada item yang cocok dengan filter."}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((c) => {
                  const st = rowState.get(c.so_item_id);
                  const checked = Boolean(st?.checked);
                  const due = daysToDue(c.due_date);
                  const selisih = selisihByItem.get(c.so_item_id);
                  const full = c.plannable <= 0;
                  return (
                    <TableRow
                      key={c.so_item_id}
                      className={cn(checked && "bg-primary/5", full && "opacity-50")}
                    >
                      <TableCell>
                        <Checkbox
                          checked={checked}
                          disabled={full}
                          onCheckedChange={(v) => updateRow(c, { checked: Boolean(v) })}
                        />
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        <span className="font-semibold">{c.no_po || "-"}</span>
                        <span className="block text-[10px] text-muted-foreground">{c.so_no}</span>
                      </TableCell>
                      <TableCell className="text-xs">
                        <code className="font-bold">{c.part_number}</code>
                        <span className="block text-[10px] text-muted-foreground truncate max-w-52">
                          {c.part_name}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{c.part_number_customer || "-"}</TableCell>
                      <TableCell className={NUM}>{c.qty_po}</TableCell>
                      <TableCell className={cn(NUM, "font-semibold")}>{c.outstanding}</TableCell>
                      <TableCell className={cn(NUM, "text-muted-foreground")}>
                        {c.planned_open || "-"}
                      </TableCell>
                      <TableCell className={NUM}>
                        {c.soh}
                        {c.soh_reserved > 0 && (
                          <span className="block text-[9px] text-muted-foreground">
                            dijatah plan lain {c.soh_reserved}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {c.tgl_po ? formatDate(c.tgl_po) : "-"}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {c.due_date ? formatDate(c.due_date) : "-"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-xs font-bold whitespace-nowrap",
                          due !== null && due < 0 && "text-destructive",
                          due !== null && due >= 0 && due <= 7 && "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {due === null ? "-" : due < 0 ? `Lewat ${-due} hr` : `${due} hr`}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={c.plannable}
                          disabled={!checked}
                          value={checked ? st!.qty : ""}
                          placeholder={full ? "Penuh" : `maks ${c.plannable}`}
                          onChange={(e) => updateRow(c, { qty: parseInt(e.target.value) || 0 })}
                          className="h-8 w-24 mx-auto text-center text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={st?.siteId || ""}
                          disabled={!checked}
                          onValueChange={(v) => updateRow(c, { siteId: v })}
                        >
                          <SelectTrigger className="h-8 w-44 text-xs">
                            <SelectValue placeholder="Pilih site..." />
                          </SelectTrigger>
                          <SelectContent>
                            {sites.map((s) => (
                              <SelectItem key={s.id} value={String(s.id)}>
                                {s.site_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell
                        className={cn(NUM, "font-bold", selisih !== undefined && selisih < 0 && "text-destructive")}
                      >
                        {selisih ?? "-"}
                      </TableCell>
                      <TableCell>
                        <Input
                          disabled={!checked}
                          value={st?.notes || ""}
                          onChange={(e) => updateRow(c, { notes: e.target.value })}
                          placeholder="Notes..."
                          className="h-8 w-48 text-xs"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          &quot;Sudah Diplan&quot; = sisa plan di planning lain yang masih berjalan; plan qty maksimal
          outstanding dikurangi itu. &quot;SOH − Plan&quot; dihitung kumulatif per part (due date terdekat
          dijatah dulu), sudah dikurangi jatah planning lain di gudang yang sama. Minus = stok kurang.
        </p>
      </Content>

      <Content>
        <div className="flex flex-col lg:flex-row justify-between gap-6 lg:items-center">
          <p className="text-[11px] text-muted-foreground font-medium">
            {selected.length} item dicentang · total plan <b className="text-foreground">{totalPlan}</b> qty.
            Planning tidak memotong stok; stok baru terpotong saat warehouse membuat IK.
          </p>
          <Button
            className="h-10 lg:w-70 font-bold text-sm uppercase"
            onClick={handleSubmit}
            disabled={saving || allowed === null}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Planning IK"}
          </Button>
        </div>
      </Content>
    </>
  );
}
