"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  completedFilterStatuses,
  normalizeDocumentStatus,
  toCompletedIfLegacy,
} from "@/lib/document-status";

/**
 * JOB COSTING SERVICES
 */
export async function getJobCostingList(params?: {
  search?: string;
  status?: string;
  cabang_id?: number;
  page?: number;
  limit?: number;
}) {
  const supabase = await createClient();
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 25;
  const from = (page - 1) * limit;

  let query = supabase
    .from("job_costing")
    .select(
      "*, cabang!job_costing_cabang_id_fkey(nama_cabang), job_costing_items(id, unit_price, qty), job_costing_finish_parts(id, qty)",
      {
        count: "exact",
      },
    )
    .order("created_at", { ascending: false });

  if (params?.search) {
    query = query.or(
      `job_kode.ilike.%${params.search}%,description.ilike.%${params.search}%,finish_part.ilike.%${params.search}%`,
    );
  }
  if (params?.status && params.status !== "all") {
    if (params.status === "completed") {
      query = query.in("status", completedFilterStatuses());
    } else {
      query = query.eq("status", params.status);
    }
  }
  if (params?.cabang_id) {
    query = query.eq("cabang_id", params.cabang_id);
  }

  query = query.range(from, from + limit - 1);

  const { data, error, count } = await query;
  if (error) return { data: [], count: 0, error: error.message };
  return { data: data ?? [], count: count ?? 0 };
}

export async function getJobCostingById(id: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_costing")
    .select(
      "*, cabang!job_costing_cabang_id_fkey(nama_cabang), finish_part_cabang:cabang!job_costing_finish_part_cabang_id_fkey(nama_cabang), job_costing_items(*, source_cabang:cabang!job_costing_items_source_cabang_id_fkey(nama_cabang), po:po_id(po_kode)), job_costing_finish_parts(*, cabang:cabang!job_costing_finish_parts_cabang_id_fkey(nama_cabang))",
    )
    .eq("id", id)
    .single();

  if (error) return { error: error.message };

  let creator_nama: string | null = null;
  if (data?.created_by) {
    const { data: profileData } = await supabase
      .from("profiles")
      .select("nama")
      .eq("id", data.created_by)
      .maybeSingle();
    creator_nama = profileData?.nama || null;
  }

  return { data: { ...data, creator_nama } };
}

async function getCurrentUserRoles() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null,
      roles: [] as string[],
      error: "Tidak terautentikasi.",
    };
  }

  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);

  if (error) {
    return { user, roles: [] as string[], error: error.message };
  }

  const roles = (roleRows || [])
    .map((r: any) => r.roles?.name)
    .filter(Boolean) as string[];

  return { user, roles, error: null as string | null };
}

async function canManageJobCostingStatus() {
  const { user, roles, error } = await getCurrentUserRoles();
  if (error || !user) return { allowed: false, error: error || "Unauthorized" };

  const allowed = roles.some((r) => ["admin", "moderator"].includes(r));
  return {
    allowed,
    error: allowed
      ? null
      : "Akses ditolak. Hanya admin/moderator yang diizinkan mengubah status.",
  };
}

async function canManageJobCostingItems(jobId: number) {
  const supabase = await createClient();
  const { user, roles, error } = await getCurrentUserRoles();
  if (error || !user) return { allowed: false, error: error || "Unauthorized" };

  const { data: job, error: jobError } = await supabase
    .from("job_costing")
    .select("created_by, status")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return {
      allowed: false,
      error: jobError?.message || "Job Costing tidak ditemukan.",
    };
  }

  if (job.status !== "open") {
    return {
      allowed: false,
      error: "Item hanya bisa diubah saat status masih open.",
    };
  }

  const isAdminLike = roles.some((r) => ["admin", "moderator"].includes(r));
  const isOwner = job.created_by === user.id;

  return {
    allowed: isAdminLike || isOwner,
    error:
      isAdminLike || isOwner
        ? null
        : "Akses ditolak. Hanya pembuat job/admin/moderator yang boleh mengubah item.",
  };
}

const STOCK_APPLIED_STATUSES = new Set(["approved", "completed"]);

function shouldApplyStock(status: string): boolean {
  return STOCK_APPLIED_STATUSES.has(normalizeDocumentStatus(status));
}

type StockLine = {
  partId: number;
  cabangId: number;
  qty: number;
  label: string;
};

type StockOpResult = { success: true } | { success: false; error: string };

function aggregateStockLines(lines: StockLine[]): StockLine[] {
  const map = new Map<string, StockLine>();
  for (const line of lines) {
    const key = `${line.partId}:${line.cabangId}`;
    const existing = map.get(key);
    if (existing) {
      existing.qty += line.qty;
    } else {
      map.set(key, { ...line });
    }
  }
  return [...map.values()];
}

// Applies a job costing's stock effect (material OUT + finish part IN).
// Used both by createJobCosting (when the initial status is already in the
// applied bucket) and by updateJobCostingStatus (on transition into it).
async function applyJobCostingStock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    jobKode: string;
    userId: string;
    materialLines: StockLine[];
    finishPartLines: StockLine[];
  },
): Promise<StockOpResult> {
  const materialAgg = aggregateStockLines(params.materialLines);
  const finishAgg = aggregateStockLines(params.finishPartLines);

  // Phase 1: read-only validation, no mutation yet.
  const materialSnapshots: Array<{
    stockId: number;
    oldQty: number;
    newQty: number;
    line: StockLine;
  }> = [];
  for (const line of materialAgg) {
    const { data: stockRow, error: stockErr } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", line.partId)
      .eq("cabang_id", line.cabangId)
      .maybeSingle();

    if (stockErr || !stockRow) {
      return {
        success: false,
        error: `Stok bahan ${line.label} tidak ditemukan pada cabang asal terpilih.`,
      };
    }

    const oldQty = Number(stockRow.qty) || 0;
    if (oldQty < line.qty) {
      return {
        success: false,
        error: `Stok bahan ${line.label} tidak mencukupi (tersedia: ${oldQty}, dibutuhkan: ${line.qty}).`,
      };
    }

    materialSnapshots.push({
      stockId: Number(stockRow.id),
      oldQty,
      newQty: oldQty - line.qty,
      line,
    });
  }

  const finishSnapshots: Array<{
    stockId: number | null;
    oldQty: number;
    line: StockLine;
  }> = [];
  for (const line of finishAgg) {
    const { data: stockRow } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", line.partId)
      .eq("cabang_id", line.cabangId)
      .maybeSingle();

    finishSnapshots.push({
      stockId: stockRow ? Number(stockRow.id) : null,
      oldQty: stockRow ? Number(stockRow.qty) || 0 : 0,
      line,
    });
  }

  // Phase 2: sequential mutation with manual rollback-on-failure.
  const appliedMaterial: Array<{ stockId: number; oldQty: number }> = [];
  const appliedFinish: Array<{
    stockId: number;
    oldQty: number;
    wasInsert: boolean;
  }> = [];

  async function rollbackAll() {
    for (const a of appliedMaterial) {
      await supabase
        .from("stock")
        .update({ qty: a.oldQty })
        .eq("id", a.stockId);
    }
    for (const a of appliedFinish) {
      if (a.wasInsert) {
        await supabase.from("stock").delete().eq("id", a.stockId);
      } else {
        await supabase
          .from("stock")
          .update({ qty: a.oldQty })
          .eq("id", a.stockId);
      }
    }
  }

  for (const snap of materialSnapshots) {
    const { data: updated, error: updErr } = await supabase
      .from("stock")
      .update({ qty: snap.newQty })
      .eq("id", snap.stockId)
      .eq("qty", snap.oldQty)
      .select("id");

    if (updErr || !updated || updated.length === 0) {
      await rollbackAll();
      return {
        success: false,
        error: `Stok bahan ${snap.line.label} berubah sejak awal pemrosesan, silakan coba lagi.`,
      };
    }
    appliedMaterial.push({ stockId: snap.stockId, oldQty: snap.oldQty });

    await supabase.from("stock_movements").insert({
      part_id: snap.line.partId,
      cabang_id: snap.line.cabangId,
      qty_change: -snap.line.qty,
      type: "JC_OUT",
      reference_id: params.jobKode,
      notes: "Pengurangan bahan Job Costing",
      created_by: params.userId,
    });
  }

  for (const snap of finishSnapshots) {
    if (snap.stockId) {
      const newQty = snap.oldQty + snap.line.qty;
      const { data: updated, error: updErr } = await supabase
        .from("stock")
        .update({ qty: newQty })
        .eq("id", snap.stockId)
        .eq("qty", snap.oldQty)
        .select("id");

      if (updErr || !updated || updated.length === 0) {
        await rollbackAll();
        return {
          success: false,
          error: `Stok finish part ${snap.line.label} berubah sejak awal pemrosesan, silakan coba lagi.`,
        };
      }
      appliedFinish.push({
        stockId: snap.stockId,
        oldQty: snap.oldQty,
        wasInsert: false,
      });
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("stock")
        .insert({
          part_id: snap.line.partId,
          cabang_id: snap.line.cabangId,
          qty: snap.line.qty,
        })
        .select("id")
        .single();

      if (insErr || !inserted) {
        await rollbackAll();
        return {
          success: false,
          error: `Gagal membuat stok finish part ${snap.line.label}, kemungkinan sudah dibuat proses lain. Silakan coba lagi.`,
        };
      }
      appliedFinish.push({
        stockId: Number(inserted.id),
        oldQty: 0,
        wasInsert: true,
      });
    }

    await supabase.from("stock_movements").insert({
      part_id: snap.line.partId,
      cabang_id: snap.line.cabangId,
      qty_change: snap.line.qty,
      type: "JC_IN",
      reference_id: params.jobKode,
      notes: "Penambahan finish part Job Costing",
      created_by: params.userId,
    });
  }

  return { success: true };
}

// Reverses a job costing's stock effect (material back IN, finish part back
// OUT). Used by updateJobCostingStatus on transition out of the applied
// bucket. Finish part reversal is blocked outright if it would take stock
// negative (it may have already been consumed elsewhere since being
// applied) -- material reversal is always safe since it only adds back.
async function reverseJobCostingStock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    jobKode: string;
    userId: string;
    materialLines: StockLine[];
    finishPartLines: StockLine[];
  },
): Promise<StockOpResult> {
  const materialAgg = aggregateStockLines(params.materialLines);
  const finishAgg = aggregateStockLines(params.finishPartLines);

  // Phase 1: read-only validation.
  const finishSnapshots: Array<{
    stockId: number;
    oldQty: number;
    line: StockLine;
  }> = [];
  for (const line of finishAgg) {
    const { data: stockRow } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", line.partId)
      .eq("cabang_id", line.cabangId)
      .maybeSingle();

    const currentQty = stockRow ? Number(stockRow.qty) || 0 : 0;
    if (!stockRow || currentQty < line.qty) {
      return {
        success: false,
        error:
          `Tidak bisa mengubah status: stok finish part ${line.label} saat ini hanya ${currentQty}, ` +
          `padahal ${line.qty} perlu dikurangi akibat pembatalan status. Kemungkinan stok sudah ` +
          `terpakai/keluar sejak di-approve. Sesuaikan stok secara manual sebelum mengubah status job ini.`,
      };
    }

    finishSnapshots.push({
      stockId: Number(stockRow.id),
      oldQty: currentQty,
      line,
    });
  }

  const materialSnapshots: Array<{
    stockId: number | null;
    oldQty: number;
    line: StockLine;
  }> = [];
  for (const line of materialAgg) {
    const { data: stockRow } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", line.partId)
      .eq("cabang_id", line.cabangId)
      .maybeSingle();

    materialSnapshots.push({
      stockId: stockRow ? Number(stockRow.id) : null,
      oldQty: stockRow ? Number(stockRow.qty) || 0 : 0,
      line,
    });
  }

  // Phase 2: sequential mutation with manual rollback-on-failure.
  const appliedFinish: Array<{ stockId: number; oldQty: number }> = [];
  const appliedMaterial: Array<{
    stockId: number;
    oldQty: number;
    wasInsert: boolean;
  }> = [];

  async function rollbackAll() {
    for (const a of appliedFinish) {
      await supabase
        .from("stock")
        .update({ qty: a.oldQty })
        .eq("id", a.stockId);
    }
    for (const a of appliedMaterial) {
      if (a.wasInsert) {
        await supabase.from("stock").delete().eq("id", a.stockId);
      } else {
        await supabase
          .from("stock")
          .update({ qty: a.oldQty })
          .eq("id", a.stockId);
      }
    }
  }

  for (const snap of finishSnapshots) {
    const newQty = snap.oldQty - snap.line.qty;
    const { data: updated, error: updErr } = await supabase
      .from("stock")
      .update({ qty: newQty })
      .eq("id", snap.stockId)
      .eq("qty", snap.oldQty)
      .select("id");

    if (updErr || !updated || updated.length === 0) {
      await rollbackAll();
      return {
        success: false,
        error: `Stok finish part ${snap.line.label} berubah sejak awal pemrosesan, silakan coba lagi.`,
      };
    }
    appliedFinish.push({ stockId: snap.stockId, oldQty: snap.oldQty });

    await supabase.from("stock_movements").insert({
      part_id: snap.line.partId,
      cabang_id: snap.line.cabangId,
      qty_change: -snap.line.qty,
      type: "JC_IN_REVERSE",
      reference_id: params.jobKode,
      notes: "Pembatalan penerapan finish part Job Costing",
      created_by: params.userId,
    });
  }

  for (const snap of materialSnapshots) {
    if (snap.stockId) {
      const newQty = snap.oldQty + snap.line.qty;
      const { data: updated, error: updErr } = await supabase
        .from("stock")
        .update({ qty: newQty })
        .eq("id", snap.stockId)
        .eq("qty", snap.oldQty)
        .select("id");

      if (updErr || !updated || updated.length === 0) {
        await rollbackAll();
        return {
          success: false,
          error: `Stok bahan ${snap.line.label} berubah sejak awal pemrosesan, silakan coba lagi.`,
        };
      }
      appliedMaterial.push({
        stockId: snap.stockId,
        oldQty: snap.oldQty,
        wasInsert: false,
      });
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("stock")
        .insert({
          part_id: snap.line.partId,
          cabang_id: snap.line.cabangId,
          qty: snap.line.qty,
        })
        .select("id")
        .single();

      if (insErr || !inserted) {
        await rollbackAll();
        return {
          success: false,
          error: `Gagal mengembalikan stok bahan ${snap.line.label}. Silakan coba lagi.`,
        };
      }
      appliedMaterial.push({
        stockId: Number(inserted.id),
        oldQty: 0,
        wasInsert: true,
      });
    }

    await supabase.from("stock_movements").insert({
      part_id: snap.line.partId,
      cabang_id: snap.line.cabangId,
      qty_change: snap.line.qty,
      type: "JC_OUT_REVERSE",
      reference_id: params.jobKode,
      notes: "Pengembalian bahan Job Costing (pembatalan status)",
      created_by: params.userId,
    });
  }

  return { success: true };
}

export async function createJobCosting(data: {
  job_kode: string;
  cabang_id: number;
  description: string;
  finish_parts: {
    part_id: number;
    part_number?: string;
    part_name?: string;
    qty: number;
    cabang_id: number;
    notes?: string;
  }[];
  job_tanggal?: string;
  status?: "open" | "approved" | "completed" | "rejected";
  notes?: string;
  items: {
    part_id?: number | null;
    part_number?: string;
    part_name?: string;
    description: string;
    qty: number;
    unit: string;
    unit_price: number;
    po_id?: number | null;
    source_cabang_id: number;
    notes?: string;
  }[];
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  if (!data.finish_parts?.length) {
    return { error: "Tambahkan minimal satu finish part." };
  }

  for (const fp of data.finish_parts) {
    if (!fp.part_id || fp.part_id <= 0) {
      return { error: "Finish part wajib dipilih." };
    }
    if (!fp.cabang_id || fp.cabang_id <= 0) {
      return {
        error: `Cabang tujuan finish part ${fp.part_number || "-"} wajib dipilih.`,
      };
    }
    if (!Number.isFinite(fp.qty) || fp.qty <= 0) {
      return {
        error: `Qty finish part ${fp.part_number || fp.part_name || "-"} wajib lebih dari 0.`,
      };
    }
  }

  if (!data.items?.length) {
    return { error: "Tambahkan minimal satu item bahan." };
  }

  for (const item of data.items) {
    if (!item.part_id || item.part_id <= 0) {
      return { error: "Part item wajib dipilih." };
    }
    if (!item.source_cabang_id || item.source_cabang_id <= 0) {
      return {
        error: `Cabang asal part ${item.part_number || "-"} wajib dipilih.`,
      };
    }
    if (!Number.isFinite(item.qty) || item.qty <= 0) {
      return {
        error: `Qty part ${item.part_number || item.part_name || "-"} wajib lebih dari 0.`,
      };
    }
  }

  // Check duplicate kode
  const { data: existing } = await supabase
    .from("job_costing")
    .select("id")
    .eq("job_kode", data.job_kode)
    .maybeSingle();
  if (existing) return { error: "Kode Job sudah digunakan." };

  const total_cost = data.items.reduce(
    (sum, item) => sum + item.qty * item.unit_price,
    0,
  );
  const normalizedStatus = toCompletedIfLegacy(data.status || "open");
  const primaryFinishPart = data.finish_parts[0];
  const finishPartSummary = data.finish_parts
    .map(
      (fp) => `${fp.part_number || "-"} - ${fp.part_name || "-"} (${fp.qty})`,
    )
    .join(", ");

  const { data: job, error } = await supabase
    .from("job_costing")
    .insert({
      job_kode: data.job_kode,
      cabang_id: data.cabang_id,
      description: data.description,
      finish_part_id: primaryFinishPart.part_id,
      finish_part_cabang_id: primaryFinishPart.cabang_id,
      qty_finish_part: primaryFinishPart.qty,
      finish_part: finishPartSummary || null,
      job_tanggal: data.job_tanggal || null,
      notes: data.notes || null,
      total_cost,
      status: normalizedStatus,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  if (data.items.length > 0) {
    const itemRows = data.items.map((item) => ({
      job_id: job.id,
      part_id: item.part_id || null,
      part_number: item.part_number || null,
      part_name: item.part_name || null,
      description: item.description,
      qty: item.qty,
      unit: item.unit,
      unit_price: item.unit_price,
      po_id: item.po_id || null,
      source_cabang_id: item.source_cabang_id,
      notes: item.notes || null,
    }));
    const { error: itemError } = await supabase
      .from("job_costing_items")
      .insert(itemRows);
    if (itemError) {
      await supabase.from("job_costing").delete().eq("id", job.id);
      return { error: itemError.message };
    }
  }

  const finishPartRows = data.finish_parts.map((fp) => ({
    job_id: job.id,
    part_id: fp.part_id,
    part_number: fp.part_number || null,
    part_name: fp.part_name || null,
    qty: fp.qty,
    cabang_id: fp.cabang_id,
    notes: fp.notes || null,
  }));
  const { error: fpError } = await supabase
    .from("job_costing_finish_parts")
    .insert(finishPartRows);
  if (fpError) {
    await supabase.from("job_costing").delete().eq("id", job.id);
    return { error: fpError.message };
  }

  if (shouldApplyStock(normalizedStatus)) {
    const materialLines: StockLine[] = data.items.map((i) => ({
      partId: i.part_id!,
      cabangId: i.source_cabang_id,
      qty: i.qty,
      label: i.part_number || i.part_name || "-",
    }));
    const finishPartLines: StockLine[] = data.finish_parts.map((fp) => ({
      partId: fp.part_id,
      cabangId: fp.cabang_id,
      qty: fp.qty,
      label: fp.part_number || fp.part_name || "-",
    }));

    const applyResult = await applyJobCostingStock(supabase, {
      jobKode: data.job_kode,
      userId: user.id,
      materialLines,
      finishPartLines,
    });
    if (!applyResult.success) {
      await supabase.from("job_costing").delete().eq("id", job.id);
      return { error: applyResult.error };
    }

    const { error: markErr } = await supabase
      .from("job_costing")
      .update({ stock_applied_at: new Date().toISOString() })
      .eq("id", job.id);
    if (markErr) {
      await reverseJobCostingStock(supabase, {
        jobKode: data.job_kode,
        userId: user.id,
        materialLines,
        finishPartLines,
      });
      await supabase.from("job_costing").delete().eq("id", job.id);
      return { error: `Gagal menandai status stok: ${markErr.message}` };
    }
  }

  revalidatePath("/job-costing");
  revalidatePath("/stock");
  return { success: true, data: job };
}

export async function updateJobCostingStatus(id: number, status: string) {
  const access = await canManageJobCostingStatus();
  if (!access.allowed) return { error: access.error };

  const normalizedNewStatus = toCompletedIfLegacy(status);
  if (
    !["open", "approved", "completed", "rejected"].includes(
      normalizedNewStatus,
    )
  ) {
    return { error: "Status tidak valid." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const { data: job, error: jobErr } = await supabase
    .from("job_costing")
    .select(
      "id, job_kode, status, stock_applied_at, finish_part_id, finish_part_cabang_id, qty_finish_part, finish_part, job_costing_items(id, part_id, part_number, part_name, qty, source_cabang_id), job_costing_finish_parts(id, part_id, part_number, part_name, qty, cabang_id)",
    )
    .eq("id", id)
    .single();
  if (jobErr || !job) {
    return { error: jobErr?.message || "Job Costing tidak ditemukan." };
  }

  const currentStatus = normalizeDocumentStatus(job.status);
  if (currentStatus === normalizedNewStatus) {
    return { error: "Status tidak berubah." };
  }

  const wasApplied = shouldApplyStock(currentStatus);
  const willApply = shouldApplyStock(normalizedNewStatus);

  const materialLines: StockLine[] = ((job.job_costing_items as any[]) ?? [])
    .filter((i) => i.part_id && i.source_cabang_id)
    .map((i) => ({
      partId: i.part_id,
      cabangId: i.source_cabang_id,
      qty: Number(i.qty),
      label: i.part_number || i.part_name || "-",
    }));

  let finishPartLines: StockLine[] = (
    (job.job_costing_finish_parts as any[]) ?? []
  )
    .filter((f) => f.part_id && f.cabang_id)
    .map((f) => ({
      partId: f.part_id,
      cabangId: f.cabang_id,
      qty: Number(f.qty),
      label: f.part_number || f.part_name || "-",
    }));

  // Defensive fallback for jobs created during the deploy window before
  // job_costing_finish_parts existed / was backfilled.
  if (
    finishPartLines.length === 0 &&
    job.finish_part_id &&
    job.finish_part_cabang_id
  ) {
    finishPartLines = [
      {
        partId: job.finish_part_id,
        cabangId: job.finish_part_cabang_id,
        qty: Number(job.qty_finish_part) || 1,
        label: job.finish_part || "-",
      },
    ];
  }

  if (!wasApplied && willApply) {
    if (materialLines.length === 0) {
      return {
        error:
          "Job Costing tidak memiliki item bahan untuk diterapkan ke stok.",
      };
    }

    const applyResult = await applyJobCostingStock(supabase, {
      jobKode: job.job_kode,
      userId: user.id,
      materialLines,
      finishPartLines,
    });
    if (!applyResult.success) return { error: applyResult.error };

    const { error: updErr } = await supabase
      .from("job_costing")
      .update({
        status: normalizedNewStatus,
        stock_applied_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updErr) {
      await reverseJobCostingStock(supabase, {
        jobKode: job.job_kode,
        userId: user.id,
        materialLines,
        finishPartLines,
      });
      return {
        error: `Gagal menyimpan status setelah menerapkan stok: ${updErr.message}`,
      };
    }
  } else if (wasApplied && !willApply) {
    const reverseResult = await reverseJobCostingStock(supabase, {
      jobKode: job.job_kode,
      userId: user.id,
      materialLines,
      finishPartLines,
    });
    if (!reverseResult.success) return { error: reverseResult.error };

    const { error: updErr } = await supabase
      .from("job_costing")
      .update({ status: normalizedNewStatus, stock_applied_at: null })
      .eq("id", id);
    if (updErr) {
      await applyJobCostingStock(supabase, {
        jobKode: job.job_kode,
        userId: user.id,
        materialLines,
        finishPartLines,
      });
      return {
        error: `Gagal menyimpan status setelah membatalkan penerapan stok: ${updErr.message}`,
      };
    }
  } else {
    const { error: updErr } = await supabase
      .from("job_costing")
      .update({ status: normalizedNewStatus })
      .eq("id", id);
    if (updErr) return { error: updErr.message };
  }

  revalidatePath("/job-costing");
  revalidatePath("/stock");
  return { success: true };
}

export async function addJobCostingItem(
  jobId: number,
  item: {
    part_id?: number | null;
    part_number?: string;
    part_name?: string;
    description: string;
    qty: number;
    unit: string;
    unit_price: number;
    po_id?: number | null;
    notes?: string;
  },
) {
  const access = await canManageJobCostingItems(jobId);
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const { error } = await supabase.from("job_costing_items").insert({
    job_id: jobId,
    ...item,
    po_id: item.po_id || null,
    notes: item.notes || null,
  });
  if (error) return { error: error.message };

  // Recalculate total_cost
  const { data: items } = await supabase
    .from("job_costing_items")
    .select("qty, unit_price")
    .eq("job_id", jobId);
  const total = (items ?? []).reduce((s, i) => s + i.qty * i.unit_price, 0);
  await supabase
    .from("job_costing")
    .update({ total_cost: total })
    .eq("id", jobId);

  revalidatePath("/job-costing");
  return { success: true };
}

export async function deleteJobCostingItem(itemId: number, jobId: number) {
  const access = await canManageJobCostingItems(jobId);
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_costing_items")
    .delete()
    .eq("id", itemId);
  if (error) return { error: error.message };

  // Recalculate total_cost
  const { data: items } = await supabase
    .from("job_costing_items")
    .select("qty, unit_price")
    .eq("job_id", jobId);
  const total = (items ?? []).reduce((s, i) => s + i.qty * i.unit_price, 0);
  await supabase
    .from("job_costing")
    .update({ total_cost: total })
    .eq("id", jobId);

  revalidatePath("/job-costing");
  return { success: true };
}

export async function generateJobKode(cabangKode: string) {
  const supabase = await createClient();
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const prefix = `JC/${cabangKode}/${year}/${month}/`;

  const { data } = await supabase
    .from("job_costing")
    .select("job_kode")
    .ilike("job_kode", `${prefix}%`)
    .order("job_kode", { ascending: false })
    .limit(1)
    .maybeSingle();

  let seq = 1;
  if (data?.job_kode) {
    const parts = data.job_kode.split("/");
    seq = parseInt(parts[parts.length - 1] || "0") + 1;
  }
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

/**
 * SPB (Surat Perintah Bayar) SERVICES
 */
export async function getSPBList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spb")
    .select("*, po:pos(po_kode, vendor:vendors(vendor_name))")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching SPB:", error);
    return [];
  }
  return data;
}

export async function createSPB(data: {
  spb_kode: string;
  po_id: number;
  total_amount: number;
}) {
  const supabase = await createClient();
  const { data: spb, error } = await supabase
    .from("spb")
    .insert([
      {
        spb_kode: data.spb_kode,
        po_id: data.po_id,
        total_amount: data.total_amount,
        status: "open",
      },
    ])
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/(With Sidebar)/finance");
  return { success: true, data: spb };
}
