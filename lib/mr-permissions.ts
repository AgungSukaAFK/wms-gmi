// Role yang diizinkan MEMBUAT Material Request (MR).
//
// Sumber kebenaran tunggal: untuk menambah/mengurangi role yang boleh bikin MR,
// cukup ubah daftar ini. Dipakai bersama oleh UI (tombol "Buat MR", guard halaman
// create) dan server action createMaterialRequest.
export const MR_CREATE_ROLES = ["admin", "moderator", "service"];

type RoleLike = { name?: string | null } | string;

/**
 * Apakah kumpulan role ini boleh membuat MR.
 * Menerima array nama role (string[]) atau array objek role ({ name }).
 */
export function canCreateMR(
  roles: RoleLike[] | null | undefined,
): boolean {
  if (!roles) return false;
  return roles.some((r) => {
    const name = typeof r === "string" ? r : r?.name;
    return name != null && MR_CREATE_ROLES.includes(name);
  });
}
