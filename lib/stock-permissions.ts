import type { ProfileWithRoles } from "@/type";

/**
 * Tentukan apakah user boleh mengubah min/max (dan qty) stok suatu gudang.
 *
 * Aturan (harus sinkron dengan server action `updateStock`):
 *  - Moderator  : boleh semua gudang (global).
 *  - PPIC / PJO : hanya gudang di lokasi (cabang) miliknya sendiri.
 *  - Role lain  : tidak boleh.
 */
export function canEditStock(
  profile: ProfileWithRoles | null | undefined,
  stockCabangId: number | null | undefined,
): boolean {
  if (!profile) return false;
  const roleNames = (profile.roles || []).map((r: any) => r?.name);

  if (roleNames.includes("moderator")) return true;

  if (roleNames.includes("ppic") || roleNames.includes("pjo")) {
    return (
      profile.cabang_id != null && profile.cabang_id === stockCabangId
    );
  }

  return false;
}
