/**
 * Util tanggal bisnis WMS-GMI.
 *
 * Seluruh perbandingan tanggal (deadline, freeze, dll) harus memakai timezone
 * bisnis (WIB / Asia/Jakarta), BUKAN UTC. `new Date().toISOString()` mengembalikan
 * tanggal UTC yang bisa mundur 1 hari dari waktu lokal Indonesia (UTC+7),
 * sehingga perbandingan "lewat deadline" jadi meleset di sekitar pergantian hari.
 */

export const BUSINESS_TIME_ZONE = "Asia/Jakarta";

/**
 * Tanggal "hari ini" menurut timezone bisnis dalam format `YYYY-MM-DD`.
 * Locale `en-CA` menghasilkan format ISO (YYYY-MM-DD).
 */
export function businessToday(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
  });
}
