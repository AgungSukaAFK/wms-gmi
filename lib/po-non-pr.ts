// PO Non-PR: PO yang item-nya dipilih bebas dari master barang (bukan
// ditarik dari PR WMS) -- dipakai kalau PN/satuan pembelian beda dengan PN
// di PR (mis. PR "Pack of 100m Roll", beli "1m Roll" x100, lalu dikonversi
// lewat Job Costing). Lihat supabase/migrations/20261006100000_po_non_pr_and_jc_link.sql.

export type PoJenis = "reguler" | "non_pr";

export const PO_JENIS_LABEL: Record<PoJenis, string> = {
  reguler: "Reguler",
  non_pr: "Non-PR",
};

export function isNonPrPo(po: { po_jenis?: string | null } | null | undefined) {
  return po?.po_jenis === "non_pr";
}

// Gudang penerima RI untuk PO Non-PR (dikunci, keputusan user 2026-10-06:
// "untuk saat ini gunakan gudang GMI Jakarta"). Dicari lewat kode ATAU nama
// karena isi tabel cabang production berbeda dari seed migration repo.
export const NON_PR_RECEIVE_CABANG = {
  kode: "JKT",
  nama: "GMI-JAKARTA",
} as const;

export async function resolveNonPrReceiveCabang(
  supabase: any,
): Promise<{ id: number; nama_cabang: string } | null> {
  const { data } = await supabase
    .from("cabang")
    .select("id, nama_cabang, kode_cabang")
    .or(
      `kode_cabang.eq.${NON_PR_RECEIVE_CABANG.kode},nama_cabang.ilike.${NON_PR_RECEIVE_CABANG.nama}`,
    )
    .order("id")
    .limit(1);
  const row = (data || [])[0];
  return row ? { id: Number(row.id), nama_cabang: row.nama_cabang } : null;
}

export const NON_PR_RECEIVE_CABANG_MISSING_MESSAGE = `Gudang ${NON_PR_RECEIVE_CABANG.nama} (kode ${NON_PR_RECEIVE_CABANG.kode}) tidak ditemukan di master cabang -- dibutuhkan sebagai gudang penerima PO Non-PR.`;

// Pemakaian item PO Non-PR sebagai bahan Job Costing
// (job_costing_items.po_item_id), Job Costing rejected tidak dihitung.
export type PoItemJcUsage = {
  qtyUsed: number;
  jobs: { id: number; job_kode: string; status: string }[];
};

export async function fetchPoItemJcUsage(
  supabase: any,
  poItemIds: number[],
): Promise<Map<number, PoItemJcUsage>> {
  const map = new Map<number, PoItemJcUsage>();
  if (poItemIds.length === 0) return map;
  const { data } = await supabase
    .from("job_costing_items")
    .select("po_item_id, qty, job_costing!inner(id, job_kode, status)")
    .in("po_item_id", poItemIds);
  for (const row of data || []) {
    const job = Array.isArray(row.job_costing) ? row.job_costing[0] : row.job_costing;
    if (!job || job.status === "rejected") continue;
    const entry = map.get(row.po_item_id) || { qtyUsed: 0, jobs: [] };
    entry.qtyUsed += Number(row.qty) || 0;
    if (!entry.jobs.some((j) => j.id === job.id)) {
      entry.jobs.push({ id: job.id, job_kode: job.job_kode, status: job.status });
    }
    map.set(row.po_item_id, entry);
  }
  return map;
}

export type JcProgressStatus = "belum_terima" | "belum_jc" | "partial" | "selesai";

// Status Job Costing satu item PO Non-PR. Patokannya qty yang SUDAH diterima
// (RI completed), karena cuma barang yang sudah ada di gudang yang bisa
// di-Job Costing.
export function jcProgressStatus(qtyReceived: number, qtyUsed: number): JcProgressStatus {
  if (qtyReceived <= 0) return "belum_terima";
  if (qtyUsed <= 0) return "belum_jc";
  if (qtyUsed < qtyReceived) return "partial";
  return "selesai";
}

export const JC_PROGRESS_LABEL: Record<JcProgressStatus, string> = {
  belum_terima: "Belum Diterima",
  belum_jc: "Belum JC",
  partial: "Partial",
  selesai: "Selesai",
};
