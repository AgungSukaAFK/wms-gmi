// Tampilan read-only detail koli + layanan/rate kurir untuk halaman detail,
// side sheet, dan halaman cetak (Item Transfer, Delivery, DO Reguler).
// Tidak render apa-apa untuk data lama yang belum punya koli_detail/layanan/rate.

import { formatCurrency } from "@/lib/utils";
import {
  beratVolumeKoli,
  estimasiBiayaKirim,
  fmtNum,
  hasDimensi,
  parseKoliDetail,
  summarizeKoli,
} from "@/lib/shipment";

export function KoliDetailView({
  koliDetail,
  layananKurir,
  ratePerKg,
  shipmentType,
  className,
}: {
  koliDetail: unknown; // nilai mentah kolom JSONB koli_detail
  layananKurir?: string | null;
  ratePerKg?: number | string | null;
  shipmentType?: string | null; // menentukan pembagi berat volume
  className?: string;
}) {
  const rows = parseKoliDetail(koliDetail);
  const rate = Number(ratePerKg) || 0;
  if (rows.length === 0 && !layananKurir && !rate) return null;

  const summary = summarizeKoli(rows, shipmentType);
  const biaya = estimasiBiayaKirim(rows, rate, shipmentType);

  return (
    <div className={`space-y-2 text-xs ${className ?? ""}`}>
      {(layananKurir || rate > 0) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <span className="text-muted-foreground">Layanan: </span>
            <span className="font-semibold">{layananKurir || "-"}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Rate/kg: </span>
            <span className="font-semibold">{rate > 0 ? formatCurrency(rate) : "-"}</span>
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left font-semibold">Jml Koli</th>
                <th className="px-2 py-1 text-right font-semibold">Berat/Koli</th>
                <th className="px-2 py-1 text-right font-semibold">Dimensi P×L×T</th>
                <th className="px-2 py-1 text-right font-semibold">Berat Vol./Koli</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1">{r.qty}</td>
                  <td className="px-2 py-1 text-right">
                    {r.berat_kg > 0 ? `${fmtNum(r.berat_kg)} kg` : "-"}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {hasDimensi(r)
                      ? `${fmtNum(r.panjang_cm)}×${fmtNum(r.lebar_cm)}×${fmtNum(r.tinggi_cm)} cm`
                      : "-"}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {hasDimensi(r) ? `${fmtNum(beratVolumeKoli(r, shipmentType))} kg` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <span className="text-muted-foreground">Total: </span>
            <span className="font-semibold">{summary.totalKoli} koli</span>
          </span>
          <span>
            <span className="text-muted-foreground">Berat aktual: </span>
            <span className="font-semibold">{fmtNum(summary.beratAktual)} kg</span>
          </span>
          <span>
            <span className="text-muted-foreground">Berat volume: </span>
            <span className="font-semibold">{fmtNum(summary.beratVolume)} kg</span>
          </span>
          <span>
            <span className="text-muted-foreground">Berat tagih: </span>
            <span className="font-semibold">{fmtNum(summary.beratTagih)} kg</span>
          </span>
          {biaya !== null && (
            <span>
              <span className="text-muted-foreground">Estimasi biaya: </span>
              <span className="font-bold">{formatCurrency(biaya)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
