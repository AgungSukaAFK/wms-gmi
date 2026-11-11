"use server";

// Data dashboard utama. Hak akses (ringkasan global, nilai Rupiah) ditentukan
// di dalam RPC dari role user yang login, jadi argumen dari client tidak bisa
// dipakai untuk membuka data yang bukan haknya.
//
// Ringkasan dipecah per bagian (core / period / exec_a / exec_b) yang
// dipanggil paralel: tiap bagian punya batas waktu statement sendiri, dan
// bagian yang gagal tidak menjatuhkan bagian lain.

import { createClient } from "@/lib/supabase/server";
import type { DashboardFilters } from "@/lib/dashboard/filters";
import type {
  DashboardCore,
  DashboardExecAPart,
  DashboardExecBPart,
  DashboardPart,
  DashboardPeriodPart,
  ListArgs,
  ListKind,
  ListResult,
  ListScope,
  PartResult,
} from "@/lib/dashboard/types";

const orNull = <T,>(list: T[]) => (list.length > 0 ? list : null);

type PartData = {
  core: DashboardCore;
  period: DashboardPeriodPart;
  exec_a: DashboardExecAPart;
  exec_b: DashboardExecBPart;
};

/** Pesan error yang bisa dipahami user (detail teknis tetap ikut). */
function friendlyError(message: string) {
  if (/statement timeout/i.test(message)) {
    return "Database terlalu lama merespons. Coba muat ulang, atau persempit periode/lokasi.";
  }
  if (/get_main_dashboard_summary|get_main_dashboard_list|schema cache/i.test(message)) {
    return `Fungsi dashboard belum tersedia di database (${message}).`;
  }
  return message;
}

export async function fetchDashboardPart<P extends DashboardPart>(
  filters: DashboardFilters,
  part: P,
): Promise<PartResult<PartData[P]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_main_dashboard_summary", {
      p_cabang_ids: orNull(filters.cabangIds),
      p_date_from: filters.from,
      p_date_to: filters.to,
      p_prev_from: filters.prevFrom,
      p_prev_to: filters.prevTo,
      p_trend_from: filters.trendFrom,
      p_kategori: orNull(filters.kategori),
      p_priorities: orNull(filters.priorities),
      // Tanpa pilihan lokasi di URL: user non-atasan dibatasi ke cabangnya.
      p_own_cabang_default: filters.cabangIds.length === 0 && !filters.lokasiAll,
      p_part: part,
    });
    if (error) return { data: null, error: friendlyError(error.message) };
    return { data: data as PartData[P], error: null };
  } catch (e) {
    return { data: null, error: friendlyError(e instanceof Error ? e.message : String(e)) };
  }
}

const MAX_LIMIT = 5000;

export async function fetchDashboardList(input: {
  kind: ListKind;
  args?: ListArgs;
  scope: ListScope;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: ListResult | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_main_dashboard_list", {
    p_kind: input.kind,
    p_cabang_ids: orNull(input.scope.cabangIds),
    p_date_from: input.scope.from,
    p_date_to: input.scope.to,
    p_kategori: orNull(input.scope.kategori),
    p_priorities: orNull(input.scope.priorities),
    p_args: input.args ?? {},
    p_search: input.search?.trim() || null,
    p_limit: Math.min(Math.max(input.limit ?? 20, 1), MAX_LIMIT),
    p_offset: Math.max(input.offset ?? 0, 0),
  });
  if (error) return { data: null, error: friendlyError(error.message) };
  return { data: data as ListResult, error: null };
}
