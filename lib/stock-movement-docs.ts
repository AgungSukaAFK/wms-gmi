// Resolve dokumen sumber untuk baris stock_movements (riwayat di detail stok).
//
// stock_movements cuma nyimpan `type` + `reference_id` (kode dokumen, teks
// bebas), tanpa FK. Helper ini memetakan type -> tabel dokumen, lalu ambil
// tanggal dibuat, tanggal dokumen, status, dan tanggal full approve (max
// processed_at saat semua step approvals JSONB sudah "approved").

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (table: string) => any };
type DocRow = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type DocKind =
  | "spb"
  | "return_spb"
  | "receive"
  | "pr"
  | "mr"
  | "delivery"
  | "item_transfer"
  | "ik"
  | "do_reguler"
  | "working_order"
  | "job_costing"
  | "penerimaan";

export interface ApprovalInfo {
  state: "none" | "approved" | "pending" | "rejected";
  approvedCount: number;
  totalCount: number;
  // Waktu step terakhir di-approve (hanya saat state = approved).
  fullApprovedAt: string | null;
  pendingName: string | null;
}

export interface MovementDoc {
  kind: DocKind;
  kindLabel: string;
  kode: string;
  createdAt: string | null;
  docDate: string | null;
  status: string | null;
  approval: ApprovalInfo;
  href: string | null;
}

interface DocSource {
  kind: DocKind;
  label: string;
  table: string;
  codeCol: string;
  dateCol: string | null;
  statusCol: string | null;
  hasApprovals: boolean;
  href: (row: DocRow) => string | null;
}

const SOURCES: Record<DocKind, DocSource> = {
  spb: {
    kind: "spb", label: "SPB", table: "spb", codeCol: "spb_no",
    dateCol: "spb_tanggal", statusCol: "spb_status", hasApprovals: true,
    href: () => "/spb",
  },
  return_spb: {
    kind: "return_spb", label: "Return SPB", table: "return_spb", codeCol: "rtn_kode",
    dateCol: "rtn_tanggal", statusCol: "rtn_status", hasApprovals: true,
    href: () => "/return-spb",
  },
  receive: {
    kind: "receive", label: "Receive Item", table: "receives", codeCol: "ri_kode",
    dateCol: "ri_tanggal", statusCol: "ri_status", hasApprovals: true,
    href: () => "/receive",
  },
  pr: {
    kind: "pr", label: "PR", table: "prs", codeCol: "pr_kode",
    dateCol: "pr_tanggal", statusCol: "pr_status", hasApprovals: true,
    href: (r) => `/pr/${r.id}`,
  },
  mr: {
    kind: "mr", label: "MR", table: "mrs", codeCol: "mr_kode",
    dateCol: "mr_tanggal", statusCol: "mr_status", hasApprovals: true,
    href: (r) => `/mr/${r.id}`,
  },
  delivery: {
    kind: "delivery", label: "Delivery", table: "deliveries", codeCol: "dlv_kode",
    dateCol: null, statusCol: "status", hasApprovals: false,
    href: () => "/deliveries",
  },
  item_transfer: {
    kind: "item_transfer", label: "Item Transfer", table: "item_transfers", codeCol: "it_kode",
    dateCol: "it_tanggal", statusCol: "status", hasApprovals: true,
    href: (r) => `/item-transfer/${r.id}`,
  },
  ik: {
    kind: "ik", label: "Invoice Konsinyasi", table: "consignment_ik", codeCol: "ik_kode",
    dateCol: "ik_tanggal", statusCol: null, hasApprovals: false,
    href: () => "/so-reguler/consignment/ik",
  },
  do_reguler: {
    kind: "do_reguler", label: "DO Reguler", table: "do_reguler", codeCol: "do_kode",
    dateCol: "do_tanggal", statusCol: "status", hasApprovals: false,
    href: () => "/so-reguler/do",
  },
  working_order: {
    kind: "working_order", label: "Working Order", table: "working_orders", codeCol: "wo_kode",
    dateCol: "wo_tanggal", statusCol: "wo_status", hasApprovals: true,
    href: (r) => `/working-order/${r.id}`,
  },
  job_costing: {
    kind: "job_costing", label: "Job Costing", table: "job_costing", codeCol: "job_kode",
    dateCol: null, statusCol: "status", hasApprovals: false,
    href: () => "/job-costing",
  },
  penerimaan: {
    kind: "penerimaan", label: "Penerimaan Konsinyasi", table: "consignment_penerimaan",
    codeCol: "penerimaan_kode", dateCol: "tanggal_terima", statusCol: null,
    hasApprovals: false,
    href: () => "/so-reguler/consignment/penerimaan",
  },
};

// Tipe mutasi -> kandidat tabel dokumen, urut prioritas. Tipe lama "PR"/"SS"
// dulu dipakai juga oleh receive, jadi kandidatnya lebih dari satu.
function candidatesForType(type: string): DocKind[] {
  if (type.startsWith("SPB_RETURN")) return ["return_spb"];
  if (type.startsWith("SPB_")) return ["spb"];
  if (type.startsWith("WO_")) return ["working_order"];
  if (type.startsWith("JC_")) return ["job_costing"];
  switch (type) {
    case "RI":
      return ["receive"];
    case "PR":
      return ["receive", "pr"];
    case "SS":
      return ["delivery", "receive", "mr"];
    case "IT":
      return ["item_transfer"];
    case "IK":
      return ["ik"];
    case "DO_REG":
      return ["do_reguler"];
    case "PENERIMAAN_KONSINYASI":
      return ["penerimaan"];
    default:
      return [];
  }
}

// Bypass Share Stock pakai ref "BYPASS-<mr_kode>".
function lookupCode(type: string, ref: string): string {
  if (type === "SS" && ref.startsWith("BYPASS-")) return ref.slice(7);
  return ref;
}

export function summarizeApprovalSteps(approvals: unknown): ApprovalInfo {
  const list = Array.isArray(approvals) ? (approvals as DocRow[]) : [];
  if (list.length === 0) {
    return { state: "none", approvedCount: 0, totalCount: 0, fullApprovedAt: null, pendingName: null };
  }
  const approved = list.filter((a) => a?.status === "approved");
  const rejected = list.some((a) => a?.status === "rejected");
  const pending = list.find((a) => a?.status === "pending");
  const allApproved = approved.length === list.length;
  let fullApprovedAt: string | null = null;
  if (allApproved) {
    for (const a of approved) {
      const t = a?.processed_at;
      if (t && (!fullApprovedAt || t > fullApprovedAt)) fullApprovedAt = t;
    }
  }
  return {
    state: rejected ? "rejected" : allApproved ? "approved" : "pending",
    approvedCount: approved.length,
    totalCount: list.length,
    fullApprovedAt,
    pendingName: pending?.nama || pending?.snapshot?.nama || null,
  };
}

/**
 * Returns Map keyed by `${type}|${reference_id}` -> dokumen sumber.
 * Query per tabel cuma untuk kode yang relevan (1 query per tabel, paralel).
 */
export async function resolveMovementDocs(
  supabase: AnyClient,
  movements: { type: string; reference_id: string | null }[],
): Promise<Map<string, MovementDoc>> {
  const codesByKind = new Map<DocKind, Set<string>>();
  for (const m of movements) {
    if (!m.reference_id) continue;
    const code = lookupCode(m.type, m.reference_id);
    for (const kind of candidatesForType(m.type)) {
      if (!codesByKind.has(kind)) codesByKind.set(kind, new Set());
      codesByKind.get(kind)!.add(code);
    }
  }

  const found = new Map<string, MovementDoc>(); // `${kind}|${code}`
  await Promise.all(
    [...codesByKind.entries()].map(async ([kind, codes]) => {
      const src = SOURCES[kind];
      const cols = [
        "id",
        src.codeCol,
        "created_at",
        src.dateCol,
        src.statusCol,
        src.hasApprovals ? "approvals" : null,
      ].filter(Boolean);
      const { data, error } = await supabase
        .from(src.table)
        .select(cols.join(", "))
        .in(src.codeCol, [...codes]);
      if (error) {
        console.error(`resolveMovementDocs ${src.table}:`, error.message);
        return;
      }
      for (const row of data || []) {
        const code = row[src.codeCol];
        found.set(`${kind}|${code}`, {
          kind,
          kindLabel: src.label,
          kode: code,
          createdAt: row.created_at ?? null,
          docDate: src.dateCol ? (row[src.dateCol] ?? null) : null,
          status: src.statusCol ? (row[src.statusCol] ?? null) : null,
          approval: src.hasApprovals
            ? summarizeApprovalSteps(row.approvals)
            : summarizeApprovalSteps(null),
          href: src.href(row),
        });
      }
    }),
  );

  const result = new Map<string, MovementDoc>();
  for (const m of movements) {
    if (!m.reference_id) continue;
    const code = lookupCode(m.type, m.reference_id);
    for (const kind of candidatesForType(m.type)) {
      const doc = found.get(`${kind}|${code}`);
      if (doc) {
        result.set(`${m.type}|${m.reference_id}`, doc);
        break;
      }
    }
  }
  return result;
}

// Label + warna jenis mutasi buat badge riwayat.
export interface MovementTypeMeta {
  label: string;
  tone: "blue" | "green" | "amber" | "violet" | "rose" | "slate" | "cyan";
}

export function movementTypeMeta(type: string): MovementTypeMeta {
  const map: Record<string, MovementTypeMeta> = {
    RI: { label: "Receive Item", tone: "green" },
    PR: { label: "Receive (PR)", tone: "green" },
    SS: { label: "Share Stock / Delivery", tone: "blue" },
    IT: { label: "Item Transfer", tone: "blue" },
    IK: { label: "Invoice Konsinyasi", tone: "violet" },
    PENERIMAAN_KONSINYASI: { label: "Penerimaan Konsinyasi", tone: "violet" },
    DO_REG: { label: "DO Reguler", tone: "cyan" },
    SPB_OUT: { label: "SPB Keluar", tone: "rose" },
    SPB_CANCEL: { label: "SPB Batal", tone: "slate" },
    SPB_ROLLBACK: { label: "SPB Rollback", tone: "slate" },
    SPB_RETURN: { label: "Return SPB", tone: "green" },
    WO_KOMPONEN: { label: "WO Komponen", tone: "amber" },
    WO_PRODUKSI: { label: "WO Produksi", tone: "amber" },
    WO_KOMPONEN_EDIT: { label: "WO Komponen (Edit)", tone: "amber" },
    WO_PRODUKSI_EDIT: { label: "WO Produksi (Edit)", tone: "amber" },
    JC_OUT: { label: "Job Costing Material", tone: "amber" },
    JC_IN: { label: "Job Costing Finish", tone: "amber" },
    JC_OUT_REVERSE: { label: "Job Costing Reverse", tone: "slate" },
    JC_IN_REVERSE: { label: "Job Costing Reverse", tone: "slate" },
    ADJUSTMENT: { label: "Adjustment", tone: "amber" },
    HM_REPLACEMENT: { label: "Ganti Part HM", tone: "cyan" },
    CASCADE_DELETE: { label: "Hapus Dokumen", tone: "slate" },
  };
  return map[type] ?? { label: type, tone: "slate" };
}
