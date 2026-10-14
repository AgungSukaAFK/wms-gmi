import { Badge } from "@/components/ui/badge";
import { SO_STATUS_LABEL, type SoStatus } from "@/lib/so-reguler";

const STATUS_CLASS: Record<SoStatus, string> = {
  open: "bg-primary/10 text-primary border-primary/30",
  partial: "bg-warning/10 text-warning border-warning/30",
  completed: "bg-success text-success-foreground border-success",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
};

export function SoStatusBadge({ status }: { status: string | null | undefined }) {
  const s = (status || "open") as SoStatus;
  return (
    <Badge
      variant="outline"
      className={`font-bold text-[10px] uppercase ${STATUS_CLASS[s] || ""}`}
    >
      {SO_STATUS_LABEL[s] || status}
    </Badge>
  );
}
