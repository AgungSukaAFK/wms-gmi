"use server";

// Data dashboard utama. Hak akses (ringkasan global, nilai Rupiah) ditentukan
// di dalam RPC dari role user yang login, jadi argumen dari client tidak bisa
// dipakai untuk membuka data yang bukan haknya.

import { createClient } from "@/lib/supabase/server";
import type { DashboardFilters } from "@/lib/dashboard/filters";
import type {
  DashboardSummary,
  ListArgs,
  ListKind,
  ListResult,
  ListScope,
} from "@/lib/dashboard/types";

const orNull = <T,>(list: T[]) => (list.length > 0 ? list : null);

export async function fetchDashboardSummary(
  filters: DashboardFilters,
): Promise<{ data: DashboardSummary | null; error: string | null }> {
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
  });
  if (error) return { data: null, error: error.message };
  return { data: data as DashboardSummary, error: null };
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
  if (error) return { data: null, error: error.message };
  return { data: data as ListResult, error: null };
}
