type RoleHolder = {
  roles?: Array<{
    name?: string;
    label?: string;
    roles?:
      | { name?: string; label?: string }
      | Array<{ name?: string; label?: string }>;
  }>;
  user_roles?: Array<{
    roles?:
      | { name?: string; label?: string }
      | Array<{ name?: string; label?: string }>;
  }>;
};

const normalizeRole = (value?: string | null) =>
  (value || "").trim().toLowerCase();

export function extractRoleNames(profile?: RoleHolder | null): string[] {
  if (!profile) return [];

  const pickRoleName = (
    role?:
      | { name?: string; label?: string }
      | Array<{ name?: string; label?: string }>,
  ) => {
    if (Array.isArray(role)) {
      return normalizeRole(role[0]?.name || role[0]?.label);
    }
    return normalizeRole(role?.name || role?.label);
  };

  const fromRoles = (profile.roles || [])
    .map((r) => normalizeRole(r?.name || r?.label) || pickRoleName(r?.roles))
    .filter(Boolean);

  const fromUserRoles = (profile.user_roles || [])
    .map((r) => pickRoleName(r?.roles))
    .filter(Boolean);

  return Array.from(new Set([...fromRoles, ...fromUserRoles]));
}

export function canViewPOPrice(profile?: RoleHolder | null): boolean {
  return extractRoleNames(profile).includes("purchasing");
}

export function maskPOPriceValue<T extends { harga?: number | null }>(
  item: T,
  allowed: boolean,
): T {
  if (allowed) return item;
  return {
    ...item,
    harga: 0,
  };
}

export function maskPOPriceItems<T extends { harga?: number | null }>(
  items: T[],
  allowed: boolean,
): T[] {
  if (allowed) return items;
  return items.map((item) => maskPOPriceValue(item, allowed));
}

export function maskedPriceText(allowed: boolean, valueText: string): string {
  return allowed ? valueText : "Restricted";
}
