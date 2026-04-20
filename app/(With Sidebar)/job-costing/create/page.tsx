"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { createJobCosting, generateJobKode } from "@/services/finance-actions";
import { useAuthStore } from "@/stores/auth-store";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { Search, Trash2, ArrowLeft, Loader2, PlusSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";

const rupiahFormatter = new Intl.NumberFormat("id-ID");

function formatRupiahInput(value: number) {
  if (!value || value <= 0) return "";
  return `Rp ${rupiahFormatter.format(value)}`;
}

function parseRupiahInput(value: string) {
  const digits = value.replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

interface LineItem {
  id: string;
  part_id: number;
  part_number: string;
  part_name: string;
  unit: string;
  stock_qty: number;
  qty: number;
  unit_price: number;
}

interface BarangOption {
  id: number;
  part_number: string;
  part_name: string;
  part_satuan: string;
  stock_qty: number;
}

export default function JobCostingCreatePage() {
  const router = useRouter();
  const storeProfile = useAuthStore((s) => s.profile);
  const supabase = createClient();

  const [cabangs, setCabangs] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [jobKode, setJobKode] = useState("");
  const [kodeLoading, setKodeLoading] = useState(false);
  const [cabangId, setCabangId] = useState("");
  const [jobTanggal, setJobTanggal] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [finishPartOpen, setFinishPartOpen] = useState(false);
  const [finishPartSearch, setFinishPartSearch] = useState("");
  const [debouncedFinishPartSearch] = useDebounce(finishPartSearch, 300);
  const [finishPartLoading, setFinishPartLoading] = useState(false);
  const [finishPartOptions, setFinishPartOptions] = useState<BarangOption[]>(
    [],
  );
  const [selectedFinishPartId, setSelectedFinishPartId] = useState<
    number | null
  >(null);
  const [selectedFinishPartLabel, setSelectedFinishPartLabel] = useState("");
  const [status, setStatus] = useState("open");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState<LineItem[]>([]);

  const [barangOpen, setBarangOpen] = useState(false);
  const [barangSearch, setBarangSearch] = useState("");
  const [debouncedBarangSearch] = useDebounce(barangSearch, 300);
  const [barangLoading, setBarangLoading] = useState(false);
  const [barangOptions, setBarangOptions] = useState<BarangOption[]>([]);
  const [selectedBarangId, setSelectedBarangId] = useState<number | null>(null);

  useEffect(() => {
    if (storeProfile?.cabang_id) {
      setCabangId(String(storeProfile.cabang_id));
    }

    supabase
      .from("cabang")
      .select("id, nama_cabang, kode_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then((result: { data: any[] | null }) => setCabangs(result.data || []));
  }, [storeProfile?.cabang_id, supabase]);

  useEffect(() => {
    if (!barangOpen) return;

    const fetchBarang = async () => {
      setBarangLoading(true);

      let query = supabase
        .from("barang")
        .select("id, part_number, part_name, part_satuan")
        .order("part_number")
        .limit(15);

      if (debouncedBarangSearch) {
        query = query.or(
          `part_number.ilike.%${debouncedBarangSearch}%,part_name.ilike.%${debouncedBarangSearch}%`,
        );
      }

      const { data: barangData } = await query;
      const rows = (barangData || []) as Omit<BarangOption, "stock_qty">[];

      if (rows.length === 0) {
        setBarangOptions([]);
        setBarangLoading(false);
        return;
      }

      const ids = rows.map((b) => b.id);
      let stockMap = new Map<number, number>();

      if (cabangId) {
        const { data: stockRows } = await supabase
          .from("stock")
          .select("part_id, qty")
          .eq("cabang_id", parseInt(cabangId, 10))
          .in("part_id", ids);

        stockMap = new Map(
          (stockRows || []).map((s: any) => [
            Number(s.part_id),
            Number(s.qty) || 0,
          ]),
        );
      }

      const mapped = rows.map((r) => ({
        ...r,
        stock_qty: stockMap.get(r.id) || 0,
      }));

      setBarangOptions(mapped);
      setBarangLoading(false);
    };

    fetchBarang();
  }, [barangOpen, debouncedBarangSearch, cabangId, supabase]);

  useEffect(() => {
    if (!finishPartOpen) return;

    const fetchFinishPartOptions = async () => {
      setFinishPartLoading(true);

      let query = supabase
        .from("barang")
        .select("id, part_number, part_name, part_satuan")
        .order("part_number")
        .limit(15);

      if (debouncedFinishPartSearch) {
        query = query.or(
          `part_number.ilike.%${debouncedFinishPartSearch}%,part_name.ilike.%${debouncedFinishPartSearch}%`,
        );
      }

      const { data: finishData } = await query;
      const rows = (finishData || []) as Omit<BarangOption, "stock_qty">[];

      const mapped = rows.map((r) => ({
        ...r,
        stock_qty: 0,
      }));

      setFinishPartOptions(mapped);
      setFinishPartLoading(false);
    };

    fetchFinishPartOptions();
  }, [finishPartOpen, debouncedFinishPartSearch, supabase]);

  useEffect(() => {
    if (!cabangId) return;
    const cabang = cabangs.find((c) => String(c.id) === cabangId);
    if (!cabang?.kode_cabang) return;

    setKodeLoading(true);
    generateJobKode(cabang.kode_cabang).then((kode) => {
      setJobKode(kode);
      setKodeLoading(false);
    });
  }, [cabangId, cabangs]);

  function addBarangToItems() {
    if (!selectedBarangId) {
      toast.error("Pilih barang terlebih dahulu.");
      return;
    }

    const selected = barangOptions.find((b) => b.id === selectedBarangId);
    if (!selected) {
      toast.error("Barang tidak ditemukan.");
      return;
    }

    setItems((prev) => {
      const idx = prev.findIndex((i) => i.part_id === selected.id);
      if (idx >= 0) {
        const cloned = [...prev];
        cloned[idx] = { ...cloned[idx], qty: cloned[idx].qty + 1 };
        return cloned;
      }

      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          part_id: selected.id,
          part_number: selected.part_number,
          part_name: selected.part_name,
          unit: selected.part_satuan || "pcs",
          stock_qty: selected.stock_qty,
          qty: 1,
          unit_price: 0,
        },
      ];
    });

    setSelectedBarangId(null);
    setBarangSearch("");
    setBarangOpen(false);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function updateQty(id: string, qty: number) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, qty: qty < 0 ? 0 : qty } : i)),
    );
  }

  function updateUnitPrice(id: string, unitPrice: number) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, unit_price: unitPrice < 0 ? 0 : unitPrice } : i,
      ),
    );
  }

  async function handleSubmit() {
    if (!cabangId) {
      toast.error("Pilih cabang terlebih dahulu.");
      return;
    }
    if (!jobTanggal) {
      toast.error("Tanggal wajib diisi.");
      return;
    }
    if (!selectedFinishPartId || !selectedFinishPartLabel) {
      toast.error("Finish part wajib diisi.");
      return;
    }
    if (!jobKode.trim()) {
      toast.error("Kode Job belum ter-generate. Pilih cabang.");
      return;
    }

    if (items.length === 0) {
      toast.error("Tambahkan minimal satu item biaya.");
      return;
    }

    setSubmitting(true);
    const result = await createJobCosting({
      job_kode: jobKode.trim(),
      cabang_id: parseInt(cabangId, 10),
      description: selectedFinishPartLabel,
      finish_part: selectedFinishPartLabel,
      job_tanggal: jobTanggal,
      status: status as "open" | "approved" | "closed" | "rejected",
      notes: notes.trim(),
      items: items.map((i) => ({
        part_id: i.part_id,
        part_number: i.part_number,
        part_name: i.part_name,
        description: i.part_name,
        qty: i.qty,
        unit: i.unit,
        unit_price: i.unit_price,
      })),
    });
    setSubmitting(false);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Job Costing berhasil dibuat!");
      router.push("/job-costing");
    }
  }

  return (
    <Content title="Tambah Job Costing" description="Input data Job Costing">
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              No Job Costing <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Input
                value={jobKode}
                onChange={(e) => setJobKode(e.target.value)}
                placeholder="Masukkan no job costing"
                className="h-10"
              />
              {kodeLoading && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Tanggal <span className="text-destructive">*</span>
            </Label>
            <DatePickerString
              value={jobTanggal}
              onChange={setJobTanggal}
              className="h-10"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Barang <span className="text-destructive">*</span>
            </Label>
            <Popover open={barangOpen} onOpenChange={setBarangOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 w-full justify-between font-medium"
                >
                  {selectedBarangId
                    ? (() => {
                        const picked = barangOptions.find(
                          (b) => b.id === selectedBarangId,
                        );
                        return picked
                          ? `${picked.part_number} - ${picked.part_name}`
                          : "Pilih barang";
                      })()
                    : "Pilih barang"}
                  <Search className="h-4 w-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-105 p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder="Cari by part number..."
                    value={barangSearch}
                    onValueChange={setBarangSearch}
                  />
                  <CommandList>
                    {barangLoading ? (
                      <div className="py-6 flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : barangOptions.length === 0 ? (
                      <CommandEmpty>Tidak ada barang ditemukan.</CommandEmpty>
                    ) : (
                      barangOptions.map((b) => (
                        <CommandItem
                          key={b.id}
                          value={`${b.part_number} ${b.part_name}`}
                          onSelect={() => setSelectedBarangId(b.id)}
                          className="py-3"
                        >
                          <div className="flex w-full items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold">
                                {b.part_number}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {b.part_name}
                              </p>
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              Stock: {b.stock_qty}
                            </span>
                          </div>
                        </CommandItem>
                      ))
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Finish Part <span className="text-destructive">*</span>
            </Label>
            <Popover open={finishPartOpen} onOpenChange={setFinishPartOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 w-full justify-between font-medium"
                >
                  {selectedFinishPartId
                    ? selectedFinishPartLabel
                    : "Pilih finish part"}
                  <Search className="h-4 w-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-105 p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder="Cari finish part by part number..."
                    value={finishPartSearch}
                    onValueChange={setFinishPartSearch}
                  />
                  <CommandList>
                    {finishPartLoading ? (
                      <div className="py-6 flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : finishPartOptions.length === 0 ? (
                      <CommandEmpty>Tidak ada barang ditemukan.</CommandEmpty>
                    ) : (
                      finishPartOptions.map((b) => (
                        <CommandItem
                          key={b.id}
                          value={`${b.part_number} ${b.part_name}`}
                          onSelect={() => {
                            setSelectedFinishPartId(b.id);
                            setSelectedFinishPartLabel(
                              `${b.part_number} - ${b.part_name}`,
                            );
                            setFinishPartOpen(false);
                          }}
                          className="py-3"
                        >
                          <div>
                            <p className="text-xs font-semibold">
                              {b.part_number}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {b.part_name}
                            </p>
                          </div>
                        </CommandItem>
                      ))
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Cabang</Label>
            <Select value={cabangId} onValueChange={setCabangId}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Pilih cabang" />
              </SelectTrigger>
              <SelectContent>
                {cabangs.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Status <span className="text-destructive">*</span>
            </Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-xs font-semibold">Keterangan</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Masukkan keterangan"
              className="min-h-20"
            />
          </div>
        </div>

        <Button
          type="button"
          className="w-full h-10 gap-2 font-semibold"
          onClick={addBarangToItems}
        >
          <PlusSquare className="h-4 w-4" /> Tambah Barang
        </Button>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">No</TableHead>
                <TableHead>Part</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead className="w-28">Qty</TableHead>
                <TableHead className="w-36">Harga</TableHead>
                <TableHead className="w-24">Unit</TableHead>
                <TableHead className="w-28">Stock</TableHead>
                <TableHead className="w-16 text-center">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Belum ada barang ditambahkan.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item, idx) => (
                  <TableRow key={item.id}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.part_number}
                    </TableCell>
                    <TableCell>{item.part_name}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={item.qty}
                        onChange={(e) =>
                          updateQty(
                            item.id,
                            parseInt(e.target.value || "0", 10),
                          )
                        }
                        className="h-9"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={formatRupiahInput(item.unit_price)}
                        onChange={(e) =>
                          updateUnitPrice(
                            item.id,
                            parseRupiahInput(e.target.value),
                          )
                        }
                        placeholder="Rp 0"
                        className="h-9"
                      />
                    </TableCell>
                    <TableCell>{item.unit}</TableCell>
                    <TableCell>{item.stock_qty}</TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeItem(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Link href="/job-costing">
            <Button variant="outline" className="h-10 gap-2">
              <ArrowLeft className="h-4 w-4" /> Kembali
            </Button>
          </Link>

          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="h-10 min-w-52 gap-2 font-semibold"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlusSquare className="h-4 w-4" />
            )}
            {submitting ? "Menyimpan..." : "Tambah Job Costing"}
          </Button>
        </div>
      </div>
    </Content>
  );
}
