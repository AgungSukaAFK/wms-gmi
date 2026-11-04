/**
 * Urutkan baris di browser memakai nilai `?sort=` (`kolom_asc` / `kolom_desc`).
 * `sort` kosong = urutan asli dari server. Tidak mengubah array asalnya.
 */
export function sortRows<T>(
  rows: T[],
  sort: string,
  getValue: (row: T, key: string) => string | number | null | undefined,
): T[] {
  if (!sort) return rows;
  const [key, dir] = sort.split(/_(asc|desc)$/);
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getValue(a, key) ?? "";
    const vb = getValue(b, key) ?? "";
    if (va < vb) return -sign;
    if (va > vb) return sign;
    return 0;
  });
}
