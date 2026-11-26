"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  isIkPlanner,
  planItemProgress,
  type IkPlanRow,
} from "@/lib/consignment-plan";

// ============================================================
// PLANNING IK (Consignment) -- rencana kirim sebelum Item Konsinyasi.
//
// 1 planning = 1 customer, boleh lintas SO / No PO, site tujuan per baris.
// Tanpa approval & tanpa gerak stok. Warehouse membuat IK dari planning
// (services/consignment-ik-actions.ts -> createConsignmentIk dgn plan_id),
// realisasi = SUM(consignment_ik_items.qty) per plan_item_id.
//
// Plan qty boleh melebihi SOH (justru itu gunanya kolom selisih SOH), tapi
// tidak boleh melebihi outstanding SO dikurangi sisa plan aktif lain utk
// item SO yang sama -- supaya 1 qty tidak direncanakan dua kali.
// ============================================================

const PLAN_PATHS = [
  "/so-reguler/consignment/planning",
  "/so-reguler/consignment/ik",
];

async function getRoleNames(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (data || [])
    .map((row: any) => row?.roles?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

async function requirePlanner(supabase: any) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, error: "Tidak terautentikasi." };
  const roles = await getRoleNames(supabase, user.id);
  if (!isIkPlanner(roles))
    return { user: null, error: "Hanya PPIC/marketing/admin/moderator yang dapat mengelola Planning IK." };
  return { user, error: null as string | null };
}

const CHUNK = 200;
const PAGE = 1000;

/** SELECT ... WHERE col IN (ids) dipecah per 200 id + per halaman 1000 baris. */
async function selectIn<T = any>(
  supabase: any,
  table: string,
  columns: string,
  col: string,
  ids: (number | string)[],
  extra?: (q: any) => any,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from(table).select(columns).in(col, slice);
      if (extra) q = extra(q);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

/** Total qty terkirim IK per item SO. */
async function shippedBySoItem(supabase: any, soItemIds: number[]) {
  const rows = await selectIn(supabase, "consignment_ik_items", "so_item_id, qty", "so_item_id", soItemIds);
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.so_item_id, (map.get(r.so_item_id) || 0) + Number(r.qty));
  return map;
}

/** Total qty IK per baris planning. */
async function realizedByPlanItem(supabase: any, planItemIds: number[]) {
  const rows = await selectIn(supabase, "consignment_ik_items", "plan_item_id, qty", "plan_item_id", planItemIds);
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.plan_item_id, (map.get(r.plan_item_id) || 0) + Number(r.qty));
  return map;
}

/**
 * Sisa plan aktif (planning open, belum direalisasi IK) per item SO.
 * `excludePlanId` dipakai saat validasi supaya planning itu sendiri tidak
 * dihitung.
 */
async function openPlannedBySoItem(supabase: any, soItemIds: number[], excludePlanId?: number) {
  const rows = await selectIn(
    supabase,
    "consignment_ik_plan_items",
    "id, plan_id, so_item_id, plan_qty, plan:consignment_ik_plans!inner(status)",
    "so_item_id",
    soItemIds,
    (q) => q.eq("plan.status", "open"),
  );
  const relevant = rows.filter((r: any) => r.plan_id !== excludePlanId);
  const realized = await realizedByPlanItem(supabase, relevant.map((r: any) => r.id));
  const map = new Map<number, number>();
  for (const r of relevant as any[]) {
    const sisa = Math.max(0, Number(r.plan_qty) - (realized.get(r.id) || 0));
    map.set(r.so_item_id, (map.get(r.so_item_id) || 0) + sisa);
  }
  return map;
}

/** Sisa plan aktif per part di satu gudang asal (SOH yang sudah "dijatah"). */
async function openPlannedByPart(supabase: any, cabangId: number, partIds: number[]) {
  const rows = await selectIn(
    supabase,
    "consignment_ik_plan_items",
    "id, part_id, plan_qty, plan:consignment_ik_plans!inner(status, dari_cabang_id)",
    "part_id",
    partIds,
    (q) => q.eq("plan.status", "open").eq("plan.dari_cabang_id", cabangId),
  );
  const realized = await realizedByPlanItem(supabase, rows.map((r: any) => r.id));
  const map = new Map<number, number>();
  for (const r of rows as any[]) {
    const sisa = Math.max(0, Number(r.plan_qty) - (realized.get(r.id) || 0));
    map.set(r.part_id, (map.get(r.part_id) || 0) + sisa);
  }
  return map;
}

async function stockMap(supabase: any, pairs: { cabangId: number; partId: number }[]) {
  const byCabang = new Map<number, number[]>();
  for (const p of pairs) {
    const list = byCabang.get(p.cabangId) || [];
    list.push(p.partId);
    byCabang.set(p.cabangId, list);
  }
  const map = new Map<string, number>();
  for (const [cabangId, partIds] of byCabang) {
    const rows = await selectIn(supabase, "stock", "part_id, qty", "part_id", partIds, (q) =>
      q.eq("cabang_id", cabangId),
    );
    for (const r of rows) map.set(`${cabangId}:${r.part_id}`, Number(r.qty) || 0);
  }
  return map;
}

export type IkPlanCandidate = {
  so_id: number;
  so_no: string;
  no_po: string | null;
  tgl_po: string | null;
  due_date: string | null;
  so_site_id: number | null;
  so_site: string | null;
  so_item_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  part_number_customer: string | null;
  satuan: string;
  qty_po: number;
  outstanding: number;
  planned_open: number; // sisa plan aktif di planning lain
  plannable: number; // outstanding - planned_open
  soh: number;
  soh_reserved: number; // sisa plan aktif lain di gudang ini utk part yang sama
};

/**
 * Item SO Consignment milik customer yang masih outstanding -- bahan form
 * Buat Planning IK. SOH = stok di gudang asal planning.
 */
export async function getIkPlanCandidates(customerId: number, cabangId: number) {
  const supabase = await createClient();
  try {
    const sos: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("consignment_so")
        .select("id, so_no, no_po, tgl_po_customer, due_date, site_id, site")
        .eq("customer_id", customerId)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      sos.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    if (sos.length === 0) return { data: [] as IkPlanCandidate[], error: null as string | null };

    const soById = new Map(sos.map((s) => [s.id, s]));
    const items = await selectIn(
      supabase,
      "consignment_so_items",
      "id, so_id, part_id, part_number, part_name, part_number_customer, satuan, qty",
      "so_id",
      sos.map((s) => s.id),
    );
    const itemIds = items.map((i: any) => i.id);
    const shipped = await shippedBySoItem(supabase, itemIds);
    const planned = await openPlannedBySoItem(supabase, itemIds);
    const soh = await stockMap(
      supabase,
      items.map((i: any) => ({ cabangId, partId: i.part_id })),
    );
    const reserved = await openPlannedByPart(
      supabase,
      cabangId,
      items.map((i: any) => i.part_id),
    );

    const data: IkPlanCandidate[] = [];
    for (const i of items as any[]) {
      const outstanding = Math.max(0, Number(i.qty) - (shipped.get(i.id) || 0));
      if (outstanding <= 0) continue;
      const so = soById.get(i.so_id);
      const plannedOpen = planned.get(i.id) || 0;
      data.push({
        so_id: i.so_id,
        so_no: so.so_no,
        no_po: so.no_po,
        tgl_po: so.tgl_po_customer,
        due_date: so.due_date,
        so_site_id: so.site_id,
        so_site: so.site,
        so_item_id: i.id,
        part_id: i.part_id,
        part_number: i.part_number,
        part_name: i.part_name,
        part_number_customer: i.part_number_customer,
        satuan: i.satuan,
        qty_po: Number(i.qty),
        outstanding,
        planned_open: plannedOpen,
        plannable: Math.max(0, outstanding - plannedOpen),
        soh: soh.get(`${cabangId}:${i.part_id}`) || 0,
        soh_reserved: reserved.get(i.part_id) || 0,
      });
    }
    // Due date terdekat dulu (tanpa due date di akhir), lalu No PO.
    data.sort(
      (a, b) =>
        (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
        (a.no_po || a.so_no).localeCompare(b.no_po || b.so_no) ||
        a.part_number.localeCompare(b.part_number),
    );
    return { data, error: null as string | null };
  } catch (e: any) {
    return { data: [] as IkPlanCandidate[], error: e.message as string };
  }
}

export type IkPlanItemInput = {
  so_item_id: number;
  site_id: number;
  plan_qty: number;
  notes?: string;
};

export async function createIkPlan(input: {
  plan_tanggal: string;
  customer_id: number;
  dari_cabang_id: number;
  catatan?: string;
  items: IkPlanItemInput[];
}) {
  const supabase = await createClient();
  const { user, error: authError } = await requirePlanner(supabase);
  if (!user) return { error: authError };

  if (!input.customer_id) return { error: "Customer wajib dipilih." };
  if (!input.dari_cabang_id) return { error: "Gudang asal wajib dipilih." };
  if (!input.items?.length) return { error: "Pilih minimal satu item untuk direncanakan." };

  const seen = new Set<string>();
  for (const it of input.items) {
    const q = Number(it.plan_qty);
    if (!q || q <= 0 || !Number.isInteger(q))
      return { error: "Plan qty harus bilangan bulat lebih dari 0." };
    if (!it.site_id) return { error: "Site tujuan wajib diisi di setiap baris." };
    const key = `${it.so_item_id}:${it.site_id}`;
    if (seen.has(key)) return { error: "Ada baris kembar (item SO + site yang sama)." };
    seen.add(key);
  }

  try {
    // Item wajib milik SO customer ini; data part diambil dari DB.
    const soItemIds = input.items.map((i) => i.so_item_id);
    const soItems = await selectIn(
      supabase,
      "consignment_so_items",
      "id, so_id, part_id, part_number, part_name, part_number_customer, satuan, qty, so:consignment_so!inner(customer_id, so_no)",
      "id",
      soItemIds,
    );
    const soItemById = new Map(soItems.map((r: any) => [r.id, r]));
    for (const it of input.items) {
      const row: any = soItemById.get(it.so_item_id);
      if (!row || row.so?.customer_id !== input.customer_id)
        return { error: "Ada item yang bukan milik SO customer ini." };
    }

    const { data: sites } = await supabase
      .from("customer_sites")
      .select("id, site_name, customer_id, is_active")
      .in("id", [...new Set(input.items.map((i) => i.site_id))]);
    const siteById = new Map((sites || []).map((s: any) => [s.id, s]));
    for (const it of input.items) {
      const s: any = siteById.get(it.site_id);
      if (!s || s.customer_id !== input.customer_id || !s.is_active)
        return { error: "Site tujuan harus site aktif milik customer ini." };
    }

    // Plan qty <= outstanding - sisa plan aktif lain (dijumlah per item SO).
    const shipped = await shippedBySoItem(supabase, soItemIds);
    const planned = await openPlannedBySoItem(supabase, soItemIds);
    const requested = new Map<number, number>();
    for (const it of input.items)
      requested.set(it.so_item_id, (requested.get(it.so_item_id) || 0) + Number(it.plan_qty));
    const violations: string[] = [];
    for (const [soItemId, qty] of requested) {
      const row: any = soItemById.get(soItemId);
      const outstanding = Number(row.qty) - (shipped.get(soItemId) || 0);
      const avail = outstanding - (planned.get(soItemId) || 0);
      if (qty > avail)
        violations.push(
          `${row.so.so_no} ${row.part_number}: bisa direncanakan ${Math.max(0, avail)}, diminta ${qty}.`,
        );
    }
    if (violations.length)
      return { error: "Plan qty melebihi outstanding yang belum direncanakan:\n" + violations.join("\n") };

    const { data: kode, error: kodeError } = await supabase.rpc("generate_consignment_ik_plan_kode");
    if (kodeError || !kode) return { error: kodeError?.message || "Gagal membuat kode planning." };

    const { data: plan, error: planError } = await supabase
      .from("consignment_ik_plans")
      .insert({
        plan_kode: kode as string,
        plan_tanggal: input.plan_tanggal,
        customer_id: input.customer_id,
        dari_cabang_id: input.dari_cabang_id,
        catatan: input.catatan?.trim() || null,
        created_by: user.id,
      })
      .select()
      .single();
    if (planError) return { error: planError.message };

    const { error: itemsError } = await supabase.from("consignment_ik_plan_items").insert(
      input.items.map((it) => {
        const row: any = soItemById.get(it.so_item_id);
        const site: any = siteById.get(it.site_id);
        return {
          plan_id: plan.id,
          so_id: row.so_id,
          so_item_id: row.id,
          site_id: site.id,
          site_name: site.site_name,
          part_id: row.part_id,
          part_number: row.part_number,
          part_name: row.part_name,
          part_number_customer: row.part_number_customer,
          satuan: row.satuan,
          plan_qty: Number(it.plan_qty),
          notes: it.notes?.trim() || null,
        };
      }),
    );
    if (itemsError) {
      await supabase.from("consignment_ik_plans").delete().eq("id", plan.id);
      return { error: itemsError.message };
    }

    PLAN_PATHS.forEach((p) => revalidatePath(p));
    return { success: true, data: plan };
  } catch (e: any) {
    return { error: e.message as string };
  }
}

/**
 * Baris planning flat dengan nilai live (outstanding, SOH, realisasi).
 * `openOnly` = cuma planning open yang masih punya sisa (picker form IK).
 */
export async function getIkPlanRows(opts: { planId?: number; openOnly?: boolean } = {}) {
  const supabase = await createClient();
  try {
    const plans: any[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from("consignment_ik_plans")
        .select(
          "id, plan_kode, plan_tanggal, status, catatan, customer_id, dari_cabang_id, customer:customers!customer_id(customer_name), cabang:cabang!dari_cabang_id(nama_cabang)",
        )
        .order("plan_tanggal", { ascending: false })
        .order("id", { ascending: false });
      if (opts.planId) q = q.eq("id", opts.planId);
      if (opts.openOnly) q = q.eq("status", "open");
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      plans.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    if (plans.length === 0) return { data: [] as IkPlanRow[], error: null as string | null };
    const planById = new Map(plans.map((p) => [p.id, p]));

    const items = await selectIn(
      supabase,
      "consignment_ik_plan_items",
      "*, so:consignment_so!so_id(so_no, no_po, tgl_po_customer, due_date), so_item:consignment_so_items!so_item_id(qty)",
      "plan_id",
      plans.map((p) => p.id),
    );
    const shipped = await shippedBySoItem(supabase, items.map((i: any) => i.so_item_id));
    const realized = await realizedByPlanItem(supabase, items.map((i: any) => i.id));
    const soh = await stockMap(
      supabase,
      items.map((i: any) => ({ cabangId: planById.get(i.plan_id).dari_cabang_id, partId: i.part_id })),
    );

    const rows: IkPlanRow[] = (items as any[]).map((i) => {
      const plan = planById.get(i.plan_id);
      const qtyPo = Number(i.so_item?.qty) || 0;
      const realizedQty = realized.get(i.id) || 0;
      const sisaPlan = plan.status === "closed" ? 0 : Math.max(0, i.plan_qty - realizedQty);
      const stok = soh.get(`${plan.dari_cabang_id}:${i.part_id}`) || 0;
      return {
        plan_item_id: i.id,
        plan_id: plan.id,
        plan_kode: plan.plan_kode,
        plan_tanggal: plan.plan_tanggal,
        plan_status: plan.status,
        plan_catatan: plan.catatan,
        customer_id: plan.customer_id,
        customer_name: plan.customer?.customer_name ?? null,
        dari_cabang_id: plan.dari_cabang_id,
        dari_cabang_name: plan.cabang?.nama_cabang ?? null,
        so_id: i.so_id,
        so_no: i.so?.so_no ?? "-",
        no_po: i.so?.no_po ?? null,
        tgl_po: i.so?.tgl_po_customer ?? null,
        due_date: i.so?.due_date ?? null,
        so_item_id: i.so_item_id,
        part_id: i.part_id,
        part_number: i.part_number,
        part_name: i.part_name,
        part_number_customer: i.part_number_customer,
        satuan: i.satuan,
        site_id: i.site_id,
        site_name: i.site_name,
        qty_po: qtyPo,
        outstanding: Math.max(0, qtyPo - (shipped.get(i.so_item_id) || 0)),
        soh: stok,
        plan_qty: i.plan_qty,
        realized_qty: realizedQty,
        sisa_plan: sisaPlan,
        selisih_soh: stok - sisaPlan,
        notes: i.notes,
        progress: planItemProgress(plan.status, i.plan_qty, realizedQty),
      };
    });

    const order = new Map(plans.map((p, idx) => [p.id, idx]));
    rows.sort(
      (a, b) =>
        order.get(a.plan_id)! - order.get(b.plan_id)! ||
        (a.no_po || a.so_no).localeCompare(b.no_po || b.so_no) ||
        a.part_number.localeCompare(b.part_number),
    );
    // Selisih SOH kumulatif: baris dgn gudang + part sama berbagi SOH,
    // dijatah urut due date terdekat (lalu tgl planning) -> baris minus =
    // baris yang stoknya tidak kebagian.
    const byStock = new Map<string, IkPlanRow[]>();
    for (const r of rows) {
      const key = `${r.dari_cabang_id}:${r.part_id}`;
      const list = byStock.get(key) || [];
      list.push(r);
      byStock.set(key, list);
    }
    for (const list of byStock.values()) {
      list
        .slice()
        .sort(
          (a, b) =>
            (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
            a.plan_tanggal.localeCompare(b.plan_tanggal) ||
            a.plan_item_id - b.plan_item_id,
        )
        .reduce((cum, r) => {
          const next = cum + r.sisa_plan;
          r.selisih_soh = r.soh - next;
          return next;
        }, 0);
    }

    const data = opts.openOnly ? rows.filter((r) => r.sisa_plan > 0 && r.outstanding > 0) : rows;
    return { data, error: null as string | null };
  } catch (e: any) {
    return { data: [] as IkPlanRow[], error: e.message as string };
  }
}

/** Tutup (sisa plan tidak dieksekusi) atau buka kembali planning. */
export async function setIkPlanStatus(planId: number, status: "open" | "closed") {
  const supabase = await createClient();
  const { user, error: authError } = await requirePlanner(supabase);
  if (!user) return { error: authError };

  // Buka kembali: sisa plan tidak boleh bentrok dgn planning lain yang sudah
  // merencanakan outstanding yang sama selama planning ini tertutup.
  if (status === "open") {
    try {
      const { data: items } = await supabase
        .from("consignment_ik_plan_items")
        .select("id, so_item_id, plan_qty, part_number, so_item:consignment_so_items!so_item_id(qty)")
        .eq("plan_id", planId);
      const soItemIds = (items || []).map((i: any) => i.so_item_id);
      const realized = await realizedByPlanItem(supabase, (items || []).map((i: any) => i.id));
      const shipped = await shippedBySoItem(supabase, soItemIds);
      const planned = await openPlannedBySoItem(supabase, soItemIds, planId);
      const need = new Map<number, { qty: number; pn: string; total: number }>();
      for (const i of (items || []) as any[]) {
        const sisa = Math.max(0, i.plan_qty - (realized.get(i.id) || 0));
        const row = need.get(i.so_item_id) || { qty: 0, pn: i.part_number, total: Number(i.so_item?.qty) || 0 };
        row.qty += sisa;
        need.set(i.so_item_id, row);
      }
      const violations: string[] = [];
      for (const [soItemId, n] of need) {
        // Sisa plan yang sudah lewat outstanding (terkirim lewat IK langsung)
        // memang tak bisa dieksekusi lagi -- bukan bentrok, jadi tidak dihitung.
        const outstanding = Math.max(0, n.total - (shipped.get(soItemId) || 0));
        const effective = Math.min(n.qty, outstanding);
        const avail = outstanding - (planned.get(soItemId) || 0);
        if (effective > avail)
          violations.push(`${n.pn}: sisa plan ${effective}, yang masih bisa direncanakan ${Math.max(0, avail)}.`);
      }
      if (violations.length)
        return { error: "Tidak bisa dibuka kembali, outstanding-nya sudah direncanakan di planning lain:\n" + violations.join("\n") };
    } catch (e: any) {
      return { error: e.message as string };
    }
  }

  const { data, error } = await supabase
    .from("consignment_ik_plans")
    .update(
      status === "closed"
        ? { status, closed_at: new Date().toISOString(), closed_by: user.id }
        : { status, closed_at: null, closed_by: null },
    )
    .eq("id", planId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Planning tidak ditemukan." };
  PLAN_PATHS.forEach((p) => revalidatePath(p));
  return { success: true };
}

/** Hapus planning -- hanya kalau belum ada IK yang dibuat dari planning ini. */
export async function deleteIkPlan(planId: number) {
  const supabase = await createClient();
  const { user, error: authError } = await requirePlanner(supabase);
  if (!user) return { error: authError };

  const { count } = await supabase
    .from("consignment_ik")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId);
  if (count && count > 0)
    return { error: "Planning ini sudah punya IK. Tutup planning-nya saja, atau hapus IK-nya dulu." };

  const { data, error } = await supabase
    .from("consignment_ik_plans")
    .delete()
    .eq("id", planId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Planning sudah dihapus." };
  PLAN_PATHS.forEach((p) => revalidatePath(p));
  return { success: true };
}
