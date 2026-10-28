// Konsinyasi vendor: supplier menitipkan barang (AC part) di gudang GMI.
// Stoknya milik vendor, disimpan di vendor_consignment_stock (per vendor +
// gudang + part) dan dicatat di vendor_consignment_movements -- TERPISAH dari
// tabel stock / stock_movements milik GMI.
//
// SENGAJA bukan modul "use server": fungsi di sini memposting stok, jadi
// tidak boleh bisa dipanggil langsung dari browser sebagai server action.
// Pemanggil (services/*-actions.ts) yang memegang validasi izin & claim.

import { changeStockQty } from "@/lib/stock-mutation";
import { fetchPrItemConvertedQty, isPrItemRejected } from "@/lib/pr-po-coverage";

export type ConsignmentKey = { vendorId: number; cabangId: number; partId: number };

export type ConsignmentChange = ConsignmentKey & {
  delta: number;
  label?: string;
  notes?: string;
};

const keyOf = (k: ConsignmentKey) => `${k.vendorId}:${k.cabangId}:${k.partId}`;

/** Tambah/kurangi satu baris stok konsinyasi (atomik, optimistic lock). */
export function changeConsignmentStock(
  supabase: any,
  key: ConsignmentKey,
  delta: number,
  opts?: { allowNegative?: boolean; label?: string },
) {
  return changeStockQty(
    supabase,
    {
      table: "vendor_consignment_stock",
      vendorId: key.vendorId,
      cabangId: key.cabangId,
      partId: key.partId,
    },
    delta,
    opts,
  );
}

/**
 * Terapkan sekumpulan perubahan stok konsinyasi sebagai satu unit: delta
 * dijumlah per vendor+gudang+part, pengurangan tidak boleh membuat stok
 * negatif. Gagal di tengah jalan -> perubahan yang sudah terjadi dikembalikan.
 * Sukses -> satu baris kartu stok per perubahan.
 */
export async function applyConsignmentChanges(
  supabase: any,
  changes: ConsignmentChange[],
  movement: { type: string; referenceId: string; actorId: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const merged = new Map<string, ConsignmentChange>();
  for (const c of changes) {
    if (!c.delta) continue;
    const cur = merged.get(keyOf(c));
    if (cur) cur.delta += c.delta;
    else merged.set(keyOf(c), { ...c });
  }

  const applied: ConsignmentChange[] = [];
  for (const c of merged.values()) {
    if (!c.delta) continue;
    const res = await changeConsignmentStock(supabase, c, c.delta, { label: c.label });
    if (!res.ok) {
      for (const a of applied) {
        await changeConsignmentStock(supabase, a, -a.delta, { allowNegative: true });
      }
      return { ok: false, error: res.error };
    }
    applied.push(c);
  }

  const rows = changes
    .filter((c) => c.delta)
    .map((c) => ({
      vendor_id: c.vendorId,
      cabang_id: c.cabangId,
      part_id: c.partId,
      qty_change: c.delta,
      type: movement.type,
      reference_id: movement.referenceId,
      notes: c.notes ?? null,
      created_by: movement.actorId,
    }));
  if (rows.length > 0) await supabase.from("vendor_consignment_movements").insert(rows);
  return { ok: true };
}

/**
 * Saldo bersih kartu stok per vendor+gudang+part untuk satu dokumen
 * (gabungan beberapa type, mis. GR + GR_CANCEL). Dipakai saat membalik
 * dokumen supaya yang dibalik persis yang benar-benar pernah tercatat.
 */
export async function fetchConsignmentNet(
  supabase: any,
  types: string[],
  referenceId: string,
): Promise<Map<string, ConsignmentKey & { qty: number }>> {
  const { data } = await supabase
    .from("vendor_consignment_movements")
    .select("vendor_id, cabang_id, part_id, qty_change")
    .in("type", types)
    .eq("reference_id", referenceId);
  const net = new Map<string, ConsignmentKey & { qty: number }>();
  for (const m of data || []) {
    const key = { vendorId: m.vendor_id, cabangId: m.cabang_id, partId: m.part_id };
    const row = net.get(keyOf(key)) || { ...key, qty: 0 };
    row.qty += Number(m.qty_change) || 0;
    net.set(keyOf(key), row);
  }
  return net;
}

/** Stok konsinyasi tersedia per part untuk satu vendor di satu gudang. */
export async function fetchConsignmentStockMap(
  supabase: any,
  vendorId: number,
  cabangId: number,
  partIds?: number[],
): Promise<Map<number, number>> {
  let q = supabase
    .from("vendor_consignment_stock")
    .select("part_id, qty")
    .eq("vendor_id", vendorId)
    .eq("cabang_id", cabangId);
  if (partIds && partIds.length > 0) q = q.in("part_id", partIds);
  const { data } = await q;
  return new Map((data || []).map((r: any) => [r.part_id, Number(r.qty) || 0]));
}

/** Total qty_terima GR Konsinyasi per item PR (sisa yang belum diterima). */
export async function fetchPrItemGrQty(
  supabase: any,
  prItemIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (prItemIds.length === 0) return map;
  const { data } = await supabase
    .from("vendor_consignment_gr_items")
    .select("pr_item_id, qty_terima")
    .in("pr_item_id", prItemIds);
  for (const r of data || []) {
    map.set(r.pr_item_id, (map.get(r.pr_item_id) || 0) + (Number(r.qty_terima) || 0));
  }
  return map;
}

export type FifoPoLine = {
  pr_item_id: number;
  pr_id: number;
  pr_kode: string;
  pr_tanggal: string;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
};

/**
 * Alokasi qty rekonsil ke item PR Konsinyasi vendor yang sama secara FIFO
 * (PR tertua dulu) -- "Purchasing buat PO berdasarkan FIFO PR yang di-share
 * ke supplier". Yang bisa dialokasikan per item PR = qty yang SUDAH diterima
 * lewat GR (maks. qty PR) - yang sudah ter-PO (PO non-rejected): barang yang
 * belum dikirim supplier tidak ikut ditagih. Part yang tidak cukup
 * dilaporkan di `shortages`.
 */
export async function allocateFifoPrItems(
  supabase: any,
  vendorId: number,
  qtyByPart: Map<number, number>,
): Promise<{ lines: FifoPoLine[]; shortages: { part_id: number; kurang: number }[] }> {
  const partIds = Array.from(qtyByPart.keys());
  if (partIds.length === 0) return { lines: [], shortages: [] };

  const { data: prItemRows } = await supabase
    .from("pr_items")
    .select(
      "id, pr_id, part_id, part_number, part_name, satuan, qty, status, prs!inner(pr_kode, pr_tanggal, pr_status, pr_jenis, pr_vendor_id)",
    )
    .in("part_id", partIds)
    .eq("prs.pr_jenis", "konsinyasi")
    .eq("prs.pr_vendor_id", vendorId)
    .eq("prs.pr_status", "approved");
  const candidates = (prItemRows || [])
    .filter((r: any) => !isPrItemRejected(r))
    .map((r: any) => {
      const pr = Array.isArray(r.prs) ? r.prs[0] : r.prs;
      return { ...r, pr_kode: pr?.pr_kode, pr_tanggal: pr?.pr_tanggal };
    })
    .sort(
      (a: any, b: any) =>
        String(a.pr_tanggal).localeCompare(String(b.pr_tanggal)) ||
        a.pr_id - b.pr_id ||
        a.id - b.id,
    );
  const candidateIds = candidates.map((c: any) => c.id);
  const [converted, received] = await Promise.all([
    fetchPrItemConvertedQty(supabase, candidateIds),
    fetchPrItemGrQty(supabase, candidateIds),
  ]);

  const lines: FifoPoLine[] = [];
  const shortages: { part_id: number; kurang: number }[] = [];
  for (const [partId, needed] of qtyByPart) {
    let left = needed;
    for (const c of candidates) {
      if (left <= 0) break;
      if (c.part_id !== partId) continue;
      const diterima = Math.min(Number(c.qty) || 0, received.get(c.id) || 0);
      const sisa = Math.max(0, diterima - (converted.get(c.id) || 0));
      if (sisa <= 0) continue;
      const take = Math.min(sisa, left);
      lines.push({
        pr_item_id: c.id,
        pr_id: c.pr_id,
        pr_kode: c.pr_kode,
        pr_tanggal: c.pr_tanggal,
        part_id: c.part_id,
        part_number: c.part_number,
        part_name: c.part_name,
        satuan: c.satuan,
        qty: take,
      });
      left -= take;
    }
    if (left > 0) shortages.push({ part_id: partId, kurang: left });
  }
  return { lines, shortages };
}

/** Qty bersih per part dari item rekonsil (dasar PO Rekonsil). */
export async function fetchRekonsilQtyByPart(
  supabase: any,
  rekonsilId: number,
): Promise<Map<number, number>> {
  const { data } = await supabase
    .from("vendor_consignment_rekonsil_items")
    .select("part_id, qty")
    .eq("rekonsil_id", rekonsilId);
  const map = new Map<number, number>();
  for (const r of data || []) map.set(r.part_id, (map.get(r.part_id) || 0) + (Number(r.qty) || 0));
  return map;
}

/**
 * Item PO Rekonsil dihitung ulang di server dari rekonsil (bukan dipercaya
 * dari payload): alokasi FIFO ke item PR Konsinyasi, vendor = vendor
 * rekonsil. Payload cuma menyumbang harga & tarif pajak per part.
 */
export async function prepareConsignmentPoItems<
  T extends {
    part_id: number;
    harga: number;
    item_ppn_rate?: number;
    item_pph_type?: string | null;
    item_pph_rate?: number;
  },
>(
  supabase: any,
  rekonsilId: number | null | undefined,
  payloadItems: T[],
): Promise<
  | { error: string }
  | {
      vendorId: number;
      items: (Omit<FifoPoLine, "pr_kode" | "pr_tanggal"> & {
        harga: number;
        vendor_id: number;
        mr_id: null;
        item_ppn_rate?: number;
        item_pph_type?: string | null;
        item_pph_rate?: number;
      })[];
    }
> {
  if (!rekonsilId) return { error: "PO Konsinyasi wajib dibuat dari Rekonsil Site." };
  const { data: rk } = await supabase
    .from("vendor_consignment_rekonsil")
    .select("id, rk_kode, status, po_id, vendor_id")
    .eq("id", rekonsilId)
    .maybeSingle();
  if (!rk) return { error: "Rekonsil tidak ditemukan." };
  if (rk.status !== "final") return { error: `Rekonsil ${rk.rk_kode} belum final (BAST belum ditandatangani).` };
  if (rk.po_id) return { error: `Rekonsil ${rk.rk_kode} sudah punya PO.` };

  const qtyByPart = await fetchRekonsilQtyByPart(supabase, rk.id);
  const { lines, shortages } = await allocateFifoPrItems(supabase, rk.vendor_id, qtyByPart);
  if (shortages.length > 0) {
    return {
      error:
        "Qty rekonsil melebihi qty PR Konsinyasi vendor ini yang sudah diterima (GR) & belum ter-PO, part: " +
        shortages.map((s) => `${s.part_id} (kurang ${s.kurang})`).join(", "),
    };
  }
  const byPart = new Map(payloadItems.map((i) => [i.part_id, i]));
  const items = lines.map((l) => {
    const src = byPart.get(l.part_id);
    return {
      pr_item_id: l.pr_item_id,
      pr_id: l.pr_id,
      part_id: l.part_id,
      part_number: l.part_number,
      part_name: l.part_name,
      satuan: l.satuan,
      qty: l.qty,
      harga: Number(src?.harga) || 0,
      vendor_id: rk.vendor_id,
      mr_id: null,
      item_ppn_rate: src?.item_ppn_rate,
      item_pph_type: src?.item_pph_type,
      item_pph_rate: src?.item_pph_rate,
    };
  });
  return { vendorId: rk.vendor_id, items };
}

/** Kode rekonsil yang sudah memuat baris SPB ini (null kalau belum). */
export async function findSpbRekonsil(
  supabase: any,
  spbId: number,
  detailIds?: number[],
): Promise<string | null> {
  let q = supabase
    .from("vendor_consignment_rekonsil_items")
    .select("vendor_consignment_rekonsil!inner(rk_kode)")
    .eq("spb_id", spbId)
    .limit(1);
  if (detailIds && detailIds.length > 0) q = q.in("spb_detail_id", detailIds);
  const { data, error } = await q;
  // Tabel belum ada (migration belum jalan) -> anggap belum direkonsil.
  if (error || !data || data.length === 0) return null;
  const rk = Array.isArray(data[0].vendor_consignment_rekonsil)
    ? data[0].vendor_consignment_rekonsil[0]
    : data[0].vendor_consignment_rekonsil;
  return rk?.rk_kode ?? "rekonsil";
}
