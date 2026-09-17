"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { createJobCosting } from "@/services/finance-actions";
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
import {
  Search,
  Trash2,
  ArrowLeft,
  Loader2,
  PlusSquare,
  Building2,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";

const rupiahFormatter = new Intl.NumberFormat("id-ID");

function formatRupiahInput(value: number) {
  if (!value || value <= 0) return "";
  return `Rp ${rupiahFormatter.format(value)}`;
}

function parseRupiahInput(value: string) {
  const digits = value.replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

type LocationType = "cabang" | "customer";

interface LineItem {
  id: string;
  part_id: number;
  part_number: string;
  part_name: string;
  source_type: LocationType;
  source_cabang_id?: number;
  source_customer_id?: number;
  source_name: string;
  unit: string;
  stock_qty: number;
  qty: number;
  unit_price: number;
}

interface FinishPartLineItem {
  id: string;
  part_id: number;
  part_number: string;
  part_name: string;
  location_type: LocationType;
  cabang_id?: number;
  customer_id?: number;
  location_name: string;
  qty: number;
}

interface BarangOption {
  id: number;
  part_number: string;
  part_name: string;
  part_satuan: string;
  stock_qty: number;
}

interface CustomerOption {
  id: number;
  customer_no: string;
  customer_name: string;
}

export default function JobCostingCreatePage() {
  const router = useRouter();
  const storeProfile = useAuthStore((s) => s.profile);
  const supabase = createClient();

  const [cabangs, setCabangs] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [jobKode, setJobKode] = useState("");
  const [cabangId, setCabangId] = useState("");
  const [jobTanggal, setJobTanggal] = useState(toYmdLocal());
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
  const [finishPartCabangId, setFinishPartCabangId] = useState("");
  const [selectedSourceCabangId, setSelectedSourceCabangId] = useState("");
  const [status, setStatus] = useState("open");
  const [notes, setNotes] = useState("");

  // Lokasi asal barang (bahan): gudang (cabang) atau customer (stok
  // konsinyasi di lokasi customer, so JobCosting bisa dikerjakan "di gudang
  // customer" -- lihat customer_stock).
  const [sourceLocationType, setSourceLocationType] =
    useState<LocationType>("cabang");
  const [selectedSourceCustomerId, setSelectedSourceCustomerId] =
    useState("");
  const [sourceCustomerOpen, setSourceCustomerOpen] = useState(false);
  const [sourceCustomerSearch, setSourceCustomerSearch] = useState("");
  const [debouncedSourceCustomerSearch] = useDebounce(
    sourceCustomerSearch,
    300,
  );
  const [sourceCustomerOptions, setSourceCustomerOptions] = useState<
    CustomerOption[]
  >([]);

  // Lokasi tujuan finish part: gudang (cabang) atau customer.
  const [finishLocationType, setFinishLocationType] =
    useState<LocationType>("cabang");
  const [finishPartCustomerId, setFinishPartCustomerId] = useState("");
  const [finishCustomerOpen, setFinishCustomerOpen] = useState(false);
  const [finishCustomerSearch, setFinishCustomerSearch] = useState("");
  const [debouncedFinishCustomerSearch] = useDebounce(
    finishCustomerSearch,
    300,
  );
  const [finishCustomerOptions, setFinishCustomerOptions] = useState<
    CustomerOption[]
  >([]);

  const [items, setItems] = useState<LineItem[]>([]);
  const [finishParts, setFinishParts] = useState<FinishPartLineItem[]>([]);

  const [barangOpen, setBarangOpen] = useState(false);
  const [barangSearch, setBarangSearch] = useState("");
  const [debouncedBarangSearch] = useDebounce(barangSearch, 300);
  const [barangLoading, setBarangLoading] = useState(false);
  const [barangOptions, setBarangOptions] = useState<BarangOption[]>([]);
  const [selectedBarangId, setSelectedBarangId] = useState<number | null>(null);

  useEffect(() => {
    if (storeProfile?.cabang_id) {
      setCabangId(String(storeProfile.cabang_id));
      setSelectedSourceCabangId(String(storeProfile.cabang_id));
      setFinishPartCabangId(String(storeProfile.cabang_id));
    }

    supabase
      .from("cabang")
      .select("id, nama_cabang, kode_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then((result: { data: any[] | null }) => setCabangs(result.data || []));
  }, [storeProfile?.cabang_id, supabase]);

  useEffect(() => {
    if (!cabangId) return;
    if (!selectedSourceCabangId) {
      setSelectedSourceCabangId(cabangId);
    }
    if (!finishPartCabangId) {
      setFinishPartCabangId(cabangId);
    }
  }, [cabangId, selectedSourceCabangId, finishPartCabangId]);

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

      if (sourceLocationType === "cabang" && selectedSourceCabangId) {
        const { data: stockRows } = await supabase
          .from("stock")
          .select("part_id, qty")
          .eq("cabang_id", parseInt(selectedSourceCabangId, 10))
          .in("part_id", ids);

        stockMap = new Map(
          (stockRows || []).map((s: any) => [
            Number(s.part_id),
            Number(s.qty) || 0,
          ]),
        );
      } else if (sourceLocationType === "customer" && selectedSourceCustomerId) {
        const { data: stockRows } = await supabase
          .from("customer_stock")
          .select("part_id, qty")
          .eq("customer_id", parseInt(selectedSourceCustomerId, 10))
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
  }, [
    barangOpen,
    debouncedBarangSearch,
    sourceLocationType,
    selectedSourceCabangId,
    selectedSourceCustomerId,
    supabase,
  ]);

  // Cari customer (lokasi asal bahan) -- dibatasi customer bertipe
  // consignment/both, karena customer_stock cuma realistis terisi untuk
  // customer konsinyasi.
  useEffect(() => {
    if (!sourceCustomerOpen) return;
    const run = async () => {
      let q = supabase
        .from("customers")
        .select("id, customer_no, customer_name")
        .eq("is_active", true)
        .in("customer_type", ["consignment", "both"])
        .order("customer_name")
        .limit(20);
      if (debouncedSourceCustomerSearch)
        q = q.or(
          `customer_name.ilike.%${debouncedSourceCustomerSearch}%,customer_no.ilike.%${debouncedSourceCustomerSearch}%`,
        );
      const { data } = await q;
      setSourceCustomerOptions(data || []);
    };
    run();
  }, [debouncedSourceCustomerSearch, sourceCustomerOpen, supabase]);

  // Cari customer (lokasi tujuan finish part).
  useEffect(() => {
    if (!finishCustomerOpen) return;
    const run = async () => {
      let q = supabase
        .from("customers")
        .select("id, customer_no, customer_name")
        .eq("is_active", true)
        .in("customer_type", ["consignment", "both"])
        .order("customer_name")
        .limit(20);
      if (debouncedFinishCustomerSearch)
        q = q.or(
          `customer_name.ilike.%${debouncedFinishCustomerSearch}%,customer_no.ilike.%${debouncedFinishCustomerSearch}%`,
        );
      const { data } = await q;
      setFinishCustomerOptions(data || []);
    };
    run();
  }, [debouncedFinishCustomerSearch, finishCustomerOpen, supabase]);

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

  function addBarangToItems() {
    if (sourceLocationType === "cabang" && !selectedSourceCabangId) {
      toast.error("Pilih gudang asal barang terlebih dahulu.");
      return;
    }
    if (sourceLocationType === "customer" && !selectedSourceCustomerId) {
      toast.error("Pilih customer asal barang terlebih dahulu.");
      return;
    }

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
      const sourceCabangId =
        sourceLocationType === "cabang"
          ? parseInt(selectedSourceCabangId, 10)
          : undefined;
      const sourceCustomerId =
        sourceLocationType === "customer"
          ? parseInt(selectedSourceCustomerId, 10)
          : undefined;
      const idx = prev.findIndex(
        (i) =>
          i.part_id === selected.id &&
          i.source_type === sourceLocationType &&
          i.source_cabang_id === sourceCabangId &&
          i.source_customer_id === sourceCustomerId,
      );
      if (idx >= 0) {
        const cloned = [...prev];
        cloned[idx] = { ...cloned[idx], qty: cloned[idx].qty + 1 };
        return cloned;
      }

      const sourceName =
        sourceLocationType === "cabang"
          ? cabangs.find((c) => String(c.id) === selectedSourceCabangId)
              ?.nama_cabang || "-"
          : sourceCustomerOptions.find(
              (c) => String(c.id) === selectedSourceCustomerId,
            )?.customer_name || "-";

      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          part_id: selected.id,
          part_number: selected.part_number,
          part_name: selected.part_name,
          source_type: sourceLocationType,
          source_cabang_id: sourceCabangId,
          source_customer_id: sourceCustomerId,
          source_name: sourceName,
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

  function addFinishPartToList() {
    if (finishLocationType === "cabang" && !finishPartCabangId) {
      toast.error("Pilih gudang tujuan finish part terlebih dahulu.");
      return;
    }
    if (finishLocationType === "customer" && !finishPartCustomerId) {
      toast.error("Pilih customer tujuan finish part terlebih dahulu.");
      return;
    }

    if (!selectedFinishPartId) {
      toast.error("Pilih finish part terlebih dahulu.");
      return;
    }

    const selected = finishPartOptions.find(
      (b) => b.id === selectedFinishPartId,
    );
    if (!selected) {
      toast.error("Finish part tidak ditemukan.");
      return;
    }

    setFinishParts((prev) => {
      const cabangId =
        finishLocationType === "cabang"
          ? parseInt(finishPartCabangId, 10)
          : undefined;
      const customerId =
        finishLocationType === "customer"
          ? parseInt(finishPartCustomerId, 10)
          : undefined;
      const idx = prev.findIndex(
        (fp) =>
          fp.part_id === selected.id &&
          fp.location_type === finishLocationType &&
          fp.cabang_id === cabangId &&
          fp.customer_id === customerId,
      );
      if (idx >= 0) {
        const cloned = [...prev];
        cloned[idx] = { ...cloned[idx], qty: cloned[idx].qty + 1 };
        return cloned;
      }

      const locationName =
        finishLocationType === "cabang"
          ? cabangs.find((c) => String(c.id) === finishPartCabangId)
              ?.nama_cabang || "-"
          : finishCustomerOptions.find(
              (c) => String(c.id) === finishPartCustomerId,
            )?.customer_name || "-";

      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          part_id: selected.id,
          part_number: selected.part_number,
          part_name: selected.part_name,
          location_type: finishLocationType,
          cabang_id: cabangId,
          customer_id: customerId,
          location_name: locationName,
          qty: 1,
        },
      ];
    });

    setSelectedFinishPartId(null);
    setFinishPartSearch("");
    setFinishPartOpen(false);
  }

  function removeFinishPart(id: string) {
    setFinishParts((prev) => prev.filter((fp) => fp.id !== id));
  }

  function updateFinishPartQty(id: string, qty: number) {
    setFinishParts((prev) =>
      prev.map((fp) => (fp.id === id ? { ...fp, qty: qty < 0 ? 0 : qty } : fp)),
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
    if (finishParts.length === 0) {
      toast.error("Tambahkan minimal satu finish part.");
      return;
    }
    if (!jobKode.trim()) {
      toast.error("Kode Job wajib diisi manual.");
      return;
    }

    if (items.length === 0) {
      toast.error("Tambahkan minimal satu item biaya.");
      return;
    }

    const finishPartsSummary = finishParts
      .map((fp) => `${fp.part_number} - ${fp.part_name} (${fp.qty})`)
      .join(", ");

    setSubmitting(true);
    const result = await createJobCosting({
      job_kode: jobKode.trim(),
      cabang_id: parseInt(cabangId, 10),
      description: finishPartsSummary,
      job_tanggal: jobTanggal,
      status: status as "open" | "approved" | "completed" | "rejected",
      notes: notes.trim(),
      finish_parts: finishParts.map((fp) => ({
        part_id: fp.part_id,
        part_number: fp.part_number,
        part_name: fp.part_name,
        qty: fp.qty,
        cabang_id: fp.location_type === "cabang" ? fp.cabang_id : undefined,
        customer_id:
          fp.location_type === "customer" ? fp.customer_id : undefined,
      })),
      items: items.map((i) => ({
        part_id: i.part_id,
        part_number: i.part_number,
        part_name: i.part_name,
        description: i.part_name,
        qty: i.qty,
        unit: i.unit,
        unit_price: i.unit_price,
        source_cabang_id:
          i.source_type === "cabang" ? i.source_cabang_id : undefined,
        source_customer_id:
          i.source_type === "customer" ? i.source_customer_id : undefined,
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

            <div className="mb-2 flex items-center gap-1.5">
              <Button
                type="button"
                variant={sourceLocationType === "cabang" ? "default" : "outline"}
                size="sm"
                className="h-9 flex-1 gap-1.5"
                onClick={() => setSourceLocationType("cabang")}
              >
                <Building2 className="h-3.5 w-3.5" /> Gudang
              </Button>
              <Button
                type="button"
                variant={sourceLocationType === "customer" ? "default" : "outline"}
                size="sm"
                className="h-9 flex-1 gap-1.5"
                onClick={() => setSourceLocationType("customer")}
              >
                <UsersRound className="h-3.5 w-3.5" /> Customer
              </Button>
            </div>

            <div className="mb-2">
              {sourceLocationType === "cabang" ? (
                <Select
                  value={selectedSourceCabangId}
                  onValueChange={setSelectedSourceCabangId}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Pilih cabang asal barang" />
                  </SelectTrigger>
                  <SelectContent>
                    {cabangs.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nama_cabang}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Popover
                  open={sourceCustomerOpen}
                  onOpenChange={setSourceCustomerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-9 w-full justify-start font-medium"
                    >
                      {selectedSourceCustomerId
                        ? sourceCustomerOptions.find(
                            (c) => String(c.id) === selectedSourceCustomerId,
                          )?.customer_name || "Pilih customer asal..."
                        : "Pilih customer asal..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Cari customer..."
                        value={sourceCustomerSearch}
                        onValueChange={setSourceCustomerSearch}
                      />
                      <CommandList>
                        {sourceCustomerOptions.length === 0 ? (
                          <CommandEmpty>
                            {debouncedSourceCustomerSearch
                              ? "Customer tidak ditemukan."
                              : "Ketik untuk mencari customer..."}
                          </CommandEmpty>
                        ) : (
                          sourceCustomerOptions.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${c.customer_no} ${c.customer_name}`}
                              onSelect={() => {
                                setSelectedSourceCustomerId(String(c.id));
                                setSourceCustomerOpen(false);
                              }}
                              className="py-2.5"
                            >
                              <div>
                                <p className="text-xs font-semibold uppercase">
                                  {c.customer_name}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {c.customer_no}
                                </p>
                              </div>
                            </CommandItem>
                          ))
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>

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

            <div className="mb-2 flex items-center gap-1.5">
              <Button
                type="button"
                variant={finishLocationType === "cabang" ? "default" : "outline"}
                size="sm"
                className="h-9 flex-1 gap-1.5"
                onClick={() => setFinishLocationType("cabang")}
              >
                <Building2 className="h-3.5 w-3.5" /> Gudang
              </Button>
              <Button
                type="button"
                variant={finishLocationType === "customer" ? "default" : "outline"}
                size="sm"
                className="h-9 flex-1 gap-1.5"
                onClick={() => setFinishLocationType("customer")}
              >
                <UsersRound className="h-3.5 w-3.5" /> Customer
              </Button>
            </div>

            <div className="mb-2">
              {finishLocationType === "cabang" ? (
                <Select
                  value={finishPartCabangId}
                  onValueChange={setFinishPartCabangId}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Cabang tujuan finish part" />
                  </SelectTrigger>
                  <SelectContent>
                    {cabangs.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nama_cabang}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Popover
                  open={finishCustomerOpen}
                  onOpenChange={setFinishCustomerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-9 w-full justify-start font-medium"
                    >
                      {finishPartCustomerId
                        ? finishCustomerOptions.find(
                            (c) => String(c.id) === finishPartCustomerId,
                          )?.customer_name || "Pilih customer tujuan..."
                        : "Pilih customer tujuan..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Cari customer..."
                        value={finishCustomerSearch}
                        onValueChange={setFinishCustomerSearch}
                      />
                      <CommandList>
                        {finishCustomerOptions.length === 0 ? (
                          <CommandEmpty>
                            {debouncedFinishCustomerSearch
                              ? "Customer tidak ditemukan."
                              : "Ketik untuk mencari customer..."}
                          </CommandEmpty>
                        ) : (
                          finishCustomerOptions.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${c.customer_no} ${c.customer_name}`}
                              onSelect={() => {
                                setFinishPartCustomerId(String(c.id));
                                setFinishCustomerOpen(false);
                              }}
                              className="py-2.5"
                            >
                              <div>
                                <p className="text-xs font-semibold uppercase">
                                  {c.customer_name}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {c.customer_no}
                                </p>
                              </div>
                            </CommandItem>
                          ))
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <Popover open={finishPartOpen} onOpenChange={setFinishPartOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 w-full justify-between font-medium"
                >
                  {selectedFinishPartId
                    ? (() => {
                        const picked = finishPartOptions.find(
                          (b) => b.id === selectedFinishPartId,
                        );
                        return picked
                          ? `${picked.part_number} - ${picked.part_name}`
                          : "Pilih finish part";
                      })()
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
                          onSelect={() => setSelectedFinishPartId(b.id)}
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
                <SelectItem value="completed">Completed</SelectItem>
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
                <TableHead className="w-40">Lokasi Asal</TableHead>
                <TableHead className="w-28">Stock</TableHead>
                <TableHead className="w-16 text-center">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
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
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        {item.source_type === "customer" ? (
                          <UsersRound className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <Building2 className="h-3 w-3 text-muted-foreground" />
                        )}
                        {item.source_name}
                      </span>
                    </TableCell>
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

        <Button
          type="button"
          className="w-full h-10 gap-2 font-semibold"
          onClick={addFinishPartToList}
        >
          <PlusSquare className="h-4 w-4" /> Tambah Finish Part
        </Button>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">No</TableHead>
                <TableHead>Part</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead className="w-28">Qty</TableHead>
                <TableHead>Lokasi Tujuan</TableHead>
                <TableHead className="w-16 text-center">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {finishParts.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Belum ada finish part ditambahkan.
                  </TableCell>
                </TableRow>
              ) : (
                finishParts.map((fp, idx) => (
                  <TableRow key={fp.id}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {fp.part_number}
                    </TableCell>
                    <TableCell>{fp.part_name}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={fp.qty}
                        onChange={(e) =>
                          updateFinishPartQty(
                            fp.id,
                            parseInt(e.target.value || "0", 10),
                          )
                        }
                        className="h-9"
                      />
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        {fp.location_type === "customer" ? (
                          <UsersRound className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <Building2 className="h-3 w-3 text-muted-foreground" />
                        )}
                        {fp.location_name}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeFinishPart(fp.id)}
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
