// Mutasi qty stok yang aman dari race condition (double-click / request
// bersamaan). Pola read -> update ... WHERE qty = qty_lama (optimistic lock,
// sama seperti Job Costing di services/finance-actions.ts), diulang kalau ada
// proses lain yang mengubah baris yang sama di tengah jalan. Tanpa ini, dua
// request yang membaca qty yang sama akan saling menimpa (satu mutasi hilang).
//
// Dipakai untuk tabel `stock` (lokasi cabang), `customer_stock` (stok
// konsinyasi di customer), dan `vendor_consignment_stock` (barang titipan
// vendor di gudang GMI).

export type StockLocation =
  | { table?: "stock"; partId: number; cabangId: number }
  | { table: "customer_stock"; partId: number; customerId: number }
  | { table: "vendor_consignment_stock"; partId: number; cabangId: number; vendorId: number };

export type StockChangeResult =
  | { ok: true; before: number; after: number }
  | { ok: false; error: string };

const MAX_ATTEMPTS = 6;

function locationFilters(loc: StockLocation): [string, number][] {
  if (loc.table === "customer_stock") return [["customer_id", loc.customerId]];
  if (loc.table === "vendor_consignment_stock") {
    return [
      ["vendor_id", loc.vendorId],
      ["cabang_id", loc.cabangId],
    ];
  }
  return [["cabang_id", loc.cabangId]];
}

function whereLocation(query: any, loc: StockLocation) {
  let q = query.eq("part_id", loc.partId);
  for (const [col, val] of locationFilters(loc)) q = q.eq(col, val);
  return q;
}

/**
 * Tambah/kurangi qty stok sebesar `delta` (boleh negatif). Pengurangan yang
 * membuat stok negatif (atau stok belum ada) ditolak kecuali allowNegative.
 * Baris stok yang belum ada dibuat otomatis untuk penambahan.
 */
export async function changeStockQty(
  supabase: any,
  loc: StockLocation,
  delta: number,
  opts?: { allowNegative?: boolean; label?: string },
): Promise<StockChangeResult> {
  const table = loc.table ?? "stock";
  const label = opts?.label ?? `part ${loc.partId}`;

  if (!delta) {
    const { data } = await whereLocation(supabase.from(table).select("qty"), loc).maybeSingle();
    const q = Number(data?.qty) || 0;
    return { ok: true, before: q, after: q };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: row, error: readErr } = await whereLocation(
      supabase.from(table).select("id, qty"),
      loc,
    ).maybeSingle();
    if (readErr) return { ok: false, error: readErr.message };

    if (!row) {
      if (delta < 0 && !opts?.allowNegative) {
        return { ok: false, error: `Stok ${label} tidak ditemukan / tidak mencukupi (butuh ${-delta}).` };
      }
      const { error: insErr } = await supabase
        .from(table)
        .insert({ part_id: loc.partId, ...Object.fromEntries(locationFilters(loc)), qty: delta });
      if (!insErr) return { ok: true, before: 0, after: delta };
      // Kemungkinan baris baru saja dibuat proses lain (unique violation) ->
      // ulangi sebagai update.
      continue;
    }

    const before = Number(row.qty) || 0;
    const after = before + delta;
    if (after < 0 && !opts?.allowNegative) {
      return {
        ok: false,
        error: `Stok ${label} tidak mencukupi (tersedia ${before}, butuh ${-delta}).`,
      };
    }

    const { data: updated, error: updErr } = await supabase
      .from(table)
      .update({ qty: after, ...(table === "stock" ? { updated_at: new Date().toISOString() } : {}) })
      .eq("id", row.id)
      .eq("qty", row.qty)
      .select("id");
    if (updErr) return { ok: false, error: updErr.message };
    if (updated && updated.length > 0) return { ok: true, before, after };
    // qty berubah sejak dibaca -> baca ulang & coba lagi.
  }

  return {
    ok: false,
    error: `Stok ${label} sedang diubah proses lain secara bersamaan. Silakan coba lagi.`,
  };
}

/** Jumlahkan qty per part (baris dengan part sama digabung). */
export function sumQtyByPart<T extends { part_id: number }>(
  rows: T[],
  qtyOf: (row: T) => number,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(r.part_id, (map.get(r.part_id) || 0) + (Number(qtyOf(r)) || 0));
  }
  return map;
}
