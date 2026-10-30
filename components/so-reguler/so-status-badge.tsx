import { StatusBadge } from "@/components/status-badge";
import { SO_STATUS_LABEL, type SoStatus } from "@/lib/so-reguler";

export function SoStatusBadge({ status }: { status: string | null | undefined }) {
  const s = (status || "open") as SoStatus;
  return <StatusBadge status={s} label={SO_STATUS_LABEL[s] || status || undefined} />;
}
