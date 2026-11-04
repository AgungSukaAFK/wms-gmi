// lib/supabase/search-filter.ts

const quoteOrValue = (value: string) =>
  `"${value.replace(/["\\]/g, "\\$&")}"`;

/**
 * Pola `ilike` untuk dipakai di dalam `.or()`. Kata kunci dibungkus kutip
 * supaya koma, kurung, atau kutip di dalamnya tidak merusak sintaks filter
 * PostgREST.
 */
export function orIlikePattern(term: string) {
  return quoteOrValue(`%${term}%`);
}

/** Seperti `orIlikePattern`, tapi hanya cocok di awal teks (prefix match). */
export function orIlikePrefixPattern(term: string) {
  return quoteOrValue(`${term}%`);
}
