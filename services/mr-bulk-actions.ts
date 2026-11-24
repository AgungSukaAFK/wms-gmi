"use server";

// Aksi massal Material Request dari list MR (khusus moderator):
//  - Batalkan massal: MR -> status 'cancelled' (soft, bukan hard delete).
//  - Edit jalur approval massal: tahap setelah pembuat diganti, approval diulang.
//  - Due date massal (set tanggal / geser +/- hari), Unfreeze/Reset massal,
//    dan ubah Kategori massal.
// Setiap MR yang berubah tercatat di moderator_edit_logs (doc_type 'mr').

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { notifyApprovers, createNotification } from "@/services/notification-actions";
import { businessToday } from "@/lib/business-date";
import { MR_KATEGORI_OPTIONS } from "@/lib/mr-options";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type BulkMrResult = {
  id: number;
  mr_kode: string;
  ok: boolean;
  // Apa yang berubah, atau alasan gagal/dilewati.
  message: string;
};

export type BulkMrApprovalStep = {
  userid: string;
  approval_role: "menyetujui" | "mengetahui";
};

const MAX_BULK = 500;
const IN_CHUNK = 200;

// Status yang sudah final -- tidak bisa dibatalkan lagi.
const NON_CANCELLABLE_STATUSES = ["cancelled", "completed", "done", "closed"];

async function requireModerator(supabase: Supabase) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." } as const;
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  const isModerator = (roleRows || []).some((r: any) => r?.roles?.name === "moderator");
  if (!isModerator) return { error: "Hanya moderator yang dapat melakukan aksi massal MR." } as const;
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .single();
  return { user, userNama: (myProfile?.nama as string) || user.email || "-" } as const;
}

function normalizeIds(ids: number[]) {
  return Array.from(new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
}

/** Ambil nilai `keyCol` dari `table` yang `filterCol`-nya ada di `values` (di-chunk). */
async function collectKeys(
  supabase: Supabase,
  table: string,
  keyCol: string,
  filterCol: string,
  values: number[],
): Promise<{ keys: Set<number>; error?: string }> {
  const keys = new Set<number>();
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const chunk = values.slice(i, i + IN_CHUNK);
    const { data, error } = await (supabase as any)
      .from(table)
      .select(keyCol)
      .in(filterCol, chunk);
    if (error) return { keys, error: `${table}: ${error.message}` };
    for (const row of data || []) {
      const v = Number(row[keyCol]);
      if (Number.isFinite(v)) keys.add(v);
    }
  }
  return { keys };
}

// ============================================================
// BATALKAN MASSAL
// ============================================================

/**
 * Batalkan banyak MR sekaligus (moderator). Hanya MR "bersih" yang boleh
 * dibatalkan: belum punya PR, PO, alokasi Share Stock, Delivery, Item
 * Transfer, Working Order, maupun Job Costing. MR yang sudah diproses dokumen
 * turunan dilewati dengan keterangan supaya tidak ada dokumen yang menggantung.
 * MR yang sudah selesai/dibatalkan juga dilewati.
 */
export async function bulkCancelMR(
  mrIds: number[],
  reason: string,
): Promise<{ error: string } | { success: true; results: BulkMrResult[] }> {
  const supabase = await createClient();
  const auth = await requireModerator(supabase);
  if ("error" in auth) return { error: auth.error as string };

  const ids = normalizeIds(mrIds);
  if (ids.length === 0) return { error: "Pilih minimal satu MR." };
  if (ids.length > MAX_BULK) return { error: `Maksimal ${MAX_BULK} MR per aksi massal.` };
  const trimmedReason = (reason || "").trim();
  if (!trimmedReason) return { error: "Alasan pembatalan wajib diisi." };

  const { data: mrs, error: mrErr } = await supabase
    .from("mrs")
    .select("id, mr_kode, mr_status")
    .in("id", ids);
  if (mrErr) return { error: mrErr.message };

  const { data: itemRows, error: itemErr } = await supabase
    .from("mr_items")
    .select("id, mr_id")
    .in("mr_id", ids);
  if (itemErr) return { error: itemErr.message };
  const mrIdByItem = new Map<number, number>(
    (itemRows || []).map((r: any) => [Number(r.id), Number(r.mr_id)]),
  );
  const itemIds = Array.from(mrIdByItem.keys());

  // Dokumen turunan per MR. Label dipakai untuk keterangan "dilewati".
  const blockers = new Map<number, Set<string>>();
  const addBlocker = (mrId: number, label: string) => {
    if (!blockers.has(mrId)) blockers.set(mrId, new Set());
    blockers.get(mrId)!.add(label);
  };

  const byMr: [string, string, string][] = [
    ["pr_items", "PR", "mr_id"],
    ["po_items", "PO", "mr_id"],
    ["deliveries", "Delivery", "mr_id"],
    ["working_orders", "Working Order", "mr_id"],
  ];
  for (const [table, label, col] of byMr) {
    const { keys, error } = await collectKeys(supabase, table, col, col, ids);
    if (error) return { error: `Gagal cek dokumen turunan (${error}).` };
    for (const mrId of keys) addBlocker(mrId, label);
  }

  const byItem: [string, string][] = [
    ["pr_items", "PR"],
    ["mr_sharestock_allocations", "Share Stock"],
    ["delivery_items", "Delivery"],
    ["item_transfer_items", "Item Transfer"],
    ["job_costing_finish_parts", "Job Costing"],
  ];
  if (itemIds.length > 0) {
    for (const [table, label] of byItem) {
      const { keys, error } = await collectKeys(supabase, table, "mr_item_id", "mr_item_id", itemIds);
      if (error) return { error: `Gagal cek dokumen turunan (${error}).` };
      for (const itemId of keys) {
        const mrId = mrIdByItem.get(itemId);
        if (mrId) addBlocker(mrId, label);
      }
    }
  }

  const byId = new Map((mrs || []).map((m: any) => [Number(m.id), m]));
  const results: BulkMrResult[] = [];
  const logs: any[] = [];
  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();

  for (const id of ids) {
    const mr = byId.get(id);
    if (!mr) {
      results.push({ id, mr_kode: `#${id}`, ok: false, message: "MR tidak ditemukan." });
      continue;
    }
    const status = String(mr.mr_status || "").toLowerCase();
    if (NON_CANCELLABLE_STATUSES.includes(status)) {
      results.push({
        id,
        mr_kode: mr.mr_kode,
        ok: false,
        message: status === "cancelled" ? "Sudah dibatalkan" : "Dilewati: MR sudah selesai",
      });
      continue;
    }
    const blocked = blockers.get(id);
    if (blocked && blocked.size > 0) {
      results.push({
        id,
        mr_kode: mr.mr_kode,
        ok: false,
        message: `Dilewati: sudah ada ${Array.from(blocked).join(", ")}`,
      });
      continue;
    }

    // Claim kondisional: status tidak boleh berubah sejak dibaca (mis. baru
    // saja di-approve lalu dibuatkan PR oleh request lain).
    const { data: updated, error: updErr } = await supabase
      .from("mrs")
      .update({ mr_status: "cancelled", updated_at: now } as any)
      .eq("id", id)
      .eq("mr_status", mr.mr_status)
      .select("id");
    if (updErr) {
      results.push({ id, mr_kode: mr.mr_kode, ok: false, message: updErr.message });
      continue;
    }
    if (!updated || updated.length === 0) {
      results.push({
        id,
        mr_kode: mr.mr_kode,
        ok: false,
        message: "Baru saja diproses oleh request lain. Muat ulang lalu coba lagi.",
      });
      continue;
    }

    results.push({ id, mr_kode: mr.mr_kode, ok: true, message: "Dibatalkan" });
    logs.push({
      doc_type: "mr",
      doc_id: id,
      user_id: auth.user.id,
      user_nama: auth.userNama,
      summary: `Batal massal: status ${mr.mr_status} → cancelled. Alasan: ${trimmedReason}`,
      changes: {
        reason: trimmedReason,
        bulk: true,
        bulk_action: "cancel",
        batch_id: batchId,
        before: { mr_status: mr.mr_status },
        after: { mr_status: "cancelled" },
      },
    });
  }

  if (logs.length > 0) {
    const { error: logErr } = await supabase.from("moderator_edit_logs").insert(logs);
    if (logErr) console.error("bulkCancelMR log:", logErr.message);
  }

  revalidatePath("/mr");
  return { success: true, results };
}

// ============================================================
// EDIT JALUR APPROVAL MASSAL
// ============================================================

// Tahap pembuat (requester) di awal jalur dipertahankan apa adanya (TTD &
// waktu tanda tangannya tetap).
function splitMrRequesterStep(approvals: any[], uidRequester: string | null) {
  const first = approvals[0];
  const isRequester =
    !!first &&
    (first.role === "Requester" ||
      (!!uidRequester && (first.user_id ?? first.userid) === uidRequester));
  return { head: isRequester ? [first] : [], rest: isRequester ? approvals.slice(1) : approvals };
}

/**
 * Ganti jalur approval banyak MR sekaligus (moderator). Tahap pembuat tetap;
 * tahap setelahnya diganti jalur baru dan SEMUA kembali pending (approval
 * diulang), approver pertama dinotifikasi. Hanya untuk MR yang masih
 * menunggu approval (status open) -- MR approved/rejected/selesai/batal
 * dilewati; pakai Moderator Edit per dokumen untuk itu.
 */
export async function bulkUpdateMRApprovals(
  mrIds: number[],
  payload: { approvals: BulkMrApprovalStep[]; reason?: string },
): Promise<{ error: string } | { success: true; results: BulkMrResult[] }> {
  const supabase = await createClient();
  const auth = await requireModerator(supabase);
  if ("error" in auth) return { error: auth.error as string };

  const ids = normalizeIds(mrIds);
  if (ids.length === 0) return { error: "Pilih minimal satu MR." };
  if (ids.length > MAX_BULK) return { error: `Maksimal ${MAX_BULK} MR per aksi massal.` };

  const steps = payload.approvals || [];
  if (steps.length === 0) return { error: "Jalur approval minimal 1 tahap (selain pembuat)." };
  for (const step of steps) {
    if (!step?.userid) return { error: "Setiap tahap approval harus punya approver yang dipilih." };
    if (!["menyetujui", "mengetahui"].includes(step.approval_role))
      return { error: "Role approval tidak valid." };
  }

  const targetUids = Array.from(new Set(steps.map((s) => s.userid)));
  const { data: targetProfiles } = await supabase
    .from("profiles")
    .select("id, nama, email, is_active")
    .in("id", targetUids);
  const profileById = new Map((targetProfiles || []).map((p: any) => [p.id, p]));
  for (const uid of targetUids) {
    const p = profileById.get(uid);
    if (!p) return { error: "User yang dipilih tidak ditemukan." };
    if (p.is_active === false) return { error: `User ${p.nama} sudah tidak aktif.` };
  }

  const { data: mrs, error: fetchErr } = await supabase
    .from("mrs")
    .select("id, mr_kode, mr_status, mr_pic_id, approvals")
    .in("id", ids);
  if (fetchErr) return { error: fetchErr.message };

  const reason = payload.reason?.trim() || "";
  const newPathKey = steps.map((s) => `${s.userid}:${s.approval_role}`).join("|");
  const newPathNames = steps.map((s) => profileById.get(s.userid)?.nama || "?").join(" → ");

  const byId = new Map((mrs || []).map((m: any) => [Number(m.id), m]));
  const batchId = crypto.randomUUID();
  const results: BulkMrResult[] = [];
  const logs: any[] = [];
  const toNotify: { id: number; mr_kode: string; approvals: any[] }[] = [];

  for (const id of ids) {
    const mr = byId.get(id);
    if (!mr) {
      results.push({ id, mr_kode: `#${id}`, ok: false, message: "MR tidak ditemukan." });
      continue;
    }
    if (mr.mr_status !== "open") {
      results.push({
        id,
        mr_kode: mr.mr_kode,
        ok: false,
        message: `Dilewati: status ${mr.mr_status}, hanya MR yang menunggu approval`,
      });
      continue;
    }

    const current: any[] = Array.isArray(mr.approvals) ? mr.approvals : [];
    const { head, rest } = splitMrRequesterStep(current, mr.mr_pic_id ?? null);
    const currentKey = rest
      .map((a: any) => {
        const role = (a.level ?? a.approval_role) === "mengetahui" ? "mengetahui" : "menyetujui";
        return `${a.user_id ?? a.userid}:${role}`;
      })
      .join("|");
    const allPending = rest.every((a: any) => a.status === "pending");
    if (currentKey === newPathKey && allPending) {
      results.push({ id, mr_kode: mr.mr_kode, ok: true, message: "Tidak ada perubahan (sudah sama)" });
      continue;
    }

    const newRest = steps.map((s, idx) => {
      const p = profileById.get(s.userid);
      return {
        step_id: null,
        step_order: head.length + idx + 1,
        level: s.approval_role,
        status: "pending",
        user_id: s.userid,
        nama: p?.nama ?? "",
        email: p?.email ?? null,
        role: s.approval_role === "menyetujui" ? "Approver" : "Reviewer",
        processed_at: null,
        signature_url: null,
        notes: null,
      };
    });
    const newApprovals = [...head, ...newRest];

    // Claim kondisional supaya tidak bentrok dengan approve yang berjalan
    // bersamaan.
    const { data: updated, error: updErr } = await supabase
      .from("mrs")
      .update({ approvals: newApprovals, updated_at: new Date().toISOString() } as any)
      .eq("id", id)
      .eq("mr_status", "open")
      .select("id");
    if (updErr) {
      results.push({ id, mr_kode: mr.mr_kode, ok: false, message: updErr.message });
      continue;
    }
    if (!updated || updated.length === 0) {
      results.push({
        id,
        mr_kode: mr.mr_kode,
        ok: false,
        message: "Baru saja diproses oleh request lain. Muat ulang lalu coba lagi.",
      });
      continue;
    }

    results.push({
      id,
      mr_kode: mr.mr_kode,
      ok: true,
      message: "Jalur approval diubah (approval diulang, status pending)",
    });
    logs.push({
      doc_type: "mr",
      doc_id: id,
      user_id: auth.user.id,
      user_nama: auth.userNama,
      summary:
        `Edit massal: jalur approval (${newPathNames}), approval diulang` +
        (reason ? `. Alasan: ${reason}` : ""),
      changes: {
        reason: reason || null,
        bulk: true,
        bulk_action: "approval",
        batch_id: batchId,
        before: { approvals: mr.approvals },
        after: { approvals: newApprovals },
      },
    });
    toNotify.push({ id, mr_kode: mr.mr_kode, approvals: newApprovals });
  }

  if (logs.length > 0) {
    const { error: logErr } = await supabase.from("moderator_edit_logs").insert(logs);
    if (logErr) console.error("bulkUpdateMRApprovals log:", logErr.message);
  }

  // notifyApprovers hanya mengirim ke pemilik tahap pending pertama.
  await Promise.all(
    toNotify.map((n) =>
      notifyApprovers(n.approvals, "MR", n.id, n.mr_kode, `/mr/${n.id}`).catch(console.error),
    ),
  );

  revalidatePath("/mr");
  for (const n of toNotify) revalidatePath(`/mr/${n.id}`);
  return { success: true, results };
}

// ============================================================
// FIELD MASSAL: DUE DATE, UNFREEZE/RESET, KATEGORI
// ============================================================

// Hanya MR yang masih berjalan yang boleh diubah field-nya.
const EDITABLE_STATUSES = ["open", "approved"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function insertBulkLogs(logs: any[], tag: string) {
  if (logs.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase.from("moderator_edit_logs").insert(logs);
  if (error) console.error(`${tag} log:`, error.message);
}

export type BulkDueDateMode =
  | { mode: "set"; date: string }
  | { mode: "shift"; days: number };

/**
 * Ubah due date banyak MR (moderator): set ke tanggal tertentu, atau geser
 * +/- N hari dari due date masing-masing. Hanya MR open/approved & bukan
 * Scheduled MR (due date-nya per item). Tanggal hasil tidak boleh lampau.
 * Tidak membuka freeze -- pakai Unfreeze/Reset untuk itu.
 */
export async function bulkUpdateMRDueDate(
  mrIds: number[],
  payload: BulkDueDateMode & { reason: string },
): Promise<{ error: string } | { success: true; results: BulkMrResult[] }> {
  const supabase = await createClient();
  const auth = await requireModerator(supabase);
  if ("error" in auth) return { error: auth.error as string };

  const ids = normalizeIds(mrIds);
  if (ids.length === 0) return { error: "Pilih minimal satu MR." };
  if (ids.length > MAX_BULK) return { error: `Maksimal ${MAX_BULK} MR per aksi massal.` };
  const reason = (payload.reason || "").trim();
  if (!reason) return { error: "Alasan wajib diisi." };

  const today = businessToday();
  if (payload.mode === "set") {
    if (!YMD.test(payload.date || "")) return { error: "Tanggal due date tidak valid." };
    if (payload.date < today) return { error: "Due date baru tidak boleh tanggal lampau." };
  } else {
    if (!Number.isInteger(payload.days) || payload.days === 0 || Math.abs(payload.days) > 3650)
      return { error: "Jumlah hari harus bilangan bulat bukan nol." };
  }

  const { data: mrs, error } = await supabase
    .from("mrs")
    .select("id, mr_kode, mr_status, mr_type, mr_due_date")
    .in("id", ids);
  if (error) return { error: error.message };
  const byId = new Map((mrs || []).map((m: any) => [Number(m.id), m]));

  const batchId = crypto.randomUUID();
  const results: BulkMrResult[] = [];
  const logs: any[] = [];
  const touched: number[] = [];

  for (const id of ids) {
    const mr: any = byId.get(id);
    if (!mr) {
      results.push({ id, mr_kode: `#${id}`, ok: false, message: "MR tidak ditemukan." });
      continue;
    }
    const fail = (message: string) =>
      results.push({ id, mr_kode: mr.mr_kode, ok: false, message });
    if (mr.mr_type === "scheduled") {
      fail("Dilewati: Scheduled MR memakai due date per item");
      continue;
    }
    if (!EDITABLE_STATUSES.includes(mr.mr_status)) {
      fail(`Dilewati: status ${mr.mr_status}`);
      continue;
    }
    let newDate: string;
    if (payload.mode === "set") {
      newDate = payload.date;
    } else {
      if (!mr.mr_due_date) {
        fail("Dilewati: MR belum punya due date untuk digeser");
        continue;
      }
      newDate = addDays(mr.mr_due_date, payload.days);
      if (newDate < today) {
        fail(`Dilewati: hasil ${newDate} sudah lampau`);
        continue;
      }
    }
    if (newDate === mr.mr_due_date) {
      results.push({ id, mr_kode: mr.mr_kode, ok: true, message: "Tidak ada perubahan (sudah sama)" });
      continue;
    }

    // Claim kondisional: status & due date tidak boleh berubah sejak dibaca.
    let q = supabase
      .from("mrs")
      .update({ mr_due_date: newDate, updated_at: new Date().toISOString() } as any)
      .eq("id", id)
      .eq("mr_status", mr.mr_status);
    q = mr.mr_due_date ? q.eq("mr_due_date", mr.mr_due_date) : q.is("mr_due_date", null);
    const { data: updated, error: updErr } = await q.select("id");
    if (updErr) {
      fail(updErr.message);
      continue;
    }
    if (!updated || updated.length === 0) {
      fail("Baru saja diproses oleh request lain. Muat ulang lalu coba lagi.");
      continue;
    }

    results.push({
      id,
      mr_kode: mr.mr_kode,
      ok: true,
      message: `Due date ${mr.mr_due_date || "-"} → ${newDate}`,
    });
    touched.push(id);
    logs.push({
      doc_type: "mr",
      doc_id: id,
      user_id: auth.user.id,
      user_nama: auth.userNama,
      summary: `Edit massal: due date ${mr.mr_due_date || "-"} → ${newDate}. Alasan: ${reason}`,
      changes: {
        reason,
        bulk: true,
        bulk_action: "due_date",
        batch_id: batchId,
        before: { mr_due_date: mr.mr_due_date },
        after: { mr_due_date: newDate },
      },
    });
  }

  await insertBulkLogs(logs, "bulkUpdateMRDueDate");
  revalidatePath("/mr");
  for (const id of touched) revalidatePath(`/mr/${id}`);
  return { success: true, results };
}

/**
 * Unfreeze / Reset banyak MR sekaligus (moderator). Tanpa `newDueDate` =
 * unfreeze (lanjut dari posisi terakhir). Dengan `newDueDate` = reset
 * (perpanjang due date lalu unfreeze). Laporan kendala yang terbuka ikut
 * ditandai selesai dan pembuat MR dinotifikasi -- sama dengan Unfreeze per MR.
 */
export async function bulkUnfreezeMR(
  mrIds: number[],
  payload: { newDueDate?: string; reason: string },
): Promise<{ error: string } | { success: true; results: BulkMrResult[] }> {
  const supabase = await createClient();
  const auth = await requireModerator(supabase);
  if ("error" in auth) return { error: auth.error as string };

  const ids = normalizeIds(mrIds);
  if (ids.length === 0) return { error: "Pilih minimal satu MR." };
  if (ids.length > MAX_BULK) return { error: `Maksimal ${MAX_BULK} MR per aksi massal.` };
  const reason = (payload.reason || "").trim();
  if (!reason) return { error: "Alasan wajib diisi." };

  const newDueDate = payload.newDueDate?.trim() || "";
  const action: "unfreeze" | "reset" = newDueDate ? "reset" : "unfreeze";
  if (newDueDate) {
    if (!YMD.test(newDueDate)) return { error: "Tanggal due date tidak valid." };
    if (newDueDate < businessToday())
      return { error: "Due date baru tidak boleh tanggal lampau." };
  }

  const { data: mrs, error } = await supabase
    .from("mrs")
    .select("id, mr_kode, mr_status, mr_type, is_frozen, mr_due_date, mr_pic_id")
    .in("id", ids);
  if (error) return { error: error.message };
  const byId = new Map((mrs || []).map((m: any) => [Number(m.id), m]));

  const batchId = crypto.randomUUID();
  const results: BulkMrResult[] = [];
  const logs: any[] = [];
  const touched: any[] = [];
  const nowIso = new Date().toISOString();

  for (const id of ids) {
    const mr: any = byId.get(id);
    if (!mr) {
      results.push({ id, mr_kode: `#${id}`, ok: false, message: "MR tidak ditemukan." });
      continue;
    }
    const fail = (message: string) =>
      results.push({ id, mr_kode: mr.mr_kode, ok: false, message });
    if (!mr.is_frozen) {
      fail("Dilewati: MR tidak dalam status freeze");
      continue;
    }

    const patch: any = { is_frozen: false, frozen_at: null, frozen_reason: null };
    if (newDueDate) patch.mr_due_date = newDueDate;
    const { data: updated, error: updErr } = await supabase
      .from("mrs")
      .update(patch)
      .eq("id", id)
      .eq("is_frozen", true)
      .select("id");
    if (updErr) {
      fail(updErr.message);
      continue;
    }
    if (!updated || updated.length === 0) {
      fail("Baru saja diproses oleh request lain. Muat ulang lalu coba lagi.");
      continue;
    }

    await supabase
      .from("mr_freeze_reports")
      .update({
        status: "resolved",
        resolution_action: action,
        resolution: reason,
        resolved_by: auth.user.id,
        resolved_at: nowIso,
      })
      .eq("mr_id", id)
      .eq("status", "open");

    results.push({
      id,
      mr_kode: mr.mr_kode,
      ok: true,
      message: newDueDate
        ? `Di-reset: unfreeze, due date ${mr.mr_due_date || "-"} → ${newDueDate}`
        : "Di-unfreeze",
    });
    touched.push(mr);
    logs.push({
      doc_type: "mr",
      doc_id: id,
      user_id: auth.user.id,
      user_nama: auth.userNama,
      summary:
        (newDueDate
          ? `Reset massal: unfreeze + due date ${mr.mr_due_date || "-"} → ${newDueDate}`
          : "Unfreeze massal") + `. Alasan: ${reason}`,
      changes: {
        reason,
        bulk: true,
        bulk_action: action,
        batch_id: batchId,
        before: { is_frozen: true, mr_due_date: mr.mr_due_date },
        after: { is_frozen: false, mr_due_date: newDueDate || mr.mr_due_date },
      },
    });
  }

  await insertBulkLogs(logs, "bulkUnfreezeMR");

  await Promise.all(
    touched
      .filter((m) => m.mr_pic_id)
      .map((m) =>
        createNotification({
          userId: m.mr_pic_id,
          type: "general",
          title: `MR ${m.mr_kode} di-${action === "reset" ? "reset" : "unfreeze"}`,
          message:
            action === "reset"
              ? `Moderator memperpanjang due date MR ${m.mr_kode}. Alur dapat dilanjutkan.`
              : `Moderator membuka freeze MR ${m.mr_kode}. Alur dapat dilanjutkan.`,
          documentType: "MR",
          documentId: m.id,
          documentUrl: `/mr/${m.id}`,
        }).catch(console.error),
      ),
  );

  revalidatePath("/mr");
  for (const m of touched) revalidatePath(`/mr/${m.id}`);
  return { success: true, results };
}

/** Ubah kategori (jenis pengajuan) banyak MR sekaligus (moderator). */
export async function bulkUpdateMRKategori(
  mrIds: number[],
  payload: { kategori: string; reason?: string },
): Promise<{ error: string } | { success: true; results: BulkMrResult[] }> {
  const supabase = await createClient();
  const auth = await requireModerator(supabase);
  if ("error" in auth) return { error: auth.error as string };

  const ids = normalizeIds(mrIds);
  if (ids.length === 0) return { error: "Pilih minimal satu MR." };
  if (ids.length > MAX_BULK) return { error: `Maksimal ${MAX_BULK} MR per aksi massal.` };
  if (!(MR_KATEGORI_OPTIONS as readonly string[]).includes(payload.kategori))
    return { error: "Kategori tidak valid." };
  const reason = payload.reason?.trim() || "";

  const { data: mrs, error } = await supabase
    .from("mrs")
    .select("id, mr_kode, mr_status, kategori")
    .in("id", ids);
  if (error) return { error: error.message };
  const byId = new Map((mrs || []).map((m: any) => [Number(m.id), m]));

  const batchId = crypto.randomUUID();
  const results: BulkMrResult[] = [];
  const logs: any[] = [];
  const touched: number[] = [];

  for (const id of ids) {
    const mr: any = byId.get(id);
    if (!mr) {
      results.push({ id, mr_kode: `#${id}`, ok: false, message: "MR tidak ditemukan." });
      continue;
    }
    if (mr.mr_status === "cancelled") {
      results.push({ id, mr_kode: mr.mr_kode, ok: false, message: "Dilewati: MR dibatalkan" });
      continue;
    }
    if ((mr.kategori || null) === payload.kategori) {
      results.push({ id, mr_kode: mr.mr_kode, ok: true, message: "Tidak ada perubahan (sudah sama)" });
      continue;
    }
    const { data: updated, error: updErr } = await supabase
      .from("mrs")
      .update({ kategori: payload.kategori, updated_at: new Date().toISOString() } as any)
      .eq("id", id)
      .neq("mr_status", "cancelled")
      .select("id");
    if (updErr || !updated || updated.length === 0) {
      results.push({
        id,
        mr_kode: mr.mr_kode,
        ok: false,
        message: updErr?.message || "Baru saja diproses oleh request lain. Muat ulang lalu coba lagi.",
      });
      continue;
    }
    results.push({
      id,
      mr_kode: mr.mr_kode,
      ok: true,
      message: `Kategori ${mr.kategori || "-"} → ${payload.kategori}`,
    });
    touched.push(id);
    logs.push({
      doc_type: "mr",
      doc_id: id,
      user_id: auth.user.id,
      user_nama: auth.userNama,
      summary:
        `Edit massal: kategori ${mr.kategori || "-"} → ${payload.kategori}` +
        (reason ? `. Alasan: ${reason}` : ""),
      changes: {
        reason: reason || null,
        bulk: true,
        bulk_action: "kategori",
        batch_id: batchId,
        before: { kategori: mr.kategori ?? null },
        after: { kategori: payload.kategori },
      },
    });
  }

  await insertBulkLogs(logs, "bulkUpdateMRKategori");
  revalidatePath("/mr");
  for (const id of touched) revalidatePath(`/mr/${id}`);
  return { success: true, results };
}

// ============================================================
// RIWAYAT AKSI MASSAL
// ============================================================

export type BulkMrHistoryBatch = {
  key: string;
  action: string;
  user_nama: string;
  created_at: string;
  reason: string | null;
  summary: string;
  items: { id: number; mr_kode: string; summary: string }[];
};

/** Riwayat aksi massal MR terbaru, dikelompokkan per batch (moderator). */
export async function getBulkMrHistory(
  limit = 30,
): Promise<{ error: string } | { success: true; batches: BulkMrHistoryBatch[] }> {
  const supabase = await createClient();
  const auth = await requireModerator(supabase);
  if ("error" in auth) return { error: auth.error as string };

  const { data, error } = await supabase
    .from("moderator_edit_logs")
    .select("id, doc_id, user_id, user_nama, summary, changes, created_at")
    .eq("doc_type", "mr")
    .eq("changes->>bulk", "true")
    .order("created_at", { ascending: false })
    .limit(1500);
  if (error) return { error: error.message };

  const rows = data || [];
  const mrIds = Array.from(new Set(rows.map((r: any) => Number(r.doc_id))));
  const kodeById = new Map<number, string>();
  for (let i = 0; i < mrIds.length; i += IN_CHUNK) {
    const { data: m } = await supabase
      .from("mrs")
      .select("id, mr_kode")
      .in("id", mrIds.slice(i, i + IN_CHUNK));
    for (const r of m || []) kodeById.set(Number(r.id), r.mr_kode);
  }

  const batches = new Map<string, BulkMrHistoryBatch>();
  for (const r of rows as any[]) {
    const ch = r.changes || {};
    // Log lama (sebelum ada batch_id) dikelompokkan per user + menit.
    const key = ch.batch_id || `${r.user_id}|${String(r.created_at).slice(0, 16)}`;
    let b = batches.get(key);
    if (!b) {
      if (batches.size >= limit) continue;
      b = {
        key,
        action: ch.bulk_action || (ch.after?.mr_status === "cancelled" ? "cancel" : "approval"),
        user_nama: r.user_nama || "-",
        created_at: r.created_at,
        reason: ch.reason ?? null,
        summary: r.summary,
        items: [],
      };
      batches.set(key, b);
    }
    b.items.push({
      id: Number(r.doc_id),
      mr_kode: kodeById.get(Number(r.doc_id)) || `#${r.doc_id}`,
      summary: r.summary,
    });
  }
  return { success: true, batches: Array.from(batches.values()) };
}
