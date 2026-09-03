"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  Handshake,
  UsersRound,
  MapPin,
  Calendar as CalendarIcon,
  Search,
  Plus,
  Trash2,
  Loader2,
  Package,
  ArrowRight,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import { createConsignmentSo } from "@/services/consignment-so-actions";

interface ConsignmentItem {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  part_number_customer: string;
  code_item_customer: string;
}

export default function CreateConsignmentSoPage() {
  const supabase = createClient();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);

  // Header form
  const [soNo, setSoNo] = useState("");
  const [soTanggalInput, setSoTanggalInput] = useState(toYmdLocal());
  const [tglPoEmailMarketing, setTglPoEmailMarketing] = useState("");
  const [tglPoCustomer, setTglPoCustomer] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [noPo, setNoPo] = useState("");
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [site, setSite] = useState("");
  const [items, setItems] = useState<ConsignmentItem[]>([]);

  // Customer picker
  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedCustomerSearch] = useDebounce(customerSearch, 300);
  const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false);

  // Item search
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [results, setResults] = useState<any[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // Search customer (server-side, dibatasi 20 hasil — tidak get-all)
  useEffect(() => {
    if (!customerPopoverOpen) return;
    const run = async () => {
      let q = supabase
        .from("customers")
        .select("id, customer_no, customer_name")
        .eq("is_active", true)
        .order("customer_name")
        .limit(20);
      if (debouncedCustomerSearch)
        q = q.or(
          `customer_name.ilike.%${debouncedCustomerSearch}%,customer_no.ilike.%${debouncedCustomerSearch}%`,
        );
      const { data } = await q;
      setCustomers(data || []);
    };
    run();
  }, [debouncedCustomerSearch, customerPopoverOpen]);

  // Search barang (PN GMI)
  useEffect(() => {
    if (!searchOpen) return;
    const run = async () => {
      let q = supabase.from("barang").select("*").order("part_name").limit(15);
      if (debouncedSearch)
        q = q.or(
          `part_number.ilike.%${debouncedSearch}%,part_name.ilike.%${debouncedSearch}%`,
        );
      const { data } = await q;
      setResults(data || []);
    };
    run();
  }, [debouncedSearch, searchOpen]);

  const addItem = (barang: any) => {
    if (items.some((i) => i.part_id === barang.id)) return;
    setItems((prev) => [
      ...prev,
      {
        part_id: barang.id,
        part_number: barang.part_number,
        part_name: barang.part_name,
        satuan: barang.part_satuan,
        qty: 1,
        part_number_customer: "",
        code_item_customer: "",
      },
    ]);
    setSearchOpen(false);
    setSearch("");
  };

  const updateItem = (partId: number, patch: Partial<ConsignmentItem>) => {
    setItems((prev) =>
      prev.map((i) => (i.part_id === partId ? { ...i, ...patch } : i)),
    );
  };

  const removeItem = (partId: number) =>
    setItems((prev) => prev.filter((i) => i.part_id !== partId));

  const validate = () => {
    if (!soNo.trim()) return "No. SO wajib diisi.";
    if (!customerId) return "Pilih customer.";
    if (items.length === 0) return "Tambahkan minimal satu item.";
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) return toast.error(err);
    setLoading(true);
    try {
      const result = await createConsignmentSo({
        so_no: soNo.trim(),
        so_tanggal_input: soTanggalInput,
        tgl_po_email_marketing: tglPoEmailMarketing || undefined,
        tgl_po_customer: tglPoCustomer || undefined,
        due_date: dueDate || undefined,
        no_po: noPo || undefined,
        customer_id: customerId!,
        site: site || undefined,
        items: items.map((i) => ({
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          satuan: i.satuan,
          qty: i.qty,
          part_number_customer: i.part_number_customer || undefined,
          code_item_customer: i.code_item_customer || undefined,
        })),
      });

      if (result.error) throw new Error(result.error);
      toast.success("SO Consignment berhasil dibuat");
      router.push("/so-reguler/consignment/so");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => router.back()}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <Handshake className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
              Buat SO Consignment
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Pencatatan Sales Order Consignment
            </p>
          </div>
        </div>
      </Content>

      {/* Header form */}
      <Content>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">No. SO</Label>
            <Input
              placeholder="Input No. SO..."
              value={soNo}
              onChange={(e) => setSoNo(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Tgl Input SO
            </Label>
            <DatePickerString value={soTanggalInput} onChange={setSoTanggalInput} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Tgl Email PO Marketing
            </Label>
            <DatePickerString value={tglPoEmailMarketing} onChange={setTglPoEmailMarketing} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Tgl PO Customer
            </Label>
            <DatePickerString value={tglPoCustomer} onChange={setTglPoCustomer} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Due Date
            </Label>
            <DatePickerString value={dueDate} onChange={setDueDate} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> No. PO
            </Label>
            <Input
              placeholder="Input No. PO Customer..."
              value={noPo}
              onChange={(e) => setNoPo(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <UsersRound className="h-3 w-3 text-success" /> Customer
            </Label>
            <Popover open={customerPopoverOpen} onOpenChange={setCustomerPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 w-full justify-start font-bold text-sm">
                  {customerName || "Pilih customer..."}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 overflow-hidden" align="start">
                <div className="p-2 border-b bg-muted/40">
                  <Input
                    placeholder="Cari customer..."
                    className="h-9 text-xs"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-62.5 overflow-y-auto p-1.5">
                  {customers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setCustomerId(c.id);
                        setCustomerName(c.customer_name);
                        setCustomerPopoverOpen(false);
                        setCustomerSearch("");
                      }}
                      className="w-full text-left p-3 rounded-lg flex items-center justify-between group mb-1 hover:bg-muted"
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-xs uppercase">{c.customer_name}</span>
                        <span className="text-[9px] opacity-60">{c.customer_no}</span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                  {customers.length === 0 && (
                    <div className="p-6 text-center text-xs text-muted-foreground italic">
                      {debouncedCustomerSearch
                        ? "Customer tidak ditemukan."
                        : "Ketik untuk mencari customer..."}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <MapPin className="h-3 w-3" /> Site
            </Label>
            <Input
              placeholder="Lokasi project customer (opsional)..."
              value={site}
              onChange={(e) => setSite(e.target.value)}
              className="h-10 text-sm font-semibold uppercase"
            />
          </div>
        </div>
      </Content>

      {/* Items */}
      <Content>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Daftar Item</h3>
          </div>
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <Plus className="h-3.5 w-3.5" /> Tambah Item
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[calc(100vw-2rem)] max-w-100 p-0" align="end">
              <div className="p-2 border-b bg-muted/40">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Cari PN GMI (barang)..."
                    className="pl-8 h-8 text-xs"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-75 overflow-y-auto p-1">
                {results.length > 0 ? (
                  results.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => addItem(r)}
                      disabled={items.some((i) => i.part_id === r.id)}
                      className="w-full text-left p-2 hover:bg-muted rounded-md disabled:opacity-50"
                    >
                      <code className="text-xs font-bold">{r.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground truncate">
                        {r.part_name}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="p-6 text-center text-xs text-muted-foreground italic">
                    Barang tidak ditemukan.
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10 hover:bg-transparent">
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">PN GMI / Desc</TableHead>
                <TableHead className="w-16 text-center text-[10px] font-black uppercase text-muted-foreground">Unit</TableHead>
                <TableHead className="w-40 text-[10px] font-black uppercase text-muted-foreground">PN Cust</TableHead>
                <TableHead className="w-40 text-[10px] font-black uppercase text-muted-foreground">Code Item Cust</TableHead>
                <TableHead className="w-28 text-center text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                <TableHead className="w-14"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length > 0 ? (
                items.map((item) => (
                  <TableRow key={item.part_id} className="h-14">
                    <TableCell>
                      <span className="font-semibold text-xs">{item.part_name}</span>
                      <code className="block text-[10px] text-muted-foreground">{item.part_number}</code>
                    </TableCell>
                    <TableCell className="text-center text-[10px] font-medium text-muted-foreground uppercase">
                      {item.satuan}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={item.part_number_customer}
                        onChange={(e) =>
                          updateItem(item.part_id, { part_number_customer: e.target.value })
                        }
                        placeholder="Opsional"
                        className="h-8 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={item.code_item_customer}
                        onChange={(e) =>
                          updateItem(item.part_id, { code_item_customer: e.target.value })
                        }
                        placeholder="Opsional"
                        className="h-8 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        value={item.qty}
                        onChange={(e) =>
                          updateItem(item.part_id, {
                            qty: Math.max(1, parseInt(e.target.value) || 1),
                          })
                        }
                        className="h-8 w-20 mx-auto text-center text-xs"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeItem(item.part_id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="h-24 hover:bg-transparent">
                  <TableCell colSpan={6} className="text-center text-xs italic text-muted-foreground">
                    Belum ada item.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Content>

      {/* Submit */}
      <Content>
        <div className="flex flex-col lg:flex-row justify-between gap-6 lg:items-center">
          <p className="text-[11px] text-muted-foreground font-medium max-w-125">
            SO Consignment murni pencatatan data (tanpa pergerakan stok & tanpa
            approval). Progress supply, pengiriman, dan rekonsiliasi akan
            ditangani di Dashboard Consignment.
          </p>
          <Button
            className="h-10 lg:w-70 font-bold text-sm uppercase"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buat SO Consignment"}
          </Button>
        </div>
      </Content>
    </>
  );
}
