export interface ApprovalStep {
  status: "pending" | "approved" | "rejected";
  nama?: string;
  level?: string | number;
  approval_role?: "menyetujui" | "mengetahui";
  userid?: string;
  user_id?: string;
}

export interface ApprovalSummary {
  approvedCount: number;
  totalCount: number;
  pendingApprover: { nama: string; level?: string | number } | null;
  isRejected: boolean;
}

/**
 * Summarize a document's approvals jsonb array (MR/PR/PO all share this
 * shape) into progress counts + who's currently pending.
 */
export function summarizeApprovals(
  approvals: ApprovalStep[] | null | undefined,
): ApprovalSummary {
  const list = approvals ?? [];
  const approvedCount = list.filter((a) => a.status === "approved").length;
  const isRejected = list.some((a) => a.status === "rejected");
  const pending = list.find((a) => a.status === "pending");

  return {
    approvedCount,
    totalCount: list.length,
    pendingApprover: pending
      ? { nama: pending.nama || "Unknown", level: pending.level }
      : null,
    isRejected,
  };
}
