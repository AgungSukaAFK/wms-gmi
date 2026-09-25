// Role yang diizinkan mengelola Working Order Formula (BOM).
//
// Moderator selalu boleh akses. 'wo_formula_editor' adalah role tambahan yang
// diberikan/dicabut per-user oleh moderator langsung dari dalam halaman WO
// Formula (lihat services/wo-formula-actions.ts toggleWoFormulaEditor) --
// bukan allowlist tabel baru, cukup pakai ulang user_roles yang sudah ada.
export const WO_FORMULA_ROLES = ["moderator", "wo_formula_editor"];

type RoleLike = { name?: string | null } | string;

/**
 * Apakah kumpulan role ini boleh mengelola WO Formula.
 * Menerima array nama role (string[]) atau array objek role ({ name }).
 */
export function canManageWoFormula(
  roles: RoleLike[] | null | undefined,
): boolean {
  if (!roles) return false;
  return roles.some((r) => {
    const name = typeof r === "string" ? r : r?.name;
    return name != null && WO_FORMULA_ROLES.includes(name);
  });
}

/**
 * Panel "Kelola Akses" (grant/revoke wo_formula_editor) hanya untuk
 * moderator -- supaya user yang baru diberi akses tidak bisa ikut
 * memberi akses ke orang lain.
 */
export function canGrantWoFormulaAccess(
  roles: RoleLike[] | null | undefined,
): boolean {
  if (!roles) return false;
  return roles.some((r) => (typeof r === "string" ? r : r?.name) === "moderator");
}
