// Level progres MR: 10 status resmi (OPEN 1/2/3A/3B/3C/4/5, CLOSE 1/2A/2B)
// yang dipakai tim untuk memantau MR secara manual.
//
// Sebagian bisa dipastikan otomatis dari data yang sudah ada di sistem
// (mr_convert_status, keberadaan PO, qty_received vs qty_request). Sisanya
// tergantung info yang tidak dimodelkan sistem (payment issue vendor, budget
// approval, barang tiba WH vs dikirim ke site, dokumen terkirim ke HO via
// email) — untuk itu sistem menampilkan rentang ("OPEN 3-5", "CLOSE 2") dan
// moderator bisa mengoreksi manual ke salah satu dari 10 status resmi
// (kolom mrs.manual_level, lihat migration mr_manual_level).

export type MrLevelCode =
  | "OPEN_1"
  | "OPEN_2"
  | "OPEN_3A"
  | "OPEN_3B"
  | "OPEN_3C"
  | "OPEN_4"
  | "OPEN_5"
  | "CLOSE_1"
  | "CLOSE_2A"
  | "CLOSE_2B";

export interface MrLevelDefinition {
  code: MrLevelCode;
  label: string;
  group: "OPEN" | "CLOSE";
  description: string;
}

export const MR_LEVEL_DEFINITIONS: MrLevelDefinition[] = [
  {
    code: "OPEN_1",
    label: "OPEN 1",
    group: "OPEN",
    description: "PR belum dibuat.",
  },
  {
    code: "OPEN_2",
    label: "OPEN 2",
    group: "OPEN",
    description: "PO/WO belum dibuat.",
  },
  {
    code: "OPEN_3A",
    label: "OPEN 3A",
    group: "OPEN",
    description:
      "Budget sudah approved, vendor belum kirim, tidak ada payment issue.",
  },
  {
    code: "OPEN_3B",
    label: "OPEN 3B",
    group: "OPEN",
    description: "Budget sudah approved, vendor belum kirim, ada payment issue.",
  },
  {
    code: "OPEN_3C",
    label: "OPEN 3C",
    group: "OPEN",
    description: "PO sudah dibuat, budget belum approved.",
  },
  {
    code: "OPEN_4",
    label: "OPEN 4",
    group: "OPEN",
    description: "Vendor sudah kirim, tetapi belum diterima warehouse HO/branch.",
  },
  {
    code: "OPEN_5",
    label: "OPEN 5",
    group: "OPEN",
    description: "Sudah diterima warehouse, tetapi belum ada pengiriman ke site.",
  },
  {
    code: "CLOSE_1",
    label: "CLOSE 1",
    group: "CLOSE",
    description:
      "Sudah ada pengiriman ke site (full/partial), tetapi MR belum terpenuhi 100%.",
  },
  {
    code: "CLOSE_2A",
    label: "CLOSE 2A",
    group: "CLOSE",
    description: "Qty received >= qty MR, tetapi belum kirim IT via email.",
  },
  {
    code: "CLOSE_2B",
    label: "CLOSE 2B",
    group: "CLOSE",
    description: "Qty received >= qty MR, sudah kirim IT via email.",
  },
];

export const MR_LEVEL_BY_CODE: Record<MrLevelCode, MrLevelDefinition> =
  Object.fromEntries(MR_LEVEL_DEFINITIONS.map((d) => [d.code, d])) as Record<
    MrLevelCode,
    MrLevelDefinition
  >;

export const MR_LEVEL_BADGE_CLASS: Record<MrLevelCode, string> = {
  OPEN_1: "bg-muted text-muted-foreground border-border",
  OPEN_2: "bg-amber-100 text-amber-700 border-amber-300",
  OPEN_3A: "bg-orange-100 text-orange-700 border-orange-300",
  OPEN_3B: "bg-red-100 text-red-700 border-red-300",
  OPEN_3C: "bg-red-100 text-red-700 border-red-300",
  OPEN_4: "bg-sky-100 text-sky-700 border-sky-300",
  OPEN_5: "bg-blue-100 text-blue-700 border-blue-300",
  CLOSE_1: "bg-orange-100 text-orange-700 border-orange-300",
  CLOSE_2A: "bg-lime-100 text-lime-700 border-lime-300",
  CLOSE_2B: "bg-success/10 text-success border-success/30",
};

// Threshold yang menentukan bucket otomatis mana yang dipilih. Disimpan di
// tabel mr_level_auto_rules (singleton, id=1) dan bisa diubah moderator lewat
// /mr-level-settings — lihat migration mr_level_auto_rules. Default di bawah
// ini persis meniru perilaku hardcoded sebelum fitur ini ada, dipakai sebagai
// fallback selama data dari DB belum termuat / gagal fetch.
export interface MrLevelAutoRules {
  pendingConvertStatuses: string[];
  closeStartMinReceivedPct: number;
  closeDoneMinReceivedPct: number;
}

export const DEFAULT_MR_LEVEL_AUTO_RULES: MrLevelAutoRules = {
  pendingConvertStatuses: ["pending"],
  closeStartMinReceivedPct: 0,
  closeDoneMinReceivedPct: 100,
};

// Bucket yang bisa dipastikan otomatis oleh sistem. OPEN_3_5 dan CLOSE_2
// adalah rentang (sistem tidak bisa memastikan sub-statusnya tanpa info
// payment/budget/WH-site/email) — bukan salah satu dari 10 MrLevelCode resmi.
export type MrAutoBucket = "OPEN_1" | "OPEN_2" | "OPEN_3_5" | "CLOSE_1" | "CLOSE_2";

export const MR_AUTO_BUCKET_LABEL: Record<MrAutoBucket, string> = {
  OPEN_1: "OPEN 1",
  OPEN_2: "OPEN 2",
  OPEN_3_5: "OPEN 3-5",
  CLOSE_1: "CLOSE 1",
  CLOSE_2: "CLOSE 2",
};

export const MR_AUTO_BUCKET_BADGE_CLASS: Record<MrAutoBucket, string> = {
  OPEN_1: "bg-muted text-muted-foreground border-border",
  OPEN_2: "bg-amber-100 text-amber-700 border-amber-300",
  OPEN_3_5: "bg-sky-100 text-sky-700 border-sky-300",
  CLOSE_1: "bg-orange-100 text-orange-700 border-orange-300",
  CLOSE_2: "bg-success/10 text-success border-success/30",
};

export function computeMrAutoBucket(
  input: {
    mrConvertStatus: string | null | undefined;
    hasPo: boolean;
    qtyRequestTotal: number;
    qtyReceivedTotal: number;
  },
  rules: MrLevelAutoRules = DEFAULT_MR_LEVEL_AUTO_RULES,
): MrAutoBucket {
  const { mrConvertStatus, hasPo, qtyRequestTotal, qtyReceivedTotal } = input;
  const receivedPct =
    qtyRequestTotal > 0 ? (qtyReceivedTotal / qtyRequestTotal) * 100 : 0;

  if (qtyRequestTotal > 0 && receivedPct >= rules.closeDoneMinReceivedPct) {
    return "CLOSE_2";
  }
  if (qtyReceivedTotal > 0 && receivedPct >= rules.closeStartMinReceivedPct) {
    return "CLOSE_1";
  }
  if (!mrConvertStatus || rules.pendingConvertStatuses.includes(mrConvertStatus)) {
    return "OPEN_1";
  }
  if (!hasPo) {
    return "OPEN_2";
  }
  return "OPEN_3_5";
}

export interface MrLevelDisplay {
  label: string;
  badgeClass: string;
  isManual: boolean;
  description?: string;
  manualNote?: string | null;
}

// Resolusi tampilan akhir: override manual (bila ada & valid) menang atas
// hasil hitung otomatis.
export function resolveMrLevelDisplay(input: {
  manualLevel?: string | null;
  manualNote?: string | null;
  autoBucket: MrAutoBucket;
}): MrLevelDisplay {
  const manualDef = input.manualLevel
    ? MR_LEVEL_BY_CODE[input.manualLevel as MrLevelCode]
    : undefined;

  if (manualDef) {
    return {
      label: manualDef.label,
      badgeClass: MR_LEVEL_BADGE_CLASS[manualDef.code],
      isManual: true,
      description: manualDef.description,
      manualNote: input.manualNote,
    };
  }

  return {
    label: MR_AUTO_BUCKET_LABEL[input.autoBucket],
    badgeClass: MR_AUTO_BUCKET_BADGE_CLASS[input.autoBucket],
    isManual: false,
  };
}
