"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DatePickerString } from "@/components/date-picker-string";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createReturnSpb,
  generateReturnKode,
  getSpbOptionsForReturn,
  getSpbReturnableDetails,
} from "@/services/spb-actions";
import { useDebounce } from "use-debounce";
import { cn } from "@/lib/utils";

type SpbOption = { id: number; spb_no: string; spb_status: string };
type ReturnableRow = {
  id: number;
  part_id: number;
  dtl_spb_part_number: string;
  dtl_spb_part_name: string;
  dtl_spb_part_satuan: string;
  dtl_spb_qty: number;
  dtl_spb_qty_returned: number;
};

export default function ReturnSpbCreatePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [rtnKode, setRtnKode] = useState("");
  const [rtnTanggal, setRtnTanggal] = useState("");
  const [rtnNote, setRtnNote] = useState("");

  const [spbOptions, setSpbOptions] = useState<SpbOption[]>([]);
  const [selectedSpbId, setSelectedSpbId] = useState("");
  const [selectedSpbLabel, setSelectedSpbLabel] = useState("");
  const [openSpbCombobox, setOpenSpbCombobox] = useState(false);
  const [spbOptionSearch, setSpbOptionSearch] = useState("");
  const [debouncedSpbOptionSearch] = useDebounce(spbOptionSearch, 300);

  const [rows, setRows] = useState<ReturnableRow[]>([]);
  const [qtyMap, setQtyMap] = useState<Record<number, string>>({});

  const selectedSpb = useMemo(
    () => spbOptions.find((s) => String(s.id) === selectedSpbId),
    [spbOptions, selectedSpbId],
  );

  const fetchInit = async () => {
    const kodeRes = await generateReturnKode();

    if (kodeRes.error) toast.error(kodeRes.error);
    else setRtnKode(kodeRes.data || "");

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setRtnTanggal(`${yyyy}-${mm}-${dd}`);
  };

  useEffect(() => {
    fetchInit();
  }, []);

  useEffect(() => {
    const loadSpbOptions = async () => {
      const res = await getSpbOptionsForReturn({
        search: debouncedSpbOptionSearch || undefined,
        limit: 15,
      });

      if (res.error) {
        toast.error(res.error);
        setSpbOptions([]);
        return;
      }

      setSpbOptions((res.data || []) as SpbOption[]);
    };

    loadSpbOptions();
  }, [debouncedSpbOptionSearch]);

  useEffect(() => {
    const loadDetails = async () => {
      if (!selectedSpbId) {
        setRows([]);
        setQtyMap({});
        return;
      }

      const res = await getSpbReturnableDetails(Number(selectedSpbId));
      if (res.error) {
        toast.error(res.error);
        setRows([]);
        setQtyMap({});
        return;
      }

      setRows((res.data || []) as ReturnableRow[]);
      setQtyMap({});
    };

    loadDetails();
  }, [selectedSpbId]);

  const submit = async () => {
    if (!rtnKode) return toast.error("Kode return belum tersedia.");
    if (!selectedSpbId) return toast.error("Pilih SPB.");
    if (!rtnTanggal) return toast.error("Tanggal return wajib diisi.");

    const details = rows
      .map((row) => ({
        spb_dtl_id: row.id,
        part_id: row.part_id,
        qty_return: Number(qtyMap[row.id] || 0),
      }))
      .filter((d) => d.qty_return > 0);

    if (!details.length) return toast.error("Isi minimal 1 qty return.");

    for (const d of details) {
      const row = rows.find((r) => r.id === d.spb_dtl_id);
      if (!row) continue;
      const max = row.dtl_spb_qty - row.dtl_spb_qty_returned;
      if (d.qty_return > max) {
        return toast.error(
          `Qty return melebihi sisa part ${row.dtl_spb_part_number}.`,
        );
      }
    }

    setLoading(true);
    const res = await createReturnSpb({
      rtn_kode: rtnKode,
      spb_id: Number(selectedSpbId),
      rtn_tanggal: new Date(rtnTanggal).toISOString(),
      rtn_note: rtnNote || undefined,
      details,
    });
    setLoading(false);

    if (res.error) {
      toast.error(res.error);
      return;
    }

    toast.success("Return SPB berhasil dibuat.");
    router.push("/return-spb");
  };

  return (
    <Content
      title="Buat Return SPB"
      description="Mengembalikan stok dari transaksi SPB"
      cardAction={
        <Button variant="outline" asChild>
          <Link href="/return-spb">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Kode Return</Label>
            <Input value={rtnKode} disabled />
          </div>

          <div className="space-y-2">
            <Label>Tanggal Return</Label>
            <DatePickerString value={rtnTanggal} onChange={setRtnTanggal} />
          </div>

          <div className="space-y-2">
            <Label>Pilih SPB</Label>
            <Popover open={openSpbCombobox} onOpenChange={setOpenSpbCombobox}>
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

          <div className="space-y-2 md:col-span-3">
            <Label>Catatan</Label>
            <Textarea
              value={rtnNote}
              onChange={(e) => setRtnNote(e.target.value)}
            />
          </div>
        </div>

        {selectedSpb && (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part Number</TableHead>
                  <TableHead>Part Name</TableHead>
                  <TableHead>Qty SPB</TableHead>
                  <TableHead>Qty Sudah Return</TableHead>
                  <TableHead>Sisa</TableHead>
                  <TableHead>Qty Return</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground"
                    >
                      Tidak ada item returnable.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const max = row.dtl_spb_qty - row.dtl_spb_qty_returned;
                    return (
                      <TableRow key={row.id}>
                        <TableCell>{row.dtl_spb_part_number}</TableCell>
                        <TableCell>{row.dtl_spb_part_name}</TableCell>
                        <TableCell>{row.dtl_spb_qty}</TableCell>
                        <TableCell>{row.dtl_spb_qty_returned}</TableCell>
                        <TableCell>{max}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            max={max}
                            value={qtyMap[row.id] || ""}
                            onChange={(e) =>
                              setQtyMap((prev) => ({
                                ...prev,
                                [row.id]: e.target.value,
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" asChild>
            <Link href="/return-spb">Batal</Link>
          </Button>
          <Button onClick={submit} disabled={loading}>
            {loading ? "Menyimpan..." : "Simpan Return"}
          </Button>
        </div>
      </div>
    </Content>
  );
}
