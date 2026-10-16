"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Search,
  ShoppingCart,
  Building2,
  Calendar,
  Package,
  Loader2,
  ChevronRight,
  CheckCircle2,
  User,
  CreditCard,
  AlertCircle,
  FileText,
  ShieldCheck,
  Percent,
  ReceiptText,
  X,
  History,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createPurchaseOrder } from "@/services/procurement-actions";
import { revisePurchaseOrder } from "@/services/po-revision-actions";
import { canRevisePO } from "@/lib/po-revision";
import { useDebounce } from "use-debounce";
import Link from "next/link";
import { cn, formatDate, toYmdLocal } from "@/lib/utils";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { DatePickerString } from "@/components/date-picker-string";
import {
  canViewPOPrice,
  extractRoleNames,
  maskedPriceText,
} from "@/lib/po-price-access";
import { PrConvertStatusBadge } from "@/components/pr/pr-convert-status-badge";
import {
  computePoTotals,
  getPphDefaultRate,
  getPphTypeLabel,
  PPH_TYPE_OPTIONS,
  PPN_RATE_OPTIONS,
} from "@/lib/po-tax";
import { fetchPrItemConvertedQty } from "@/lib/pr-po-coverage";
import type { PoJenis } from "@/lib/po-non-pr";
import {
  computeSoItemRemaining,
  fetchSoItemFulfillment,
} from "@/lib/so-reguler";
import {
  PO_CURRENCY_OPTIONS,
  formatPoMoney,
  getPoCurrencySymbol,
  type PoCurrency,
} from "@/lib/po-currency";
import { PoMoneyInput } from "@/components/po/po-money-input";

type Step = 1 | 2 | 3;

interface POItem {
  // null semua untuk item PO Non-PR (dipilih bebas dari master barang).
  mr_id: number | null;
  // Diisi untuk PO dari SO Reguler.
  so_item_id?: number | null;
  pr_item_id: number | null;
  pr_id: number | null;
  pr_kode: string;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  remaining: number;
  selected: boolean;
  qty: number;
  harga: number;
  vendor_id: number | null;
  // Edit/Revisi PO: id po_items untuk item lama (null = item baru) dan qty
  // yang sudah diterima (batas bawah qty, item tidak bisa dihapus bila > 0).
  po_item_id?: number | null;
  qty_received?: number;
}

const PAYMENT_TERM_PRESETS = [
  "Cash / COD",
  "NET 7",
  "NET 14",
  "NET 30",
  "NET 45",
  "NET 60",
  "DP 30%",
  "DP 50%",
  "Kredit",
];

export function PoForm({ editPoId }: { editPoId?: number } = {}) {
  const isEdit = Boolean(editPoId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSoId = Number(searchParams.get("so_id")) || null;
  const supabase = createClient();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // User & auth
  const [userProfile, setUserProfile] = useState<any>(null);
  const [canViewPrice, setCanViewPrice] = useState(false);

  // Jenis PO: "reguler" = item ditarik dari PR WMS; "non_pr" = item dipilih
  // bebas dari master barang (PN/satuan beli beda dengan PR), PR cuma
  // referensi teks. Lihat lib/po-non-pr.ts.
  const [poJenis, setPoJenis] = useState<PoJenis>("reguler");
  const [prReferensi, setPrReferensi] = useState("");
  const [barangSearch, setBarangSearch] = useState("");
  const [debouncedBarangSearch] = useDebounce(barangSearch, 300);
  const [barangResults, setBarangResults] = useState<any[]>([]);
  const [barangLoading, setBarangLoading] = useState(false);
  const [barangPopoverOpen, setBarangPopoverOpen] = useState(false);
  const isNonPr = poJenis === "non_pr";
  const isSo = poJenis === "so";

  // PO dari SO Reguler: 1 PO = 1 SO, item = sisa SO yang belum di-PO/DO.
  const [selectedSo, setSelectedSo] = useState<any | null>(null);
  const [soResults, setSoResults] = useState<any[]>([]);
  const [soSearch, setSoSearch] = useState("");
  const [debouncedSoSearch] = useDebounce(soSearch, 300);
  const [soPopoverOpen, setSoPopoverOpen] = useState(false);
  const [soLoading, setSoLoading] = useState(false);
  // Gudang penerima PO dari SO (SO tidak punya lokasi). Default gudang akun.
  const [soCabangId, setSoCabangId] = useState("");
  const [cabangOptions, setCabangOptions] = useState<
    { id: number; nama_cabang: string }[]
  >([]);

  // Step 1 — Select PR
  const [prs, setPrs] = useState<any[]>([]);
  const [prSearch, setPrSearch] = useState("");
  const [debouncedPrSearch] = useDebounce(prSearch, 300);
  const [prPopoverOpen, setPrPopoverOpen] = useState(false);
  const [selectedPrs, setSelectedPrs] = useState<any[]>([]);

  // Step 2 — Item & harga per item, vendor per dokumen (satu vendor untuk
  // seluruh PO, bukan per item).
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [vendorResults, setVendorResults] = useState<any[]>([]);
  const [vendorLoading, setVendorLoading] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<any | null>(null);
  const [vendorSearch, setVendorSearch] = useState("");
  const [vendorPopoverOpen, setVendorPopoverOpen] = useState(false);

  // Step 3 — PO Header
  const [poKode, setPoKode] = useState("");
  const [poTanggal, setPoTanggal] = useState(toYmdLocal());
  const [poEstimasi, setPoEstimasi] = useState("");
  const [poPaymentTerm, setPoPaymentTerm] = useState("");
  const [paymentTermCustom, setPaymentTermCustom] = useState(false);
  const [poKeterangan, setPoKeterangan] = useState("");
  const [poCurrency, setPoCurrency] = useState<PoCurrency>("IDR");
  const currencySymbol = getPoCurrencySymbol(poCurrency);

  // Pajak, diskon & ongkir
  const [hargaTermasukPajak, setHargaTermasukPajak] = useState(false);
  const [ppnMode, setPpnMode] = useState<"percent" | "amount">("amount");
  const [ppnRate, setPpnRate] = useState(0);
  const [ppnAmountManual, setPpnAmountManual] = useState(0);
  const [diskonMode, setDiskonMode] = useState<"percent" | "amount">("amount");
  const [diskonValue, setDiskonValue] = useState(0);
  const [ongkir, setOngkir] = useState(0);
  const [pphType, setPphType] = useState("");
  const [pphMode, setPphMode] = useState<"percent" | "amount">("amount");
  const [pphRate, setPphRate] = useState(0);
  const [pphAmountManual, setPphAmountManual] = useState(0);

  // Approval template
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);

  // Signature dialog
  const [isSignatureOpen, setIsSignatureOpen] = useState(false);

  // Edit/Revisi PO
  const [editPo, setEditPo] = useState<any | null>(null);
  const [editLoading, setEditLoading] = useState(isEdit);
  const [editAllowed, setEditAllowed] = useState<boolean | null>(
    isEdit ? null : true,
  );
  const [revisionReason, setRevisionReason] = useState("");
  // Item PO asli — dipakai ulang kalau PR asal dilepas lalu dipilih lagi,
  // supaya item lama tidak berubah jadi item baru (hapus + insert).
  const [editExistingItems, setEditExistingItems] = useState<any[]>([]);

  useEffect(() => {
    fetchUser();
    supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then(({ data }) => setCabangOptions(data || []));
    if (editPoId) {
      loadEditPo(editPoId);
      return;
    }
    if (initialSoId) {
      setPoJenis("so");
      handleSelectSo(initialSoId);
    }
  }, []);

  useEffect(() => {
    if (!soPopoverOpen) return;
    const run = async () => {
      let q = supabase
        .from("so_reguler")
        .select(
          "id, so_kode, so_status, so_tanggal, customer:customers!customer_id(customer_name)",
        )
        .in("so_status", ["open", "partial"])
        .order("created_at", { ascending: false })
        .limit(30);
      if (debouncedSoSearch) q = q.ilike("so_kode", `%${debouncedSoSearch}%`);
      const { data } = await q;
      setSoResults(data || []);
    };
    run();
  }, [debouncedSoSearch, soPopoverOpen]);

  const handleSelectSo = async (soId: number) => {
    setSoPopoverOpen(false);
    setSoSearch("");
    setSoLoading(true);
    const { data: so } = await supabase
      .from("so_reguler")
      .select(
        "id, so_kode, so_status, customer:customers!customer_id(customer_name), so_reguler_items(id, part_id, part_number, part_name, satuan, qty)",
      )
      .eq("id", soId)
      .maybeSingle();
    if (!so || so.so_status === "cancelled" || so.so_status === "completed") {
      setSoLoading(false);
      toast.error(so ? `SO ${so.so_kode} tidak bisa di-PO (status ${so.so_status}).` : "SO tidak ditemukan.");
      return;
    }
    const soItems: any[] = [...(so.so_reguler_items || [])].sort(
      (a, b) => a.id - b.id,
    );
    const fulfillment = await fetchSoItemFulfillment(
      supabase,
      soItems.map((i) => i.id),
    );
    const nextItems: POItem[] = soItems.map((i) => {
      const { sisaPo } = computeSoItemRemaining(i.qty, fulfillment.get(i.id));
      return {
        mr_id: null,
        pr_item_id: null,
        pr_id: null,
        pr_kode: "",
        so_item_id: i.id,
        part_id: i.part_id,
        part_number: i.part_number,
        part_name: i.part_name,
        satuan: i.satuan,
        remaining: sisaPo,
        selected: sisaPo > 0,
        qty: sisaPo,
        harga: 0,
        vendor_id: selectedVendor?.id ?? null,
      };
    });
    setSoLoading(false);
    if (!nextItems.some((i) => i.remaining > 0)) {
      toast.error(`Semua item SO ${so.so_kode} sudah di-PO / dikirim.`);
      return;
    }
    setSelectedSo(so);
    setPoItems(nextItems);
  };

  useEffect(() => {
    fetchApprovedPRs();
  }, [debouncedPrSearch]);

  useEffect(() => {
    if (!barangPopoverOpen) return;
    const run = async () => {
      setBarangLoading(true);
      let q = supabase
        .from("barang")
        .select("id, part_number, part_name, part_satuan")
        .order("part_number")
        .limit(20);
      if (debouncedBarangSearch) {
        q = q.or(
          `part_number.ilike.%${debouncedBarangSearch}%,part_name.ilike.%${debouncedBarangSearch}%`,
        );
      }
      const { data } = await q;
      setBarangResults(data || []);
      setBarangLoading(false);
    };
    run();
  }, [debouncedBarangSearch, barangPopoverOpen]);

  const switchPoJenis = (next: PoJenis) => {
    if (next === poJenis) return;
    setPoJenis(next);
    setSelectedPrs([]);
    setSelectedSo(null);
    setPoItems([]);
  };

  const handleAddBarang = (b: any) => {
    setBarangPopoverOpen(false);
    setBarangSearch("");
    if (poItems.some((i) => i.part_id === b.id)) {
      toast.info(`${b.part_number} sudah ada di daftar item.`);
      return;
    }
    setPoItems((prev) => [
      ...prev,
      {
        mr_id: null,
        pr_item_id: null,
        pr_id: null,
        pr_kode: "",
        part_id: b.id,
        part_number: b.part_number,
        part_name: b.part_name,
        satuan: b.part_satuan,
        remaining: Number.POSITIVE_INFINITY,
        selected: true,
        qty: 1,
        harga: 0,
        vendor_id: selectedVendor?.id ?? null,
      },
    ]);
  };

  const removeItem = (idx: number) => {
    const target = poItems[idx];
    if ((target?.qty_received || 0) > 0) {
      toast.error(
        `${target.part_number} sudah ada barang diterima, tidak bisa dihapus.`,
      );
      return;
    }
    setPoItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const fetchUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("*, cabang(id, nama_cabang), user_roles(roles(name,label))")
      .eq("id", user.id)
      .single();
    if (!profile && isEdit) setEditAllowed(false);
    if (profile) {
      setUserProfile(profile);
      if (profile.cabang_id)
        setSoCabangId((prev) => prev || String(profile.cabang_id));
      // Edit/Revisi PO: moderator juga boleh mengubah harga (lihat
      // lib/po-revision.ts); buat PO baru tetap khusus purchasing.
      const revisable = canRevisePO(extractRoleNames(profile));
      setCanViewPrice(isEdit ? revisable : canViewPOPrice(profile));
      if (isEdit) setEditAllowed(revisable);

      // Edit: template lokasi PO juga ditawarkan, selain lokasi editor.
      let poCabangId: number | null = null;
      if (editPoId) {
        const { data: poRow } = await supabase
          .from("pos")
          .select("cabang_id")
          .eq("id", editPoId)
          .maybeSingle();
        poCabangId = poRow?.cabang_id ?? null;
      }
      const cabangFilter = [profile.cabang_id, poCabangId]
        .filter(Boolean)
        .map((id) => `cabang_id.eq.${id}`)
        .join(",");
      const { data: templateData } = await supabase
        .from("approval_templates")
        .select(
          "*, steps:approval_template_steps(*, profiles(id, nama, email))",
        )
        .eq("type", "Purchase Order")
        .or(`${cabangFilter ? `${cabangFilter},` : ""}cabang_id.is.null`)
        .order("name");
      setTemplates(templateData || []);
      if (templateData && templateData.length > 0) {
        setSelectedTemplateId(templateData[0].id.toString());
      }
    }
  };

  const fetchApprovedPRs = async () => {
    setLoading(true);
    let query = supabase
      .from("prs")
      .select(
        "id, pr_kode, pr_status, pr_convert_status, pr_tanggal, cabang(nama_cabang), profiles(nama)",
      )
      .eq("pr_status", "approved")
      .order("created_at", { ascending: false })
      .limit(50);

    if (debouncedPrSearch) {
      query = query.ilike("pr_kode", `%${debouncedPrSearch}%`);
    }

    const { data } = await query;
    setPrs(data || []);
    setLoading(false);
  };

  const searchVendors = async (query: string) => {
    setVendorLoading(true);
    let q = supabase
      .from("vendors")
      .select("id, vendor_name, vendor_no")
      .order("vendor_name")
      .limit(15);
    if (query.trim()) {
      q = q.or(`vendor_name.ilike.%${query}%,vendor_no.ilike.%${query}%`);
    }
    const { data } = await q;
    setVendorResults(data || []);
    setVendorLoading(false);
  };

  // Hitung qty yang sudah terpakai di PO lain (belum rejected) per pr_item,
  // termasuk link manual dari PO Non-PR.
  const fetchConvertedMap = async (prItemIds: number[]) => {
    const converted = await fetchPrItemConvertedQty(supabase, prItemIds, {
      excludePoId: editPoId,
    });
    return Object.fromEntries(converted) as Record<number, number>;
  };

  // Item PR jadi baris PO. existingByPrItemId (mode edit): item PO lama
  // ditumpuk di atas baris PR-nya supaya id, qty, harga & qty diterima ikut.
  const loadPrItems = async (
    pr: any,
    existingByPrItemId?: Map<number, any>,
    vendorId?: number | null,
  ): Promise<POItem[]> => {
    // Note: pr_items has no harga column; user enters harga in step 2
    const { data: items } = await supabase
      .from("pr_items")
      .select("id, mr_id, part_id, part_number, part_name, satuan, qty, status")
      .eq("pr_id", pr.id)
      .neq("status", "rejected")
      .order("created_at");

    const prItemIds = (items || []).map((i: any) => i.id);
    const convertedMap = await fetchConvertedMap(prItemIds);

    return (items || []).map((item: any) => {
      const remaining = Math.max(0, item.qty - (convertedMap[item.id] || 0));
      const base: POItem = {
        mr_id: item.mr_id,
        pr_item_id: item.id,
        pr_id: pr.id,
        pr_kode: pr.pr_kode,
        part_id: item.part_id,
        part_number: item.part_number,
        part_name: item.part_name,
        satuan: item.satuan,
        remaining,
        selected: remaining > 0,
        qty: remaining,
        harga: 0,
        vendor_id: vendorId ?? selectedVendor?.id ?? null,
      };
      const existing = existingByPrItemId?.get(item.id);
      return existing ? mergeExistingItem(base, existing) : base;
    });
  };

  const handleTogglePR = async (pr: any) => {
    const isSelected = selectedPrs.some((p) => p.id === pr.id);
    if (isSelected) {
      const received = poItems.find(
        (i) => i.pr_id === pr.id && (i.qty_received || 0) > 0,
      );
      if (received) {
        toast.error(
          `PR ${pr.pr_kode} tidak bisa dilepas: item ${received.part_number} sudah ada barang diterima.`,
        );
        return;
      }
      setSelectedPrs((prev) => prev.filter((p) => p.id !== pr.id));
      setPoItems((prev) => prev.filter((i) => i.pr_id !== pr.id));
      return;
    }

    setSelectedPrs((prev) => [...prev, pr]);
    const existingMap = new Map(
      editExistingItems
        .filter((e: any) => e.pr_item_id)
        .map((e: any) => [e.pr_item_id, e]),
    );
    const newItems = await loadPrItems(pr, existingMap);
    setPoItems((prev) => [...prev, ...newItems]);
  };

  const mergeExistingItem = (base: POItem, existing: any): POItem => ({
    ...base,
    po_item_id: existing.id,
    qty_received: Number(existing.qty_received) || 0,
    selected: true,
    qty: Number(existing.qty) || 0,
    harga: Number(existing.harga) || 0,
    vendor_id: existing.vendor_id ?? base.vendor_id,
    // Sisa sudah tidak menghitung PO ini sendiri; data legacy yang melebihi
    // sisa tetap boleh dipertahankan.
    remaining: Math.max(base.remaining, Number(existing.qty) || 0),
  });

  const existingToItem = (existing: any, prKode = ""): POItem => ({
    mr_id: existing.mr_id ?? null,
    pr_item_id: existing.pr_item_id ?? null,
    pr_id: existing.pr_items?.pr_id ?? null,
    pr_kode: prKode,
    so_item_id: existing.so_item_id ?? null,
    part_id: existing.part_id,
    part_number: existing.part_number,
    part_name: existing.part_name,
    satuan: existing.satuan,
    remaining: Number.POSITIVE_INFINITY,
    selected: true,
    qty: Number(existing.qty) || 0,
    harga: Number(existing.harga) || 0,
    vendor_id: existing.vendor_id ?? null,
    po_item_id: existing.id,
    qty_received: Number(existing.qty_received) || 0,
  });

  const loadEditPo = async (poId: number) => {
    setEditLoading(true);
    try {
      const { data: po } = await supabase
        .from("pos")
        .select(
          "*, cabang(nama_cabang), so_reguler(id, so_kode, so_status, customer:customers!customer_id(customer_name), so_reguler_items(id, part_id, part_number, part_name, satuan, qty))",
        )
        .eq("id", poId)
        .maybeSingle();
      if (!po) {
        setEditPo(null);
        return;
      }
      const { data: rows } = await supabase
        .from("po_items")
        .select(
          "id, part_id, part_number, part_name, satuan, qty, qty_received, harga, vendor_id, mr_id, pr_item_id, so_item_id, vendors(id, vendor_name, vendor_no), pr_items(id, pr_id)",
        )
        .eq("po_id", poId)
        .order("id");
      const existing = rows || [];
      setEditExistingItems(existing);

      // Header
      setPoJenis((po.po_jenis || "reguler") as PoJenis);
      if (po.cabang_id) setSoCabangId(String(po.cabang_id));
      setPoKode(po.po_kode || "");
      setPoTanggal(po.po_tanggal || toYmdLocal());
      setPoEstimasi(po.po_estimasi || "");
      const term = po.po_payment_term || "";
      setPoPaymentTerm(term);
      setPaymentTermCustom(Boolean(term) && !PAYMENT_TERM_PRESETS.includes(term));
      setPoKeterangan(po.po_keterangan || "");
      setPoCurrency((po.po_currency || "IDR") as PoCurrency);
      setPrReferensi(po.po_pr_referensi || "");
      setHargaTermasukPajak(Boolean(po.po_harga_termasuk_pajak));
      setPpnMode(po.po_ppn_mode === "percent" ? "percent" : "amount");
      setPpnRate(Number(po.po_ppn_rate) || 0);
      setPpnAmountManual(Number(po.po_ppn_amount) || 0);
      setDiskonMode(po.po_diskon_mode === "percent" ? "percent" : "amount");
      setDiskonValue(Number(po.po_diskon_value) || 0);
      setOngkir(Number(po.po_ongkir) || 0);
      setPphType(po.po_pph_type || "");
      setPphMode(po.po_pph_mode === "percent" ? "percent" : "amount");
      setPphRate(Number(po.po_pph_rate) || 0);
      setPphAmountManual(Number(po.po_pph_amount) || 0);

      const vendorRow = existing.find((i: any) => i.vendors)?.vendors;
      const vendor = Array.isArray(vendorRow) ? vendorRow[0] : vendorRow;
      if (vendor) setSelectedVendor(vendor);

      // Item
      const jenis = po.po_jenis || "reguler";
      let nextItems: POItem[] = [];
      if (jenis === "non_pr") {
        nextItems = existing.map((e: any) => existingToItem(e));
      } else if (jenis === "so") {
        const so = Array.isArray(po.so_reguler) ? po.so_reguler[0] : po.so_reguler;
        if (so) {
          setSelectedSo(so);
          const soItems: any[] = [...(so.so_reguler_items || [])].sort(
            (a, b) => a.id - b.id,
          );
          const fulfillment = await fetchSoItemFulfillment(
            supabase,
            soItems.map((i) => i.id),
            { excludePoId: poId },
          );
          const bySoItem = new Map(existing.map((e: any) => [e.so_item_id, e]));
          nextItems = soItems.map((i) => {
            const { sisaPo } = computeSoItemRemaining(i.qty, fulfillment.get(i.id));
            const base: POItem = {
              mr_id: null,
              pr_item_id: null,
              pr_id: null,
              pr_kode: "",
              so_item_id: i.id,
              part_id: i.part_id,
              part_number: i.part_number,
              part_name: i.part_name,
              satuan: i.satuan,
              remaining: sisaPo,
              selected: false,
              qty: sisaPo,
              harga: 0,
              vendor_id: vendor?.id ?? null,
            };
            const e = bySoItem.get(i.id);
            return e ? mergeExistingItem(base, e) : base;
          });
        }
        const covered = new Set(nextItems.map((i) => i.po_item_id));
        nextItems.push(
          ...existing
            .filter((e: any) => !covered.has(e.id))
            .map((e: any) => existingToItem(e)),
        );
      } else {
        const prIds = Array.from(
          new Set(
            existing
              .map((e: any) => e.pr_items?.pr_id)
              .filter((id: any): id is number => Boolean(id)),
          ),
        );
        const { data: prRows } = prIds.length
          ? await supabase
              .from("prs")
              .select(
                "id, pr_kode, pr_status, pr_convert_status, pr_tanggal, cabang(nama_cabang), profiles(nama)",
              )
              .in("id", prIds)
          : { data: [] as any[] };
        const prList = (prRows || []).sort(
          (a: any, b: any) => prIds.indexOf(a.id) - prIds.indexOf(b.id),
        );
        setSelectedPrs(prList);
        const byPrItem = new Map(
          existing
            .filter((e: any) => e.pr_item_id)
            .map((e: any) => [e.pr_item_id, e]),
        );
        for (const pr of prList) {
          const rowsForPr = await loadPrItems(pr, byPrItem, vendor?.id ?? null);
          // Baris PR yang bukan bagian PO lama jangan otomatis tercentang.
          nextItems.push(
            ...rowsForPr.map((r) => (r.po_item_id ? r : { ...r, selected: false })),
          );
        }
        // Item PO yang PR-nya sudah tidak ada tetap ditampilkan.
        const covered = new Set(nextItems.map((i) => i.po_item_id));
        nextItems.push(
          ...existing
            .filter((e: any) => !covered.has(e.id))
            .map((e: any) => existingToItem(e)),
        );
      }
      setPoItems(nextItems);
      setEditPo(po);
    } finally {
      setEditLoading(false);
    }
  };

  const toggleItemSelected = (idx: number, checked: boolean) => {
    const target = poItems[idx];
    if (!checked && (target?.qty_received || 0) > 0) {
      toast.error(
        `${target.part_number} sudah ada barang diterima, tidak bisa dikeluarkan dari PO.`,
      );
      return;
    }
    setPoItems((prev) =>
      prev.map((item, i) =>
        i === idx ? { ...item, selected: checked } : item,
      ),
    );
  };

  const toggleAllItems = (checked: boolean) => {
    setPoItems((prev) =>
      prev.map((item) =>
        item.remaining > 0 && (checked || !(item.qty_received || 0))
          ? { ...item, selected: checked }
          : item,
      ),
    );
  };

  const updateItemQty = (idx: number, qty: number) => {
    setPoItems((prev) =>
      prev.map((item, i) =>
        i === idx
          ? {
              ...item,
              qty: Math.max(
                item.qty_received || 0,
                Math.min(qty, item.remaining),
              ),
            }
          : item,
      ),
    );
  };

  const updateItemField = (index: number, field: keyof POItem, value: any) => {
    setPoItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const handleVendorSelect = (vendor: any) => {
    setSelectedVendor(vendor);
    setPoItems((prev) =>
      prev.map((item) => ({ ...item, vendor_id: vendor.id })),
    );
    setVendorPopoverOpen(false);
  };

  const totalNilai = poItems
    .filter((it) => it.selected)
    .reduce((sum, it) => sum + it.qty * it.harga, 0);

  const poTax = computePoTotals({
    subtotal: totalNilai,
    diskonMode,
    diskonValue,
    hargaTermasukPajak,
    ppnMode,
    ppnRate,
    ppnAmountManual,
    ongkir,
    pphMode,
    pphRate: pphType ? pphRate : 0,
    pphAmountManual: pphType ? pphAmountManual : 0,
  });

  const selectableItemCount = poItems.filter((it) => it.remaining > 0).length;
  const allItemsSelected =
    selectableItemCount > 0 &&
    poItems.filter((it) => it.remaining > 0).every((it) => it.selected);

  const handleSubmit = () => {
    const chosen = poItems.filter((i) => i.selected && i.qty > 0);
    if (!poKode.trim()) return toast.error("Kode PO wajib diisi");
    if (isSo && !selectedSo) return toast.error("Pilih SO terlebih dahulu");
    if (isSo && !isEdit && !soCabangId)
      return toast.error("Pilih gudang penerima PO");
    if (poJenis === "reguler" && selectedPrs.length === 0)
      return toast.error("Pilih PR terlebih dahulu");
    if (chosen.length === 0)
      return toast.error("Tidak ada item terpilih untuk diproses ke PO");
    if (!selectedTemplateId) return toast.error("Pilih Alur Approval");
    if (!templates.find((t) => t.id.toString() === selectedTemplateId))
      return toast.error("Template approval tidak valid");
    if (!canViewPrice) {
      return toast.error(
        isEdit
          ? "Hanya purchasing atau moderator yang bisa mengedit PO."
          : "Hanya user dengan akses harga yang bisa membuat PO.",
      );
    }
    if (isEdit && !revisionReason.trim())
      return toast.error("Alasan revisi wajib diisi");
    if (!selectedVendor) return toast.error("Pilih vendor untuk PO ini.");
    const incomplete = chosen.filter((item) => !(item.harga > 0));
    if (incomplete.length > 0) {
      return toast.error(
        `Harga wajib diisi untuk: ${incomplete
          .map((i) => i.part_number)
          .join(", ")}`,
      );
    }
    setIsSignatureOpen(true);
  };

  const handleConfirmSignature = async (signature: {
    id: string;
    image_url: string;
    label: string;
  }) => {
    const template = templates.find(
      (t) => t.id.toString() === selectedTemplateId,
    )!;
    const sortedSteps = [...(template.steps || [])].sort(
      (a: any, b: any) => a.step_order - b.step_order,
    );
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
          ? {
              nama: userProfile.nama,
              email: userProfile.email,
              lokasi: userProfile.cabang?.nama_cabang,
            }
          : null,
      };
    });

    const headerPayload = {
      po_tanggal: poTanggal,
      po_currency: poCurrency,
      po_harga_termasuk_pajak: hargaTermasukPajak,
      po_ppn_mode: ppnMode,
      po_ppn_rate: ppnRate,
      po_ppn_amount: ppnAmountManual,
      po_diskon_mode: diskonMode,
      po_diskon_value: diskonValue,
      po_ongkir: ongkir,
      po_pph_type: pphType || null,
      po_pph_mode: pphMode,
      po_pph_rate: pphType ? pphRate : 0,
      po_pph_amount: pphType ? pphAmountManual : 0,
    };

    if (isEdit && editPoId) {
      setSubmitting(true);
      try {
        const result = await revisePurchaseOrder(editPoId, {
          ...headerPayload,
          reason: revisionReason.trim(),
          po_kode: poKode,
          po_estimasi: poEstimasi || null,
          po_payment_term: poPaymentTerm || null,
          po_keterangan: poKeterangan || null,
          po_pr_referensi: isNonPr ? prReferensi.trim() || null : null,
          approvals: approvalData,
          items: poItems
            .filter((i) => i.selected && i.qty > 0)
            .map((i) => ({
              po_item_id: i.po_item_id ?? null,
              mr_id: i.mr_id,
              pr_item_id: i.pr_item_id,
              pr_id: i.pr_id,
              so_item_id: i.so_item_id ?? null,
              part_id: i.part_id,
              part_number: i.part_number,
              part_name: i.part_name,
              satuan: i.satuan,
              qty: i.qty,
              harga: i.harga,
              vendor_id: i.vendor_id,
            })),
        });
        if (result.success) {
          toast.success(
            `PO berhasil direvisi (Rev. ${result.revision}). Approval diulang dari awal.`,
          );
          router.push(`/po/${editPoId}`);
        } else {
          toast.error(result.error || "Gagal menyimpan revisi PO");
        }
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      const result = await createPurchaseOrder({
        po_kode: poKode,
        cabang_id: userProfile?.cabang_id,
        po_pic: userProfile?.nama || "",
        po_pic_id: userProfile?.id || "",
        po_tanggal: poTanggal,
        po_estimasi: poEstimasi || undefined,
        po_payment_term: poPaymentTerm || undefined,
        po_keterangan: poKeterangan || undefined,
        po_currency: poCurrency,
        po_harga_termasuk_pajak: hargaTermasukPajak,
        po_ppn_mode: ppnMode,
        po_ppn_rate: ppnRate,
        po_ppn_amount: ppnAmountManual,
        po_diskon_mode: diskonMode,
        po_diskon_value: diskonValue,
        po_ongkir: ongkir,
        po_pph_type: pphType || null,
        po_pph_mode: pphMode,
        po_pph_rate: pphType ? pphRate : 0,
        po_pph_amount: pphType ? pphAmountManual : 0,
        po_jenis: poJenis,
        po_pr_referensi: isNonPr ? prReferensi.trim() || undefined : undefined,
        so_id: isSo ? selectedSo?.id : undefined,
        so_cabang_id: isSo ? Number(soCabangId) : undefined,
        approvals: approvalData,
        items: poItems
          .filter((i) => i.selected && i.qty > 0)
          .map((i) => ({
            mr_id: i.mr_id,
            pr_item_id: i.pr_item_id,
            pr_id: i.pr_id,
            so_item_id: i.so_item_id ?? null,
            part_id: i.part_id,
            part_number: i.part_number,
            part_name: i.part_name,
            satuan: i.satuan,
            qty: i.qty,
            harga: i.harga,
            vendor_id: i.vendor_id,
          })),
      });

      if (result.success) {
        toast.success("Purchase Order berhasil dibuat");
        router.push("/po");
      } else {
        toast.error(result.error || "Gagal membuat PO");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (n: number) => formatPoMoney(n, poCurrency);

  const handleCurrencyChange = (next: PoCurrency) => {
    setPoCurrency(next);
  };

  if (isEdit && (editLoading || editAllowed === null)) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isEdit && (!editPo || !editAllowed)) {
    return (
      <Content>
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
          <AlertCircle className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-bold text-foreground uppercase">
            {!editPo
              ? "Purchase Order tidak ditemukan"
              : "Hanya purchasing atau moderator yang dapat mengedit PO"}
          </p>
          <Link href={editPo ? `/po/${editPoId}` : "/po"}>
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Kembali
            </Button>
          </Link>
        </div>
      </Content>
    );
  }

  const nextRevision = (Number(editPo?.po_revision) || 0) + 1;

  return (
    <>
      {/* Header */}
      <Content>
        <div className="flex items-center gap-3">
          <Link href={isEdit ? `/po/${editPoId}` : "/po"}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
              {isEdit
                ? `Edit Purchase Order — ${editPo?.po_kode}`
                : "Buat Purchase Order"}
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              {step === 1
                ? isNonPr
                  ? "Langkah 1 dari 3 — Pilih Barang (PO Non-PR)"
                  : isSo
                    ? "Langkah 1 dari 3 — Pilih SO Reguler"
                    : "Langkah 1 dari 3 — Pilih Purchase Request"
                : step === 2
                  ? "Langkah 2 dari 3 — Tentukan Vendor & Harga"
                  : "Langkah 3 dari 3 — Isi Informasi PO"}
            </p>
          </div>
        </div>
      </Content>

      {isEdit && (
        <Content>
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 flex items-start gap-2">
            <History className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-[11px] font-semibold text-warning leading-relaxed">
              Mode revisi PO (akan jadi Rev. {nextRevision}). Semua data bisa
              diubah, termasuk menambah PR baru beserta itemnya. Setelah
              disimpan, alur approval diulang dari awal dan perubahan tercatat
              di Riwayat PO. Item yang sudah ada barang diterima tidak bisa
              dihapus dan qty-nya tidak bisa di bawah qty diterima.
            </p>
          </div>
        </Content>
      )}

      {/* Step Indicator */}
      <Content>
        <div className="flex items-center gap-0">
          {[
            {
              n: 1,
              label: isNonPr ? "Pilih Barang" : isSo ? "Pilih SO" : "Pilih PR",
            },
            { n: 2, label: "Vendor & Harga" },
            { n: 3, label: "Informasi PO" },
          ].map((s, i) => (
            <React.Fragment key={s.n}>
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-black transition-colors",
                    step > s.n
                      ? "bg-success text-success-foreground"
                      : step === s.n
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {step > s.n ? <CheckCircle2 className="h-4 w-4" /> : s.n}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-bold uppercase hidden sm:block",
                    step === s.n ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
              </div>
              {i < 2 && (
                <div className="flex-1 h-0.5 mx-3 bg-border rounded-full" />
              )}
            </React.Fragment>
          ))}
        </div>
      </Content>

      {/* Step 1: Select PR */}
      {step === 1 && (
        <Content>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Jenis PO
              </Label>
              <div className="flex h-10 w-full max-w-2xl overflow-hidden rounded-md border border-input">
                {(
                  [
                    { value: "reguler", label: "Dari PR (Reguler)" },
                    { value: "non_pr", label: "Non-PR (PR hanya referensi)" },
                    { value: "so", label: "Dari SO Reguler" },
                  ] as { value: PoJenis; label: string }[]
                ).map((opt, i) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => switchPoJenis(opt.value)}
                    disabled={isEdit && poJenis !== opt.value}
                    className={cn(
                      "flex-1 px-3 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      i > 0 && "border-l border-input",
                      poJenis === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {isNonPr && (
                <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">
                  Untuk barang yang PN/satuan belinya beda dengan PR (mis. PR
                  &quot;Pack of 100m Roll&quot;, dibeli &quot;1m Roll&quot;
                  x100). Barang diterima di gudang GMI-JAKARTA, lalu dikonversi
                  ke PN PR lewat Job Costing. Setelah PO dibuat, item bisa
                  dihubungkan ke PR WMS dari halaman detail PO.
                </p>
              )}
              {isSo && (
                <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">
                  Untuk item SO Reguler yang stoknya belum ada. Barang diterima
                  (Receive Item) di gudang penerima yang dipilih, lalu dikirim
                  ke customer lewat DO Reguler dari SO yang sama. Qty dibatasi
                  sisa SO yang belum di-PO / dikirim.
                </p>
              )}
            </div>

            {isSo ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                    SO Reguler
                  </Label>
                  <Popover open={soPopoverOpen} onOpenChange={setSoPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start gap-2 h-10 font-bold text-xs"
                        disabled={soLoading || isEdit}
                      >
                        {soLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ReceiptText className="h-4 w-4 text-muted-foreground" />
                        )}
                        {selectedSo ? (
                          <span className="text-foreground uppercase">
                            {selectedSo.so_kode} —{" "}
                            {selectedSo.customer?.customer_name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            Cari Kode SO...
                          </span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-105 p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Cari kode SO..."
                          value={soSearch}
                          onValueChange={setSoSearch}
                        />
                        <CommandList>
                          {soResults.length === 0 ? (
                            <CommandEmpty>
                              Tidak ada SO open/partial.
                            </CommandEmpty>
                          ) : (
                            soResults.map((so) => (
                              <CommandItem
                                key={so.id}
                                value={String(so.id)}
                                onSelect={() => handleSelectSo(so.id)}
                                className="gap-3 py-3"
                              >
                                <ReceiptText className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-xs uppercase">
                                    {so.so_kode}
                                  </p>
                                  <p className="text-[9px] text-muted-foreground font-medium uppercase">
                                    {so.customer?.customer_name}
                                  </p>
                                </div>
                                <Badge
                                  variant="outline"
                                  className="text-[9px] font-bold uppercase shrink-0"
                                >
                                  {formatDate(so.so_tanggal)}
                                </Badge>
                              </CommandItem>
                            ))
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedSo && (
                    <p className="text-[10px] text-muted-foreground font-medium uppercase">
                      {poItems.filter((i) => i.remaining > 0).length} item bisa
                      di-PO
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                    <Building2 className="h-3 w-3" /> Gudang Penerima
                  </Label>
                  <Select
                    value={soCabangId}
                    onValueChange={setSoCabangId}
                    disabled={isEdit}
                  >
                    <SelectTrigger className="h-10 w-full font-bold text-xs uppercase">
                      <SelectValue placeholder="Pilih gudang penerima..." />
                    </SelectTrigger>
                    <SelectContent>
                      {cabangOptions.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.nama_cabang}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground font-medium">
                    {isEdit
                      ? "Gudang penerima PO tidak bisa diubah saat edit."
                      : "Default gudang Anda. Receive Item PO ini dikunci ke gudang ini."}
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    className="gap-2 font-bold text-xs uppercase"
                    disabled={
                      !selectedSo ||
                      poItems.length === 0 ||
                      (!isEdit && !soCabangId)
                    }
                    onClick={() => setStep(2)}
                  >
                    Lanjut ke Vendor & Harga{" "}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : isNonPr ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                    Referensi PR
                  </Label>
                  <Input
                    value={prReferensi}
                    onChange={(e) => setPrReferensi(e.target.value)}
                    placeholder="Mis. PR-PPIC-0123 — Pack of 100m Roll (boleh PR di luar WMS)"
                    className="h-10 font-medium text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                    Tambah Barang
                  </Label>
                  <Popover
                    open={barangPopoverOpen}
                    onOpenChange={setBarangPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start gap-2 h-10 font-bold text-xs"
                      >
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          Cari part number / nama barang...
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-105 p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Cari part number / nama..."
                          value={barangSearch}
                          onValueChange={setBarangSearch}
                        />
                        <CommandList>
                          {barangLoading ? (
                            <div className="py-6 flex items-center justify-center">
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : barangResults.length === 0 ? (
                            <CommandEmpty>Barang tidak ditemukan.</CommandEmpty>
                          ) : (
                            barangResults.map((b) => (
                              <CommandItem
                                key={b.id}
                                value={String(b.id)}
                                onSelect={() => handleAddBarang(b)}
                                className="gap-3 py-2.5"
                              >
                                <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-xs font-mono uppercase">
                                    {b.part_number}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground uppercase truncate">
                                    {b.part_name}
                                  </p>
                                </div>
                                <Badge
                                  variant="outline"
                                  className="text-[9px] font-bold uppercase shrink-0"
                                >
                                  {b.part_satuan}
                                </Badge>
                              </CommandItem>
                            ))
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {poItems.length > 0 && (
                  <div className="rounded-lg border border-border divide-y divide-border">
                    {poItems.map((item, idx) => (
                      <div
                        key={item.part_id}
                        className="flex items-center gap-3 px-3 py-2"
                      >
                        <span className="text-[11px] font-black font-mono uppercase">
                          {item.part_number}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-[10px] text-muted-foreground uppercase">
                          {item.part_name}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[9px] font-bold uppercase"
                        >
                          {item.satuan}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[10px] font-bold text-destructive"
                          onClick={() => removeItem(idx)}
                        >
                          Hapus
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <Button
                    className="gap-2 font-bold text-xs uppercase"
                    disabled={poItems.length === 0}
                    onClick={() => setStep(2)}
                  >
                    Lanjut ke Vendor & Harga{" "}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-primary rounded-full" />
                  <h3 className="text-[11px] font-bold uppercase">
                    Pilih Purchase Request yang Telah Disetujui (bisa lebih dari
                    1)
                  </h3>
                </div>

                <Popover open={prPopoverOpen} onOpenChange={setPrPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2 h-10 font-bold text-xs"
                    >
                      <Search className="h-4 w-4 text-muted-foreground" />
                      {selectedPrs.length > 0 ? (
                        <span className="text-foreground">
                          {selectedPrs.length} PR Dipilih
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Cari Kode PR...
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-105 p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Cari kode PR..."
                        value={prSearch}
                        onValueChange={setPrSearch}
                      />
                      <CommandList>
                        {loading ? (
                          <div className="py-6 flex items-center justify-center">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : prs.length === 0 ? (
                          <CommandEmpty>
                            Tidak ada PR approved yang tersedia.
                          </CommandEmpty>
                        ) : (
                          prs.map((pr) => {
                            const isChecked = selectedPrs.some(
                              (p) => p.id === pr.id,
                            );
                            return (
                              <CommandItem
                                key={pr.id}
                                value={pr.pr_kode}
                                onSelect={() => handleTogglePR(pr)}
                                className="gap-3 py-3"
                              >
                                {isChecked ? (
                                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                                ) : (
                                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="font-bold text-xs uppercase">
                                      {pr.pr_kode}
                                    </p>
                                    <PrConvertStatusBadge
                                      status={pr.pr_convert_status}
                                    />
                                  </div>
                                  <p className="text-[9px] text-muted-foreground font-medium uppercase">
                                    {pr.cabang?.nama_cabang} •{" "}
                                    {pr.profiles?.nama}
                                  </p>
                                </div>
                                <Badge
                                  variant="outline"
                                  className="text-[9px] font-bold uppercase shrink-0"
                                >
                                  {formatDate(pr.pr_tanggal)}
                                </Badge>
                              </CommandItem>
                            );
                          })
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {selectedPrs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedPrs.map((pr) => (
                      <Badge
                        key={pr.id}
                        variant="outline"
                        className="text-[10px] font-bold uppercase gap-1 pr-1"
                      >
                        {pr.pr_kode}
                        <button
                          type="button"
                          onClick={() => handleTogglePR(pr)}
                          className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                          title={`Lepas ${pr.pr_kode}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <Button
                    className="gap-2 font-bold text-xs uppercase"
                    disabled={selectedPrs.length === 0 || poItems.length === 0}
                    onClick={() => setStep(2)}
                  >
                    Lanjut ke Vendor & Harga{" "}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </Content>
      )}

      {/* Step 2: Vendor per dokumen + Harga per item */}
      {step === 2 && (
        <>
          <Content>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-4 w-1 bg-primary rounded-full" />
                <h3 className="text-[11px] font-bold uppercase">
                  Tentukan Vendor & Harga
                </h3>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase flex-wrap justify-end">
                <FileText className="h-3.5 w-3.5" />
                {isNonPr
                  ? `Non-PR${prReferensi.trim() ? ` — ${prReferensi.trim()}` : ""}`
                  : isSo
                    ? `SO ${selectedSo?.so_kode || ""}`
                    : selectedPrs.map((pr) => pr.pr_kode).join(", ")}
              </div>
            </div>
          </Content>

          <Content>
            <div className="mb-4 flex flex-wrap items-start gap-4">
              <div className="space-y-1.5 w-full max-w-sm">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                  <Building2 className="h-3 w-3" /> Vendor
                </Label>
                <Popover
                  open={vendorPopoverOpen}
                  onOpenChange={(val) => {
                    setVendorPopoverOpen(val);
                    if (val) searchVendors(vendorSearch);
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-10 w-full max-w-sm justify-start gap-1.5 font-bold text-sm"
                    >
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {selectedVendor
                        ? selectedVendor.vendor_name
                        : "Pilih Vendor..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Cari vendor..."
                        value={vendorSearch}
                        onValueChange={(val) => {
                          setVendorSearch(val);
                          searchVendors(val);
                        }}
                      />
                      <CommandList>
                        {vendorLoading ? (
                          <div className="py-6 flex items-center justify-center">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : vendorResults.length === 0 ? (
                          <CommandEmpty>Vendor tidak ditemukan.</CommandEmpty>
                        ) : (
                          vendorResults.map((v) => (
                            <CommandItem
                              key={v.id}
                              value={v.id.toString()}
                              onSelect={() => handleVendorSelect(v)}
                              className="text-xs font-bold"
                            >
                              {v.vendor_name}
                              {v.vendor_no && (
                                <span className="ml-2 text-[9px] text-muted-foreground font-mono">
                                  {v.vendor_no}
                                </span>
                              )}
                            </CommandItem>
                          ))
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="text-[9px] text-muted-foreground font-medium">
                  Vendor berlaku untuk semua item di PO ini.
                </p>
              </div>
              <div className="space-y-1.5 w-full max-w-[14rem]">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                  <CreditCard className="h-3 w-3" /> Mata Uang
                </Label>
                <Select
                  value={poCurrency}
                  onValueChange={(val) =>
                    handleCurrencyChange(val as PoCurrency)
                  }
                >
                  <SelectTrigger className="h-10 font-bold text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PO_CURRENCY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[9px] text-muted-foreground font-medium">
                  Berlaku untuk harga, pajak, diskon & ongkir PO ini.
                </p>
              </div>
            </div>
            <Table containerClassName="max-h-[55vh] overflow-y-auto">
              <TableHeader className="bg-muted/50 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:shadow-[0_2px_4px_-2px_rgba(0,0,0,0.15)]">
                <TableRow className="h-10 hover:bg-transparent">
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={allItemsSelected}
                      disabled={selectableItemCount === 0}
                      onCheckedChange={(v) => toggleAllItems(Boolean(v))}
                    />
                  </TableHead>
                  <TableHead className="text-[9px] font-black uppercase text-muted-foreground w-24">
                    {isSo ? "SO Asal" : "PR Asal"}
                  </TableHead>
                  <TableHead className="text-[9px] font-black uppercase text-muted-foreground w-28">
                    Part No.
                  </TableHead>
                  <TableHead className="text-[9px] font-black uppercase text-muted-foreground">
                    Nama Barang
                  </TableHead>
                  <TableHead className="text-[9px] font-black uppercase text-muted-foreground text-center w-24">
                    Qty (Sisa)
                  </TableHead>
                  <TableHead className="text-[9px] font-black uppercase text-muted-foreground w-36">
                    Harga Satuan
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poItems.map((item, idx) => {
                  return (
                    <TableRow
                      key={idx}
                      className={cn(
                        "border-b border-border/50 hover:bg-muted/20",
                        !item.selected && "opacity-50",
                      )}
                    >
                      <TableCell className="pl-4 py-3 align-top">
                        <Checkbox
                          checked={item.selected}
                          disabled={item.remaining <= 0}
                          onCheckedChange={(v) =>
                            toggleItemSelected(idx, Boolean(v))
                          }
                        />
                      </TableCell>
                      <TableCell className="py-3 align-top">
                        <Badge
                          variant="outline"
                          className="text-[9px] font-bold uppercase"
                        >
                          {item.so_item_id
                            ? selectedSo?.so_kode || "SO"
                            : item.pr_kode || "Non-PR"}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 align-top">
                        <span className="text-[11px] font-black text-foreground font-mono uppercase tracking-wide">
                          {item.part_number}
                        </span>
                      </TableCell>
                      <TableCell className="py-3 align-top max-w-45">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase leading-snug wrap-break-word whitespace-normal">
                          {item.part_name}
                        </span>
                      </TableCell>
                      <TableCell className="text-center py-3 align-middle">
                        <div className="flex flex-col items-center gap-0.5">
                          <Input
                            type="number"
                            min={item.qty_received || 0}
                            max={
                              Number.isFinite(item.remaining)
                                ? item.remaining
                                : undefined
                            }
                            disabled={!item.selected}
                            value={item.qty}
                            onChange={(e) =>
                              updateItemQty(idx, Number(e.target.value) || 0)
                            }
                            className="h-8 w-20 text-center font-bold text-sm mx-auto"
                          />
                          <span className="text-[9px] font-medium text-muted-foreground">
                            {Number.isFinite(item.remaining)
                              ? `Sisa ${item.remaining} ${item.satuan}`
                              : item.satuan}
                          </span>
                          {(item.qty_received || 0) > 0 && (
                            <span className="text-[9px] font-bold text-success">
                              Diterima {item.qty_received}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 pr-4 align-middle">
                        {canViewPrice ? (
                          <PoMoneyInput
                            currency={poCurrency}
                            value={item.harga}
                            onChange={(v) => updateItemField(idx, "harga", v)}
                            className="h-8"
                            inputClassName="text-xs"
                          />
                        ) : (
                          <div className="flex items-center h-8 rounded-md border border-input bg-muted/40 px-2 text-xs font-bold text-muted-foreground uppercase">
                            Restricted
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between p-4 border-t border-border bg-muted/30 mt-2">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">
                Subtotal Item (Qty × Harga)
              </span>
              <span className="text-sm font-black text-foreground">
                {maskedPriceText(canViewPrice, formatCurrency(totalNilai))}
              </span>
            </div>
            <p className="px-4 pb-2 text-[9px] text-muted-foreground font-medium">
              Pajak, diskon, dan ongkos kirim diisi di langkah berikutnya.
            </p>

            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                className="gap-2 font-bold text-xs"
                onClick={() => setStep(1)}
              >
                <ArrowLeft className="h-4 w-4" /> Kembali
              </Button>
              <Button
                className="gap-2 font-bold text-xs uppercase"
                onClick={() => setStep(3)}
              >
                Lanjut ke Informasi PO <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </Content>
        </>
      )}

      {/* Step 3: PO Header */}
      {step === 3 && (
        <Content>
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 bg-primary rounded-full" />
              <h3 className="text-[11px] font-bold uppercase">
                Informasi Purchase Order
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Kode PO <span className="text-destructive">*</span>
                </Label>
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                  <Input
                    value={poKode}
                    onChange={(e) => setPoKode(e.target.value)}
                    placeholder="PO-XXX-0001"
                    className="h-10 font-bold text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  PIC / Pembuat
                </Label>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <div className="flex h-10 w-full items-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground">
                    {(isEdit ? editPo?.po_pic : userProfile?.nama) || "-"}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Tanggal PO <span className="text-destructive">*</span>
                </Label>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <DatePickerString
                    value={poTanggal}
                    onChange={setPoTanggal}
                    className="h-10 font-bold text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Estimasi Tanggal Penerimaan
                </Label>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <DatePickerString
                    value={poEstimasi}
                    onChange={setPoEstimasi}
                    className="h-10 font-bold text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Syarat Pembayaran (Payment Term)
                </Label>
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                  <Select
                    value={
                      paymentTermCustom ? "__custom__" : poPaymentTerm || ""
                    }
                    onValueChange={(val) => {
                      if (val === "__custom__") {
                        setPaymentTermCustom(true);
                        setPoPaymentTerm("");
                      } else {
                        setPaymentTermCustom(false);
                        setPoPaymentTerm(val);
                      }
                    }}
                  >
                    <SelectTrigger className="h-10 font-bold text-sm flex-1">
                      <SelectValue placeholder="Pilih syarat pembayaran..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cash / COD">Cash / COD</SelectItem>
                      <SelectItem value="NET 7">NET 7</SelectItem>
                      <SelectItem value="NET 14">NET 14</SelectItem>
                      <SelectItem value="NET 30">NET 30</SelectItem>
                      <SelectItem value="NET 45">NET 45</SelectItem>
                      <SelectItem value="NET 60">NET 60</SelectItem>
                      <SelectItem value="DP 30%">DP 30%</SelectItem>
                      <SelectItem value="DP 50%">DP 50%</SelectItem>
                      <SelectItem value="Kredit">Kredit</SelectItem>
                      <SelectItem value="__custom__">
                        Lainnya / Custom...
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {paymentTermCustom && (
                  <Input
                    value={poPaymentTerm}
                    onChange={(e) => setPoPaymentTerm(e.target.value)}
                    placeholder="Masukkan syarat pembayaran lainnya..."
                    className="h-10 font-bold text-sm"
                    autoFocus
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Lokasi / Cabang
                </Label>
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <div className="flex h-10 w-full items-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground">
                    {(isEdit
                      ? editPo?.cabang?.nama_cabang
                      : isSo
                        ? cabangOptions.find(
                            (c) => String(c.id) === soCabangId,
                          )?.nama_cabang
                        : userProfile?.cabang?.nama_cabang) || "-"}
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Keterangan
                </Label>
                <Textarea
                  value={poKeterangan}
                  onChange={(e) => setPoKeterangan(e.target.value)}
                  placeholder="Keterangan tambahan, instruksi khusus, dll..."
                  className="resize-none min-h-20 font-medium text-sm"
                />
              </div>

              {/* Pajak, Diskon & Ongkir */}
              <div className="md:col-span-2 space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex items-center gap-2">
                  <Percent className="w-4 h-4 text-muted-foreground" />
                  <h4 className="text-[11px] font-bold uppercase text-foreground">
                    Pajak, Diskon & Ongkos Kirim
                  </h4>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="harga-termasuk-pajak"
                    checked={hargaTermasukPajak}
                    onCheckedChange={(v) => setHargaTermasukPajak(Boolean(v))}
                  />
                  <Label
                    htmlFor="harga-termasuk-pajak"
                    className="text-xs font-semibold cursor-pointer"
                  >
                    Harga sudah termasuk pajak (PPN tidak ditambahkan lagi ke
                    total)
                  </Label>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      PPN
                    </Label>
                    <div className="flex items-center gap-2">
                      <div className="flex h-10 shrink-0 overflow-hidden rounded-md border border-input">
                        <button
                          type="button"
                          onClick={() => setPpnMode("percent")}
                          className={cn(
                            "px-2.5 text-xs font-bold transition-colors",
                            ppnMode === "percent"
                              ? "bg-primary text-primary-foreground"
                              : "bg-background text-muted-foreground hover:bg-muted",
                          )}
                        >
                          %
                        </button>
                        <button
                          type="button"
                          onClick={() => setPpnMode("amount")}
                          className={cn(
                            "px-2.5 text-xs font-bold border-l border-input transition-colors",
                            ppnMode === "amount"
                              ? "bg-primary text-primary-foreground"
                              : "bg-background text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {currencySymbol}
                        </button>
                      </div>
                      {ppnMode === "percent" ? (
                        <Select
                          value={String(ppnRate)}
                          onValueChange={(val) => setPpnRate(Number(val))}
                        >
                          <SelectTrigger className="h-10 font-bold text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PPN_RATE_OPTIONS.map((opt) => (
                              <SelectItem
                                key={opt.value}
                                value={String(opt.value)}
                              >
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <PoMoneyInput
                          currency={poCurrency}
                          value={ppnAmountManual}
                          onChange={setPpnAmountManual}
                          className="h-10 flex-1"
                          inputClassName="text-sm"
                        />
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      Diskon
                    </Label>
                    <div className="flex items-center gap-2">
                      <div className="flex h-10 shrink-0 overflow-hidden rounded-md border border-input">
                        <button
                          type="button"
                          onClick={() => setDiskonMode("percent")}
                          className={cn(
                            "px-2.5 text-xs font-bold transition-colors",
                            diskonMode === "percent"
                              ? "bg-primary text-primary-foreground"
                              : "bg-background text-muted-foreground hover:bg-muted",
                          )}
                        >
                          %
                        </button>
                        <button
                          type="button"
                          onClick={() => setDiskonMode("amount")}
                          className={cn(
                            "px-2.5 text-xs font-bold border-l border-input transition-colors",
                            diskonMode === "amount"
                              ? "bg-primary text-primary-foreground"
                              : "bg-background text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {currencySymbol}
                        </button>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        value={diskonValue || ""}
                        onChange={(e) =>
                          setDiskonValue(
                            Math.max(0, Number(e.target.value) || 0),
                          )
                        }
                        placeholder="0"
                        className="h-10 font-bold text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      Ongkos Kirim
                    </Label>
                    <PoMoneyInput
                      currency={poCurrency}
                      value={ongkir}
                      onChange={setOngkir}
                      className="h-10"
                      inputClassName="text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      PPh (Potong-Pungut)
                    </Label>
                    <Select
                      value={pphType || "none"}
                      onValueChange={(val) => {
                        if (val === "none") {
                          setPphType("");
                          setPphRate(0);
                        } else {
                          setPphType(val);
                          setPphRate(getPphDefaultRate(val));
                        }
                      }}
                    >
                      <SelectTrigger className="h-10 font-bold text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Tanpa PPh</SelectItem>
                        {PPH_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {pphType && (
                    <div className="space-y-2">
                      <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                        Nilai PPh
                      </Label>
                      <div className="flex items-center gap-2">
                        <div className="flex h-10 shrink-0 overflow-hidden rounded-md border border-input">
                          <button
                            type="button"
                            onClick={() => setPphMode("percent")}
                            className={cn(
                              "px-2.5 text-xs font-bold transition-colors",
                              pphMode === "percent"
                                ? "bg-primary text-primary-foreground"
                                : "bg-background text-muted-foreground hover:bg-muted",
                            )}
                          >
                            %
                          </button>
                          <button
                            type="button"
                            onClick={() => setPphMode("amount")}
                            className={cn(
                              "px-2.5 text-xs font-bold border-l border-input transition-colors",
                              pphMode === "amount"
                                ? "bg-primary text-primary-foreground"
                                : "bg-background text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {currencySymbol}
                          </button>
                        </div>
                        {pphMode === "percent" ? (
                          <Input
                            type="number"
                            min={0}
                            step={0.1}
                            value={pphRate}
                            onChange={(e) =>
                              setPphRate(
                                Math.max(0, Number(e.target.value) || 0),
                              )
                            }
                            className="h-10 font-bold text-sm"
                          />
                        ) : (
                          <PoMoneyInput
                            currency={poCurrency}
                            value={pphAmountManual}
                            onChange={setPphAmountManual}
                            className="h-10 flex-1"
                            inputClassName="text-sm"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <p className="text-[9px] text-muted-foreground font-medium">
                  PPh adalah pajak potong-pungut — dipotong dari pembayaran ke
                  vendor, tidak mengurangi Total PO di ringkasan bawah.
                </p>
              </div>

              {isEdit && (
                <div className="md:col-span-2 space-y-2">
                  <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                    Alasan Revisi <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    value={revisionReason}
                    onChange={(e) => setRevisionReason(e.target.value)}
                    placeholder="Mis. vendor revisi harga, tambah item dari PR baru, koreksi qty..."
                    className="resize-none min-h-20 font-medium text-sm"
                  />
                  <p className="text-[9px] text-muted-foreground font-medium">
                    Dicatat di Riwayat PO dan dikirim ke PIC PO.
                  </p>
                </div>
              )}

              {/* Approval Template */}
              <div className="md:col-span-2 space-y-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Alur Approval <span className="text-destructive">*</span>
                </Label>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-muted-foreground mt-2.5 shrink-0" />
                  <div className="flex-1 space-y-3">
                    <Popover
                      open={templatePopoverOpen}
                      onOpenChange={setTemplatePopoverOpen}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start gap-2 h-10 font-bold text-xs"
                        >
                          <Search className="h-3.5 w-3.5 text-muted-foreground" />
                          <span
                            className={cn(
                              selectedTemplateId
                                ? "text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {selectedTemplateId
                              ? (templates.find(
                                  (t) => t.id.toString() === selectedTemplateId,
                                )?.name ?? "Pilih template...")
                              : "Pilih template approval..."}
                          </span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-0" align="start">
                        <Command>
                          <CommandInput
                            placeholder="Cari template..."
                            value={templateSearch}
                            onValueChange={setTemplateSearch}
                          />
                          <CommandList>
                            {templates.length === 0 ? (
                              <CommandEmpty>
                                Tidak ada template untuk PO.
                              </CommandEmpty>
                            ) : (
                              templates
                                .filter((t) =>
                                  t.name
                                    .toLowerCase()
                                    .includes(templateSearch.toLowerCase()),
                                )
                                .map((t) => (
                                  <CommandItem
                                    key={t.id}
                                    value={t.name}
                                    onSelect={() => {
                                      setSelectedTemplateId(t.id.toString());
                                      setTemplatePopoverOpen(false);
                                    }}
                                    className="text-xs font-bold gap-2"
                                  >
                                    <CheckCircle2
                                      className={cn(
                                        "h-3.5 w-3.5",
                                        selectedTemplateId === t.id.toString()
                                          ? "text-primary"
                                          : "text-transparent",
                                      )}
                                    />
                                    {t.name}
                                  </CommandItem>
                                ))
                            )}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {/* Step preview */}
                    {selectedTemplateId &&
                      (() => {
                        const tpl = templates.find(
                          (t) => t.id.toString() === selectedTemplateId,
                        );
                        if (!tpl) return null;
                        const sorted = [...(tpl.steps || [])].sort(
                          (a: any, b: any) => a.step_order - b.step_order,
                        );
                        return (
                          <div className="flex flex-col gap-1">
                            {sorted.map((step: any, i: number) => {
                              const isRequester =
                                step.approver_type === "requester";
                              const displayName = isRequester
                                ? userProfile?.nama || "Anda"
                                : step.profiles?.nama || "—";
                              return (
                                <div
                                  key={i}
                                  className="flex items-center gap-2"
                                >
                                  <div
                                    className={cn(
                                      "h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0",
                                      i === 0
                                        ? "bg-success text-success-foreground"
                                        : "bg-primary/10 text-primary",
                                    )}
                                  >
                                    {i + 1}
                                  </div>
                                  <span className="text-[10px] font-bold text-foreground">
                                    {displayName}
                                  </span>
                                  {isRequester && (
                                    <Badge
                                      variant="outline"
                                      className="text-[8px] font-bold uppercase px-1 py-0"
                                    >
                                      Requester
                                    </Badge>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                  </div>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="p-4 bg-muted/40 border border-border rounded-xl space-y-2">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                <span>
                  {isNonPr ? "Jenis PO" : isSo ? "Sumber SO" : "Sumber PR"}
                </span>
                <span className="text-foreground font-mono text-right">
                  {isNonPr
                    ? `Non-PR${prReferensi.trim() ? ` — Ref: ${prReferensi.trim()}` : ""}`
                    : isSo
                      ? `${selectedSo?.so_kode || "-"} — ${selectedSo?.customer?.customer_name || ""}`
                      : selectedPrs.map((pr) => pr.pr_kode).join(", ")}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                <span>Jumlah Item</span>
                <span className="text-foreground">
                  {poItems.filter((i) => i.selected).length} item
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                <span>Vendor</span>
                <span className="text-foreground">
                  {selectedVendor?.vendor_name || "-"}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                <span>Mata Uang</span>
                <span className="text-foreground">{poCurrency}</span>
              </div>

              <div className="space-y-1.5 border-t border-border pt-2">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="text-foreground">
                    {maskedPriceText(
                      canViewPrice,
                      formatCurrency(poTax.subtotal),
                    )}
                  </span>
                </div>
                {poTax.diskonAmount > 0 && (
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                    <span>
                      Diskon
                      {diskonMode === "percent" ? ` (${diskonValue}%)` : ""}
                    </span>
                    <span className="text-destructive">
                      -{" "}
                      {maskedPriceText(
                        canViewPrice,
                        formatCurrency(poTax.diskonAmount),
                      )}
                    </span>
                  </div>
                )}
                {(ppnMode === "percent"
                  ? ppnRate > 0
                  : ppnAmountManual > 0) && (
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                    <span>
                      PPN (
                      {ppnMode === "percent" ? `${ppnRate}%` : "nominal manual"}
                      ){hargaTermasukPajak ? " — sudah termasuk harga" : ""}
                    </span>
                    <span className="text-foreground">
                      {hargaTermasukPajak
                        ? "-"
                        : `+ ${maskedPriceText(canViewPrice, formatCurrency(poTax.ppnAmount))}`}
                    </span>
                  </div>
                )}
                {ongkir > 0 && (
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                    <span>Ongkos Kirim</span>
                    <span className="text-foreground">
                      + {maskedPriceText(canViewPrice, formatCurrency(ongkir))}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-sm font-black uppercase pt-2 border-t border-border">
                <span>Total PO</span>
                <span className="text-primary">
                  {maskedPriceText(canViewPrice, formatCurrency(poTax.totalPo))}
                </span>
              </div>

              {pphType && (
                <>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground pt-1">
                    <span>
                      PPh {getPphTypeLabel(pphType)} (
                      {pphMode === "percent" ? `${pphRate}%` : "nominal manual"}
                      )
                    </span>
                    <span className="text-destructive">
                      -{" "}
                      {maskedPriceText(
                        canViewPrice,
                        formatCurrency(poTax.pphAmount),
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-black uppercase pt-1.5 border-t border-dashed border-border">
                    <span>Dibayar ke Vendor</span>
                    <span className="text-foreground">
                      {maskedPriceText(
                        canViewPrice,
                        formatCurrency(poTax.dibayarKeVendor),
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                className="gap-2 font-bold text-xs"
                onClick={() => setStep(2)}
                disabled={submitting}
              >
                <ArrowLeft className="h-4 w-4" /> Kembali
              </Button>
              <Button
                className="gap-2 font-bold text-xs uppercase px-6"
                onClick={handleSubmit}
                disabled={
                  submitting ||
                  !poKode.trim() ||
                  !selectedTemplateId ||
                  (isEdit && !revisionReason.trim())
                }
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    {isEdit
                      ? `Simpan Revisi (Rev. ${nextRevision})`
                      : "Buat Purchase Order"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </Content>
      )}

      <MRSignatureDialog
        open={isSignatureOpen}
        onOpenChange={setIsSignatureOpen}
        onConfirm={handleConfirmSignature}
      />
    </>
  );
}
