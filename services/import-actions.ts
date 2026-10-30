"use server";

// Server action Pusat Import Excel. Semua aksi khusus role moderator.
// Logika per fitur ada di lib/import/server/<fitur>.ts (bukan "use server",
// supaya hanya bisa dijalankan lewat aksi di sini yang sudah dicek role-nya).

import { createClient } from "@/lib/supabase/server";
import { getImportDefinition } from "@/lib/import/registry";
import { IMPORT_HANDLERS } from "@/lib/import/server";
import { type ImportCtx, fetchAll } from "@/lib/import/server/common";
import type { ImportOptionValues, ImportRefs, ImportRow, ImportRowResult } from "@/lib/import/types";

async function requireModerator() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesi berakhir, silakan login ulang." } as const;
  const [{ data: roleRows }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("roles(name)").eq("user_id", user.id),
    supabase.from("profiles").select("nama, email, cabang_id, cabang:cabang_id(nama_cabang)").eq("id", user.id).maybeSingle(),
  ]);
  const roles = (roleRows || []).map((r: any) => (Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name)).filter(Boolean) as string[];
  if (!roles.includes("moderator")) return { error: "Akses ditolak. Import data Excel hanya untuk Moderator." } as const;
  const cab: any = Array.isArray((profile as any)?.cabang) ? (profile as any).cabang[0] : (profile as any)?.cabang;
  return {
    supabase,
    user,
    roles,
    name: profile?.nama || user.email || "Moderator",
    email: profile?.email || user.email || "",
    cabangId: (profile?.cabang_id as number | null) ?? null,
    cabangName: (cab?.nama_cabang as string | null) ?? null,
  } as const;
}

function makeCtx(auth: Exclude<Awaited<ReturnType<typeof requireModerator>>, { error: string }>, options: ImportOptionValues, commit: boolean): ImportCtx {
  return {
    supabase: auth.supabase,
    userId: auth.user.id,
    userName: auth.name,
    userEmail: auth.email,
    userRoles: auth.roles,
    userCabangId: auth.cabangId,
    userCabangName: auth.cabangName,
    options,
    commit,
  };
}

/** Daftar referensi untuk dropdown template + template approval untuk opsi. */
export async function getImportReferences(key: string): Promise<{ data?: ImportRefs; error?: string }> {
  const auth = await requireModerator();
  if ("error" in auth) return { error: auth.error };
  const def = getImportDefinition(key);
  if (!def) return { error: "Jenis import tidak dikenal." };
  const { supabase } = auth;
  const kinds = new Set(def.columns.filter((c) => c.ref && !c.infoOnly).map((c) => c.ref!));
  const refs: ImportRefs = {};
  try {
    if (kinds.has("cabang")) {
      const rows = await fetchAll<any>(() => supabase.from("cabang").select("nama_cabang, is_active").order("nama_cabang"));
      refs.cabang = rows.filter((r) => r.is_active !== false).map((r) => r.nama_cabang);
    }
    if (kinds.has("satuan")) {
      const { data } = await supabase.rpc("import_ref_satuan");
      refs.satuan = (data || []).map((r: any) => r.satuan);
    }
    if (kinds.has("customer") || kinds.has("customer_consignment")) {
      const rows = await fetchAll<any>(() => supabase.from("customers").select("customer_no, customer_type, is_active").eq("is_active", true).order("customer_no"));
      if (kinds.has("customer")) refs.customer = rows.filter((r) => r.customer_type !== "consignment").map((r) => r.customer_no);
      if (kinds.has("customer_consignment")) refs.customer_consignment = rows.filter((r) => r.customer_type !== "non_consignment").map((r) => r.customer_no);
    }
    if (kinds.has("vendor")) {
      const rows = await fetchAll<any>(() => supabase.from("vendors").select("vendor_no, is_active").eq("is_active", true).is("deleted_at", null).order("vendor_no"));
      refs.vendor = rows.map((r) => r.vendor_no);
    }
    const tplTypes = (def.options || []).filter((o) => o.type === "approval_template").map((o: any) => o.templateType as string);
    if (tplTypes.length) {
      const { data } = await supabase
        .from("approval_templates")
        .select("id, name, type, cabang:cabang_id(nama_cabang)")
        .in("type", tplTypes)
        .order("name");
      refs.approvalTemplates = {};
      for (const t of data || []) {
        const c: any = Array.isArray(t.cabang) ? t.cabang[0] : t.cabang;
        (refs.approvalTemplates[t.type] ||= []).push({ id: t.id, name: t.name, cabang: c?.nama_cabang || null });
      }
    }
  } catch (e: any) {
    return { error: e?.message || "Gagal memuat daftar referensi." };
  }
  return { data: refs };
}

/** Baris data saat ini untuk template "isi data" (download -> edit -> upload). */
export async function getImportPrefill(
  key: string,
  params: { mode: string; cabangIds: number[] },
): Promise<{ data?: Record<string, unknown>[]; error?: string }> {
  const auth = await requireModerator();
  if ("error" in auth) return { error: auth.error };
  const handler = IMPORT_HANDLERS[key];
  if (!handler?.prefill) return { error: "Template isi-data tidak tersedia untuk fitur ini." };
  try {
    const rows = await handler.prefill(makeCtx(auth, {}, false), { mode: params.mode, cabangIds: params.cabangIds || [] });
    return { data: rows };
  } catch (e: any) {
    return { error: e?.message || "Gagal memuat data." };
  }
}

/** Preview (commit=false) atau proses (commit=true) 1 batch baris. */
export async function runImportBatch(
  key: string,
  rows: ImportRow[],
  options: ImportOptionValues,
  commit: boolean,
): Promise<{ data?: ImportRowResult[]; error?: string }> {
  const auth = await requireModerator();
  if ("error" in auth) return { error: auth.error };
  const handler = IMPORT_HANDLERS[key];
  if (!handler) return { error: "Jenis import tidak dikenal." };
  if (!rows?.length) return { data: [] };
  try {
    const results = await handler.run(makeCtx(auth, options || {}, commit), rows);
    return { data: results };
  } catch (e: any) {
    console.error(`[import:${key}]`, e);
    return { error: e?.message || "Terjadi kesalahan saat memproses." };
  }
}

export async function saveImportLog(entry: {
  key: string;
  fileName: string;
  options: ImportOptionValues;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  summary?: string;
}) {
  const auth = await requireModerator();
  if ("error" in auth) return { error: auth.error };
  const def = getImportDefinition(entry.key);
  const { error } = await auth.supabase.from("import_logs").insert({
    feature_key: entry.key,
    feature_title: def?.title || entry.key,
    file_name: entry.fileName,
    options: entry.options || {},
    rows_total: entry.total,
    rows_created: entry.created,
    rows_updated: entry.updated,
    rows_skipped: entry.skipped,
    rows_error: entry.errors,
    summary: entry.summary || null,
    created_by: auth.user.id,
    created_by_name: auth.name,
  });
  return { error: error?.message };
}

export async function getImportLogs(key?: string) {
  const auth = await requireModerator();
  if ("error" in auth) return { data: [], error: auth.error };
  let q = auth.supabase.from("import_logs").select("*").order("created_at", { ascending: false }).limit(50);
  if (key) q = q.eq("feature_key", key);
  const { data, error } = await q;
  return { data: data || [], error: error?.message };
}

export async function getImportAccess() {
  const auth = await requireModerator();
  return { allowed: !("error" in auth) };
}
