// Service Forecasting AC (modul HM Maintenance) - query dari browser lewat
// supabase-js, akses dijaga RLS + RPC di DB (lihat
// supabase/migrations/20261005120000_hm_ac_forecast.sql).

import { createClient } from "@/lib/supabase/client";
import type { HmUnit } from "@/lib/hm";
import {
  periodDbValue,
  type HmAcBarangRef,
  type AcScheduleDraft,
  type HmAcExtraItem,
  type HmAcSchedule,
  type HmAcPackage,
  type HmAcPackageItem,
  type HmAcSection,
  type HmAcUnitSetting,
} from "@/lib/hm-ac";

// ---------- Baca ----------

/** siteId null = semua site. Sama dengan daftar unit modul Periodic Maintenance. */
export async function fetchAcUnits(siteId: number | null = null): Promise<HmUnit[]> {
  let q = createClient().from("hm_units").select("id, code, name, model, current_hm, cabang_id");
  if (siteId !== null) q = q.eq("cabang_id", siteId);
  const { data, error } = await q.order("code");
  if (error) throw error;
  return (data ?? []) as HmUnit[];
}

export async function fetchAcSettings(): Promise<HmAcUnitSetting[]> {
  const { data, error } = await createClient()
    .from("hm_ac_units")
    .select("unit_id, section, package_id, interval_hm, last_service_hm, daily_hm, is_active");
  if (error) throw error;
  return (data ?? []).map((s) => ({ ...s, daily_hm: Number(s.daily_hm) })) as HmAcUnitSetting[];
}

export async function fetchAcPackages(): Promise<HmAcPackage[]> {
  const { data, error } = await createClient()
    .from("hm_ac_packages")
    .select(
      "id, name, note, items:hm_ac_package_items(id, package_id, barang_id, name, qty, unit_price, barang:barang_id(part_number, part_name, part_satuan))",
    )
    .order("name");
  if (error) throw error;
  type RawItem = Omit<HmAcPackageItem, "barang"> & {
    barang: HmAcBarangRef | HmAcBarangRef[] | null;
  };
  return (data ?? []).map((p) => ({
    ...p,
    items: ((p.items ?? []) as unknown as RawItem[])
      .map((it): HmAcPackageItem => ({
        ...it,
        barang: Array.isArray(it.barang) ? (it.barang[0] ?? null) : (it.barang ?? null),
        qty: Number(it.qty),
        unit_price: Number(it.unit_price),
      }))
      .sort((a, b) => a.id - b.id),
  })) as HmAcPackage[];
}

export async function fetchAcExtras(periodKeys: string[]): Promise<HmAcExtraItem[]> {
  const { data, error } = await createClient()
    .from("hm_ac_extra_items")
    .select(
      "id, unit_id, period, barang_id, name, qty, unit_price, note, barang:barang_id(part_number, part_name, part_satuan)",
    )
    .in("period", periodKeys.map(periodDbValue))
    .order("id");
  if (error) throw error;
  return (data ?? []).map((e) => ({
    ...e,
    barang: Array.isArray(e.barang) ? (e.barang[0] ?? null) : (e.barang ?? null),
    qty: Number(e.qty),
    unit_price: Number(e.unit_price),
  })) as HmAcExtraItem[];
}

export async function fetchAcSchedules(periodKeys: string[]): Promise<HmAcSchedule[]> {
  const { data, error } = await createClient()
    .from("hm_ac_schedules")
    .select("unit_id, period, day_hours, smu_hm, repair_option, target_pa, unscheduled_hours, note")
    .in("period", periodKeys.map(periodDbValue));
  if (error) throw error;
  return (data ?? []).map((s) => ({
    ...s,
    day_hours: ((s.day_hours ?? []) as (number | string)[]).map(Number),
    target_pa: Number(s.target_pa),
    unscheduled_hours: Number(s.unscheduled_hours),
  })) as HmAcSchedule[];
}

/** Simpan isian grid beberapa unit sekaligus (upsert per unit+bulan). */
export async function saveAcSchedules(periodKey: string, rows: { unitId: number; draft: AcScheduleDraft }[]) {
  if (rows.length === 0) return;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("hm_ac_schedules").upsert(
    rows.map(({ unitId, draft }) => ({
      unit_id: unitId,
      period: periodDbValue(periodKey),
      ...draft,
      created_by: user?.id ?? null,
    })),
    { onConflict: "unit_id,period" },
  );
  if (error) throw error;
}

export async function deleteAcSchedule(unitId: number, periodKey: string) {
  const { error } = await createClient()
    .from("hm_ac_schedules")
    .delete()
    .eq("unit_id", unitId)
    .eq("period", periodDbValue(periodKey));
  if (error) throw error;
}

/** Stok per (barang, gudang) untuk barang yang dibutuhkan forecast. */
export async function fetchAcStock(
  barangIds: number[],
): Promise<{ part_id: number; cabang_id: number; qty: number }[]> {
  if (barangIds.length === 0) return [];
  const { data, error } = await createClient()
    .from("stock")
    .select("part_id, cabang_id, qty")
    .in("part_id", barangIds);
  if (error) throw error;
  return (data ?? []) as { part_id: number; cabang_id: number; qty: number }[];
}

// ---------- Tulis (admin: moderator / service, ditegakkan RLS) ----------

export type AcSettingInput = {
  section: HmAcSection;
  package_id: number | null;
  interval_hm: number;
  last_service_hm: number;
  daily_hm: number;
  is_active: boolean;
};

export async function upsertAcSetting(unitId: number, input: AcSettingInput) {
  const { error } = await createClient()
    .from("hm_ac_units")
    .upsert({ unit_id: unitId, ...input }, { onConflict: "unit_id" });
  if (error) throw error;
}

export async function deleteAcSetting(unitId: number) {
  const { error } = await createClient().from("hm_ac_units").delete().eq("unit_id", unitId);
  if (error) throw error;
}

export async function recordAcService(input: { unitId: number; hm: number; date: Date; note: string }) {
  const { error } = await createClient().rpc("hm_record_ac_service", {
    p_unit_id: input.unitId,
    p_hm: input.hm,
    p_date: input.date.toISOString(),
    p_note: input.note,
  });
  if (error) throw error;
}

export type AcItemInput = {
  barang_id: number | null;
  name: string;
  qty: number;
  unit_price: number;
};

/** Simpan paket + ganti seluruh itemnya. Mengembalikan id paket. */
export async function saveAcPackage(
  packageId: number | null,
  input: { name: string; note: string; items: AcItemInput[] },
): Promise<number> {
  const supabase = createClient();
  let id = packageId;
  if (id) {
    const { error } = await supabase
      .from("hm_ac_packages")
      .update({ name: input.name, note: input.note })
      .eq("id", id);
    if (error) throw error;
    const { error: delError } = await supabase.from("hm_ac_package_items").delete().eq("package_id", id);
    if (delError) throw delError;
  } else {
    const { data, error } = await supabase
      .from("hm_ac_packages")
      .insert({ name: input.name, note: input.note })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as number;
  }
  if (input.items.length > 0) {
    const { error } = await supabase
      .from("hm_ac_package_items")
      .insert(input.items.map((it) => ({ ...it, package_id: id })));
    if (error) throw error;
  }
  return id;
}

export async function deleteAcPackage(packageId: number) {
  const { error } = await createClient().from("hm_ac_packages").delete().eq("id", packageId);
  if (error) throw error;
}

export async function createAcExtra(
  unitId: number,
  periodKey: string,
  input: AcItemInput & { note: string },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("hm_ac_extra_items").insert({
    unit_id: unitId,
    period: periodDbValue(periodKey),
    ...input,
    created_by: user?.id ?? null,
  });
  if (error) throw error;
}

export async function deleteAcExtra(extraId: number) {
  const { error } = await createClient().from("hm_ac_extra_items").delete().eq("id", extraId);
  if (error) throw error;
}
