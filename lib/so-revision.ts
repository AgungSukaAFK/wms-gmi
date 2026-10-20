// Edit SO Reguler: bentuk snapshot yang disimpan fungsi DB update_so_reguler
// (public._so_reguler_snapshot) di so_reguler_revisions, plus diff untuk
// "Riwayat Perubahan" di detail SO. Diff dihitung di sini dari snapshot
// sebelum & sesudah (tidak disimpan di DB).

export type SoSnapshotItem = {
  id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  remarks: string | null;
};

export type SoSnapshot = {
  so_kode: string;
  so_tanggal: string | null;
  so_due_date: string | null;
  kategori: string | null;
  customer_id: number;
  customer_name: string | null;
  customer_po_no: string | null;
  customer_po_date: string | null;
  customer_po_received_date: string | null;
  marketing_name: string | null;
  remarks: string | null;
  so_status: string;
  so_revision: number;
  items: SoSnapshotItem[];
};

export type SoFieldChange = { label: string; before: string; after: string };

export type SoRevisionDiff = {
  header: SoFieldChange[];
  added: SoSnapshotItem[];
  removed: SoSnapshotItem[];
  changed: { part_number: string; part_name: string; changes: SoFieldChange[] }[];
};

const HEADER_FIELDS: { key: keyof SoSnapshot; label: string }[] = [
  { key: "so_kode", label: "Nomor SO" },
  { key: "so_tanggal", label: "Tanggal SO" },
  { key: "so_due_date", label: "Deadline" },
  { key: "kategori", label: "Kategori" },
  { key: "customer_name", label: "Customer" },
  { key: "customer_po_no", label: "Nomor PO Customer" },
  { key: "customer_po_date", label: "Tgl PO Dibuat Customer" },
  { key: "customer_po_received_date", label: "Tgl PO Diterima via Email" },
  { key: "marketing_name", label: "Nama Marketing" },
  { key: "remarks", label: "Keterangan" },
];

const show = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

export function diffSoSnapshots(
  before: SoSnapshot,
  after: SoSnapshot,
): SoRevisionDiff {
  const header: SoFieldChange[] = [];
  for (const { key, label } of HEADER_FIELDS) {
    // Customer: bandingkan id-nya (nama bisa sama untuk akun berbeda).
    const changed =
      key === "customer_name"
        ? before.customer_id !== after.customer_id
        : show(before[key]) !== show(after[key]);
    if (changed)
      header.push({ label, before: show(before[key]), after: show(after[key]) });
  }

  const beforeById = new Map(before.items.map((i) => [i.id, i]));
  const afterIds = new Set(after.items.map((i) => i.id));
  const added = after.items.filter((i) => !beforeById.has(i.id));
  const removed = before.items.filter((i) => !afterIds.has(i.id));
  const changed: SoRevisionDiff["changed"] = [];
  for (const a of after.items) {
    const b = beforeById.get(a.id);
    if (!b) continue;
    const changes: SoFieldChange[] = [];
    if (b.qty !== a.qty)
      changes.push({ label: "Qty", before: show(b.qty), after: show(a.qty) });
    if (show(b.remarks) !== show(a.remarks))
      changes.push({
        label: "Catatan",
        before: show(b.remarks),
        after: show(a.remarks),
      });
    if (changes.length)
      changed.push({
        part_number: a.part_number,
        part_name: a.part_name,
        changes,
      });
  }
  return { header, added, removed, changed };
}
