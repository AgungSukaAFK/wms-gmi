// Level progres MR turunan (derived), dihitung dari mr_convert_status,
// keberadaan PO terkait, dan agregat qty_received vs qty_request.
// Tidak disimpan di DB — murni dihitung di client dari data yang sudah ada.
export type MrLevel =
  | "pr_pending"
  | "po_pending"
  | "awaiting_receive"
  | "partial_received"
  | "fully_received";

export const MR_LEVEL_LABELS: Record<MrLevel, string> = {
  pr_pending: "Menunggu PR",
  po_pending: "Menunggu PO",
  awaiting_receive: "Menunggu Barang",
  partial_received: "Diterima Sebagian",
  fully_received: "Diterima Lengkap",
};

export const MR_LEVEL_BADGE_CLASS: Record<MrLevel, string> = {
  pr_pending: "bg-muted text-muted-foreground border-border",
  po_pending: "bg-amber-100 text-amber-700 border-amber-300",
  awaiting_receive: "bg-sky-100 text-sky-700 border-sky-300",
  partial_received: "bg-orange-100 text-orange-700 border-orange-300",
  fully_received: "bg-success/10 text-success border-success/30",
};

export function computeMrLevel(input: {
  mrConvertStatus: string | null | undefined;
  hasPo: boolean;
  qtyRequestTotal: number;
  qtyReceivedTotal: number;
}): MrLevel {
  const { mrConvertStatus, hasPo, qtyRequestTotal, qtyReceivedTotal } = input;

  if (qtyRequestTotal > 0 && qtyReceivedTotal >= qtyRequestTotal) {
    return "fully_received";
  }
  if (qtyReceivedTotal > 0) {
    return "partial_received";
  }
  if (!mrConvertStatus || mrConvertStatus === "pending") {
    return "pr_pending";
  }
  if (!hasPo) {
    return "po_pending";
  }
  return "awaiting_receive";
}
