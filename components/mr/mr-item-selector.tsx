"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Plus,
  Trash2,
  Package,
  Layers,
  X,
  Target,
  Minus,
  Loader2,
} from "lucide-react";
import { useDebounce } from "use-debounce";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";

interface Barang {
  id: number;
  part_number: string;
  part_name: string;
  part_satuan: string;
}

export interface MRItem {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
}

interface MRItemSelectorProps {
  items: MRItem[];
  onItemsChange: (items: MRItem[]) => void;
}

export function MRItemSelector({ items, onItemsChange }: MRItemSelectorProps) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [results, setResults] = useState<Barang[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchItems = async (q: string) => {
    setLoading(true);
    let query = supabase
      .from("barang")
      .select("*")
      .order("part_name")
      .limit(15);

    if (q) {
      query = query.or(`part_number.ilike.%${q}%,part_name.ilike.%${q}%`);
    }

    const { data } = await query;
    setResults(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (open) {
      fetchItems(debouncedSearch);
    }
  }, [debouncedSearch, open]);

  const handleAddItem = (barang: Barang) => {
    if (items.some((i) => i.part_id === barang.id)) return;
    
    const newItem: MRItem = {
      part_id: barang.id,
      part_number: barang.part_number,
      part_name: barang.part_name,
      satuan: barang.part_satuan,
      qty: 1,
    };
    
    onItemsChange([...items, newItem]);
    setOpen(false);
    setSearch("");
  };

  const removeItem = (part_id: number) => {
    onItemsChange(items.filter((i) => i.part_id !== part_id));
  };

  const updateItem = (part_id: number, updates: Partial<MRItem>) => {
    onItemsChange(
      items.map((i) => (i.part_id === part_id ? { ...i, ...updates } : i))
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
           <Package className="h-4 w-4 text-slate-500" />
           <h3 className="font-semibold text-slate-900 text-sm">Daftar Barang</h3>
        </div>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-2 font-medium">
              <Plus className="h-3.5 w-3.5" /> Tambah Barang
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0 rounded-lg border-slate-200 shadow-xl overflow-hidden" align="end">
            <div className="p-2 border-b border-slate-100 bg-slate-50/50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Cari Barang..."
                  className="pl-8 h-8 bg-white border-slate-200 focus:ring-slate-900 rounded-md text-xs"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-[300px] overflow-y-auto p-1">
              {loading ? (
                <div className="p-8 text-center bg-slate-50/30">
                  <span className="text-[10px] font-medium text-slate-400">Searching...</span>
                </div>
              ) : results.length > 0 ? (
                results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleAddItem(r)}
                    disabled={items.some((i) => i.part_id === r.id)}
                    className="w-full text-left p-2 hover:bg-slate-50 transition-all rounded-md group disabled:opacity-50"
                  >
                    <div className="flex justify-between items-center gap-4">
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-slate-900 leading-none mb-0.5">
                          {r.part_name}
                        </span>
                        <code className="text-[10px] text-slate-400">{r.part_number}</code>
                      </div>
                      <Badge variant="outline" className="text-[10px] font-medium text-slate-400 h-4 px-1">
                        {r.part_satuan}
                      </Badge>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-8 text-center text-slate-400 text-xs italic">Barang tidak ditemukan.</div>
              )}
            </div>
            <div className="p-2 bg-slate-50/80 border-t border-slate-100 flex justify-center">
              <Link href="/request-barang-baru" className="text-[10px] font-medium text-blue-600 hover:underline">
                Request Item Baru
              </Link>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white border-slate-200">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow className="h-10 hover:bg-transparent">
              <TableHead className="w-[50px] text-center font-semibold text-slate-500 text-xs text-slate-500">No</TableHead>
              <TableHead className="font-semibold text-slate-500 text-xs">Part Name & Number</TableHead>
              <TableHead className="w-[100px] font-semibold text-slate-500 text-xs text-center">Unit</TableHead>
              <TableHead className="w-[120px] font-semibold text-slate-500 text-xs text-center">Quantity</TableHead>
              <TableHead className="w-[60px] text-center font-semibold text-slate-500 text-xs">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length > 0 ? (
              items.map((item, index) => (
                <TableRow key={item.part_id} className="h-12 hover:bg-slate-50/50 transition-colors">
                  <TableCell className="text-center text-slate-400 text-xs font-medium">
                    {index + 1}
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-900 text-xs">{item.part_name}</span>
                      <code className="text-[10px] text-slate-400">{item.part_number}</code>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-[10px] font-medium text-slate-500 uppercase">{item.satuan}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center">
                       <Input
                        type="number"
                        min="1"
                        value={item.qty}
                        onChange={(e) => updateItem(item.part_id, { qty: parseInt(e.target.value) || 0 })}
                        className="h-8 w-20 text-center font-medium text-xs rounded-md bg-white border-slate-200"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeItem(item.part_id)}
                      className="h-7 w-7 text-slate-300 hover:text-red-500 rounded-md"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className="h-32 hover:bg-transparent">
                <TableCell colSpan={5} className="text-center">
                  <span className="text-xs font-medium text-slate-400 italic">No items added yet.</span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
