// Helper bersama importer dokumen transaksi (SO, DO, IK, SPB, MR, PR, PO, ...).

import { changeStockQty } from "@/lib/stock-mutation";
import type { ImportRow, ImportRowResult } from "../types";
import { type BarangMatch, codeVariants, fail, fetchIn, keyOf, ok, str } from "./common";

export type CustomerRow = { id: number; customer_no: string; customer_name: string; customer_type: string; is_active: boolean };

export async function loadCustomers(supabase: any, nos: (string | null)[]) {
  const rows = await fetchIn<CustomerRow>(codeVariants(nos), (p) =>
    supabase.from("customers").select("id, customer_no, customer_name, customer_type, is_active").in("customer_no", p).order("id"),
  );
  return new Map(rows.map((c) => [keyOf(c.customer_no), c]));
}

/** Kode dokumen yang sudah ada di tabel (kunci keyOf). */
export async function existingCodes(supabase: any, table: string, column: string, codes: (string | null)[]) {
  const rows = await fetchIn<any>(codeVariants(codes), (p) => supabase.from(table).select(`id, ${column}`).in(column, p).order("id"));
  return new Map(rows.map((r) => [keyOf(r[column]), r]));
}

export type DocItem = {
  row: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  /** Kolom tambahan per baris (remarks, PN customer, dst). */
  extra: Record<string, unknown>;
};

/**
 * Baris barang 1 dokumen -> item ber-part_id. Part tidak ada di master =
 * error baris; part "mirip" dipakai dengan peringatan. mergeDuplicates:
 * part sama digabung (qty dijumlah) -- untuk dokumen yang tidak boleh punya
 * barang dobel.
 */
export function resolveDocItems(
  list: ImportRow[],
  barang: Map<string, BarangMatch>,
  opts: { mergeDuplicates?: boolean; extra?: (r: ImportRow) => Record<string, unknown> } = {},
) {
  const errors = new Map<number, string>();
  const warnings = new Map<number, string[]>();
  const items: DocItem[] = [];
  const byPart = new Map<number, DocItem>();
  for (const r of list) {
    const pn = str(r.values.part_number)!;
    const m = barang.get(pn);
    if (!m) {
      errors.set(r.row, `Part ${pn} tidak ada di master Barang (tambahkan lewat import Barang dulu)`);
      continue;
    }
    if (m.match === "mirip") warnings.set(r.row, [...(warnings.get(r.row) || []), `Part “${pn}” dicocokkan ke “${m.part_number}”`]);
    const qty = Number(r.values.qty);
    const extra = opts.extra ? opts.extra(r) : {};
    const prev = byPart.get(m.id);
    if (opts.mergeDuplicates && prev) {
      prev.qty += qty;
      warnings.set(r.row, [...(warnings.get(r.row) || []), `Part dobel dalam 1 dokumen → digabung ke baris ${prev.row} (qty jadi ${prev.qty})`]);
      continue;
    }
    const item: DocItem = { row: r.row, part_id: m.id, part_number: m.part_number, part_name: m.part_name, satuan: m.part_satuan || "PCS", qty, extra };
    items.push(item);
    if (!prev) byPart.set(m.id, item);
  }
  return { items, errors, warnings };
}

/** Hasil per baris untuk 1 dokumen: error dulu, sisanya status yang sama. */
export function docResults(
  list: ImportRow[],
  code: string,
  status: ImportRowResult["status"],
  message: string,
  errors: Map<number, string> = new Map(),
  warnings: Map<number, string[]> = new Map(),
): ImportRowResult[] {
  const hasErr = errors.size > 0 || status === "error";
  return list.map((r) => {
    if (errors.has(r.row)) return fail(r.row, errors.get(r.row)!, code);
    if (hasErr && status !== "error") return fail(r.row, "Dilewati: ada baris error di dokumen yang sama", code);
    if (status === "error") return fail(r.row, message, code);
    return ok(r.row, status, message, code, warnings.get(r.row));
  });
}

export async function stockLevels(supabase: any, cabangId: number, partIds: number[]) {
  const rows = await fetchIn<any>(partIds, (p) => supabase.from("stock").select("part_id, qty").eq("cabang_id", cabangId).in("part_id", p).order("id"));
  return new Map(rows.map((r) => [r.part_id as number, Number(r.qty) || 0]));
}

/** Cache stok per gudang + part; ambil dari DB hanya part yang belum dimuat. */
export class StockCache {
  private map = new Map<string, number>();
  constructor(private supabase: any) {}
  async ensure(cabangId: number, partIds: number[]) {
    const missing = Array.from(new Set(partIds)).filter((p) => !this.map.has(`${cabangId}|${p}`));
    if (!missing.length) return;
    const found = await stockLevels(this.supabase, cabangId, missing);
    for (const p of missing) this.map.set(`${cabangId}|${p}`, found.get(p) ?? 0);
  }
  get(cabangId: number, partId: number) {
    return this.map.get(`${cabangId}|${partId}`) ?? 0;
  }
}

export function sumByPart(items: { part_id: number; qty: number }[]) {
  const m = new Map<number, number>();
  for (const i of items) m.set(i.part_id, (m.get(i.part_id) || 0) + i.qty);
  return m;
}

/**
 * Potong stok gudang per part (atomik, boleh minus) + 1 stock_movement per
 * item. Dipakai mode Riwayat (mode Normal memakai fungsi create aplikasi).
 */
export async function cutStock(
  supabase: any,
  params: {
    cabangId: number;
    items: { part_id: number; part_number: string; part_name: string; qty: number }[];
    type: string;
    reference: string;
    note: (i: { part_number: string; part_name: string; qty: number }) => string;
    userId: string;
  },
) {
  for (const [partId, qty] of sumByPart(params.items)) {
    const label = params.items.find((i) => i.part_id === partId)?.part_number;
    const res = await changeStockQty(supabase, { partId, cabangId: params.cabangId }, -qty, { allowNegative: true, label });
    if (!res.ok) return res.error || `Gagal memotong stok ${label}`;
  }
  const { error } = await supabase.from("stock_movements").insert(
    params.items.map((i) => ({
      part_id: i.part_id,
      cabang_id: params.cabangId,
      qty_change: -i.qty,
      type: params.type,
      reference_id: params.reference,
      created_by: params.userId,
      notes: params.note(i),
    })),
  );
  return error ? `Stok terpotong, riwayat gagal disimpan: ${error.message}` : null;
}
