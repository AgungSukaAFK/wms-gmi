// SO Reguler: Sales Order reguler ke customer, tanpa approval. Pemenuhan per
// item dinamis & partial per qty -- sebagian langsung DO Reguler dari stok,
// sebagian PO dulu (po_jenis 'so') lalu RI ke gudang site SO, baru di-DO.
// Lihat supabase/migrations/20261014100000_so_reguler.sql.

// Role yang boleh MEMBUAT SO Reguler (keputusan user 2026-10-14).
export const SO_CREATE_ROLES = ["marketing", "admin", "moderator"];

type RoleLike = { name?: string | null } | string;

export function canCreateSO(roles: RoleLike[] | null | undefined): boolean {
  if (!roles) return false;
  return roles.some((r) => {
    const name = typeof r === "string" ? r : r?.name;
    return name != null && SO_CREATE_ROLES.includes(name);
  });
}

// Kategori SO sengaja disamakan dengan kategori MR (keputusan user).
export const SO_KATEGORI_OPTIONS = [
  "New Item",
  "Replace Item",
  "Fix & Repair",
  "Upgrade",
];

export type SoStatus = "open" | "partial" | "completed" | "cancelled";

export const SO_STATUS_LABEL: Record<SoStatus, string> = {
  open: "Open",
  partial: "Partial",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export type SoItemFulfillment = {
  // PO yang belum rejected
  qtyPo: number;
  // Sudah diterima lewat RI dari PO tsb (po_items.qty_received)
  qtyPoReceived: number;
  // DO Reguler yang belum dibatalkan
  qtyDo: number;
  // Bagian qtyDo yang memakai barang hasil PO (do_reguler_items.qty_from_po)
  qtyDoFromPo: number;
  pos: { id: number; po_kode: string; qty: number; po_status: string }[];
  dos: { id: number; do_kode: string; qty: number; status: string }[];
};

function rel(row: any, key: string) {
  const v = row?.[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Satu-satunya definisi "sudah di-PO" / "sudah di-DO" untuk item SO. Dihitung
 * dari dokumen turunan (bukan counter) supaya otomatis benar saat PO ditolak/
 * dihapus atau DO dibatalkan/dihapus.
 */
export async function fetchSoItemFulfillment(
  supabase: any,
  soItemIds: number[],
  // Abaikan satu PO (Edit/Revisi PO: qty PO yang sedang diedit jangan
  // mengurangi sisa SO-nya sendiri).
  opts?: { excludePoId?: number },
): Promise<Map<number, SoItemFulfillment>> {
  const map = new Map<number, SoItemFulfillment>();
  for (const id of soItemIds) {
    map.set(id, {
      qtyPo: 0,
      qtyPoReceived: 0,
      qtyDo: 0,
      qtyDoFromPo: 0,
      pos: [],
      dos: [],
    });
  }
  if (soItemIds.length === 0) return map;

  const [{ data: poRows }, { data: doRows }] = await Promise.all([
    supabase
      .from("po_items")
      .select("so_item_id, qty, qty_received, pos!inner(id, po_kode, po_status)")
      .in("so_item_id", soItemIds),
    supabase
      .from("do_reguler_items")
      .select("so_item_id, qty, qty_from_po, do_reguler!inner(id, do_kode, status)")
      .in("so_item_id", soItemIds),
  ]);

  for (const row of poRows ?? []) {
    const po = rel(row, "pos");
    const entry = map.get(row.so_item_id);
    if (!po || !entry || po.po_status === "rejected") continue;
    if (opts?.excludePoId && po.id === opts.excludePoId) continue;
    entry.qtyPo += Number(row.qty) || 0;
    entry.qtyPoReceived += Number(row.qty_received) || 0;
    entry.pos.push({
      id: po.id,
      po_kode: po.po_kode,
      qty: Number(row.qty) || 0,
      po_status: po.po_status,
    });
  }
  for (const row of doRows ?? []) {
    const d = rel(row, "do_reguler");
    const entry = map.get(row.so_item_id);
    if (!d || !entry || d.status === "cancelled") continue;
    entry.qtyDo += Number(row.qty) || 0;
    entry.qtyDoFromPo += Number(row.qty_from_po) || 0;
    entry.dos.push({
      id: d.id,
      do_kode: d.do_kode,
      qty: Number(row.qty) || 0,
      status: d.status,
    });
  }
  return map;
}

/**
 * Sisa qty per item SO.
 *
 * - sisaDo: qty yang belum dikirim ke customer.
 * - sisaPo: qty yang belum "tertutup" -- belum dipesan lewat PO dan belum
 *   dikirim dari stok biasa. Unit DO yang memakai barang hasil PO
 *   (qty_from_po) tidak mengurangi jatah PO lagi. Contoh qty 5: PO 3
 *   (diterima 3) lalu DO 3 -> sisaPo 2 (bukan 0), karena 3 unit DO itu adalah
 *   barang PO.
 * - poPoolAvailable: barang hasil PO yang sudah diterima tapi belum dipakai
 *   DO -- dipakai createDoReguler untuk mengisi qty_from_po DO baru.
 */
export function computeSoItemRemaining(
  qty: number,
  f:
    | Pick<SoItemFulfillment, "qtyPo" | "qtyPoReceived" | "qtyDo" | "qtyDoFromPo">
    | undefined,
) {
  const qtyPo = f?.qtyPo ?? 0;
  const qtyDo = f?.qtyDo ?? 0;
  const qtyPoReceived = Math.min(f?.qtyPoReceived ?? 0, qtyPo);
  const qtyDoFromPo = Math.min(f?.qtyDoFromPo ?? 0, qtyDo);
  const doFromStock = qtyDo - qtyDoFromPo;
  const sisaDo = Math.max(0, qty - qtyDo);
  return {
    sisaDo,
    sisaPo: Math.max(0, Math.min(sisaDo, qty - qtyPo - doFromStock)),
    poPoolAvailable: Math.max(0, qtyPoReceived - qtyDoFromPo),
  };
}

export function computeSoStatus(
  items: { qty: number; qtyDo: number; qtyPo: number }[],
): Exclude<SoStatus, "cancelled"> {
  if (items.length > 0 && items.every((i) => i.qtyDo >= i.qty)) {
    return "completed";
  }
  if (items.some((i) => i.qtyDo > 0 || i.qtyPo > 0)) return "partial";
  return "open";
}

/**
 * Hitung ulang & simpan so_reguler.so_status. Dipanggil setelah aksi yang
 * mengubah pemenuhan SO (buat/batal/hapus DO, buat/tolak/hapus PO). SO yang
 * sudah dibatalkan tidak disentuh.
 */
export async function refreshSoStatus(supabase: any, soId: number | null | undefined) {
  if (!soId) return;
  const { data: so } = await supabase
    .from("so_reguler")
    .select("id, so_status, so_reguler_items(id, qty)")
    .eq("id", soId)
    .maybeSingle();
  if (!so || so.so_status === "cancelled") return;
  const items: { id: number; qty: number }[] = so.so_reguler_items || [];
  const f = await fetchSoItemFulfillment(
    supabase,
    items.map((i) => i.id),
  );
  const next = computeSoStatus(
    items.map((i) => ({
      qty: i.qty,
      qtyDo: f.get(i.id)?.qtyDo ?? 0,
      qtyPo: f.get(i.id)?.qtyPo ?? 0,
    })),
  );
  if (next !== so.so_status) {
    await supabase.from("so_reguler").update({ so_status: next }).eq("id", soId);
  }
}
