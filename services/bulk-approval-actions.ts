"use server";

// Approval massal dari dashboard ("Menunggu approval Anda").
//
// Daftar diambil dari RPC dashboard_pending_approvals (definisi "giliran
// saya" yang sama dengan panel dashboard), tanpa filter lokasi.
// Approve tetap lewat fungsi approve per jenis dokumen, satu dokumen per
// panggilan, jadi semua validasi (giliran, status, klaim kondisional,
// notifikasi, posting stok) sama persis dengan approve dari halaman detail.

import { createClient } from "@/lib/supabase/server";
import type { ApprovalDocType } from "@/lib/dashboard/types";
import { approveMR, approvePO, approvePR, approveReceive } from "@/services/procurement-actions";
import { approveItemTransfer } from "@/services/item-transfer-actions";
import { approveWorkingOrder } from "@/services/working-order-actions";
import { approveReturnSpb, approveSpbInvoice } from "@/services/spb-actions";

export type BulkApprovalRow = {
  doc_type: ApprovalDocType;
  id: number;
  kode: string;
  href: string;
  lokasi: string | null;
  tanggal: string | null;
  umur_hari: number;
  /** Butuh tanda tangan (MR/PR/PO/RI/IT/WO). Invoice & Return SPB tidak. */
  needs_signature: boolean;
  /** null = boleh di-approve massal; selain itu alasan harus lewat detail. */
  blocked_reason: string | null;
};

const SIGNED_TYPES = new Set<ApprovalDocType>(["mr", "pr", "po", "ri", "it", "wo"]);

function jakartaToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function daysBetween(fromIso: string, toYmd: string) {
  const from = new Date(fromIso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const ms = Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** Index step pending pertama; -1 kalau tidak ada. */
function currentStepIndex(approvals: unknown) {
  if (!Array.isArray(approvals)) return -1;
  return approvals.findIndex((a: { status?: string }) => a?.status === "pending");
}

/** MR reguler di step terakhir butuh keputusan alokasi (PR vs Share Stock). */
function mrNeedsAllocation(mr: { mr_type?: string | null; approvals?: unknown }) {
  if (mr.mr_type === "scheduled") return false;
  const idx = currentStepIndex(mr.approvals);
  return idx !== -1 && idx === (mr.approvals as unknown[]).length - 1;
}

export async function getMyApprovalQueue(): Promise<
  { data: BulkApprovalRow[]; error: null } | { data: null; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, error: "Session expired" };

  const { data, error } = await supabase
    .rpc("dashboard_pending_approvals", { p_cabang_ids: null })
    .eq("approver_id", user.id);
  if (error) return { data: null, error: error.message };

  type PendingRow = {
    doc_type: ApprovalDocType;
    doc_id: number;
    kode: string;
    href: string;
    cabang_id: number | null;
    tanggal: string | null;
    waiting_since: string;
  };
  const rows = (data ?? []) as PendingRow[];

  const cabangIds = [...new Set(rows.map((r) => r.cabang_id).filter((v): v is number => v != null))];
  const mrIds = rows.filter((r) => r.doc_type === "mr").map((r) => r.doc_id);

  const [cabangRes, mrRes] = await Promise.all([
    cabangIds.length
      ? supabase.from("cabang").select("id, nama_cabang").in("id", cabangIds)
      : Promise.resolve({ data: [] as { id: number; nama_cabang: string }[] }),
    mrIds.length
      ? supabase.from("mrs").select("id, mr_type, approvals").in("id", mrIds)
      : Promise.resolve({ data: [] as { id: number; mr_type: string | null; approvals: unknown }[] }),
  ]);

  const cabangName = new Map((cabangRes.data ?? []).map((c) => [Number(c.id), c.nama_cabang]));
  const mrById = new Map((mrRes.data ?? []).map((m) => [Number(m.id), m]));
  const today = jakartaToday();

  const result: BulkApprovalRow[] = rows.map((r) => {
    let blocked: string | null = null;
    if (r.doc_type === "spb") {
      blocked = "SPB tidak punya approval digital";
    } else if (r.doc_type === "mr") {
      const mr = mrById.get(Number(r.doc_id));
      if (!mr) blocked = "MR tidak ditemukan";
      else if (mrNeedsAllocation(mr)) blocked = "Approver terakhir: tentukan alokasi di detail MR";
    }
    return {
      doc_type: r.doc_type,
      id: Number(r.doc_id),
      kode: r.kode,
      href: r.href.endsWith("=") ? `${r.href}${encodeURIComponent(r.kode)}` : r.href,
      lokasi: r.cabang_id != null ? cabangName.get(Number(r.cabang_id)) ?? null : null,
      tanggal: r.tanggal,
      umur_hari: daysBetween(r.waiting_since, today),
      needs_signature: SIGNED_TYPES.has(r.doc_type),
      blocked_reason: blocked,
    };
  });

  result.sort((a, b) => b.umur_hari - a.umur_hari || a.kode.localeCompare(b.kode));
  return { data: result, error: null };
}

/**
 * Approve satu dokumen dari antrian approval massal.
 * Dipanggil per dokumen dari client supaya progres terlihat dan satu
 * dokumen yang gagal tidak membatalkan dokumen lain.
 */
export async function approveQueuedDocument(
  docType: ApprovalDocType,
  id: number,
  signatureUrl: string | null,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (SIGNED_TYPES.has(docType) && !signatureUrl?.trim()) {
      return { success: false, error: "Tanda tangan wajib dipilih." };
    }
    const sig = signatureUrl ?? "";
    const supabase = await createClient();

    let res: { error?: string; success?: boolean } | undefined;
    switch (docType) {
      case "mr": {
        // Cek ulang di server: step terakhir MR reguler wajib lewat detail
        // (tanpa alokasi, approveMR akan menjadikan seluruh qty PR).
        const { data: mr } = await supabase
          .from("mrs")
          .select("mr_type, approvals")
          .eq("id", id)
          .single();
        if (!mr) return { success: false, error: "MR tidak ditemukan." };
        if (mrNeedsAllocation(mr)) {
          return { success: false, error: "Approver terakhir MR harus menentukan alokasi di halaman detail." };
        }
        res = await approveMR(id, sig, undefined);
        break;
      }
      case "pr": {
        // Approve massal = semua item PR disetujui (sama dengan default di detail PR).
        const { data: items, error } = await supabase.from("pr_items").select("id").eq("pr_id", id);
        if (error) return { success: false, error: error.message };
        const decisions = (items ?? []).map((it) => ({
          itemId: Number(it.id),
          status: "approved" as const,
        }));
        res = await approvePR(id, decisions, sig);
        break;
      }
      case "po":
        res = await approvePO(id, sig);
        break;
      case "ri":
        res = await approveReceive(id, sig);
        break;
      case "it":
        res = await approveItemTransfer(id, sig);
        break;
      case "wo":
        res = await approveWorkingOrder(id, sig);
        break;
      case "spb_invoice":
        res = await approveSpbInvoice(id);
        break;
      case "return_spb":
        res = await approveReturnSpb(id);
        break;
      default:
        return { success: false, error: "Jenis dokumen ini tidak bisa di-approve massal." };
    }

    if (res && "error" in res && res.error) return { success: false, error: res.error };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
