// Helper ambil SEMUA baris dari Supabase/PostgREST untuk export & agregasi.
//
// PostgREST membatasi tiap response maksimal `max_rows` (1000) baris — tanpa
// error, datanya cuma terpotong diam-diam. Jadi query yang hasilnya bisa
// > 1000 baris (termasuk `.in("parent_id", ids)` ke tabel anak!) WAJIB
// dipaginasi dengan `.range()` + urutan yang stabil.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PAGE_SIZE = 1000;

/**
 * Paginasi query builder sampai habis. `make()` harus membuat query baru
 * tiap dipanggil dan SUDAH punya `.order()` yang unik/stabil (mis. `id`).
 */
export async function fetchAllPages<T = any>(
  make: () => any,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await make().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message || String(error));
    out.push(...((data || []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/**
 * `select(columns).in(column, ids)` untuk daftar id yang panjang: id dipecah
 * per `chunkSize` (URL PostgREST terbatas) dan tiap potongan dipaginasi,
 * diurutkan by `orderBy` (default "id") supaya halaman tidak loncat/dobel.
 * `modify` untuk filter tambahan (mis. `.eq(...)`).
 */
export async function fetchInPaged<T = any>(
  supabase: any,
  table: string,
  columns: string,
  column: string,
  ids: (string | number | null | undefined)[],
  opts: {
    chunkSize?: number;
    orderBy?: string;
    modify?: (query: any) => any;
  } = {},
): Promise<T[]> {
  const { chunkSize = 200, orderBy = "id", modify } = opts;
  const uniq = Array.from(
    new Set(ids.filter((v) => v !== null && v !== undefined && v !== "")),
  ) as (string | number)[];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const rows = await fetchAllPages<T>(() => {
      let q = supabase.from(table).select(columns).in(column, chunk);
      if (modify) q = modify(q);
      return q.order(orderBy, { ascending: true });
    });
    out.push(...rows);
  }
  return out;
}
