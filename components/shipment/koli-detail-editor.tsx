"use client";

// Editor detail koli + layanan/rate kurir, dipakai bersama oleh form
// Item Transfer, Delivery, dan DO Reguler. Hitungan di lib/shipment.ts.

import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Package, Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  type KoliRow,
  beratVolumeKoli,
  emptyKoliRow,
  estimasiBiayaKirim,
  fmtNum,
  hasDimensi,
  summarizeKoli,
} from "@/lib/shipment";

/**
 * Input angka desimal dengan draft string lokal, supaya ketikan antara
 * seperti "0." / "1,5" tidak dihapus oleh re-render nilai numerik.
 */
function DecimalCell({
  value,
  onChange,
  integer,
  placeholder,
}: {
  value: number;
  onChange: (v: number) => void;
  integer?: boolean;
  placeholder?: string;
}) {
  const parse = (s: string) => {
    const n = integer ? parseInt(s, 10) : parseFloat(s.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const [draft, setDraft] = useState(value ? String(value) : "");

  useEffect(() => {
    if (parse(draft) !== value) setDraft(value ? String(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      inputMode={integer ? "numeric" : "decimal"}
      value={draft}
      placeholder={placeholder ?? "0"}
      onChange={(e) => {
        const s = e.target.value;
        if (!(integer ? /^\d*$/ : /^\d*([.,]\d*)?$/).test(s)) return;
        setDraft(s);
        onChange(parse(s));
      }}
      className="h-9 text-xs text-right min-w-16"
    />
  );
}

export function KoliDetailEditor({
  rows,
  onRowsChange,
  showKurirFields,
  layananKurir,
  onLayananKurirChange,
  ratePerKg,
  onRatePerKgChange,
}: {
  rows: KoliRow[];
  onRowsChange: (rows: KoliRow[]) => void;
  /** TRUE untuk ekspedisi: tampilkan layanan, rate/kg & estimasi biaya. */
  showKurirFields: boolean;
  layananKurir: string;
  onLayananKurirChange: (v: string) => void;
  ratePerKg: number;
  onRatePerKgChange: (v: number) => void;
}) {
  const summary = summarizeKoli(rows);
  const biaya = showKurirFields ? estimasiBiayaKirim(rows, ratePerKg) : null;

  const patch = (idx: number, p: Partial<KoliRow>) =>
    onRowsChange(rows.map((r, i) => (i === idx ? { ...r, ...p } : r)));

  return (
    <div className="space-y-3">
      {showKurirFields && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">
              Jenis Layanan Kurir
            </Label>
            <Input
              value={layananKurir}
              onChange={(e) => onLayananKurirChange(e.target.value)}
              placeholder="cth: REG, One Day Service"
              className="h-10 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">
              Rate per Kg
            </Label>
            <CurrencyInput
              value={ratePerKg}
              onValueChange={onRatePerKgChange}
              className="h-10 text-sm"
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
            <Package className="h-3 w-3" /> Detail Koli
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onRowsChange([...rows, emptyKoliRow()])}
          >
            <Plus className="h-3 w-3 mr-1" /> Tambah Baris Koli
          </Button>
        </div>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] w-20">Jml Koli</TableHead>
                <TableHead className="text-[10px]">Berat/Koli (kg)</TableHead>
                <TableHead className="text-[10px]">P (cm)</TableHead>
                <TableHead className="text-[10px]">L (cm)</TableHead>
                <TableHead className="text-[10px]">T (cm)</TableHead>
                <TableHead className="text-[10px] text-right whitespace-nowrap">
                  Berat Vol./Koli
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, idx) => (
                <TableRow key={idx}>
                  <TableCell className="p-1.5">
                    <DecimalCell integer value={r.qty} onChange={(v) => patch(idx, { qty: v })} placeholder="1" />
                  </TableCell>
                  <TableCell className="p-1.5">
                    <DecimalCell value={r.berat_kg} onChange={(v) => patch(idx, { berat_kg: v })} />
                  </TableCell>
                  <TableCell className="p-1.5">
                    <DecimalCell value={r.panjang_cm} onChange={(v) => patch(idx, { panjang_cm: v })} />
                  </TableCell>
                  <TableCell className="p-1.5">
                    <DecimalCell value={r.lebar_cm} onChange={(v) => patch(idx, { lebar_cm: v })} />
                  </TableCell>
                  <TableCell className="p-1.5">
                    <DecimalCell value={r.tinggi_cm} onChange={(v) => patch(idx, { tinggi_cm: v })} />
                  </TableCell>
                  <TableCell className="p-1.5 text-right text-xs text-muted-foreground whitespace-nowrap">
                    {hasDimensi(r) ? `${fmtNum(beratVolumeKoli(r))} kg` : "-"}
                  </TableCell>
                  <TableCell className="p-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      disabled={rows.length <= 1}
                      onClick={() => onRowsChange(rows.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Koli dengan berat & dimensi sama cukup 1 baris (isi jumlah koli). Berat
          volume = P×L×T / 6000; berat tagih per koli = yang lebih besar antara
          berat aktual & berat volume.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 rounded-md bg-muted/50 p-3 text-xs">
        <SummaryItem label="Total Koli" value={`${summary.totalKoli} koli`} />
        <SummaryItem label="Berat Aktual" value={`${fmtNum(summary.beratAktual)} kg`} />
        <SummaryItem label="Berat Volume" value={`${fmtNum(summary.beratVolume)} kg`} />
        <SummaryItem label="Berat Tagih" value={`${fmtNum(summary.beratTagih)} kg`} />
        {showKurirFields && (
          <SummaryItem
            label="Estimasi Biaya"
            value={biaya !== null ? formatCurrency(biaya) : "-"}
            strong
          />
        )}
      </div>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase font-bold text-muted-foreground">{label}</div>
      <div className={strong ? "font-bold text-primary" : "font-semibold"}>{value}</div>
    </div>
  );
}
