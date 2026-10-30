"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  Loader2,
  ReceiptText,
  ArrowRight,
  UsersRound,
  ShieldCheck,
  CheckCircle2,
  Circle,
  AlertCircle,
  Phone,
  Mail,
  MapPin,
  User,
  X,
  Truck,
  ShoppingCart,
  FileText,
  CalendarClock,
  Info,
  Lock,
  Pencil,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createSoReguler,
  updateSoReguler,
} from "@/services/so-reguler-actions";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { cn, toYmdLocal } from "@/lib/utils";
import {
  SO_KATEGORI_OPTIONS,
  canCreateSO,
  canEditSO,
  fetchSoItemFulfillment,
  soItemMinQty,
} from "@/lib/so-reguler";
import {
  diffSoSnapshots,
  type SoSnapshot,
  type SoSnapshotItem,
} from "@/lib/so-revision";
import {
  SoItemTable,
  SoFormItem,
  SoItemLock,
  soItemQtyError,
  stockCoverage,
  usePartStock,
} from "@/components/so-reguler/so-item-table";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useGoBack } from "@/hooks/use-go-back";

type CustomerOption = {
  id: number;
  customer_no: string;
  customer_name: string;
  contact_name: string | null;
  pic_name: string | null;
  telephone: string | null;
  email: string | null;
  address: string | null;
};

type KodeStatus = "idle" | "checking" | "available" | "taken";

const fmt = (n: number) => n.toLocaleString("id-ID");

function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return toYmdLocal(new Date(y, m - 1, d + days));
}

function daysBetween(fromYmd: string, toYmd: string) {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000,
  );
}

function formatLongDate(ymd: string) {
  if (!ymd) return "-";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function SectionTitle({
  step,
  title,
  done,
  hint,
}: {
  step: number;
  title: string;
  done: boolean;
  hint?: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors",
          done
            ? "bg-success text-success-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : step}
      </div>
      <div>
        <h2 className="text-sm font-bold leading-6 text-foreground">{title}</h2>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function FieldError({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <p className="flex items-center gap-1 text-[10px] font-semibold text-destructive">
      <AlertCircle className="h-3 w-3" /> {children}
    </p>
  );
}

const CUSTOMER_FIELDS =
  "id, customer_no, customer_name, contact_name, pic_name, telephone, email, address";

/**
 * Form SO Reguler. Tanpa `editSoId` = Buat SO; dengan `editSoId` = Edit SO
 * (marketing/moderator, lihat updateSoReguler). Saat edit, item yang sudah
 * dipakai PO/DO dikunci (qty minimum, tidak bisa dihapus) dan customer
 * dikunci kalau sudah ada DO.
 */
export function SoForm({ editSoId }: { editSoId?: number }) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const isEdit = !!editSoId;
  const router = useRouter();
  const goBack = useGoBack("/so-reguler/so");
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [userProfile, setUserProfile] = useState<any>(null);
  const [lastSoKode, setLastSoKode] = useState<string | null>(null);

  // Form
  const [soKode, setSoKode] = useState("");
  const [customerPoNo, setCustomerPoNo] = useState("");
  const [customerPoDate, setCustomerPoDate] = useState("");
  const [customerPoReceivedDate, setCustomerPoReceivedDate] = useState("");
  const [marketingName, setMarketingName] = useState("");
  const [kategori, setKategori] = useState("");
  const [soTanggal, setSoTanggal] = useState(toYmdLocal());
  const [soDueDate, setSoDueDate] = useState("");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [remarks, setRemarks] = useState("");
  const [items, setItems] = useState<SoFormItem[]>([]);

  // Cek nomor SO duplikat secara langsung
  const [debouncedKode] = useDebounce(soKode.trim(), 400);
  const [kodeStatus, setKodeStatus] = useState<KodeStatus>("idle");

  // Customer picker
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedCustomerSearch] = useDebounce(customerSearch, 300);
  const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [activeSoCount, setActiveSoCount] = useState<number | null>(null);

  // Edit SO
  const [original, setOriginal] = useState<SoSnapshot | null>(null);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState("");
  const [locks, setLocks] = useState<Record<number, SoItemLock>>({});
  const [customerLockedBy, setCustomerLockedBy] = useState<string[]>([]);
  const [reason, setReason] = useState("");

  const stock = usePartStock(items.map((i) => i.part_id));

  useEffect(() => {
    const init = async () => {
      setInitialLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*, cabang(id, nama_cabang), roles:user_roles(roles(name))")
        .eq("id", user.id)
        .single();

      const roleNames = (profile?.roles as any[])?.map(
        (r: any) => r.roles?.name,
      );
      if (
        profile &&
        !(isEdit ? canEditSO(roleNames) : canCreateSO(roleNames))
      ) {
        toast.error(
          `Akses ditolak. Role Anda tidak diizinkan ${isEdit ? "mengedit" : "membuat"} SO.`,
        );
        router.push(isEdit ? `/so-reguler/so/${editSoId}` : "/so-reguler/so");
        return;
      }

      if (isEdit) {
        const ok = await loadForEdit(editSoId!);
        if (!ok) {
          router.push(`/so-reguler/so/${editSoId}`);
          return;
        }
        setUserProfile(profile);
        setInitialLoading(false);
        return;
      }

      // Referensi penomoran manual: nomor SO terakhir yang dibuat.
      const { data: last } = await supabase
        .from("so_reguler")
        .select("so_kode")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setLastSoKode(last?.so_kode ?? null);

      setUserProfile(profile);
      setInitialLoading(false);
    };
    init();
  }, []);

  // Muat SO + batas item dari PO/DO yang sudah ada. false = tidak bisa diedit.
  const loadForEdit = async (soId: number) => {
    const { data: so } = await supabase
      .from("so_reguler")
      .select(
        `*, customer:customers!customer_id(${CUSTOMER_FIELDS}), so_reguler_items(id, part_id, part_number, part_name, satuan, qty, remarks)`,
      )
      .eq("id", soId)
      .maybeSingle();
    if (!so) {
      toast.error("SO Reguler tidak ditemukan.");
      return false;
    }
    if (so.so_status === "cancelled") {
      toast.error("SO yang sudah dibatalkan tidak bisa diedit.");
      return false;
    }
    const soItems: SoSnapshotItem[] = [...(so.so_reguler_items || [])].sort(
      (a: any, b: any) => a.id - b.id,
    );
    const ids = soItems.map((i) => i.id);
    if (new Set(soItems.map((i) => i.part_id)).size !== soItems.length) {
      toast.error(
        "SO ini punya barang yang sama di lebih dari satu baris, tidak bisa diedit lewat form. Hubungi moderator.",
      );
      return false;
    }

    const [
      fulfillment,
      { data: poRefs },
      { data: doRefs },
      { data: activeDos },
    ] = await Promise.all([
      fetchSoItemFulfillment(supabase, ids),
      // Referensi mana pun (termasuk PO rejected / DO cancelled) menahan
      // item dari penghapusan (FK so_item_id).
      ids.length
        ? supabase.from("po_items").select("so_item_id").in("so_item_id", ids)
        : Promise.resolve({ data: [] as any[] }),
      ids.length
        ? supabase
            .from("do_reguler_items")
            .select("so_item_id")
            .in("so_item_id", ids)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("do_reguler")
        .select("do_kode")
        .eq("so_id", soId)
        .neq("status", "cancelled"),
    ]);
    const referenced = new Set<number>(
      [...(poRefs || []), ...(doRefs || [])].map((r: any) => r.so_item_id),
    );
    const nextLocks: Record<number, SoItemLock> = {};
    for (const i of soItems) {
      const f = fulfillment.get(i.id);
      if (!referenced.has(i.id) && !f) continue;
      nextLocks[i.part_id] = {
        minQty: soItemMinQty(f),
        qtyPo: f?.qtyPo ?? 0,
        qtyDo: f?.qtyDo ?? 0,
        referenced: referenced.has(i.id),
      };
    }

    setOriginal({
      so_kode: so.so_kode,
      so_tanggal: so.so_tanggal,
      so_due_date: so.so_due_date,
      kategori: so.kategori,
      customer_id: so.customer_id,
      customer_name: so.customer?.customer_name ?? null,
      customer_po_no: so.customer_po_no,
      customer_po_date: so.customer_po_date,
      customer_po_received_date: so.customer_po_received_date,
      marketing_name: so.marketing_name,
      remarks: so.remarks,
      so_status: so.so_status,
      so_revision: so.so_revision ?? 0,
      items: soItems,
    });
    setExpectedUpdatedAt(so.updated_at);
    setLocks(nextLocks);
    setCustomerLockedBy(
      Array.from(new Set((activeDos || []).map((d: any) => d.do_kode))),
    );
    setSoKode(so.so_kode || "");
    setCustomerPoNo(so.customer_po_no || "");
    setCustomerPoDate(so.customer_po_date || "");
    setCustomerPoReceivedDate(so.customer_po_received_date || "");
    setMarketingName(so.marketing_name || "");
    setKategori(so.kategori || "");
    setSoTanggal(so.so_tanggal || toYmdLocal());
    setSoDueDate(so.so_due_date || "");
    setCustomer((so.customer as CustomerOption) || null);
    setRemarks(so.remarks || "");
    setItems(
      soItems.map((i) => ({
        id: i.id,
        part_id: i.part_id,
        part_number: i.part_number,
        part_name: i.part_name,
        satuan: i.satuan,
        qty: i.qty,
        remarks: i.remarks || "",
      })),
    );
    return true;
  };

  useEffect(() => {
    if (!debouncedKode) {
      setKodeStatus("idle");
      return;
    }
    // Nomor SO sendiri (saat edit) tidak dianggap duplikat.
    if (isEdit && debouncedKode === original?.so_kode) {
      setKodeStatus("available");
      return;
    }
    let cancelled = false;
    setKodeStatus("checking");
    let q = supabase
      .from("so_reguler")
      .select("id")
      .eq("so_kode", debouncedKode);
    if (isEdit) q = q.neq("id", editSoId!);
    q.maybeSingle().then(({ data }) => {
      if (!cancelled) setKodeStatus(data ? "taken" : "available");
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedKode, original?.so_kode]);

  // Search customer (server-side, dibatasi 20 hasil). SO reguler hanya untuk
  // customer non-consignment, sama seperti DO Reguler.
  useEffect(() => {
    if (!customerPopoverOpen) return;
    let cancelled = false;
    const run = async () => {
      setCustomerLoading(true);
      let q = supabase
        .from("customers")
        .select(CUSTOMER_FIELDS)
        .eq("is_active", true)
        .in("customer_type", ["non_consignment", "both"])
        .order("customer_name")
        .limit(20);
      const term = debouncedCustomerSearch.trim().replace(/["\\]/g, "\\$&");
      if (term)
        q = q.or(
          `customer_name.ilike."%${term}%",customer_no.ilike."%${term}%"`,
        );
      const { data } = await q;
      if (cancelled) return;
      setCustomers((data as CustomerOption[]) || []);
      setCustomerLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [debouncedCustomerSearch, customerPopoverOpen]);

  // Info SO yang masih berjalan untuk customer terpilih.
  useEffect(() => {
    setActiveSoCount(null);
    if (!customer) return;
    let cancelled = false;
    let q = supabase
      .from("so_reguler")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customer.id)
      .in("so_status", ["open", "partial"]);
    if (isEdit) q = q.neq("id", editSoId!);
    q.then(({ count }) => {
      if (!cancelled) setActiveSoCount(count ?? 0);
    });
    return () => {
      cancelled = true;
    };
  }, [customer?.id]);

  // Snapshot isian form saat ini (bentuk sama dgn so_reguler_revisions) untuk
  // dirty-check & ringkasan perubahan di mode edit. Item baru diberi id negatif.
  const draft: SoSnapshot | null = original
    ? {
        ...original,
        so_kode: soKode.trim(),
        so_tanggal: soTanggal || null,
        so_due_date: soDueDate || null,
        kategori: kategori || null,
        customer_id: customer?.id ?? 0,
        customer_name: customer?.customer_name ?? null,
        customer_po_no: customerPoNo.trim() || null,
        customer_po_date: customerPoDate || null,
        customer_po_received_date: customerPoReceivedDate || null,
        marketing_name: marketingName.trim().toUpperCase() || null,
        remarks: remarks.trim() || null,
        items: items.map((i, idx) => ({
          id: i.id ?? -(idx + 1),
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          satuan: i.satuan,
          qty: i.qty,
          remarks: i.remarks?.trim() || null,
        })),
      }
    : null;
  const diff = original && draft ? diffSoSnapshots(original, draft) : null;
  const changeCount = diff
    ? diff.header.length +
      diff.added.length +
      diff.removed.length +
      diff.changed.length
    : 0;

  const isDirty = isEdit
    ? changeCount > 0
    : !!soKode.trim() ||
      !!customerPoNo.trim() ||
      !!customerPoDate ||
      !!customerPoReceivedDate ||
      !!marketingName.trim() ||
      !!kategori ||
      !!customer ||
      items.length > 0 ||
      !!remarks.trim();

  // Peringatan saat meninggalkan halaman dengan isian belum disimpan.
  useEffect(() => {
    if (!isDirty || loading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, loading]);

  const invalidQtyItems = items.filter(
    (i) => soItemQtyError(i, locks[i.part_id]) !== null,
  );
  const dueBeforeDate = !!soDueDate && !!soTanggal && soDueDate < soTanggal;
  const poReceivedBeforeCreated =
    !!customerPoDate &&
    !!customerPoReceivedDate &&
    customerPoReceivedDate < customerPoDate;

  const checks = {
    kode: !!soKode.trim() && kodeStatus !== "taken",
    customer: !!customer,
    tanggal: !!soTanggal && !dueBeforeDate && !poReceivedBeforeCreated,
    kategori: !!kategori,
    items: items.length > 0 && invalidQtyItems.length === 0,
  };
  const doneCount = Object.values(checks).filter(Boolean).length;
  const totalChecks = Object.keys(checks).length;
  const canSubmit = doneCount === totalChecks && kodeStatus !== "checking";

  const totalQty = items.reduce((s, i) => s + (i.qty > 0 ? i.qty : 0), 0);
  const coverage = items.reduce(
    (acc, i) => {
      const c = stockCoverage(i.qty, stock[i.part_id]);
      if (c) acc[c] += 1;
      else acc.loading += 1;
      return acc;
    },
    { full: 0, partial: 0, none: 0, loading: 0 },
  );

  const validateForm = () => {
    if (!soKode.trim()) return "Nomor Dokumen harus diisi";
    if (kodeStatus === "taken")
      return "Nomor SO sudah digunakan. Gunakan nomor lain.";
    if (!soTanggal) return "Tanggal SO harus diisi";
    if (dueBeforeDate) return "Deadline tidak boleh sebelum tanggal SO";
    if (poReceivedBeforeCreated)
      return "Tanggal PO diterima tidak boleh sebelum tanggal PO dibuat";
    if (!kategori) return "Kategori SO harus dipilih";
    if (!customer) return "Customer harus dipilih";
    if (items.length === 0) return "Daftar barang tidak boleh kosong";
    if (invalidQtyItems.length > 0)
      return `Qty tidak valid (harus bilangan bulat > 0 dan tidak di bawah qty yang sudah PO/DO). Periksa: ${invalidQtyItems
        .map((i) => i.part_number)
        .join(", ")}`;
    if (isEdit && changeCount === 0) return "Belum ada perubahan.";
    return null;
  };

  const handleReview = () => {
    setSubmitted(true);
    const error = validateForm();
    if (error) {
      toast.error(error);
      return;
    }
    setConfirmOpen(true);
  };

  const handleUpdate = async () => {
    if (!reason.trim()) {
      toast.error("Alasan perubahan wajib diisi.");
      return;
    }
    setLoading(true);
    const result = await updateSoReguler(editSoId!, {
      expected_updated_at: expectedUpdatedAt,
      reason: reason.trim(),
      so_kode: soKode.trim(),
      so_tanggal: soTanggal,
      so_due_date: soDueDate || null,
      kategori: kategori || null,
      customer_po_no: customerPoNo.trim(),
      customer_po_date: customerPoDate || null,
      customer_po_received_date: customerPoReceivedDate || null,
      marketing_name: marketingName.trim(),
      customer_id: customer!.id,
      remarks: remarks.trim(),
      items: items.map((item) => ({
        id: item.id,
        part_id: item.part_id,
        part_number: item.part_number,
        part_name: item.part_name,
        satuan: item.satuan,
        qty: item.qty,
        remarks: item.remarks?.trim() || undefined,
      })),
    });
    if (result.error) {
      toast.error(result.error);
      setLoading(false);
      return;
    }
    toast.success(
      `SO ${soKode.trim()} diperbarui (revisi ke-${result.revision_no})`,
    );
    router.push(`/so-reguler/so/${editSoId}`);
  };

  const handleSubmit = async () => {
    if (isEdit) return handleUpdate();
    setLoading(true);
    try {
      const result = await createSoReguler({
        so_kode: soKode.trim(),
        so_tanggal: soTanggal,
        so_due_date: soDueDate || null,
        kategori,
        customer_po_no: customerPoNo.trim() || undefined,
        customer_po_date: customerPoDate || null,
        customer_po_received_date: customerPoReceivedDate || null,
        marketing_name: marketingName.trim() || undefined,
        customer_id: customer!.id,
        remarks: remarks.trim() || undefined,
        items: items.map((item) => ({
          part_id: item.part_id,
          part_number: item.part_number,
          part_name: item.part_name,
          satuan: item.satuan,
          qty: item.qty,
          remarks: item.remarks?.trim() || undefined,
        })),
      });
      if (result.error) throw new Error(result.error);
      toast.success(`SO ${soKode.trim()} berhasil dibuat`);
      router.push(`/so-reguler/so/${result.data.id}`);
    } catch (err: any) {
      toast.error(err.message);
      setConfirmOpen(false);
      setLoading(false);
    }
  };

  const handleBack = async () => {
    if (
      isDirty &&
      !(await confirm({
        title: "Tinggalkan halaman ini?",
        description: isEdit
          ? "Perubahan SO belum disimpan dan akan hilang."
          : "Isian SO belum disimpan dan akan hilang.",
        confirmText: "Tinggalkan",
        destructive: true,
      }))
    )
      return;
    goBack();
  };

  if (initialLoading) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const today = toYmdLocal();
  const dueInDays = soDueDate ? daysBetween(today, soDueDate) : null;
  const contactName = customer?.pic_name || customer?.contact_name;

  return (
    <>
      {confirmDialog}
      {/* Header */}
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={handleBack}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
              {isEdit ? (
                <Pencil className="h-5 w-5" />
              ) : (
                <ReceiptText className="h-5 w-5" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                {isEdit
                  ? `Edit SO ${original?.so_kode ?? ""}`
                  : "Buat SO Reguler"}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isEdit
                  ? `Revisi ke-${(original?.so_revision ?? 0) + 1} · ${
                      changeCount > 0
                        ? `${changeCount} perubahan belum disimpan`
                        : "belum ada perubahan"
                    }`
                  : "Sales Order ke customer — langsung aktif tanpa approval"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {doneCount}/{totalChecks} isian wajib lengkap
            </span>
            <div className="flex gap-1">
              {Object.values(checks).map((ok, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 w-6 rounded-full transition-colors",
                    ok ? "bg-success" : "bg-muted",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </Content>

      {/* Kolom kiri: form */}
      <div className="col-span-12 min-w-0 space-y-4 md:space-y-6 xl:col-span-8">
        {/* 1. Dokumen */}
        <Content>
          <SectionTitle
            step={1}
            title="Informasi Dokumen"
            done={checks.kode && checks.tanggal && checks.kategori}
            hint="Nomor SO diisi manual, tidak boleh sama dengan SO lain."
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Nomor SO <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Input
                  placeholder="Contoh: SO-2610-001"
                  className={cn(
                    "h-9 pr-8 font-semibold uppercase",
                    (kodeStatus === "taken" || (submitted && !soKode.trim())) &&
                      "border-destructive focus-visible:ring-destructive",
                    kodeStatus === "available" && "border-success",
                  )}
                  value={soKode}
                  onChange={(e) => setSoKode(e.target.value.toUpperCase())}
                  autoFocus={!isEdit}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  {kodeStatus === "checking" && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                  {kodeStatus === "available" && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  )}
                  {kodeStatus === "taken" && (
                    <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                  )}
                </span>
              </div>
              <FieldError show={kodeStatus === "taken"}>
                Nomor sudah dipakai SO lain
              </FieldError>
              <FieldError show={submitted && !soKode.trim()}>
                Nomor SO wajib diisi
              </FieldError>
              {!isEdit && kodeStatus !== "taken" && lastSoKode && (
                <p className="text-[10px] text-muted-foreground">
                  SO terakhir:{" "}
                  <span className="font-semibold text-foreground">
                    {lastSoKode}
                  </span>
                </p>
              )}
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs font-semibold">
                  Nomor PO{" "}
                  <span className="font-normal text-muted-foreground">
                    (opsional)
                  </span>
                </Label>
                <Input
                  placeholder="Nomor PO dari customer"
                  className="h-9 font-semibold uppercase"
                  value={customerPoNo}
                  onChange={(e) =>
                    setCustomerPoNo(e.target.value.toUpperCase())
                  }
                  maxLength={100}
                />
                <p className="text-[10px] text-muted-foreground">
                  Keterangan saja, tidak terhubung ke data PO.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Tanggal SO <span className="text-destructive">*</span>
              </Label>
              <DatePickerString
                className="h-9 w-full text-xs font-semibold"
                value={soTanggal}
                onChange={setSoTanggal}
              />
              {soTanggal && soTanggal !== today && (
                <button
                  type="button"
                  onClick={() => setSoTanggal(today)}
                  className="text-[10px] font-medium text-primary hover:underline"
                >
                  Kembalikan ke hari ini
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  Deadline{" "}
                  <span className="font-normal text-muted-foreground">
                    (opsional)
                  </span>
                </Label>
                {soDueDate && (
                  <button
                    type="button"
                    onClick={() => setSoDueDate("")}
                    className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Kosongkan
                  </button>
                )}
              </div>
              <DatePickerString
                className={cn(
                  "h-9 w-full text-xs font-semibold",
                  dueBeforeDate && "border-destructive",
                )}
                value={soDueDate}
                onChange={setSoDueDate}
                placeholder="Tanpa deadline"
              />
              <div className="flex flex-wrap gap-1">
                {[7, 14, 30].map((d) => {
                  const target = addDays(soTanggal || today, d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSoDueDate(target)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                        soDueDate === target
                          ? "border-primary bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      +{d} hari
                    </button>
                  );
                })}
              </div>
              <FieldError show={dueBeforeDate}>
                Deadline sebelum tanggal SO
              </FieldError>
              {!dueBeforeDate && dueInDays !== null && (
                <p
                  className={cn(
                    "text-[10px] font-medium",
                    dueInDays < 0
                      ? "text-destructive"
                      : dueInDays <= 3
                        ? "text-warning"
                        : "text-muted-foreground",
                  )}
                >
                  {dueInDays < 0
                    ? `Sudah lewat ${Math.abs(dueInDays)} hari`
                    : dueInDays === 0
                      ? "Jatuh tempo hari ini"
                      : `${dueInDays} hari lagi dari hari ini`}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Nama Marketing{" "}
                <span className="font-normal text-muted-foreground">
                  (opsional)
                </span>
              </Label>
              <Input
                placeholder="Nama marketing"
                className="h-9 font-semibold uppercase"
                value={marketingName}
                onChange={(e) => setMarketingName(e.target.value.toUpperCase())}
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  Tgl PO Dibuat Customer{" "}
                  <span className="font-normal text-muted-foreground">
                    (opsional)
                  </span>
                </Label>
                {customerPoDate && (
                  <button
                    type="button"
                    onClick={() => setCustomerPoDate("")}
                    className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Kosongkan
                  </button>
                )}
              </div>
              <DatePickerString
                className="h-9 w-full text-xs font-semibold"
                value={customerPoDate}
                onChange={setCustomerPoDate}
                placeholder="Pilih tanggal"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  Tgl PO Diterima via Email{" "}
                  <span className="font-normal text-muted-foreground">
                    (opsional)
                  </span>
                </Label>
                {customerPoReceivedDate && (
                  <button
                    type="button"
                    onClick={() => setCustomerPoReceivedDate("")}
                    className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Kosongkan
                  </button>
                )}
              </div>
              <DatePickerString
                className={cn(
                  "h-9 w-full text-xs font-semibold",
                  poReceivedBeforeCreated && "border-destructive",
                )}
                value={customerPoReceivedDate}
                onChange={setCustomerPoReceivedDate}
                placeholder="Pilih tanggal"
              />
              <FieldError show={poReceivedBeforeCreated}>
                Sebelum tanggal PO dibuat customer
              </FieldError>
            </div>
          </div>
          <div className="mt-4 space-y-1.5">
            <Label className="text-xs font-semibold">
              Kategori <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {/* SO lama bisa berkategori gaya MR -- boleh dipertahankan. */}
              {[
                ...(original?.kategori &&
                !SO_KATEGORI_OPTIONS.includes(original.kategori)
                  ? [original.kategori]
                  : []),
                ...SO_KATEGORI_OPTIONS,
              ].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKategori(k)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
                    kategori === k
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted",
                    submitted && !kategori && "border-destructive",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
            <FieldError show={submitted && !kategori}>
              Kategori wajib dipilih
            </FieldError>
          </div>
        </Content>

        {/* 2. Customer */}
        <Content>
          <SectionTitle
            step={2}
            title="Customer"
            done={checks.customer}
            hint="Hanya customer reguler (non-consignment) yang aktif."
          />
          <Popover
            open={customerPopoverOpen}
            onOpenChange={setCustomerPopoverOpen}
          >
            <PopoverAnchor asChild>
              <div>
                {customer ? (
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                          <UsersRound className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold uppercase text-foreground">
                            {customer.customer_name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            No. {customer.customer_no}
                          </p>
                        </div>
                      </div>
                      {customerLockedBy.length === 0 && (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setCustomerPopoverOpen(true)}
                          >
                            Ganti
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setCustomer(null)}
                            title="Hapus pilihan customer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                      {customerLockedBy.length > 0 && (
                        <span
                          className="flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground"
                          title={`Sudah ada DO: ${customerLockedBy.join(", ")}`}
                        >
                          <Lock className="h-3 w-3" /> Terkunci
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <User className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {contactName || "PIC belum diisi"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {customer.telephone || "-"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {customer.email || "-"}
                        </span>
                      </div>
                      <div className="flex items-start gap-1.5 text-muted-foreground sm:col-span-2">
                        <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="line-clamp-2">
                          {customer.address || "Alamat belum diisi"}
                        </span>
                      </div>
                    </div>
                    {customerLockedBy.length > 0 && (
                      <p className="mt-3 flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
                        <Lock className="h-3.5 w-3.5 shrink-0" />
                        Customer tidak bisa diganti karena SO sudah dikirim
                        lewat DO {customerLockedBy.join(", ")}.
                      </p>
                    )}
                    {activeSoCount !== null && activeSoCount > 0 && (
                      <p className="mt-3 flex items-center gap-1.5 rounded-md bg-primary/5 px-2.5 py-1.5 text-[11px] text-primary">
                        <Info className="h-3.5 w-3.5 shrink-0" />
                        Customer ini punya {activeSoCount} SO yang masih
                        berjalan — pastikan pesanan ini bukan duplikat.
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCustomerPopoverOpen(true)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border-2 border-dashed px-4 py-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5",
                      submitted && !customer
                        ? "border-destructive/50"
                        : "border-border",
                    )}
                  >
                    <UsersRound className="h-6 w-6 text-muted-foreground/60" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Pilih customer
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Cari berdasarkan nama atau nomor customer
                      </p>
                    </div>
                  </button>
                )}
              </div>
            </PopoverAnchor>
            <PopoverContent
              className="w-[calc(100vw-2rem)] max-w-md overflow-hidden p-0"
              align="start"
            >
              <div className="border-b bg-muted/40 p-2">
                <Input
                  placeholder="Cari nama / nomor customer..."
                  className="h-9 text-xs"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {customerLoading && customers.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat...
                  </div>
                ) : (
                  customers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCustomer(c);
                        setCustomerPopoverOpen(false);
                        setCustomerSearch("");
                      }}
                      className={cn(
                        "group mb-1 flex w-full items-center justify-between rounded-lg p-2.5 text-left hover:bg-muted",
                        customer?.id === c.id && "bg-primary/5",
                      )}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-xs font-bold uppercase">
                          {c.customer_name}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {c.customer_no}
                          {(c.pic_name || c.contact_name) &&
                            ` · ${c.pic_name || c.contact_name}`}
                        </span>
                      </div>
                      {customer?.id === c.id ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-100" />
                      )}
                    </button>
                  ))
                )}
                {!customerLoading && customers.length === 0 && (
                  <div className="p-6 text-center text-xs italic text-muted-foreground">
                    Customer tidak ditemukan.
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
          <FieldError show={submitted && !customer}>
            Customer wajib dipilih
          </FieldError>
        </Content>

        {/* 3. Barang */}
        <Content>
          <SectionTitle
            step={3}
            title="Barang yang Dipesan"
            done={checks.items}
            hint="Stok & status pemenuhan tampil otomatis untuk tiap barang."
          />
          <SoItemTable
            items={items}
            onItemsChange={setItems}
            stock={stock}
            showErrors={submitted}
            locks={isEdit ? locks : undefined}
          />
          {isEdit && Object.values(locks).some((l) => l.referenced) && (
            <p className="mt-2 flex items-start gap-1.5 text-[10px] text-muted-foreground">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              Barang yang sudah dipakai PO/DO tidak bisa dihapus, dan qty-nya
              tidak bisa diturunkan di bawah qty yang sudah di-PO + dikirim dari
              stok. Supaya bisa diturunkan lagi, tolak/kurangi PO atau batalkan
              DO terkait dulu.
            </p>
          )}
        </Content>

        {/* 4. Keterangan */}
        <Content>
          <SectionTitle
            step={4}
            title="Keterangan"
            done={!!remarks.trim()}
            hint="Opsional — catatan umum untuk SO ini."
          />
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Mis. syarat pengiriman, nomor PO customer, dll."
            className="min-h-20 resize-y text-xs"
            maxLength={1000}
          />
          <p className="mt-1 text-right text-[10px] text-muted-foreground">
            {remarks.length}/1000
          </p>
        </Content>
      </div>

      {/* Kolom kanan: ringkasan */}
      <div className="col-span-12 min-w-0 xl:col-span-4 xl:sticky xl:top-4">
        <Content>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-bold">Ringkasan SO</h2>
            </div>

            <ul className="space-y-2 text-xs">
              {[
                {
                  ok: checks.kode,
                  label: "Nomor SO",
                  value: soKode.trim() || "-",
                },
                {
                  ok: checks.tanggal,
                  label: "Tanggal",
                  value: formatLongDate(soTanggal),
                },
                {
                  ok: checks.kategori,
                  label: "Kategori",
                  value: kategori || "-",
                },
                {
                  ok: checks.customer,
                  label: "Customer",
                  value: customer?.customer_name || "-",
                },
                {
                  ok: checks.items,
                  label: "Barang",
                  value: items.length
                    ? `${items.length} item · ${fmt(totalQty)} qty`
                    : "-",
                },
              ].map((row) => (
                <li key={row.label} className="flex items-start gap-2">
                  {row.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  )}
                  <span className="w-16 shrink-0 text-muted-foreground">
                    {row.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-right font-semibold">
                    {row.value}
                  </span>
                </li>
              ))}
              {customerPoNo.trim() && (
                <li className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="w-16 shrink-0 text-muted-foreground">
                    No. PO
                  </span>
                  <span className="min-w-0 flex-1 truncate text-right font-semibold">
                    {customerPoNo.trim()}
                  </span>
                </li>
              )}
              <li className="flex items-start gap-2">
                <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="w-16 shrink-0 text-muted-foreground">
                  Deadline
                </span>
                <span className="min-w-0 flex-1 truncate text-right font-semibold">
                  {soDueDate ? formatLongDate(soDueDate) : "Tanpa deadline"}
                </span>
              </li>
            </ul>

            {items.length > 0 && (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  Estimasi pemenuhan dari stok
                </p>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="bg-success transition-all"
                    style={{
                      width: `${(coverage.full / items.length) * 100}%`,
                    }}
                  />
                  <div
                    className="bg-warning transition-all"
                    style={{
                      width: `${(coverage.partial / items.length) * 100}%`,
                    }}
                  />
                  <div
                    className="bg-destructive/70 transition-all"
                    style={{
                      width: `${(coverage.none / items.length) * 100}%`,
                    }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div>
                    <p className="text-sm font-bold text-success">
                      {coverage.full}
                    </p>
                    <p className="text-[9px] text-muted-foreground">Siap DO</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-warning">
                      {coverage.partial}
                    </p>
                    <p className="text-[9px] text-muted-foreground">Sebagian</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-destructive">
                      {coverage.none}
                    </p>
                    <p className="text-[9px] text-muted-foreground">Perlu PO</p>
                  </div>
                </div>
              </div>
            )}

            <Button
              className="h-10 w-full gap-2 font-bold"
              onClick={handleReview}
              disabled={loading || kodeStatus === "checking"}
            >
              <ShieldCheck className="h-4 w-4" />{" "}
              {isEdit ? "Tinjau & Simpan Perubahan" : "Tinjau & Simpan SO"}
            </Button>
            {!canSubmit && (
              <p className="text-center text-[10px] text-muted-foreground">
                Lengkapi langkah bertanda{" "}
                <Circle className="inline h-2.5 w-2.5" /> untuk menyimpan.
              </p>
            )}

            {!isEdit && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  Setelah disimpan
                </p>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span>
                    Item yang ada stoknya bisa langsung dikirim lewat{" "}
                    <b className="text-foreground">DO Reguler</b> — gudang
                    pengirim dipilih saat buat DO.
                  </span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <ShoppingCart className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  <span>
                    Kekurangan stok dipenuhi lewat{" "}
                    <b className="text-foreground">PO dari SO</b> — gudang
                    penerima dipilih saat buat PO.
                  </span>
                </div>
                <p className="text-[10px] italic text-muted-foreground">
                  Boleh dipecah per qty, tanpa approval. PIC:{" "}
                  {userProfile?.nama || userProfile?.email}
                </p>
              </div>
            )}
            {isEdit && (
              <p className="border-t pt-3 text-[10px] italic text-muted-foreground">
                PO/DO yang sudah ada tidak ikut berubah. Status SO dihitung
                ulang otomatis setelah disimpan; setiap perubahan tercatat di
                Riwayat Perubahan SO.
              </p>
            )}
          </div>
        </Content>
      </div>

      {/* Konfirmasi */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => !loading && setConfirmOpen(o)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isEdit
                ? `Simpan perubahan SO ${soKode.trim()}?`
                : `Simpan SO ${soKode.trim()}?`}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Periksa daftar perubahan berikut, lalu isi alasan perubahan."
                : "SO Reguler langsung aktif tanpa approval. Periksa sekali lagi sebelum menyimpan."}
            </DialogDescription>
          </DialogHeader>
          {isEdit && diff ? (
            <div className="space-y-3 text-xs">
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-3">
                {diff.header.map((c) => (
                  <div key={c.label}>
                    <p className="text-[10px] text-muted-foreground">
                      {c.label}
                    </p>
                    <p className="break-words">
                      <span className="text-destructive line-through">
                        {c.before}
                      </span>{" "}
                      → <span className="font-semibold">{c.after}</span>
                    </p>
                  </div>
                ))}
                {diff.added.map((i) => (
                  <p key={`a-${i.id}`}>
                    <Badge className="mr-1.5 bg-success/15 text-[9px] text-success hover:bg-success/15">
                      Tambah
                    </Badge>
                    <code className="font-bold">{i.part_number}</code> ·{" "}
                    {fmt(i.qty)} {i.satuan}
                  </p>
                ))}
                {diff.removed.map((i) => (
                  <p key={`r-${i.id}`}>
                    <Badge className="mr-1.5 bg-destructive/15 text-[9px] text-destructive hover:bg-destructive/15">
                      Hapus
                    </Badge>
                    <code className="font-bold">{i.part_number}</code> ·{" "}
                    {fmt(i.qty)} {i.satuan}
                  </p>
                ))}
                {diff.changed.map((i) => (
                  <div key={`c-${i.part_number}`}>
                    <p>
                      <Badge className="mr-1.5 bg-primary/15 text-[9px] text-primary hover:bg-primary/15">
                        Ubah
                      </Badge>
                      <code className="font-bold">{i.part_number}</code>
                    </p>
                    {i.changes.map((c) => (
                      <p
                        key={c.label}
                        className="ml-12 break-words text-[11px]"
                      >
                        {c.label}:{" "}
                        <span className="text-destructive line-through">
                          {c.before}
                        </span>{" "}
                        → <span className="font-semibold">{c.after}</span>
                      </p>
                    ))}
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">
                  Alasan perubahan <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Mis. customer revisi PO, tambah qty, salah input nomor SO..."
                  className="min-h-16 text-xs"
                  maxLength={500}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">Customer</p>
                  <p className="font-semibold uppercase">
                    {customer?.customer_name}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">
                    Tanggal / Deadline
                  </p>
                  <p className="font-semibold">
                    {formatLongDate(soTanggal)} →{" "}
                    {soDueDate ? formatLongDate(soDueDate) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Kategori</p>
                  <p className="font-semibold">{kategori}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Nomor PO</p>
                  <p className="font-semibold uppercase">
                    {customerPoNo.trim() || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">
                    Tgl PO Dibuat / Diterima Email
                  </p>
                  <p className="font-semibold">
                    {customerPoDate ? formatLongDate(customerPoDate) : "—"} /{" "}
                    {customerPoReceivedDate
                      ? formatLongDate(customerPoReceivedDate)
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Marketing</p>
                  <p className="font-semibold uppercase">
                    {marketingName.trim() || "—"}
                  </p>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border">
                {items.map((i, idx) => (
                  <div
                    key={i.part_id}
                    className="flex items-center justify-between gap-3 border-b px-3 py-1.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <code className="text-[11px] font-bold">
                        {idx + 1}. {i.part_number}
                      </code>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {i.part_name}
                      </p>
                    </div>
                    <span className="shrink-0 font-bold tabular-nums">
                      {fmt(i.qty)} {i.satuan}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{items.length} item</Badge>
                <Badge variant="secondary">{fmt(totalQty)} total qty</Badge>
                {coverage.partial + coverage.none > 0 && (
                  <Badge
                    variant="outline"
                    className="border-warning/30 bg-warning/10 text-warning"
                  >
                    {coverage.partial + coverage.none} item perlu PO
                  </Badge>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={loading}
            >
              Periksa Lagi
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || (isEdit && !reason.trim())}
              className="gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              {isEdit ? "Ya, Simpan Perubahan" : "Ya, Simpan SO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
