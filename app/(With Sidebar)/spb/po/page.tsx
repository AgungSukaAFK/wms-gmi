"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Plus,
  Search,
  ShoppingCart,
} from "lucide-react";
import { Content } from "@/components/content";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { DatePickerString } from "@/components/date-picker-string";
import {
  createSpbPo,
  getSpbDetailsBySpbId,
  getSpbOptionsForPo,
  getSpbPoList,
} from "@/services/spb-actions";
import { useDebounce } from "use-debounce";
import { cn } from "@/lib/utils";

type SpbOption = { id: number; spb_no: string; spb_status: string };
type SpbDetail = {
  id: number;
  dtl_spb_part_number: string;
  dtl_spb_part_name: string;
  dtl_spb_qty: number;
  dtl_spb_part_satuan: string;
};

export default function SpbPoPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);

  const [spbOptions, setSpbOptions] = useState<SpbOption[]>([]);
  const [selectedSpbId, setSelectedSpbId] = useState("");
  const [selectedSpbLabel, setSelectedSpbLabel] = useState("");
  const [openSpbCombobox, setOpenSpbCombobox] = useState(false);
  const [spbOptionSearch, setSpbOptionSearch] = useState("");
  const [debouncedSpbOptionSearch] = useDebounce(spbOptionSearch, 300);
  const [spbDetails, setSpbDetails] = useState<SpbDetail[]>([]);
  const [selectedDetailIds, setSelectedDetailIds] = useState<number[]>([]);

  const [poNo, setPoNo] = useState("");
  const [soNo, setSoNo] = useState("");
  const [soDate, setSoDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [openCreateModal, setOpenCreateModal] = useState(false);

  const selectedSpb = useMemo(
    () => spbOptions.find((s) => String(s.id) === selectedSpbId),
    [spbOptions, selectedSpbId],
  );

  const fetchList = async () => {
    setLoading(true);
    const res = await getSpbPoList({
      search: debouncedSearch || undefined,
      page,
      limit,
    });
    if (res.error) {
      toast.error(res.error);
      setRows([]);
      setTotal(0);
    } else {
      setRows(res.data || []);
      setTotal(res.count || 0);
    }
    setLoading(false);
  };

  const fetchSpbOptions = async (keyword?: string) => {
    const res = await getSpbOptionsForPo({
      search: keyword?.trim() || undefined,
      limit: 15,
    });
    if (res.error) return;
    setSpbOptions((res.data || []) as SpbOption[]);
  };

  useEffect(() => {
    fetchList();
  }, [debouncedSearch, page, limit]);

  useEffect(() => {
    if (!openCreateModal) return;
    fetchSpbOptions(debouncedSpbOptionSearch);
  }, [openCreateModal, debouncedSpbOptionSearch]);

  useEffect(() => {
    const loadDetails = async () => {
      if (!selectedSpbId) {
        setSpbDetails([]);
        setSelectedDetailIds([]);
        return;
      }
      const res = await getSpbDetailsBySpbId(Number(selectedSpbId));
      if (res.error) {
        toast.error(res.error);
        setSpbDetails([]);
        return;
      }
      setSpbDetails((res.data || []) as SpbDetail[]);
      setSelectedDetailIds([]);
    };

    loadDetails();
  }, [selectedSpbId]);

  const toggleDetail = (id: number, checked: boolean) => {
    setSelectedDetailIds((prev) =>
      checked ? [...prev, id] : prev.filter((v) => v !== id),
    );
  };

  const submit = async () => {
    if (!selectedSpbId) return toast.error("Pilih SPB.");
    if (!poNo.trim()) return toast.error("No PO wajib diisi.");
    if (!selectedDetailIds.length) return toast.error("Pilih minimal 1 item.");

    setSubmitting(true);
    const res = await createSpbPo({
      spb_id: Number(selectedSpbId),
      po_no: poNo,
      so_no: soNo || undefined,
      so_date: soDate ? new Date(soDate).toISOString() : undefined,
      details: selectedDetailIds.map((id) => ({ spb_dtl_id: id })),
    });
    setSubmitting(false);

    if (res.error) {
      toast.error(res.error);
      return;
    }

    toast.success("SPB-PO berhasil dibuat.");
    resetCreateForm();
    setOpenCreateModal(false);
    fetchList();
  };

  const resetCreateForm = () => {
    setPoNo("");
    setSoNo("");
    setSoDate("");
    setSelectedSpbId("");
    setSelectedSpbLabel("");
    setSpbOptionSearch("");
    setOpenSpbCombobox(false);
    setSpbDetails([]);
    setSelectedDetailIds([]);
  };

  const handleOpenCreateModal = (open: boolean) => {
    setOpenCreateModal(open);
    if (!open) {
      resetCreateForm();
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                PURCHASE ORDER (SPB)
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Attach PO ke SPB
              </p>
            </div>
          </div>

          <Button
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
            onClick={() => setOpenCreateModal(true)}
          >
            <Plus className="h-4 w-4" /> BUAT SPB-PO
          </Button>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="space-y-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1 xl:min-w-70">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Cari No PO atau No SO"
                className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium text-foreground transition-all focus:bg-background"
              />
            </div>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No SPB</TableHead>
                  <TableHead>No PO</TableHead>
                  <TableHead>No SO</TableHead>
                  <TableHead>SO Date</TableHead>
                  <TableHead>Lokasi</TableHead>
                  <TableHead>Item Count</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-muted-foreground"
                    >
                      Memuat data...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-muted-foreground"
                    >
                      Belum ada data SPB-PO.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.spb?.spb_no || "-"}</TableCell>
                      <TableCell className="font-medium">{row.po_no}</TableCell>
                      <TableCell>{row.so_no || "-"}</TableCell>
                      <TableCell>
                        {row.so_date
                          ? new Date(row.so_date).toLocaleDateString("id-ID")
                          : "-"}
                      </TableCell>
                      <TableCell>{row.spb?.spb_gudang || "-"}</TableCell>
                      <TableCell>{row.details?.length || 0}</TableCell>
                      <TableCell>
                        {new Date(row.created_at).toLocaleDateString("id-ID")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <DataTablePagination
            totalCount={total}
            pageSize={limit}
            currentPage={page}
            onPageChange={setPage}
            onPageSizeChange={(v) => {
              setLimit(Number(v));
              setPage(1);
            }}
            itemLabel="SPB PO"
          />
        </div>
      </Content>

      <Dialog open={openCreateModal} onOpenChange={handleOpenCreateModal}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Buat SPB-PO</DialogTitle>
            <DialogDescription>
              Pilih SPB, lengkapi informasi PO, lalu pilih item detail SPB.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Pilih SPB</Label>
                <Popover
                  open={openSpbCombobox}
                  onOpenChange={setOpenSpbCombobox}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={openSpbCombobox}
                      className="w-full justify-between font-normal"
                    >
                      <span className="truncate">
                        {selectedSpb
                          ? `${selectedSpb.spb_no} (${selectedSpb.spb_status})`
                          : selectedSpbLabel || "Pilih SPB..."}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-(--radix-popover-trigger-width) p-0"
                    align="start"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Cari SPB..."
                        value={spbOptionSearch}
                        onValueChange={setSpbOptionSearch}
                      />
                      <CommandList>
                        <CommandEmpty>Tidak ada SPB ditemukan.</CommandEmpty>
                        <CommandGroup>
                          {spbOptions.map((spb) => {
                            const value = String(spb.id);
                            const label = `${spb.spb_no} (${spb.spb_status})`;

                            return (
                              <CommandItem
                                key={spb.id}
                                value={label}
                                onSelect={() => {
                                  setSelectedSpbId(value);
                                  setSelectedSpbLabel(label);
                                  setOpenSpbCombobox(false);
                                }}
                              >
                                <span className="truncate">{label}</span>
                                <Check
                                  className={cn(
                                    "ml-auto",
                                    selectedSpbId === value
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>SO Date</Label>
                <DatePickerString value={soDate} onChange={setSoDate} />
              </div>

              <div className="space-y-2">
                <Label>No PO</Label>
                <Input value={poNo} onChange={(e) => setPoNo(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>No SO</Label>
                <Input value={soNo} onChange={(e) => setSoNo(e.target.value)} />
              </div>
            </div>

            {selectedSpbId && (
              <div className="rounded-md border max-h-[45vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">Pilih</TableHead>
                      <TableHead>Part Number</TableHead>
                      <TableHead>Part Name</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Satuan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {spbDetails.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-muted-foreground"
                        >
                          Tidak ada detail item.
                        </TableCell>
                      </TableRow>
                    ) : (
                      spbDetails.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedDetailIds.includes(item.id)}
                              onChange={(e) =>
                                toggleDetail(item.id, e.target.checked)
                              }
                            />
                          </TableCell>
                          <TableCell>{item.dtl_spb_part_number}</TableCell>
                          <TableCell>{item.dtl_spb_part_name}</TableCell>
                          <TableCell>{item.dtl_spb_qty}</TableCell>
                          <TableCell>{item.dtl_spb_part_satuan}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenCreateModal(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Menyimpan..." : "Simpan SPB-PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
