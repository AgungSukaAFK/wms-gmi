"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowLeft,
  Factory,
  Search,
  Loader2,
  CheckCircle2,
  Building2,
  AlertCircle,
  Beaker,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { toYmdLocal } from "@/lib/utils";
import { getMrForWo, createWorkingOrder } from "@/services/working-order-actions";
import { getWoFormulaByTargetPart } from "@/services/wo-formula-actions";

interface DraftItem {
  mr_item_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty_request: number;
  wo_remaining: number;
  selected: boolean;
  qty: number;
  lead_time_days: string;
  deadline_date: string;
  formulaState: "idle" | "loading" | "missing" | "ready";
  formulaComponents: any[];
}

export default function CreateWorkingOrderPage() {
  return (
    <Suspense
      fallback={
        <div className="col-span-12 flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CreateWorkingOrderPageInner />
    </Suspense>
  );
}

function CreateWorkingOrderPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const presetMrId = searchParams.get("mr_id");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [cabangList, setCabangList] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);

  const [mr, setMr] = useState<any>(null);
  const [mrLocked, setMrLocked] = useState(false);
  const [mrSearch, setMrSearch] = useState("");
  const [debouncedMrSearch] = useDebounce(mrSearch, 300);
  const [mrResults, setMrResults] = useState<any[]>([]);
  const [mrPopoverOpen, setMrPopoverOpen] = useState(false);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);

  const [woKode, setWoKode] = useState("");
  const [woTanggal, setWoTanggal] = useState(toYmdLocal());
  const [gudangCabangId, setGudangCabangId] = useState<string>("");
  const [departemen, setDepartemen] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  useEffect(() => {
    void init();
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("*, cabang(id, nama_cabang)")
      .eq("id", user.id)
      .single();
    setUserProfile(profile);

    const { data: cabangData } = await supabase
      .from("cabang")
      .select("id, nama_cabang, cabang_type")
      .eq("is_active", true)
      .order("nama_cabang");
    setCabangList(cabangData || []);

    if (profile) {
      // profile.cabang_id bisa null (mis. akun moderator tanpa cabang) --
      // "cabang_id.eq.null" bukan sintaks PostgREST yang valid untuk null,
      // jadi filter cabang cuma ditambahkan kalau memang ada nilainya.
      let templateQuery = supabase
        .from("approval_templates")
        .select("id, name")
        .eq("type", "Working Order");
      templateQuery = profile.cabang_id
        ? templateQuery.or(`cabang_id.eq.${profile.cabang_id},cabang_id.is.null`)
        : templateQuery.is("cabang_id", null);
      const { data: templateData } = await templateQuery.order("name");
      setTemplates(templateData || []);
      if (templateData && templateData.length > 0) {
        setSelectedTemplateId(String(templateData[0].id));
      }
    }

    if (presetMrId) {
      setMrLocked(true);
      await loadMr(Number(presetMrId));
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!mrPopoverOpen) return;
    const run = async () => {
      let q = supabase
        .from("mrs")
        .select("id, mr_kode, mr_tanggal, mr_pic, cabang(nama_cabang)")
        .eq("mr_status", "approved")
        .order("created_at", { ascending: false })
        .limit(20);
      if (debouncedMrSearch) q = q.ilike("mr_kode", `%${debouncedMrSearch}%`);
      const { data } = await q;
      setMrResults(data || []);
    };
    void run();
  }, [debouncedMrSearch, mrPopoverOpen]);

  async function loadMr(mrId: number) {
    const { data, error } = await getMrForWo(mrId);
    if (error || !data) {
      toast.error(error || "Gagal memuat MR.");
      return;
    }
    setMr(data.mr);
    setDraftItems(
      data.items
        .filter((i: any) => i.wo_remaining > 0)
        .map((i: any) => ({
          mr_item_id: i.id,
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          satuan: i.satuan,
          qty_request: i.qty_request,
          wo_remaining: i.wo_remaining,
          selected: false,
          qty: i.wo_remaining,
          lead_time_days: "",
          deadline_date: "",
          formulaState: "idle",
          formulaComponents: [],
        })),
    );
  }

  async function toggleItem(mrItemId: number, checked: boolean) {
    const target = draftItems.find((i) => i.mr_item_id === mrItemId);
    if (checked && target && target.formulaState === "idle") {
      setDraftItems((prev) =>
        prev.map((i) => (i.mr_item_id === mrItemId ? { ...i, formulaState: "loading" } : i)),
      );
      const { data } = await getWoFormulaByTargetPart(target.part_id);
      const components = data?.wo_formula_components || [];
      setDraftItems((prev) =>
        prev.map((i) =>
          i.mr_item_id === mrItemId
            ? {
                ...i,
                formulaState: components.length > 0 ? "ready" : "missing",
                formulaComponents: components,
                selected: components.length > 0,
              }
            : i,
        ),
      );
      if (components.length === 0) {
        toast.error(`${target.part_number} belum punya formula WO. Tidak bisa di-checklist.`);
      }
      return;
    }
    setDraftItems((prev) =>
      prev.map((i) => (i.mr_item_id === mrItemId ? { ...i, selected: checked } : i)),
    );
  }

  function updateItem(mrItemId: number, patch: Partial<DraftItem>) {
    setDraftItems((prev) =>
      prev.map((i) => (i.mr_item_id === mrItemId ? { ...i, ...patch } : i)),
    );
  }

  async function handleSubmit() {
    if (!woKode.trim()) return toast.error("Kode WO wajib diisi");
    if (!mr) return toast.error("Pilih referensi MR");
    if (!gudangCabangId) return toast.error("Gudang WO wajib dipilih");
    if (!departemen) return toast.error("Departemen wajib dipilih");
    if (!selectedTemplateId) return toast.error("Jalur approval wajib dipilih");
    const chosen = draftItems.filter((i) => i.selected && i.qty > 0);
    if (chosen.length === 0) return toast.error("Pilih minimal 1 item untuk di-WO-kan");
    for (const item of chosen) {
      if (item.qty > item.wo_remaining) {
        return toast.error(`${item.part_number}: qty melebihi sisa yang boleh di-WO (${item.wo_remaining}).`);
      }
    }

    setSubmitting(true);
    try {
      const result = await createWorkingOrder({
        wo_kode: woKode,
        mr_id: mr.id,
        gudang_cabang_id: Number(gudangCabangId),
        departemen: departemen as "HO" | "BPP",
        wo_tanggal: woTanggal,
        approval_template_id: Number(selectedTemplateId),
        items: chosen.map((item) => ({
          mr_item_id: item.mr_item_id,
          part_id: item.part_id,
          part_number: item.part_number,
          part_name: item.part_name,
          satuan: item.satuan,
          qty: item.qty,
          lead_time_days: item.lead_time_days ? Number(item.lead_time_days) : null,
          deadline_date: item.deadline_date || null,
        })),
      });

      if ((result as any).success) {
        toast.success("Working Order berhasil dibuat");
        router.push(`/working-order/${(result as any).data.id}`);
      } else {
        toast.error((result as any).error || "Gagal membuat WO");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <Link href="/working-order">
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
            <Factory className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
              Buat Working Order
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Assembly/Produksi Internal dari MR
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Kode WO (Manual)
              </Label>
              <Input
                placeholder="WO/XXXX/2026..."
                value={woKode}
                onChange={(e) => setWoKode(e.target.value)}
                className="font-bold uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Referensi MR
              </Label>
              {mrLocked || mr ? (
                <div className="p-3 bg-muted/40 border border-border rounded-lg text-sm font-bold uppercase">
                  {mr?.mr_kode ?? "Memuat..."}
                  {mr?.cabang?.nama_cabang ? (
                    <span className="block text-[10px] text-muted-foreground font-medium normal-case mt-1">
                      {mr.cabang.nama_cabang}
                    </span>
                  ) : null}
                </div>
              ) : (
                <Popover open={mrPopoverOpen} onOpenChange={setMrPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      Pilih MR Referensi...
                      <Search className="h-3.5 w-3.5 opacity-40" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[calc(100vw-2rem)] max-w-100 p-0" align="start">
                    <div className="p-2 border-b border-border">
                      <Input
                        placeholder="Cari kode MR..."
                        value={mrSearch}
                        onChange={(e) => setMrSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-62.5 overflow-y-auto p-1">
                      {mrResults.length > 0 ? (
                        mrResults.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              setMrPopoverOpen(false);
                              void loadMr(m.id);
                            }}
                            className="w-full text-left p-2.5 rounded-md hover:bg-muted text-sm"
                          >
                            <div className="font-bold text-xs uppercase">{m.mr_kode}</div>
                            <div className="text-[10px] text-muted-foreground uppercase">
                              {m.mr_pic} · {m.cabang?.nama_cabang}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="p-6 text-center text-xs text-muted-foreground italic">
                          MR approved tidak ditemukan
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Tanggal WO
              </Label>
              <Input type="date" value={woTanggal} onChange={(e) => setWoTanggal(e.target.value)} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Gudang WO
              </Label>
              <Select value={gudangCabangId} onValueChange={setGudangCabangId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih gudang..." />
                </SelectTrigger>
                <SelectContent>
                  {cabangList.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      <Building2 className="h-3.5 w-3.5 mr-1.5 inline" />
                      {c.nama_cabang}
                      {c.cabang_type ? ` (${c.cabang_type})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Departemen
              </Label>
              <Select value={departemen} onValueChange={setDepartemen}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih departemen..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HO">HO</SelectItem>
                  <SelectItem value="BPP">BPP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Jalur Approval
              </Label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={templates.length === 0 ? "Tidak ada template tersedia" : "Pilih template..."}
                  />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-full bg-foreground rounded-xl p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                <span className="text-xs font-bold text-background uppercase tracking-tight">
                  Simpan Working Order
                </span>
              </div>
              <Button
                className="w-full h-11 bg-background text-foreground hover:bg-background/90 font-bold text-xs uppercase gap-2 rounded-lg"
                onClick={handleSubmit}
                disabled={submitting || !mr || draftItems.length === 0}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>SIMPAN WO</>}
              </Button>
            </div>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 bg-primary rounded-full" />
            <h3 className="text-xs font-bold text-foreground uppercase">
              Item MR &amp; Formula
            </h3>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <Table containerClassName="max-h-[60vh] overflow-y-auto">
              <TableHeader className="bg-muted/50 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:shadow-[0_2px_4px_-2px_rgba(0,0,0,0.15)]">
                <TableRow>
                  <TableHead className="w-10 pl-4" />
                  <TableHead>Part Number</TableHead>
                  <TableHead>Nama Barang</TableHead>
                  <TableHead className="text-center">Qty WO</TableHead>
                  <TableHead className="text-center">Lead Time (hari)</TableHead>
                  <TableHead className="text-center">Deadline</TableHead>
                  <TableHead>Formula</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draftItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-40 text-center text-muted-foreground italic">
                      {mr ? "Semua item MR sudah terpenuhi/ter-WO-kan" : "Pilih MR referensi dulu"}
                    </TableCell>
                  </TableRow>
                ) : (
                  draftItems.map((item) => (
                    <TableRow key={item.mr_item_id} className={!item.selected ? "opacity-60" : ""}>
                      <TableCell className="pl-4">
                        <Checkbox
                          checked={item.selected}
                          disabled={item.formulaState === "loading"}
                          onCheckedChange={(v) => toggleItem(item.mr_item_id, Boolean(v))}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold uppercase">
                        {item.part_number}
                      </TableCell>
                      <TableCell className="text-sm font-semibold">{item.part_name}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <Input
                            type="number"
                            min={0}
                            max={item.wo_remaining}
                            disabled={!item.selected}
                            value={item.qty}
                            onChange={(e) =>
                              updateItem(item.mr_item_id, {
                                qty: Math.max(0, Math.min(item.wo_remaining, Number(e.target.value) || 0)),
                              })
                            }
                            className="h-8 w-20 text-center font-bold text-sm"
                          />
                          <span className="text-[9px] font-medium text-muted-foreground">
                            Sisa {item.wo_remaining}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number"
                          min={0}
                          disabled={!item.selected}
                          value={item.lead_time_days}
                          onChange={(e) => updateItem(item.mr_item_id, { lead_time_days: e.target.value })}
                          className="h-8 w-20 text-center"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="date"
                          disabled={!item.selected}
                          value={item.deadline_date}
                          onChange={(e) => updateItem(item.mr_item_id, { deadline_date: e.target.value })}
                          className="h-8 w-36"
                        />
                      </TableCell>
                      <TableCell>
                        {item.formulaState === "loading" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : item.formulaState === "missing" ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-destructive uppercase">
                            <AlertCircle className="h-3 w-3" /> Belum ada formula
                          </span>
                        ) : item.formulaState === "ready" ? (
                          <div className="space-y-1">
                            {item.formulaComponents.map((c: any) => (
                              <div
                                key={c.id}
                                className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground"
                              >
                                <Beaker className="h-3 w-3 shrink-0" />
                                {c.component_part_number} — {(Number(c.qty_per_unit) * item.qty).toFixed(2)}{" "}
                                {c.component_satuan}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </Content>
    </>
  );
}
