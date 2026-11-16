import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  SOFT,
  SOLID_TONE,
  STATUS_COLOR,
  STATUS_LABEL,
  type StatusColor,
} from "@/lib/constants/status";

/**
 * Badge status dokumen. `tone="solid"` hanya untuk status dokumen di header
 * halaman/panel detail; selain itu (kolom tabel, item, chip) pakai `soft`.
 */
export function StatusBadge({
  status,
  label,
  tone = "soft",
  color: colorOverride,
  className,
}: {
  status: string | null | undefined;
  /** Teks tampilan kalau beda dari label default status ini. */
  label?: string;
  tone?: "soft" | "solid";
  /** Warna kalau beda dari default status ini (mis. PO 'closed'). */
  color?: StatusColor;
  className?: string;
}) {
  const key = (status || "").toLowerCase();
  const color = colorOverride ?? STATUS_COLOR[key] ?? "gray";
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-bold text-[10px] uppercase",
        tone === "solid" ? SOLID_TONE[color] : SOFT[color],
        className,
      )}
    >
      {label ?? STATUS_LABEL[key] ?? (status || "N/A")}
    </Badge>
  );
}
