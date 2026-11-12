// Role yang boleh mengelola data Konsinyasi Vendor (hapus PR/GR, stock opname,
// buka kembali / hapus rekonsil, ubah tagihan). Dipakai di server action
// (services/vendor-consignment-actions.ts) dan halaman /vendor-consignment/*.
export const CONSIGNMENT_MANAGER_ROLES = ["moderator", "admin", "ppic"];

export function isConsignmentManager(roleNames: string[]) {
  return roleNames.some((r) => CONSIGNMENT_MANAGER_ROLES.includes(r));
}
