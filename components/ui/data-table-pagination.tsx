"use client";

import React, { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DataTablePaginationProps {
  totalCount: number;
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: string) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
}

export function DataTablePagination({
  totalCount,
  pageSize,
  currentPage,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  itemLabel = "Item",
}: DataTablePaginationProps) {
  const [jumpPage, setJumpPage] = useState(currentPage.toString());
  const totalPages = Math.ceil(totalCount / pageSize);

  // Sync jumpPage with currentPage when it changes externally
  useEffect(() => {
    setJumpPage(currentPage.toString());
  }, [currentPage]);

  const handleJumpPage = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(jumpPage);
    if (!isNaN(p) && p >= 1 && p <= totalPages) {
      onPageChange(p);
    } else {
      setJumpPage(currentPage.toString());
    }
  };

  return (
    <div className="flex flex-col items-start justify-between gap-4 rounded-xl border bg-white p-3 shadow-sm md:flex-row md:items-center">
      <p className="text-xs font-medium text-muted-foreground">
        Ditemukan{" "}
        <span className="font-bold text-slate-900">
          {totalCount} {itemLabel}
        </span>
      </p>

      <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:flex-nowrap">
        {/* Rows Per Page */}
        <div className="flex items-center gap-1.5 pr-3 md:border-r md:border-slate-100">
          <span className="text-[10px] uppercase font-black text-slate-300">
            BARIS:
          </span>
          <Select value={pageSize.toString()} onValueChange={onPageSizeChange}>
            <SelectTrigger className="h-7 w-[65px] bg-slate-50 border-slate-200 text-xs font-bold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((option) => (
                <SelectItem key={option} value={option.toString()}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Jump to Page */}
        <form
          onSubmit={handleJumpPage}
          className="flex items-center gap-1.5 focus-within:opacity-100 transition-opacity"
        >
          <Input
            className="h-7 w-12 text-center bg-slate-50 border-slate-200 text-xs font-bold"
            value={jumpPage}
            onChange={(e) => setJumpPage(e.target.value)}
          />
          <span className="text-[10px] uppercase font-black text-slate-300">
            / {totalPages || 1}
          </span>
        </form>

        {/* Navigation Buttons */}
        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 overflow-hidden ml-2 transition-all">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-3 hover:bg-white transition-colors disabled:opacity-30"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1 || totalPages === 0}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-3 border-l border-slate-200 hover:bg-white transition-colors disabled:opacity-30"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages || totalPages === 0}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
