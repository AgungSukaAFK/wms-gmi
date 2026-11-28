// Export Excel riwayat servis & penggantian part HM (pengganti CSV hm.md §8),
// style seragam lib/excel-styled.ts. Kolom = CSV_HEADERS di lib/hm.ts.

import { CELL_COLORS, downloadStyledExcel, exportSubtitle } from "@/lib/excel-styled";
import { CSV_HEADERS, type HmHistoryRow, toDateInputValue } from "@/lib/hm";

const JENIS_REP = "Penggantian Part";
const JENIS_SERVIS = "Servis Umum";

export async function downloadHistoryExcel(rows: HmHistoryRow[], d = new Date()) {
  const [jenis, kodeUnit, namaUnit, pn, deskripsi, jenisServis, tanggal, hm, catatan] =
    CSV_HEADERS;
  await downloadStyledExcel(`riwayat-servis-${toDateInputValue(d)}.xlsx`, [
    {
      name: "Riwayat Servis",
      title: "RIWAYAT SERVIS & PENGGANTIAN PART",
      subtitle: exportSubtitle({ count: rows.length }),
      freezeCols: 3,
      columns: [
        {
          header: jenis,
          width: 18,
          colors: { [JENIS_REP]: CELL_COLORS.blue, [JENIS_SERVIS]: CELL_COLORS.green },
        },
        { header: kodeUnit, width: 14 },
        { header: namaUnit, width: 26, wrap: true },
        { header: pn, width: 20 },
        { header: deskripsi, width: 32, wrap: true },
        { header: jenisServis, width: 20, wrap: true },
        { header: tanggal, width: 13, type: "date" },
        { header: hm, width: 10, type: "int" },
        { header: catatan, width: 36, wrap: true },
      ],
      rows: rows.map((row) => {
        const isRep = row.kind.trim().toLowerCase().startsWith("penggantian");
        return {
          [jenis]: isRep ? JENIS_REP : JENIS_SERVIS,
          [kodeUnit]: row.unit_code,
          [namaUnit]: row.unit_name,
          [pn]: isRep ? (row.part_code ?? "") : "",
          [deskripsi]: isRep ? row.part_name : "",
          [jenisServis]: isRep ? "" : row.service_kind,
          [tanggal]: row.date,
          [hm]: row.hm,
          [catatan]: row.note,
        };
      }),
    },
  ]);
}
