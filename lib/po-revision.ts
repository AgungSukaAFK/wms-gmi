// Edit / Revisi PO: snapshot & diff yang disimpan di po_revisions dan
// ditampilkan di "Riwayat PO". Modul biasa (bukan "use server") supaya bisa
// dipakai server action maupun komponen client.

import { computePoTotals, getPphTypeLabel } from "@/lib/po-tax";
import { formatPoMoney, normalizePoCurrency } from "@/lib/po-currency";

export const PO_REVISION_ROLES = ["purchasing", "moderator"] as const;

export function canRevisePO(roleNames: string[]): boolean {
  const names = roleNames.map((r) => (r || "").trim().toLowerCase());
  return PO_REVISION_ROLES.some((r) => names.includes(r));
}

export type PoRevisionItemSnapshot = {
  id: number;
  part_id: number | null;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  qty_received: number;
  harga: number;
  vendor_id: number | null;
  vendor_name: string | null;
  pr_item_id: number | null;
  pr_kode: string | null;
  so_item_id: number | null;
};

export type PoRevisionSnapshot = {
  po_kode: string;
  po_tanggal: string | null;
  po_estimasi: string | null;
  po_payment_term: string | null;
  po_keterangan: string | null;
  po_currency: string;
  po_harga_termasuk_pajak: boolean;
  po_ppn_mode: string;
  po_ppn_rate: number;
  po_ppn_amount: number;
  po_diskon_mode: string;
  po_diskon_value: number;
  po_ongkir: number;
  po_pph_type: string | null;
  po_pph_mode: string;
  po_pph_rate: number;
  po_pph_amount: number;
  po_pr_referensi: string | null;
  po_status: string;
  po_revision: number;
  pr_kodes: string[];
  total_po: number;
  items: PoRevisionItemSnapshot[];
  approvals: any[];
};

export type PoRevisionFieldChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export type PoRevisionItemChange = {
  part_number: string;
  part_name: string;
  pr_kode: string | null;
  changes: PoRevisionFieldChange[];
};

export type PoRevisionChanges = {
  header: PoRevisionFieldChange[];
  prs: { added: string[]; removed: string[] };
  items: {
    added: PoRevisionItemSnapshot[];
    removed: PoRevisionItemSnapshot[];
    changed: PoRevisionItemChange[];
  };
  totals: { before: number; after: number; currency: string };
};

const num = (v: any) => Number(v) || 0;

/** Bangun snapshot dari baris pos + po_items (sudah di-join vendor & PR). */
export function buildPoRevisionSnapshot(po: any, items: any[]): PoRevisionSnapshot {
  const itemSnaps: PoRevisionItemSnapshot[] = (items || [])
    .map((i: any) => ({
      id: i.id,
      part_id: i.part_id ?? null,
      part_number: i.part_number || "",
      part_name: i.part_name || "",
      satuan: i.satuan || "",
      qty: num(i.qty),
      qty_received: num(i.qty_received),
      harga: num(i.harga),
      vendor_id: i.vendor_id ?? null,
      vendor_name: i.vendor_name ?? i.vendors?.vendor_name ?? null,
      pr_item_id: i.pr_item_id ?? null,
      pr_kode: i.pr_kode ?? null,
      so_item_id: i.so_item_id ?? null,
    }))
    .sort((a, b) => a.id - b.id);

  const subtotal = itemSnaps.reduce((s, i) => s + i.qty * i.harga, 0);
  const pphType = po.po_pph_type || null;
  const totals = computePoTotals({
    subtotal,
    diskonMode: po.po_diskon_mode === "amount" ? "amount" : "percent",
    diskonValue: num(po.po_diskon_value),
    hargaTermasukPajak: Boolean(po.po_harga_termasuk_pajak),
    ppnMode: po.po_ppn_mode === "amount" ? "amount" : "percent",
    ppnRate: num(po.po_ppn_rate),
    ppnAmountManual: num(po.po_ppn_amount),
    ongkir: num(po.po_ongkir),
    pphMode: po.po_pph_mode === "amount" ? "amount" : "percent",
    pphRate: pphType ? num(po.po_pph_rate) : 0,
    pphAmountManual: pphType ? num(po.po_pph_amount) : 0,
  });

  return {
    po_kode: po.po_kode,
    po_tanggal: po.po_tanggal ?? null,
    po_estimasi: po.po_estimasi ?? null,
    po_payment_term: po.po_payment_term ?? null,
    po_keterangan: po.po_keterangan ?? null,
    po_currency: normalizePoCurrency(po.po_currency),
    po_harga_termasuk_pajak: Boolean(po.po_harga_termasuk_pajak),
    po_ppn_mode: po.po_ppn_mode || "percent",
    po_ppn_rate: num(po.po_ppn_rate),
    po_ppn_amount: num(po.po_ppn_amount),
    po_diskon_mode: po.po_diskon_mode || "percent",
    po_diskon_value: num(po.po_diskon_value),
    po_ongkir: num(po.po_ongkir),
    po_pph_type: pphType,
    po_pph_mode: po.po_pph_mode || "percent",
    po_pph_rate: num(po.po_pph_rate),
    po_pph_amount: num(po.po_pph_amount),
    po_pr_referensi: po.po_pr_referensi ?? null,
    po_status: po.po_status,
    po_revision: num(po.po_revision),
    pr_kodes: Array.from(
      new Set(itemSnaps.map((i) => i.pr_kode).filter((k): k is string => Boolean(k))),
    ).sort(),
    total_po: totals.totalPo,
    items: itemSnaps,
    approvals: po.approvals || [],
  };
}

const text = (v: any) => (v === null || v === undefined || v === "" ? "-" : String(v));

function headerFields(s: PoRevisionSnapshot) {
  const money = (v: number) => formatPoMoney(v, s.po_currency as any);
  const rate = (mode: string, pct: number, amt: number) =>
    mode === "amount" ? money(amt) : `${pct}%`;
  return [
    { field: "po_kode", label: "Kode PO", value: text(s.po_kode), price: false },
    { field: "po_tanggal", label: "Tanggal PO", value: text(s.po_tanggal), price: false },
    { field: "po_estimasi", label: "Estimasi Terima", value: text(s.po_estimasi), price: false },
    { field: "po_payment_term", label: "Payment Term", value: text(s.po_payment_term), price: false },
    { field: "po_keterangan", label: "Keterangan", value: text(s.po_keterangan), price: false },
    { field: "po_pr_referensi", label: "Referensi PR", value: text(s.po_pr_referensi), price: false },
    { field: "po_currency", label: "Mata Uang", value: s.po_currency, price: true },
    {
      field: "po_harga_termasuk_pajak",
      label: "Harga Termasuk Pajak",
      value: s.po_harga_termasuk_pajak ? "Ya" : "Tidak",
      price: true,
    },
    {
      field: "po_ppn",
      label: "PPN",
      value: rate(s.po_ppn_mode, s.po_ppn_rate, s.po_ppn_amount),
      price: true,
    },
    {
      field: "po_diskon",
      label: "Diskon",
      value: s.po_diskon_mode === "amount" ? money(s.po_diskon_value) : `${s.po_diskon_value}%`,
      price: true,
    },
    { field: "po_ongkir", label: "Ongkos Kirim", value: money(s.po_ongkir), price: true },
    {
      field: "po_pph",
      label: "PPh",
      value: s.po_pph_type
        ? `${getPphTypeLabel(s.po_pph_type)} — ${rate(s.po_pph_mode, s.po_pph_rate, s.po_pph_amount)}`
        : "Tanpa PPh",
      price: true,
    },
    {
      field: "vendor",
      label: "Vendor",
      value: text(
        Array.from(new Set(s.items.map((i) => i.vendor_name).filter(Boolean))).join(", "),
      ),
      price: false,
    },
  ];
}

/** Field header yang mengandung info harga — disembunyikan untuk non-purchasing. */
export const PO_REVISION_PRICE_FIELDS = new Set(
  ["po_currency", "po_harga_termasuk_pajak", "po_ppn", "po_diskon", "po_ongkir", "po_pph", "harga"],
);

// Kunci pencocokan item sebelum/sesudah: id po_items (item lama dipertahankan
// id-nya saat revisi, item baru dapat id baru).
export function diffPoRevision(
  before: PoRevisionSnapshot,
  after: PoRevisionSnapshot,
): PoRevisionChanges {
  const bh = headerFields(before);
  const ah = headerFields(after);
  const header: PoRevisionFieldChange[] = [];
  for (const b of bh) {
    const a = ah.find((x) => x.field === b.field)!;
    if (a.value !== b.value) {
      header.push({ field: b.field, label: b.label, before: b.value, after: a.value });
    }
  }

  const beforeById = new Map(before.items.map((i) => [i.id, i]));
  const afterById = new Map(after.items.map((i) => [i.id, i]));
  const added = after.items.filter((i) => !beforeById.has(i.id));
  const removed = before.items.filter((i) => !afterById.has(i.id));
  const changed: PoRevisionItemChange[] = [];
  for (const a of after.items) {
    const b = beforeById.get(a.id);
    if (!b) continue;
    const changes: PoRevisionFieldChange[] = [];
    if (b.qty !== a.qty)
      changes.push({ field: "qty", label: "Qty", before: String(b.qty), after: String(a.qty) });
    if (b.harga !== a.harga)
      changes.push({
        field: "harga",
        label: "Harga",
        before: formatPoMoney(b.harga, before.po_currency as any),
        after: formatPoMoney(a.harga, after.po_currency as any),
      });
    if (changes.length > 0) {
      changed.push({
        part_number: a.part_number,
        part_name: a.part_name,
        pr_kode: a.pr_kode,
        changes,
      });
    }
  }

  return {
    header,
    prs: {
      added: after.pr_kodes.filter((k) => !before.pr_kodes.includes(k)),
      removed: before.pr_kodes.filter((k) => !after.pr_kodes.includes(k)),
    },
    items: { added, removed, changed },
    totals: { before: before.total_po, after: after.total_po, currency: after.po_currency },
  };
}

/** Ringkasan satu baris untuk notifikasi & daftar. */
export function summarizePoRevision(c: PoRevisionChanges): string {
  const parts: string[] = [];
  if (c.prs.added.length) parts.push(`tambah PR ${c.prs.added.join(", ")}`);
  if (c.prs.removed.length) parts.push(`lepas PR ${c.prs.removed.join(", ")}`);
  if (c.items.added.length) parts.push(`${c.items.added.length} item ditambah`);
  if (c.items.removed.length) parts.push(`${c.items.removed.length} item dihapus`);
  if (c.items.changed.length) parts.push(`${c.items.changed.length} item diubah`);
  if (c.header.length) parts.push(c.header.map((h) => h.label.toLowerCase()).join(", "));
  return parts.length ? parts.join("; ") : "tanpa perubahan data (approval diulang)";
}
