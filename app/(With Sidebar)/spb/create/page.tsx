"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/date-picker";
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
import { createClient } from "@/lib/supabase/client";
import { createSpb, generateSpbKode } from "@/services/spb-actions";
import { useRouter } from "next/navigation";

type Barang = {
  id: number;
  part_number: string;
  part_name: string;
  part_satuan: string;
};

type StockRow = {
  part_id: number;
  qty: number;
};

type SpbItem = {
  part_id: number;
  dtl_spb_part_number: string;
  dtl_spb_part_name: string;
  dtl_spb_part_satuan: string;
  dtl_spb_qty: number;
};

export default function SpbCreatePage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(false);
  const [masterLoading, setMasterLoading] = useState(true);

  const [spbNo, setSpbNo] = useState("");
  const [spbTanggal, setSpbTanggal] = useState<Date | undefined>(new Date());

  const [section, setSection] = useState("");
  const [noWo, setNoWo] = useState("");
  const [picGmi, setPicGmi] = useState("");
  const [picPpa, setPicPpa] = useState("");
  const [kodeUnit, setKodeUnit] = useState("");
  const [tipeUnit, setTipeUnit] = useState("");
  const [brand, setBrand] = useState("");
  const [hm, setHm] = useState("");
  const [remark, setRemark] = useState("");
  const [gudang, setGudang] = useState("");
  const [cabangId, setCabangId] = useState<number | null>(null);

  const [partPickerOpen, setPartPickerOpen] = useState(false);
  const [partSearch, setPartSearch] = useState("");
  const [partOptions, setPartOptions] = useState<Barang[]>([]);
  const [partLoading, setPartLoading] = useState(false);
  const partTriggerRef = useRef<HTMLDivElement | null>(null);
  const [partPopoverWidth, setPartPopoverWidth] = useState<number>(0);

  const [selectedPartId, setSelectedPartId] = useState<string>("");

  const [stockMap, setStockMap] = useState<Record<number, number>>({});

  const [selectedQty, setSelectedQty] = useState("");
  const [items, setItems] = useState<SpbItem[]>([]);

  const selectedPart = useMemo(
    () => partOptions.find((b) => String(b.id) === selectedPartId),
    [partOptions, selectedPartId],
  );

  const loadProfileAndMaster = async () => {
    setMasterLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("User tidak ditemukan.");
      setMasterLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("nama, cabang_id, cabang:cabang_id(nama_cabang)")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      toast.error(profileError.message);
    }

    if (profile?.nama) {
      setPicGmi(profile.nama);
    }
    let resolvedGudang = "";
    if ((profile as any)?.cabang?.nama_cabang) {
      resolvedGudang = (profile as any).cabang.nama_cabang;
    }
    if (profile?.cabang_id) {
      setCabangId(profile.cabang_id);

      if (!resolvedGudang) {
        const { data: cabangData } = await supabase
          .from("cabang")
          .select("nama_cabang")
          .eq("id", profile.cabang_id)
          .maybeSingle();
        resolvedGudang = cabangData?.nama_cabang || "";
      }

      const kodeRes = await generateSpbKode(profile.cabang_id);
      if (kodeRes.error) {
        toast.error(kodeRes.error);
      } else {
        setSpbNo(kodeRes.data || "");
      }
    }

    setGudang(resolvedGudang);

    if (profile?.cabang_id) {
      const { data: stockData } = await supabase
        .from("stock")
        .select("part_id, qty")
        .eq("cabang_id", profile.cabang_id);

      const mapped = ((stockData || []) as StockRow[]).reduce(
        (acc, row) => {
          acc[row.part_id] = row.qty;
          return acc;
        },
        {} as Record<number, number>,
      );
      setStockMap(mapped);
    }

    setMasterLoading(false);
  };

  useEffect(() => {
    loadProfileAndMaster();
  }, []);

  useEffect(() => {
    const fetchPartOptions = async () => {
      if (!partPickerOpen) return;

      setPartLoading(true);
      let query = supabase
        .from("barang")
        .select("id, part_number, part_name, part_satuan")
        .order("part_name", { ascending: true })
        .limit(15);

      const keyword = partSearch.trim();
      if (keyword) {
        query = query.or(
          `part_number.ilike.%${keyword}%,part_name.ilike.%${keyword}%`,
        );
      }

      const { data, error } = await query;
      if (error) {
        toast.error(error.message);
        setPartOptions([]);
      } else {
        setPartOptions((data || []) as Barang[]);
      }
      setPartLoading(false);
    };

    fetchPartOptions();
  }, [partPickerOpen, partSearch, supabase]);

  useEffect(() => {
    const syncWidth = () => {
      if (!partTriggerRef.current) return;
      setPartPopoverWidth(partTriggerRef.current.getBoundingClientRect().width);
    };

    if (partPickerOpen) {
      syncWidth();
    }

    window.addEventListener("resize", syncWidth);
    return () => window.removeEventListener("resize", syncWidth);
  }, [partPickerOpen]);

  const addItem = () => {
    if (!selectedPart) {
      toast.error("Pilih part terlebih dahulu.");
      return;
    }

    const qty = Number(selectedQty);
    if (!qty || qty <= 0) {
      toast.error("Qty harus lebih dari 0.");
      return;
    }

    if (items.some((i) => i.part_id === selectedPart.id)) {
      toast.error("Part sudah ada di daftar.");
      return;
    }

    setItems((prev) => [
      ...prev,
      {
        part_id: selectedPart.id,
        dtl_spb_part_number: selectedPart.part_number,
        dtl_spb_part_name: selectedPart.part_name,
        dtl_spb_part_satuan: selectedPart.part_satuan,
        dtl_spb_qty: qty,
      },
    ]);

    setSelectedPartId("");
    setSelectedQty("");
  };

  const removeItem = (partId: number) => {
    setItems((prev) => prev.filter((i) => i.part_id !== partId));
  };

  const onSubmit = async () => {
    if (!spbNo) return toast.error("Kode SPB belum tersedia.");
    if (!spbTanggal) return toast.error("Tanggal SPB wajib diisi.");
    if (!section.trim()) return toast.error("Section wajib diisi.");
    if (!picPpa.trim()) return toast.error("PIC PPA wajib diisi.");
    if (!kodeUnit.trim()) return toast.error("Kode Unit wajib diisi.");
    if (!tipeUnit.trim()) return toast.error("Tipe Unit wajib diisi.");
    if (!brand.trim()) return toast.error("Brand wajib diisi.");
    if (!hm || Number(hm) <= 0) return toast.error("HM harus lebih dari 0.");
    if (!items.length) return toast.error("Tambahkan minimal 1 item.");

    setLoading(true);

    const res = await createSpb({
      spb_no: spbNo,
      spb_tanggal: spbTanggal.toISOString(),
      spb_no_wo: noWo || undefined,
      spb_section: section,
      spb_pic_gmi: picGmi,
      spb_pic_ppa: picPpa,
      spb_kode_unit: kodeUnit,
      spb_tipe_unit: tipeUnit,
      spb_brand: brand,
      spb_hm: Number(hm),
      spb_problem_remark: remark || undefined,
      spb_gudang: gudang || undefined,
      cabang_id: cabangId || undefined,
      items,
    });

    setLoading(false);

    if (res.error) {
      toast.error(res.error);
      return;
    }

    toast.success("SPB berhasil dibuat.");
    router.push("/spb");
  };

  return (
    <Content
      title="Buat SPB"
      description="Surat Pengeluaran Barang"
      cardAction={
        <Button variant="outline" asChild>
          <Link href="/spb">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>No SPB</Label>
            <div className="flex gap-2">
              <Input value={spbNo} disabled />
              <Button
                variant="outline"
                onClick={async () => {
                  if (!cabangId) return;
                  const kodeRes = await generateSpbKode(cabangId);
                  if (kodeRes.error) toast.error(kodeRes.error);
                  else setSpbNo(kodeRes.data || "");
                }}
              >
                Refresh
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tanggal SPB</Label>
            <DatePicker value={spbTanggal} onChange={setSpbTanggal} />
          </div>

          <div className="space-y-2">
            <Label>Gudang</Label>
            <Input
              value={gudang}
              onChange={(e) => setGudang(e.target.value)}
              disabled
            />
          </div>

          <div className="space-y-2">
            <Label>No WO</Label>
            <Input value={noWo} onChange={(e) => setNoWo(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Section</Label>
            <Input
              value={section}
              onChange={(e) => setSection(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>PIC GMI</Label>
            <Input
              value={picGmi}
              onChange={(e) => setPicGmi(e.target.value)}
              disabled
            />
          </div>

          <div className="space-y-2">
            <Label>PIC PPA</Label>
            <Input value={picPpa} onChange={(e) => setPicPpa(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Kode Unit</Label>
            <Input
              value={kodeUnit}
              onChange={(e) => setKodeUnit(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Tipe Unit</Label>
            <Input
              value={tipeUnit}
              onChange={(e) => setTipeUnit(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Brand</Label>
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>HM</Label>
            <Input
              type="number"
              value={hm}
              onChange={(e) => setHm(e.target.value)}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Problem / Remark</Label>
            <Textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Tambah Item</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label>Pilih Part Number</Label>
              <div className="mt-2" ref={partTriggerRef}>
                <Popover open={partPickerOpen} onOpenChange={setPartPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between"
                      disabled={masterLoading}
                    >
                      {selectedPart
                        ? `${selectedPart.part_number} - ${selectedPart.part_name}`
                        : "Pilih part..."}
                      <ChevronsUpDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0"
                    align="start"
                    style={
                      partPopoverWidth
                        ? { width: `${partPopoverWidth}px` }
                        : undefined
                    }
                  >
                    <div className="border-b p-2">
                      <Input
                        placeholder="Cari part number / part name..."
                        value={partSearch}
                        onChange={(e) => setPartSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1">
                      {partLoading ? (
                        <div className="p-3 text-sm text-muted-foreground">
                          Memuat data...
                        </div>
                      ) : partOptions.length === 0 ? (
                        <div className="p-3 text-sm text-muted-foreground">
                          Data tidak ditemukan.
                        </div>
                      ) : (
                        partOptions.map((part) => (
                          <button
                            key={part.id}
                            type="button"
                            className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                            onClick={() => {
                              setSelectedPartId(String(part.id));
                              setPartPickerOpen(false);
                            }}
                          >
                            <div className="font-medium">
                              {part.part_number}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {part.part_name}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div>
              <Label>Qty</Label>
              <Input
                type="number"
                min={1}
                value={selectedQty}
                onChange={(e) => setSelectedQty(e.target.value)}
                className="mt-2"
              />
            </div>

            <div className="md:col-span-2 flex justify-end">
              <Button type="button" className="w-full" onClick={addItem}>
                <Plus className="h-4 w-4" /> Tambah
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Stock saat ini mengacu ke lokasi user:{" "}
            <span className="font-medium text-foreground">{gudang || "-"}</span>
          </p>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part Number</TableHead>
                  <TableHead>Part Name</TableHead>
                  <TableHead>Satuan</TableHead>
                  <TableHead>Qty SPB</TableHead>
                  <TableHead>Stock Saat Ini ({gudang || "-"})</TableHead>
                  <TableHead className="w-16">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground"
                    >
                      Belum ada item.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.part_id}>
                      <TableCell>{item.dtl_spb_part_number}</TableCell>
                      <TableCell>{item.dtl_spb_part_name}</TableCell>
                      <TableCell>{item.dtl_spb_part_satuan}</TableCell>
                      <TableCell>{item.dtl_spb_qty}</TableCell>
                      <TableCell>{stockMap[item.part_id] ?? 0}</TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeItem(item.part_id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" asChild>
            <Link href="/spb">Batal</Link>
          </Button>
          <Button onClick={onSubmit} disabled={loading || masterLoading}>
            {loading ? "Menyimpan..." : "Simpan SPB"}
          </Button>
        </div>
      </div>
    </Content>
  );
}
