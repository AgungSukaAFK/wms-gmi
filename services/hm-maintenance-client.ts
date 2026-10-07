// Service modul Periodic Maintenance (HM Maintenance) - BUKAN server action:
// semua query jalan dari browser lewat supabase-js, akses dijaga RLS + RPC
// di DB (lihat supabase/migrations/20261005100000_hm_periodic_maintenance.sql).
// Pengecekan admin di client (hm_is_admin) cuma untuk UX (sembunyikan tombol).

import { createClient } from "@/lib/supabase/client";
import type {
  HmHistoryRow,
  HmPartView,
  HmReplacement,
  HmServiceKind,
  HmServiceRecord,
  HmUnit,
  HmUnitSummary,
} from "@/lib/hm";

export type HmCabangOption = { id: number; nama_cabang: string; kode_cabang: string | null };
export type HmBarangOption = { id: number; part_number: string; part_name: string; part_satuan: string };

// ---------- Baca ----------

export async function fetchHmIsAdmin(): Promise<boolean> {
  const { data, error } = await createClient().rpc("hm_is_admin");
  if (error) return false;
  return data === true;
}

/** Site (gudang) yang punya unit HM, urut nama. */
export async function fetchHmSites(): Promise<HmCabangOption[]> {
  const { data, error } = await createClient()
    .from("hm_units")
    .select("cabang:cabang_id(id, nama_cabang, kode_cabang)")
    .not("cabang_id", "is", null);
  if (error) throw error;
  const byId = new Map<number, HmCabangOption>();
  for (const row of (data ?? []) as { cabang: HmCabangOption | HmCabangOption[] | null }[]) {
    const c = Array.isArray(row.cabang) ? row.cabang[0] : row.cabang;
    if (c) byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => a.nama_cabang.localeCompare(b.nama_cabang));
}

/** siteId null = semua site. */
export async function fetchHmUnits(siteId: number | null = null): Promise<HmUnitSummary[]> {
  let q = createClient().from("hm_unit_summaries").select("*");
  if (siteId !== null) q = q.eq("cabang_id", siteId);
  const { data, error } = await q.order("id");
  if (error) throw error;
  return (data ?? []) as HmUnitSummary[];
}

/** siteId null = semua site. */
export async function fetchHmSchedule(siteId: number | null = null): Promise<HmPartView[]> {
  const supabase = createClient();
  let q = supabase.from("hm_part_views").select("*");
  if (siteId !== null) {
    // hm_part_views tidak punya cabang_id -> saring lewat unit di site tsb.
    const { data: units, error: unitError } = await supabase
      .from("hm_units")
      .select("id")
      .eq("cabang_id", siteId);
    if (unitError) throw unitError;
    q = q.in("unit_id", (units ?? []).map((u) => u.id));
  }
  const { data, error } = await q.order("status_rank").order("remaining_hm").order("id");
  if (error) throw error;
  return (data ?? []) as HmPartView[];
}

export async function fetchHmUnitDetail(
  unitId: number,
): Promise<{ unit: HmUnit; cabangName: string | null; parts: HmPartView[] } | null> {
  const supabase = createClient();
  const { data: row, error } = await supabase
    .from("hm_units")
    .select("id, code, name, model, current_hm, cabang_id, cabang:cabang_id(nama_cabang)")
    .eq("id", unitId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const { cabang, ...unit } = row as HmUnit & {
    cabang: { nama_cabang: string } | { nama_cabang: string }[] | null;
  };

  const { data: parts, error: partsError } = await supabase
    .from("hm_part_views")
    .select("*")
    .eq("unit_id", unitId)
    .order("id");
  if (partsError) throw partsError;
  return {
    unit: unit as HmUnit,
    cabangName: (Array.isArray(cabang) ? cabang[0] : cabang)?.nama_cabang ?? null,
    parts: (parts ?? []) as HmPartView[],
  };
}

export async function fetchHmReplacements(partId: number): Promise<HmReplacement[]> {
  const { data, error } = await createClient()
    .from("hm_replacements")
    .select("id, part_id, unit_id, hm, date, note, qty_used, cabang_id")
    .eq("part_id", partId)
    .order("date", { ascending: false })
    .order("id");
  if (error) throw error;
  return (data ?? []) as HmReplacement[];
}

export async function fetchHmServices(unitId: number): Promise<HmServiceRecord[]> {
  const { data, error } = await createClient()
    .from("hm_services")
    .select("id, unit_id, kind, date, hm, note")
    .eq("unit_id", unitId)
    .order("date", { ascending: false })
    .order("id");
  if (error) throw error;
  return (data ?? []) as HmServiceRecord[];
}

/** siteId null = semua site. */
export async function fetchHmHistory(siteId: number | null = null): Promise<HmHistoryRow[]> {
  const supabase = createClient();
  let q = supabase.from("hm_history").select("*");
  if (siteId !== null) {
    // hm_history cuma bawa kode unit -> saring lewat kode unit di site tsb.
    const { data: units, error: unitError } = await supabase
      .from("hm_units")
      .select("code")
      .eq("cabang_id", siteId);
    if (unitError) throw unitError;
    q = q.in("unit_code", (units ?? []).map((u) => u.code));
  }
  const { data, error } = await q
    .order("date", { ascending: false })
    .order("kind_order")
    .order("id");
  if (error) throw error;
  return (data ?? []) as HmHistoryRow[];
}

export async function fetchHmCabangOptions(): Promise<HmCabangOption[]> {
  const { data, error } = await createClient()
    .from("cabang")
    .select("id, nama_cabang, kode_cabang")
    .eq("is_active", true)
    .order("nama_cabang");
  if (error) throw error;
  return (data ?? []) as HmCabangOption[];
}

export async function searchHmBarang(term: string): Promise<HmBarangOption[]> {
  let q = createClient()
    .from("barang")
    .select("id, part_number, part_name, part_satuan")
    .order("part_name")
    .limit(15);
  if (term) q = q.or(`part_number.ilike.%${term}%,part_name.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as HmBarangOption[];
}

// ---------- Tulis (admin: moderator / service, ditegakkan RLS) ----------
// Setiap fungsi melempar error kalau gagal; UI menangkap dan menampilkan
// toast dari hm.md §6.7.

export type HmUnitInput = {
  code: string;
  name: string;
  model: string;
  current_hm: number;
  cabang_id: number | null;
};

export async function createHmUnit(input: HmUnitInput) {
  const { error } = await createClient().from("hm_units").insert(input);
  if (error) throw error;
}

// HM sengaja TIDAK ikut diubah (hm.md §15.3) - pakai updateHmUnitHm.
export async function updateHmUnit(unitId: number, input: Omit<HmUnitInput, "current_hm">) {
  const { error } = await createClient().from("hm_units").update(input).eq("id", unitId);
  if (error) throw error;
}

export async function updateHmUnitHm(unitId: number, currentHm: number) {
  const { error } = await createClient()
    .from("hm_units")
    .update({ current_hm: currentHm })
    .eq("id", unitId);
  if (error) throw error;
}

export async function deleteHmUnit(unitId: number) {
  const { error } = await createClient().from("hm_units").delete().eq("id", unitId);
  if (error) throw error;
}

export type HmPartInput = {
  barang_id: number | null;
  code: string;
  name: string;
  interval_hm: number;
  last_replacement_hm: number;
};

export async function createHmPart(unitId: number, input: HmPartInput) {
  const { error } = await createClient()
    .from("hm_parts")
    .insert({ unit_id: unitId, ...input });
  if (error) throw error;
}

export async function updateHmPart(partId: number, input: HmPartInput) {
  const { error } = await createClient().from("hm_parts").update(input).eq("id", partId);
  if (error) throw error;
}

export async function deleteHmPart(partId: number) {
  const { error } = await createClient().from("hm_parts").delete().eq("id", partId);
  if (error) throw error;
}

export async function recordHmReplacement(input: {
  partId: number;
  hm: number;
  date: Date;
  note: string;
  qtyUsed: number;
}) {
  const { error } = await createClient().rpc("hm_record_replacement", {
    p_part_id: input.partId,
    p_hm: input.hm,
    p_date: input.date.toISOString(),
    p_note: input.note,
    p_qty_used: input.qtyUsed,
  });
  if (error) throw error;
}

export async function recordHmService(input: {
  unitId: number;
  kind: HmServiceKind;
  date: Date;
  hm: number;
  note: string;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("hm_services").insert({
    unit_id: input.unitId,
    kind: input.kind,
    date: input.date.toISOString(),
    hm: input.hm,
    note: input.note,
    created_by: user?.id ?? null,
  });
  if (error) throw error;
}
