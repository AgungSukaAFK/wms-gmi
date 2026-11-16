// Status per barang PO, pembatalan item, dan hak edit approver. Modul biasa
// (bukan "use server") supaya bisa dipakai server action maupun komponen.
//
// Aturan:
// - Pembatalan item hanya untuk PO yang sudah full approved (approved/closed).
//   Sisa qty yang belum diterima pindah ke qty_cancelled, po_items.qty turun
//   ke qty_received, dan PO langsung 'closed'. Item aktif lain tetap bisa RI.
// - Approver PO (step > 0, step 0 = pembuat) boleh mengedit PO kapan pun
//   selama belum ada RI (RI rejected tidak dihitung), tanpa mengulang approval.
// - Status progres per barang boleh diedit approver / purchasing / moderator.

export const PO_ITEM_MANAGER_ROLES = ["purchasing", "moderator"] as const;

/** Preset status progres per barang (tetap bisa diisi teks bebas). */
export const PO_ITEM_DETAIL_STATUS_PRESETS = [
  "Menunggu Konfirmasi Vendor",
  "Dikonfirmasi Vendor",
  "Indent",
  "Dalam Produksi",
  "Siap Kirim",
  "Dalam Pengiriman",
  "Tertahan / Kendala",
] as const;

/** Status PO yang masih bisa menerima barang lewat RI. */
export const PO_RECEIVABLE_STATUSES = ["approved", "closed"] as const;

/** Status PO yang itemnya boleh dibatalkan. */
export const PO_CANCELLABLE_STATUSES = ["approved", "closed"] as const;

/** Status PO yang boleh diedit approver (selama belum ada RI). */
export const PO_APPROVER_EDITABLE_STATUSES = ["open", "approved"] as const;

const num = (v: any) => Number(v) || 0;

function approvalUserId(a: any): string | null {
  return a?.userid || a?.user_id || null;
}

/**
 * User ada di jalur approval PO sebagai approver (bukan step pertama, yang
 * selalu ditandatangani pembuat/editor PO).
 */
export function isPoApprover(approvals: any[] | null | undefined, userId?: string | null): boolean {
  if (!userId || !Array.isArray(approvals)) return false;
  return approvals.some((a, idx) => idx > 0 && approvalUserId(a) === userId);
}

export function hasPoManagerRole(roleNames: string[]): boolean {
  const names = roleNames.map((r) => (r || "").trim().toLowerCase());
  return PO_ITEM_MANAGER_ROLES.some((r) => names.includes(r));
}

/** Boleh membatalkan item / mengubah status per barang. */
export function canManagePoItems(
  roleNames: string[],
  approvals: any[] | null | undefined,
  userId?: string | null,
): boolean {
  return hasPoManagerRole(roleNames) || isPoApprover(approvals, userId);
}

export function isPoReceivable(status?: string | null): boolean {
  return (PO_RECEIVABLE_STATUSES as readonly string[]).includes(status || "");
}

export function qtyOriginal(item: { qty?: any; qty_cancelled?: any }): number {
  return num(item.qty) + num(item.qty_cancelled);
}

export type PoItemSystemStatus =
  | "menunggu_approval"
  | "ditolak"
  | "menunggu_terima"
  | "partial"
  | "diterima"
  | "dibatalkan"
  | "partial_dibatalkan";

export const PO_ITEM_SYSTEM_STATUS_LABEL: Record<PoItemSystemStatus, string> = {
  menunggu_approval: "Menunggu Approval",
  ditolak: "PO Ditolak",
  menunggu_terima: "Menunggu Diterima",
  partial: "Diterima Sebagian",
  diterima: "Diterima Lengkap",
  dibatalkan: "Dibatalkan",
  partial_dibatalkan: "Diterima Sebagian · Sisa Dibatalkan",
};

/** Status sistem per barang — turunan dari status PO + qty, tidak diedit manual. */
export function poItemSystemStatus(
  item: { qty?: any; qty_received?: any; qty_cancelled?: any },
  poStatus?: string | null,
): PoItemSystemStatus {
  const qty = num(item.qty);
  const received = num(item.qty_received);
  const cancelled = num(item.qty_cancelled);
  if (cancelled > 0) return received > 0 ? "partial_dibatalkan" : "dibatalkan";
  if (poStatus === "rejected") return "ditolak";
  if (poStatus === "open") return "menunggu_approval";
  if (qty > 0 && received >= qty) return "diterima";
  if (received > 0) return "partial";
  return "menunggu_terima";
}

/** Sisa qty yang masih bisa diterima (belum termasuk RI pending). */
export function poItemOutstanding(item: { qty?: any; qty_received?: any }): number {
  return Math.max(0, num(item.qty) - num(item.qty_received));
}

/**
 * Label & warna status dokumen PO. 'closed' di PO = ada item dibatalkan
 * (bukan legacy "selesai" seperti di dokumen lain).
 */
export const PO_STATUS_LABELS: Record<string, string> = {
  open: "Pending Approval",
  closed: "Closed",
};
export const PO_STATUS_COLORS: Record<string, "orange"> = { closed: "orange" };
