"use client";

import React, { useState, useEffect } from "react";
import { Content } from "@/components/content";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Search,
  Loader2,
  FilterX,
  Package,
  ArrowRight,
  Warehouse,
  ArrowUpDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useDebounce } from "use-debounce";
import { useRouter, useSearchParams } from "next/navigation";
import { StockDetailSheet } from "@/components/stock/stock-detail-sheet";
import { cn } from "@/lib/utils";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface StockClientProps {
  initialData: any[];
  totalCount: number;
  cabangList: any[];
  currentPage: number;
  pageSize: number;
  initialQuery: string;
  initialCabang: string;
  initialStatus: string;
  initialSort: string;
  initialView: "table" | "grid";
  initialStockFrom: string;
  initialStockTo: string;
}

export default function StockClient({
  initialData,
  totalCount,
  cabangList,
  currentPage,
  pageSize,
  initialQuery,
  initialCabang,
  initialStatus,
  initialSort,
  initialView,
  initialStockFrom,
  initialStockTo,
}: StockClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(initialQuery);
  const [debouncedSearch] = useDebounce(search, 500);
  const [stockFrom, setStockFrom] = useState(initialStockFrom);
  const [stockTo, setStockTo] = useState(initialStockTo);
  const [debouncedStockFrom] = useDebounce(stockFrom, 500);
  const [debouncedStockTo] = useDebounce(stockTo, 500);

  // Selected Part for Detail
  const [selectedPartId, setSelectedPartId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (debouncedSearch) params.set("q", debouncedSearch);
    else params.delete("q");

    if (debouncedStockFrom) params.set("stock_from", debouncedStockFrom);
    else params.delete("stock_from");

    if (debouncedStockTo) params.set("stock_to", debouncedStockTo);
    else params.delete("stock_to");

    params.set("page", "1");
    router.push(`/stock?${params.toString()}`);
  }, [debouncedSearch, debouncedStockFrom, debouncedStockTo]);

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", newPage.toString());
    router.push(`/stock?${params.toString()}`);
  };

  const handleSortChange = (newSort: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", newSort);
    params.set("page", "1");
    router.push(`/stock?${params.toString()}`);
  };

  const handleLimitChange = (newLimit: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("limit", newLimit);
    params.set("page", "1");
    router.push(`/stock?${params.toString()}`);
  };

  const handleRowClick = (partId: number) => {
    setSelectedPartId(partId);
    setDetailOpen(true);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <>
      {/* Section 1: Header */}
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <Warehouse className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                MONITORING STOK
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Pantau ketersediaan barang di seluruh site dan lokasi
                operasional
              </p>
            </div>
          </div>
          <Badge
            variant="secondary"
            className="h-9 shrink-0 rounded-md px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground"
          >
            Ringkasan Part
          </Badge>
        </div>
      </Content>

      {/* Section 2: Filter Bar */}
      <Content>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-70 group">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <Input
              placeholder="Cari Barang..."
              className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium text-foreground transition-all focus:bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <Select value={initialSort} onValueChange={handleSortChange}>
              <SelectTrigger className="h-9 w-full border-input bg-background text-xs font-semibold text-foreground sm:w-45">
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Urutkan" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="qty_desc">Stok Terbanyak</SelectItem>
                <SelectItem value="qty_asc">Stok Terendah</SelectItem>
                <SelectItem value="name_asc">Nama (A-Z)</SelectItem>
              </SelectContent>
            </Select>

            <Input
              type="number"
              min="0"
              placeholder="Stok min"
              className="h-9 w-full border-input bg-muted/40 text-xs font-medium text-foreground sm:w-28"
              value={stockFrom}
              onChange={(e) => setStockFrom(e.target.value)}
            />

            <Input
              type="number"
              min="0"
              placeholder="Stok max"
              className="h-9 w-full border-input bg-muted/40 text-xs font-medium text-foreground sm:w-28"
              value={stockTo}
              onChange={(e) => setStockTo(e.target.value)}
            />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStockFrom("");
                setStockTo("");
                router.push("/stock");
              }}
              className="h-9 text-xs font-bold text-muted-foreground hover:text-destructive"
            >
              <FilterX className="mr-1 h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        </div>
      </Content>

      {/* Section 3: Table + Pagination */}
      <Content className="overflow-hidden">
        <div className="overflow-x-auto text-[13px]">
          <Table className="table-fixed">
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10 border-b border-border hover:bg-transparent">
                <TableHead className="w-12.5 text-center text-[10px] font-black uppercase text-muted-foreground">
                  No
                </TableHead>
                <TableHead className="w-45 text-[10px] font-black uppercase text-muted-foreground">
                  Part Number
                </TableHead>
                <TableHead className="w-25 max-w-65 text-[10px] font-black uppercase text-muted-foreground">
                  Part Name
                </TableHead>
                <TableHead className="w-25 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Lokasi
                </TableHead>
                <TableHead className="w-27.5 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Total Stock
                </TableHead>
                <TableHead className="w-30 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Total Stok
                </TableHead>
                <TableHead className="w-15 pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialData.length > 0 ? (
                initialData.map((part, index) => (
                  <TableRow
                    key={part.part_id}
                    className="group cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30"
                    onClick={() => handleRowClick(part.part_id)}
                  >
                    <TableCell className="text-center text-xs font-medium text-muted-foreground">
                      {(currentPage - 1) * pageSize + index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="truncate font-bold tracking-tight text-foreground transition-colors group-hover:text-primary">
                        {part.part_number}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-65">
                      <div className="truncate text-xs font-medium text-muted-foreground">
                        {part.part_name}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className="h-5 border-border bg-muted/40 text-[10px] font-bold"
                      >
                        {part.active_locations} Site
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-black text-foreground">
                        {part.total_qty}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col">
                        <span
                          className={cn(
                            "text-sm font-black",
                            part.total_qty > 0
                              ? "text-foreground"
                              : "text-muted-foreground/40",
                          )}
                        >
                          {part.total_qty}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                          {part.part_satuan}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <ArrowRight className="h-4 w-4 text-muted-foreground/40 transition-all group-hover:translate-x-1 group-hover:text-primary" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-32 text-center text-sm italic text-muted-foreground"
                  >
                    Belum ada data stok.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="border-t border-border bg-muted/30 p-4">
          <DataTablePagination
            totalCount={totalCount}
            pageSize={pageSize}
            currentPage={currentPage}
            onPageChange={handlePageChange}
            onPageSizeChange={handleLimitChange}
            itemLabel="Part"
          />
        </div>
      </Content>

      <StockDetailSheet
        partId={selectedPartId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={() => router.refresh()}
      />
    </>
  );
}
