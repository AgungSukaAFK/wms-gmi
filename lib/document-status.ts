export const LEGACY_FINAL_STATUSES = ["done", "closed"] as const;

export function isLegacyCompletedStatus(status?: string | null): boolean {
  return LEGACY_FINAL_STATUSES.includes((status || "").toLowerCase() as any);
}

export function normalizeDocumentStatus(status?: string | null): string {
  const normalized = (status || "").toLowerCase();
  if (normalized === "completed") return "completed";
  if (isLegacyCompletedStatus(normalized)) return "completed";
  return normalized;
}

export function isCompletedLikeStatus(status?: string | null): boolean {
  return normalizeDocumentStatus(status) === "completed";
}

export function completedFilterStatuses(): string[] {
  return ["completed", ...LEGACY_FINAL_STATUSES];
}

export function toCompletedIfLegacy(status?: string | null): string {
  return isLegacyCompletedStatus(status) ? "completed" : status || "open";
}
