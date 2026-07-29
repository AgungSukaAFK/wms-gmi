"use client";

import * as React from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Header kolom tabel yang bisa diklik untuk sort asc/desc. Cuma komponen
 * presentasi -- pemanggil yang menentukan bagaimana `onSort` diterapkan
 * (ganti query param URL, state + refetch server, atau sort array di client).
 *
 * `currentSort` memakai konvensi string `${sortKey}_asc` / `${sortKey}_desc`.
 */
interface SortableTableHeadProps extends React.ComponentProps<"th"> {
  sortKey: string;
  currentSort: string;
  onSort: (nextSort: string) => void;
  /** Arah yang dipakai saat kolom ini diklik pertama kali (belum aktif). */
  defaultDir?: "asc" | "desc";
}

export function SortableTableHead({
  sortKey,
  currentSort,
  onSort,
  defaultDir = "asc",
  className,
  children,
  ...props
}: SortableTableHeadProps) {
  const isAsc = currentSort === `${sortKey}_asc`;
  const isDesc = currentSort === `${sortKey}_desc`;
  const active = isAsc || isDesc;

  const handleClick = () => {
    if (isAsc) onSort(`${sortKey}_desc`);
    else if (isDesc) onSort(`${sortKey}_asc`);
    else onSort(`${sortKey}_${defaultDir}`);
  };

  return (
    <TableHead
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        "cursor-pointer select-none transition-colors hover:text-foreground",
        active && "text-foreground",
        className,
      )}
      {...props}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {isAsc && <ArrowUp className="h-3 w-3 shrink-0" />}
        {isDesc && <ArrowDown className="h-3 w-3 shrink-0" />}
        {!active && <ArrowUpDown className="h-3 w-3 shrink-0 opacity-30" />}
      </span>
    </TableHead>
  );
}
