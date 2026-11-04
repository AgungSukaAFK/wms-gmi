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

type SortDir = "asc" | "desc";

/** Nilai sort berikutnya saat kolom diklik. */
export function getNextSort(
  sortKey: string,
  currentSort: string,
  defaultDir: SortDir = "asc",
) {
  if (currentSort === `${sortKey}_asc`) return `${sortKey}_desc`;
  if (currentSort === `${sortKey}_desc`) return `${sortKey}_asc`;
  return `${sortKey}_${defaultDir}`;
}

export function sortAriaValue(sortKey: string, currentSort: string) {
  if (currentSort === `${sortKey}_asc`) return "ascending" as const;
  if (currentSort === `${sortKey}_desc`) return "descending" as const;
  return "none" as const;
}

export function SortIcon({
  sortKey,
  currentSort,
}: {
  sortKey: string;
  currentSort: string;
}) {
  if (currentSort === `${sortKey}_asc`)
    return <ArrowUp className="h-3 w-3 shrink-0" />;
  if (currentSort === `${sortKey}_desc`)
    return <ArrowDown className="h-3 w-3 shrink-0" />;
  return <ArrowUpDown className="h-3 w-3 shrink-0 opacity-30" />;
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
  const active = sortAriaValue(sortKey, currentSort) !== "none";
  const handleClick = () => onSort(getNextSort(sortKey, currentSort, defaultDir));

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
        <SortIcon sortKey={sortKey} currentSort={currentSort} />
      </span>
    </TableHead>
  );
}
