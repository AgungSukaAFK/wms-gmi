// Penjelasan error import untuk manusia: jenis masalah + saran perbaikan.
// Dipakai client (tabel hasil, ringkasan, laporan Excel) dan server (handler
// boleh mengisi `kind`/`hint`/`details` sendiri). Handler lama yang cuma
// mengisi `message` tetap dapat jenis masalah lewat classifyIssue().

import type { ImportIssueKind, ImportRowResult } from "./types";

export const ISSUE_INFO: Record<ImportIssueKind, { label: string; hint: string; order: number }> = {
  format: {
    label: "Isian sel salah / kosong",
    hint: "Perbaiki sel yang disebut sesuai sheet Petunjuk (format tanggal DD/MM/YYYY, angka tanpa teks, pilihan dari dropdown, kolom bertanda * wajib diisi).",
    order: 1,
  },
  header_mismatch: {
    label: "Data dokumen tidak seragam",
    hint: "Kolom grup DOKUMEN harus persis sama di semua baris dengan nomor dokumen yang sama. Samakan isinya atau pakai nomor dokumen berbeda.",
    order: 2,
  },
  duplicate: {
    label: "Data dobel di file",
    hint: "Hapus salah satu baris dobel, atau bedakan kuncinya.",
    order: 3,
  },
  master_missing: {
    label: "Tidak ditemukan di WMS",
    hint: "Cek ejaan/kode persis seperti di WMS (pakai dropdown template). Kalau memang belum ada, tambahkan dulu master/dokumennya.",
    order: 4,
  },
  not_in_source: {
    label: "Barang tidak ada di dokumen acuan",
    hint: "Part Number tidak tercantum di dokumen acuan (MR/PO/SO) yang ditulis. Cek apakah No dokumen atau Part Number-nya tertukar.",
    order: 5,
  },
  doc_status: {
    label: "Status dokumen acuan belum sesuai",
    hint: "Selesaikan dulu prosesnya di WMS (mis. approve MR/PR) lalu upload ulang.",
    order: 6,
  },
  freeze: {
    label: "MR di-freeze / lewat due date",
    hint: "Minta moderator memperpanjang due date atau unfreeze MR-nya, lalu upload ulang.",
    order: 7,
  },
  stock: {
    label: "Stok gudang tidak cukup",
    hint: "Kurangi qty, pilih gudang asal lain, atau masukkan stoknya dulu (RI / Item Transfer / update stok).",
    order: 8,
  },
  allocation: {
    label: "Jatah share stock tidak ada / kurang",
    hint: "Qty per MR tidak boleh melebihi sisa jatah share stock dari gudang asal. Atur alokasinya dulu di Share Stock, atau sesuaikan qty / gudang asal.",
    order: 9,
  },
  over_qty: {
    label: "Qty melebihi sisa",
    hint: "Kurangi qty sesuai sisa yang tertulis.",
    order: 10,
  },
  conflict: {
    label: "Bentrok dengan data yang sudah ada",
    hint: "Data ini sudah tercatat berbeda di WMS. Cek data di WMS, perbaiki salah satunya.",
    order: 11,
  },
  save_failed: {
    label: "Ditolak saat disimpan",
    hint: "Lolos cek awal tapi ditolak saat disimpan (data di WMS berubah atau aturan form). Baca keterangannya, perbaiki, lalu upload ulang.",
    order: 12,
  },
  cascade: {
    label: "Ikut ditahan (1 dokumen dengan baris error)",
    hint: "Baris ini sendiri tidak salah. 1 dokumen dibuat utuh atau tidak sama sekali, jadi perbaiki baris penyebab yang disebut.",
    order: 98,
  },
  other: { label: "Lainnya", hint: "Baca keterangan, perbaiki, lalu upload ulang.", order: 99 },
};

const RULES: [RegExp, ImportIssueKind][] = [
  [/^(Dilewati|Ikut ditahan): ada (baris|barang)|^Ikut ditahan/i, "cascade"],
  [/beda dengan baris .* di dokumen yang sama/i, "header_mismatch"],
  [/dobel/i, "duplicate"],
  [/wajib diisi|bukan tanggal|tanggal tidak valid|bukan angka|bilangan bulat|minimal \d|tidak dikenal \(pilihan|harus Ya atau Tidak|wajib > ?0/i, "format"],
  [/freeze/i, "freeze"],
  [/share stock|jatah share/i, "allocation"],
  [/^Stok sumber .* tidak ditemukan|^Stok .* tidak (cukup|mencukupi)|stok .* tidak (cukup|mencukupi)/i, "stock"],
  [/melebihi/i, "over_qty"],
  [/berstatus|harus approved|CANCELLED/i, "doc_status"],
  [/tidak ada di (MR|PO|SO|PR)|bukan barang (SO|PO|MR)/i, "not_in_source"],
  [/sudah tercatat|sudah (ada|digunakan|dipakai)|Ada \d+ .* (bernama|dengan kode)/i, "conflict"],
  [/tidak ada di master|tidak ditemukan|tidak dikenal/i, "master_missing"],
  [/^Ditolak saat disimpan|^Gagal disimpan|batch dibatalkan|violates|duplicate key|timeout|fetch failed/i, "save_failed"],
];

export function classifyIssue(message?: string): ImportIssueKind {
  const m = message || "";
  for (const [re, kind] of RULES) if (re.test(m)) return kind;
  return "other";
}

/** Jenis + saran untuk 1 hasil baris error (null kalau bukan error). */
export function explainResult(res?: ImportRowResult) {
  if (!res || res.status !== "error") return null;
  const kind = res.kind || classifyIssue(res.message);
  const info = ISSUE_INFO[kind];
  return { kind, label: info.label, hint: res.hint || info.hint };
}

/** Rincian "isi file vs WMS" jadi 1 baris teks (laporan Excel). */
export function detailsText(res?: ImportRowResult) {
  return (res?.details || [])
    .map((d) => {
      const parts = [d.file !== undefined && d.file !== null && d.file !== "" ? `file: ${d.file}` : null, d.wms !== undefined && d.wms !== null && d.wms !== "" ? `WMS: ${d.wms}` : null].filter(Boolean);
      return `${d.label} (${parts.join(" | ") || "-"})`;
    })
    .join("; ");
}

export type IssueGroup = {
  kind: ImportIssueKind;
  label: string;
  hint: string;
  rows: number[];
  docs: Set<string>;
  /** Contoh pesan berbeda (maks 5). */
  samples: { message: string; rows: number[] }[];
};

/** Kelompokkan baris error per jenis masalah (urut: penyebab dulu, "ikut ditahan" terakhir). */
export function groupIssues(results: Iterable<ImportRowResult>): IssueGroup[] {
  const map = new Map<ImportIssueKind, IssueGroup>();
  for (const res of results) {
    const ex = explainResult(res);
    if (!ex) continue;
    let g = map.get(ex.kind);
    if (!g) {
      g = { kind: ex.kind, label: ex.label, hint: ISSUE_INFO[ex.kind].hint, rows: [], docs: new Set(), samples: [] };
      map.set(ex.kind, g);
    }
    g.rows.push(res.row);
    if (res.ref) g.docs.add(res.ref);
    const msg = res.message || "";
    const s = g.samples.find((x) => x.message === msg);
    if (s) s.rows.push(res.row);
    else if (g.samples.length < 5) g.samples.push({ message: msg, rows: [res.row] });
  }
  return Array.from(map.values()).sort((a, b) => ISSUE_INFO[a.kind].order - ISSUE_INFO[b.kind].order);
}

/** "3, 5, 7–9" -- ringkas daftar nomor baris. */
export function formatRowList(rows: number[], max = 12) {
  const sorted = Array.from(new Set(rows)).sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j - i >= 2 ? `${sorted[i]}–${sorted[j]}` : j > i ? `${sorted[i]}, ${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  const shown = out.slice(0, max).join(", ");
  return out.length > max ? `${shown}, …` : shown;
}
