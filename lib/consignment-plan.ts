// Planning IK (Consignment) -- konstanta & helper yang dipakai bersama oleh
// server action (services/consignment-ik-plan-actions.ts) dan halaman
// /so-reguler/consignment/planning + form Buat IK.

// Penyusun planning (buat, tutup/buka, hapus). Eksekusi IK oleh warehouse
// tidak dibatasi di sini (form IK terbuka seperti sebelumnya).
export const IK_PLANNER_ROLES = ["moderator", "admin", "ppic", "marketing"];

export function isIkPlanner(roleNames: string[]) {
  return roleNames.some((r) => IK_PLANNER_ROLES.includes(r));
}

// Gudang default rencana kirim (kolom "SOH BPN"): cabang yang namanya
// mengandung salah satu kata ini. Di prod: GMI-BPP.
export function isDefaultPlanCabang(namaCabang: string) {
  const n = namaCabang.toUpperCase();
  return n.includes("BPP") || n.includes("BPN") || n.includes("BALIKPAPAN");
}

/** Sisa hari ke due date (negatif = lewat). null kalau due date kosong. */
export function daysToDue(dueDate: string | null | undefined, today = new Date()): number | null {
  if (!dueDate) return null;
  const [y, m, d] = dueDate.slice(0, 10).split("-").map(Number);
  const due = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - now) / 86_400_000);
}

export type PlanProgress = "belum" | "sebagian" | "selesai" | "ditutup";

export const PLAN_PROGRESS_LABEL: Record<PlanProgress, string> = {
  belum: "Belum IK",
  sebagian: "Sebagian",
  selesai: "Selesai",
  ditutup: "Ditutup",
};

export function planItemProgress(
  planStatus: string,
  planQty: number,
  realizedQty: number,
): PlanProgress {
  if (realizedQty >= planQty) return "selesai";
  if (planStatus === "closed") return "ditutup";
  return realizedQty > 0 ? "sebagian" : "belum";
}

/** Baris planning (flat) seperti yang tampil di list & detail. */
export type IkPlanRow = {
  plan_item_id: number;
  plan_id: number;
  plan_kode: string;
  plan_tanggal: string;
  plan_status: "open" | "closed";
  plan_catatan: string | null;
  customer_id: number;
  customer_name: string | null;
  dari_cabang_id: number;
  dari_cabang_name: string | null;
  so_id: number;
  so_no: string;
  no_po: string | null;
  tgl_po: string | null;
  due_date: string | null;
  so_item_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  part_number_customer: string | null;
  satuan: string;
  site_id: number;
  site_name: string;
  qty_po: number;
  outstanding: number; // qty SO - total terkirim IK (semua IK)
  soh: number; // stok gudang asal planning saat ini
  plan_qty: number;
  realized_qty: number; // total IK yang merujuk baris ini
  sisa_plan: number; // plan_qty - realized (0 kalau ditutup)
  // SOH - sisa plan kumulatif (baris gudang+part sama, urut due date);
  // minus = stok tidak cukup utk baris ini.
  selisih_soh: number;
  notes: string | null;
  progress: PlanProgress;
};

export const PLAN_PROGRESS_COLOR: Record<PlanProgress, "gray" | "amber" | "emerald" | "red"> = {
  belum: "gray",
  sebagian: "amber",
  selesai: "emerald",
  ditutup: "red",
};
