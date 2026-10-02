"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { toYmdLocal } from "@/lib/utils";

type ConsignmentSoItemInput = {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  part_number_customer: string;
  qty: number;
};

async function getRoleNames(supabase: any, userId: string): Promise<string[]> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (roleRows || [])
    .map((row: any) => row?.roles?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

/**
 * Site SO wajib milik customer SO. Nama site disalin ke kolom teks `site`
 * (dibaca v_consignment_dashboard & code lama).
 */
async function resolveCustomerSite(
  supabase: any,
  customerId: number,
  siteId: number | null | undefined,
) {
  if (!siteId) return { site_id: null, site: null } as const;
  const { data } = await supabase
    .from("customer_sites")
    .select("id, site_name")
    .eq("id", siteId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (!data) return { error: "Site tidak ditemukan untuk customer ini." } as const;
  return { site_id: data.id as number, site: data.site_name as string } as const;
}

async function requireModeratorOrAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" } as const;

  const roleNames = await getRoleNames(supabase, user.id);
  const allowed = roleNames.some(
    (role) => role === "moderator" || role === "admin",
  );
  if (!allowed)
    return {
      error:
        "Akses ditolak. Hanya moderator/admin yang dapat mengubah atau menghapus SO Consignment.",
    } as const;

  return { supabase, user } as const;
}

/**
 * BUAT SO CONSIGNMENT
 *
 * Murni pencatatan data. Tidak ada pergerakan stok & tidak ada approval.
 */
export async function createConsignmentSo(data: {
  so_no: string;
  so_tanggal_input: string;
  tgl_po_email_marketing?: string;
  tgl_po_customer?: string;
  due_date?: string;
  no_po?: string;
  customer_id: number;
  site_id?: number | null;
  items: ConsignmentSoItemInput[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const soNo = data.so_no?.trim();
  if (!soNo) return { error: "No. SO wajib diisi." };
  if (!data.customer_id) return { error: "Customer wajib dipilih." };
  if (!data.items || data.items.length === 0)
    return { error: "Daftar item tidak boleh kosong." };
  for (const item of data.items) {
    if (!item.qty || item.qty <= 0)
      return { error: `${item.part_number}: qty harus lebih dari 0.` };
    if (!item.part_number_customer?.trim())
      return { error: `${item.part_number}: PN Customer wajib diisi.` };
  }

  const siteRes = await resolveCustomerSite(supabase, data.customer_id, data.site_id);
  if ("error" in siteRes) return { error: siteRes.error };

  // No. SO unik
  const { data: existing } = await supabase
    .from("consignment_so")
    .select("id")
    .eq("so_no", soNo)
    .maybeSingle();
  if (existing) return { error: "No. SO sudah digunakan. Gunakan nomor lain." };

  // Insert header
  const { data: soRow, error: soError } = await supabase
    .from("consignment_so")
    .insert([
      {
        so_no: soNo,
        so_tanggal_input: data.so_tanggal_input,
        tgl_po_email_marketing: data.tgl_po_email_marketing || null,
        tgl_po_customer: data.tgl_po_customer || null,
        due_date: data.due_date || null,
        no_po: data.no_po?.trim() || null,
        customer_id: data.customer_id,
        site_id: siteRes.site_id,
        site: siteRes.site,
        created_by: user.id,
      },
    ])
    .select()
    .single();
  if (soError) return { error: soError.message };

  // Insert items
  const itemsToInsert = data.items.map((item) => ({
    so_id: soRow.id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    part_number_customer: item.part_number_customer?.trim() || null,
    qty: item.qty,
  }));
  const { error: itemsError } = await supabase
    .from("consignment_so_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  revalidatePath("/so-reguler/consignment/so");
  return { success: true, data: soRow };
}

/**
 * UPDATE HEADER SO CONSIGNMENT (moderator/admin).
 *
 * Item tidak diubah lewat fungsi ini (mengikuti pola DO Reguler).
 */
export async function updateConsignmentSo(
  soId: number,
  payload: Partial<{
    so_tanggal_input: string;
    tgl_po_email_marketing: string;
    tgl_po_customer: string;
    due_date: string;
    no_po: string;
    site_id: number | null;
  }>,
) {
  const auth = await requireModeratorOrAdmin();
  if ("error" in auth) return { error: auth.error };

  const { supabase } = auth;
  const { site_id: siteId, ...rest } = payload;
  // site_id tidak dikirim = site tidak diubah (null = kosongkan site).
  let siteFields = {};
  if (siteId !== undefined) {
    const { data: soRow } = await supabase
      .from("consignment_so")
      .select("customer_id")
      .eq("id", soId)
      .maybeSingle();
    if (!soRow) return { error: "SO Consignment tidak ditemukan." };
    const siteRes = await resolveCustomerSite(supabase, soRow.customer_id, siteId);
    if ("error" in siteRes) return { error: siteRes.error };
    siteFields = { site_id: siteRes.site_id, site: siteRes.site };
  }

  const safePayload = {
    ...rest,
    tgl_po_email_marketing: payload.tgl_po_email_marketing || null,
    tgl_po_customer: payload.tgl_po_customer || null,
    due_date: payload.due_date || null,
    no_po: payload.no_po?.trim() || null,
    ...siteFields,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("consignment_so")
    .update(safePayload)
    .eq("id", soId);
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/consignment/so");
  return { success: true };
}

/**
 * HAPUS SO CONSIGNMENT (moderator/admin). Item ikut terhapus lewat cascade.
 */
export async function deleteConsignmentSo(soId: number) {
  const auth = await requireModeratorOrAdmin();
  if ("error" in auth) return { error: auth.error };

  const { supabase } = auth;
  const { error } = await supabase
    .from("consignment_so")
    .delete()
    .eq("id", soId);
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/consignment/so");
  return { success: true };
}

const DASHBOARD_SORT_COLUMNS: Record<string, string> = {
  so_tanggal_input: "so_tanggal_input",
  so_no: "so_no",
  due_date: "due_date",
  customer_name: "customer_name",
  part_number: "part_number",
};

/**
 * REPORT DASHBOARD CONSIGNMENT
 *
 * Satu baris per item SO Consignment (v_consignment_dashboard). Mengikuti
 * pola getSpbReport — kolom fase berikutnya (supply, IT, PR/PO GMI,
 * rekonsiliasi) belum ada di view, ditampilkan kosong oleh frontend.
 */
export async function getConsignmentDashboardReport(params?: {
  search?: string;
  page?: number;
  limit?: number;
  sort?: string;
}) {
  const supabase = await createClient();
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 50;
  const from = (page - 1) * limit;

  let query = supabase
    .from("v_consignment_dashboard")
    .select("*", { count: "exact" });

  const [sortKeyRaw, sortDirRaw] = (params?.sort || "").split(/_(asc|desc)$/);
  const sortColumn = DASHBOARD_SORT_COLUMNS[sortKeyRaw];
  if (sortColumn) {
    query = query.order(sortColumn, { ascending: sortDirRaw === "asc" });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  if (params?.search) {
    query = query.or(
      `so_no.ilike.%${params.search}%,no_po.ilike.%${params.search}%,site.ilike.%${params.search}%,part_number.ilike.%${params.search}%,part_name.ilike.%${params.search}%,part_number_customer.ilike.%${params.search}%`,
    );
  }

  const { data, error, count } = await query.range(from, from + limit - 1);
  if (error) return { data: [], count: 0, error: error.message };

  return { data: data || [], count: count || 0, error: null as string | null };
}

/**
 * PERFORMANCE REPORT CONSIGNMENT
 *
 * Ringkasan agregat buat tab Performance di Dashboard Consignment. Beda dari
 * getConsignmentDashboardReport (tabel tracking per-item SO) -- ini murni
 * angka. Dua jenis cakupan waktu:
 *   - "Kondisi sekarang" (alerts, daftar kritis, IK belum dikonfirmasi):
 *     semua data, tanpa filter periode.
 *   - "Periode" (fulfilment, on-time, lead time, customer, penerimaan, tren):
 *     SO/IK/penerimaan dalam `months` bulan terakhir (termasuk bulan ini).
 *
 * Agregasi di app (bukan RPC) supaya tidak butuh perubahan DB; data dibaca
 * per halaman 1000 baris karena batas max_rows PostgREST.
 */

const DUE_SOON_DAYS = 7;
const IK_PENDING_AGING_DAYS = 7;
const LEAD_TIME_BUCKETS = [
  { label: "0-3 hari", min: 0, max: 3 },
  { label: "4-7 hari", min: 4, max: 7 },
  { label: "8-14 hari", min: 8, max: 14 },
  { label: "15-30 hari", min: 15, max: 30 },
  { label: "> 30 hari", min: 31, max: Infinity },
];

export type ConsignmentCriticalItem = {
  item_id: number;
  so_id: number;
  so_no: string | null;
  customer_name: string | null;
  site: string | null;
  part_number: string | null;
  part_name: string | null;
  satuan: string | null;
  due_date: string;
  days_to_due: number;
  qty: number;
  qty_kirim: number;
  qty_sisa: number;
};

export type ConsignmentPendingIk = {
  ik_id: number;
  ik_kode: string;
  ik_tanggal: string;
  so_no: string | null;
  customer_name: string | null;
  gudang_tujuan: string | null;
  no_awb: string | null;
  total_qty: number;
  age_days: number;
};

export type ConsignmentPerformanceData = {
  period_months: number;
  period_start: string;
  kpi: {
    so_this_month: number;
    so_last_month: number;
    ik_this_month: number;
    ik_last_month: number;
    qty_this_month: number;
    qty_last_month: number;
    lead_time_this_month: number | null;
    lead_time_last_month: number | null;
  };
  alerts: {
    overdue_items: number;
    overdue_so: number;
    overdue_qty: number;
    due_soon_items: number;
    due_soon_so: number;
    due_soon_qty: number;
    ik_pending: number;
    ik_pending_aged: number;
    ik_pending_oldest_days: number | null;
    komplain_open: number;
    komplain_open_qty: number;
  };
  fulfilment: {
    items_total: number;
    items_belum: number;
    items_partial: number;
    items_full: number;
    qty_order: number;
    qty_kirim: number;
    fill_rate: number | null;
    on_time: number;
    late: number;
    on_time_rate: number | null;
  };
  lead_time: {
    avg: number | null;
    median: number | null;
    samples: number;
    buckets: { label: string; count: number }[];
  };
  penerimaan: {
    ik_confirmed: number;
    qty_kirim: number;
    qty_terima: number;
    acceptance_rate: number | null;
    items_komplain: number;
    komplain_selesai: number;
    avg_days_to_confirm: number | null;
  };
  trend: {
    bulan: string;
    so: number;
    ik: number;
    qty_so: number;
    qty_ik: number;
  }[];
  top_customers: {
    customer_id: number;
    customer_name: string;
    so_count: number;
    qty_order: number;
    qty_kirim: number;
    fill_rate: number | null;
    overdue_items: number;
  }[];
  critical_items: ConsignmentCriticalItem[];
  critical_items_total: number;
  pending_iks: ConsignmentPendingIk[];
};

async function fetchAllPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetchPage(from, from + PAGE - 1);
    if (res.error) throw new Error(res.error.message);
    // Embed many-to-one PostgREST datang sebagai objek, tapi tipe hasil
    // inferensi supabase-js menganggapnya array -> cast ke tipe baris.
    const data = res.data as T[] | null;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

/** Selisih hari kalender antar dua tanggal YYYY-MM-DD (b - a). */
function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split("-").map(Number);
  const [by, bm, bd] = b.slice(0, 10).split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ratio(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

type PerfItemRow = {
  so_id: number;
  so_no: string | null;
  so_tanggal_input: string | null;
  due_date: string | null;
  customer_id: number | null;
  customer_name: string | null;
  site: string | null;
  item_id: number;
  part_number: string | null;
  part_name: string | null;
  satuan: string | null;
  qty: number | null;
  total_qty_ik: number | null;
  tgl_ik_terakhir: string | null;
  durasi_kirim_ik_so: number | null;
};

type PerfIkRow = {
  id: number;
  ik_kode: string;
  ik_tanggal: string;
  no_awb: string | null;
  so: { so_no: string | null; customer: { customer_name: string | null } | null } | null;
  cabang_tujuan: { nama_cabang: string | null } | null;
  consignment_ik_items: { qty: number }[] | null;
};

type PerfPenerimaanRow = {
  ik_id: number;
  tanggal_terima: string;
  consignment_penerimaan_items:
    | {
        qty_kirim: number;
        qty_terima: number;
        status: string;
        resolution_status: string | null;
      }[]
    | null;
};

export async function getConsignmentPerformanceReport(params?: {
  months?: number;
}): Promise<ConsignmentPerformanceData & { error: string | null }> {
  const supabase = await createClient();
  const periodMonths = Math.min(Math.max(params?.months ?? 6, 1), 24);

  const now = new Date();
  const today = toYmdLocal(now);
  const months: { key: string; label: string; start: string; end: string }[] =
    [];
  for (let i = periodMonths - 1; i >= 0; i -= 1) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const nextMonthDate = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth() + 1,
      1,
    );
    months.push({
      key: toYmdLocal(monthDate).slice(0, 7),
      label: monthDate.toLocaleDateString("id-ID", {
        month: "short",
        year: "2-digit",
      }),
      start: toYmdLocal(monthDate),
      end: toYmdLocal(nextMonthDate),
    });
  }
  const periodStart = months[0].start;
  const thisMonthKey = today.slice(0, 7);
  const lastMonthKey = toYmdLocal(
    new Date(now.getFullYear(), now.getMonth() - 1, 1),
  ).slice(0, 7);

  let items: PerfItemRow[];
  let iks: PerfIkRow[];
  let penerimaan: PerfPenerimaanRow[];
  try {
    [items, iks, penerimaan] = await Promise.all([
      fetchAllPages<PerfItemRow>((from, to) =>
        supabase
          .from("v_consignment_dashboard")
          .select(
            "so_id, so_no, so_tanggal_input, due_date, customer_id, customer_name, site, item_id, part_number, part_name, satuan, qty, total_qty_ik, tgl_ik_terakhir, durasi_kirim_ik_so",
          )
          .order("item_id", { ascending: true })
          .range(from, to),
      ),
      fetchAllPages<PerfIkRow>((from, to) =>
        supabase
          .from("consignment_ik")
          .select(
            "id, ik_kode, ik_tanggal, no_awb, so:consignment_so(so_no, customer:customers!customer_id(customer_name)), cabang_tujuan:cabang!consignment_ik_ke_cabang_id_fkey(nama_cabang), consignment_ik_items(qty)",
          )
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllPages<PerfPenerimaanRow>((from, to) =>
        supabase
          .from("consignment_penerimaan")
          .select(
            "ik_id, tanggal_terima, consignment_penerimaan_items(qty_kirim, qty_terima, status, resolution_status)",
          )
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);
  } catch (e) {
    return {
      ...emptyPerformance(periodMonths, periodStart, months),
      error: e instanceof Error ? e.message : "Gagal memuat data performance",
    };
  }

  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  const trend = months.map((m) => ({
    bulan: m.label,
    so: 0,
    ik: 0,
    qty_so: 0,
    qty_ik: 0,
  }));

  // --- Item SO ---
  const soThisMonth = new Set<number>();
  const soLastMonth = new Set<number>();
  const trendSoSets = months.map(() => new Set<number>());
  const leadThisMonth: number[] = [];
  const leadLastMonth: number[] = [];
  const leadPeriod: number[] = [];

  const fulfilment = {
    items_total: 0,
    items_belum: 0,
    items_partial: 0,
    items_full: 0,
    qty_order: 0,
    qty_kirim: 0,
    on_time: 0,
    late: 0,
  };
  const alerts = {
    overdue_items: 0,
    overdue_qty: 0,
    due_soon_items: 0,
    due_soon_qty: 0,
  };
  const overdueSo = new Set<number>();
  const dueSoonSo = new Set<number>();
  const critical: ConsignmentCriticalItem[] = [];

  const customerAgg = new Map<
    number,
    {
      customer_name: string;
      so: Set<number>;
      qty_order: number;
      qty_kirim: number;
      overdue_items: number;
    }
  >();

  for (const row of items) {
    const qty = Number(row.qty) || 0;
    const shipped = Number(row.total_qty_ik) || 0;
    const shippedCapped = Math.min(shipped, qty);
    const isFull = qty > 0 && shipped >= qty;
    const soDate = row.so_tanggal_input?.slice(0, 10) ?? null;
    const soMonth = soDate?.slice(0, 7) ?? null;
    const inPeriod = !!soDate && soDate >= periodStart;

    if (soMonth === thisMonthKey) soThisMonth.add(row.so_id);
    if (soMonth === lastMonthKey) soLastMonth.add(row.so_id);
    const ti = soMonth ? monthIndex.get(soMonth) : undefined;
    if (ti !== undefined) {
      trendSoSets[ti].add(row.so_id);
      trend[ti].qty_so += qty;
    }

    // Lead time = SO input -> IK terakhir yang membuat item jadi Full.
    // Dikelompokkan per bulan IK selesai (bukan bulan SO).
    if (isFull && row.durasi_kirim_ik_so !== null && row.tgl_ik_terakhir) {
      const lead = Math.max(Number(row.durasi_kirim_ik_so), 0);
      const doneMonth = row.tgl_ik_terakhir.slice(0, 7);
      if (doneMonth === thisMonthKey) leadThisMonth.push(lead);
      if (doneMonth === lastMonthKey) leadLastMonth.push(lead);
      if (row.tgl_ik_terakhir.slice(0, 10) >= periodStart) leadPeriod.push(lead);
    }

    if (inPeriod) {
      fulfilment.items_total += 1;
      fulfilment.qty_order += qty;
      fulfilment.qty_kirim += shippedCapped;
      if (isFull) fulfilment.items_full += 1;
      else if (shipped > 0) fulfilment.items_partial += 1;
      else fulfilment.items_belum += 1;

      if (isFull && row.due_date && row.tgl_ik_terakhir) {
        if (row.tgl_ik_terakhir.slice(0, 10) <= row.due_date.slice(0, 10))
          fulfilment.on_time += 1;
        else fulfilment.late += 1;
      }

      if (row.customer_id) {
        const agg = customerAgg.get(row.customer_id) ?? {
          customer_name: row.customer_name || "-",
          so: new Set<number>(),
          qty_order: 0,
          qty_kirim: 0,
          overdue_items: 0,
        };
        agg.so.add(row.so_id);
        agg.qty_order += qty;
        agg.qty_kirim += shippedCapped;
        customerAgg.set(row.customer_id, agg);
      }
    }

    // Kondisi sekarang: item yang belum Full & punya due date dekat/lewat.
    if (!isFull && row.due_date) {
      const due = row.due_date.slice(0, 10);
      const daysToDue = diffDays(today, due);
      const sisa = Math.max(qty - shipped, 0);
      if (daysToDue < 0) {
        alerts.overdue_items += 1;
        alerts.overdue_qty += sisa;
        overdueSo.add(row.so_id);
        if (inPeriod && row.customer_id) {
          const agg = customerAgg.get(row.customer_id);
          if (agg) agg.overdue_items += 1;
        }
      } else if (daysToDue <= DUE_SOON_DAYS) {
        alerts.due_soon_items += 1;
        alerts.due_soon_qty += sisa;
        dueSoonSo.add(row.so_id);
      }
      if (daysToDue <= DUE_SOON_DAYS) {
        critical.push({
          item_id: row.item_id,
          so_id: row.so_id,
          so_no: row.so_no,
          customer_name: row.customer_name,
          site: row.site,
          part_number: row.part_number,
          part_name: row.part_name,
          satuan: row.satuan,
          due_date: due,
          days_to_due: daysToDue,
          qty,
          qty_kirim: shipped,
          qty_sisa: sisa,
        });
      }
    }
  }
  trendSoSets.forEach((set, i) => {
    trend[i].so = set.size;
  });
  critical.sort(
    (a, b) => a.days_to_due - b.days_to_due || b.qty_sisa - a.qty_sisa,
  );

  // --- IK ---
  const confirmedIk = new Set(penerimaan.map((p) => p.ik_id));
  const ikDateById = new Map<number, string>();
  let ikThis = 0;
  let ikLast = 0;
  let qtyThis = 0;
  let qtyLast = 0;
  const pending: ConsignmentPendingIk[] = [];

  for (const ik of iks) {
    const date = ik.ik_tanggal.slice(0, 10);
    const month = date.slice(0, 7);
    const qty = (ik.consignment_ik_items || []).reduce(
      (s, it) => s + (Number(it.qty) || 0),
      0,
    );
    ikDateById.set(ik.id, date);
    if (month === thisMonthKey) {
      ikThis += 1;
      qtyThis += qty;
    }
    if (month === lastMonthKey) {
      ikLast += 1;
      qtyLast += qty;
    }
    const ti = monthIndex.get(month);
    if (ti !== undefined) {
      trend[ti].ik += 1;
      trend[ti].qty_ik += qty;
    }
    if (!confirmedIk.has(ik.id)) {
      pending.push({
        ik_id: ik.id,
        ik_kode: ik.ik_kode,
        ik_tanggal: date,
        so_no: ik.so?.so_no ?? null,
        customer_name: ik.so?.customer?.customer_name ?? null,
        gudang_tujuan: ik.cabang_tujuan?.nama_cabang ?? null,
        no_awb: ik.no_awb,
        total_qty: qty,
        age_days: Math.max(diffDays(date, today), 0),
      });
    }
  }
  pending.sort((a, b) => b.age_days - a.age_days);

  // --- Penerimaan ---
  const pen = {
    ik_confirmed: 0,
    qty_kirim: 0,
    qty_terima: 0,
    items_komplain: 0,
    komplain_selesai: 0,
  };
  const confirmDays: number[] = [];
  let komplainOpen = 0;
  let komplainOpenQty = 0;
  for (const p of penerimaan) {
    const inPeriod = p.tanggal_terima.slice(0, 10) >= periodStart;
    if (inPeriod) {
      pen.ik_confirmed += 1;
      const ikDate = ikDateById.get(p.ik_id);
      if (ikDate) confirmDays.push(Math.max(diffDays(ikDate, p.tanggal_terima), 0));
    }
    for (const it of p.consignment_penerimaan_items || []) {
      const isKomplain = it.status === "komplain";
      if (isKomplain && it.resolution_status !== "selesai") {
        komplainOpen += 1;
        komplainOpenQty += Math.max(it.qty_kirim - it.qty_terima, 0);
      }
      if (!inPeriod) continue;
      pen.qty_kirim += Number(it.qty_kirim) || 0;
      pen.qty_terima += Number(it.qty_terima) || 0;
      if (isKomplain) {
        pen.items_komplain += 1;
        if (it.resolution_status === "selesai") pen.komplain_selesai += 1;
      }
    }
  }

  const topCustomers = [...customerAgg.entries()]
    .map(([customer_id, agg]) => ({
      customer_id,
      customer_name: agg.customer_name,
      so_count: agg.so.size,
      qty_order: agg.qty_order,
      qty_kirim: agg.qty_kirim,
      fill_rate: ratio(agg.qty_kirim, agg.qty_order),
      overdue_items: agg.overdue_items,
    }))
    .sort((a, b) => b.qty_order - a.qty_order)
    .slice(0, 8);

  return {
    period_months: periodMonths,
    period_start: periodStart,
    kpi: {
      so_this_month: soThisMonth.size,
      so_last_month: soLastMonth.size,
      ik_this_month: ikThis,
      ik_last_month: ikLast,
      qty_this_month: qtyThis,
      qty_last_month: qtyLast,
      lead_time_this_month: average(leadThisMonth),
      lead_time_last_month: average(leadLastMonth),
    },
    alerts: {
      ...alerts,
      overdue_so: overdueSo.size,
      due_soon_so: dueSoonSo.size,
      ik_pending: pending.length,
      ik_pending_aged: pending.filter((p) => p.age_days > IK_PENDING_AGING_DAYS)
        .length,
      ik_pending_oldest_days: pending[0]?.age_days ?? null,
      komplain_open: komplainOpen,
      komplain_open_qty: komplainOpenQty,
    },
    fulfilment: {
      ...fulfilment,
      fill_rate: ratio(fulfilment.qty_kirim, fulfilment.qty_order),
      on_time_rate: ratio(
        fulfilment.on_time,
        fulfilment.on_time + fulfilment.late,
      ),
    },
    lead_time: {
      avg: average(leadPeriod),
      median: median(leadPeriod),
      samples: leadPeriod.length,
      buckets: LEAD_TIME_BUCKETS.map((b) => ({
        label: b.label,
        count: leadPeriod.filter((d) => d >= b.min && d <= b.max).length,
      })),
    },
    penerimaan: {
      ...pen,
      acceptance_rate: ratio(pen.qty_terima, pen.qty_kirim),
      avg_days_to_confirm: average(confirmDays),
    },
    trend,
    top_customers: topCustomers,
    critical_items: critical.slice(0, 15),
    critical_items_total: critical.length,
    pending_iks: pending.slice(0, 8),
    error: null,
  };
}

function emptyPerformance(
  periodMonths: number,
  periodStart: string,
  months: { label: string }[],
): ConsignmentPerformanceData {
  return {
    period_months: periodMonths,
    period_start: periodStart,
    kpi: {
      so_this_month: 0,
      so_last_month: 0,
      ik_this_month: 0,
      ik_last_month: 0,
      qty_this_month: 0,
      qty_last_month: 0,
      lead_time_this_month: null,
      lead_time_last_month: null,
    },
    alerts: {
      overdue_items: 0,
      overdue_so: 0,
      overdue_qty: 0,
      due_soon_items: 0,
      due_soon_so: 0,
      due_soon_qty: 0,
      ik_pending: 0,
      ik_pending_aged: 0,
      ik_pending_oldest_days: null,
      komplain_open: 0,
      komplain_open_qty: 0,
    },
    fulfilment: {
      items_total: 0,
      items_belum: 0,
      items_partial: 0,
      items_full: 0,
      qty_order: 0,
      qty_kirim: 0,
      fill_rate: null,
      on_time: 0,
      late: 0,
      on_time_rate: null,
    },
    lead_time: {
      avg: null,
      median: null,
      samples: 0,
      buckets: LEAD_TIME_BUCKETS.map((b) => ({ label: b.label, count: 0 })),
    },
    penerimaan: {
      ik_confirmed: 0,
      qty_kirim: 0,
      qty_terima: 0,
      acceptance_rate: null,
      items_komplain: 0,
      komplain_selesai: 0,
      avg_days_to_confirm: null,
    },
    trend: months.map((m) => ({
      bulan: m.label,
      so: 0,
      ik: 0,
      qty_so: 0,
      qty_ik: 0,
    })),
    top_customers: [],
    critical_items: [],
    critical_items_total: 0,
    pending_iks: [],
  };
}
