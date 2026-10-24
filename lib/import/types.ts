// Tipe bersama Pusat Import Excel (client: template & parser, server: handler).
// Satu fitur = satu ImportDefinition. Template, sheet Petunjuk, dropdown,
// validasi tipe & parser semuanya dibentuk dari definisi ini, jadi menambah
// kolom cukup di registry.ts.

export type ImportColumnType = "text" | "int" | "number" | "date" | "enum" | "bool";

/** Daftar referensi dari DB, dipakai untuk dropdown di template. */
export type ImportRefKind =
  | "cabang"
  | "customer"
  | "customer_consignment"
  | "vendor"
  | "satuan";

export type ImportColumn = {
  key: string;
  header: string;
  type: ImportColumnType;
  /** Wajib diisi (tanda * di judul kolom). */
  required?: boolean;
  /** Penjelasan untuk sheet Petunjuk & catatan di judul kolom. */
  description: string;
  example?: string | number;
  /** Nilai baku untuk type enum (yang tertulis di Excel). */
  enumValues?: string[];
  /** Alias tambahan untuk enum/bool (huruf besar/kecil diabaikan) -> nilai baku. */
  aliases?: Record<string, string>;
  /** Dropdown dari daftar referensi DB (nilai lain tetap boleh, cuma diperingatkan). */
  ref?: ImportRefKind;
  /** Batas bawah angka (int/number). */
  min?: number;
  /** Kolom informasi saja (ikut di template isi-data, diabaikan saat upload). */
  infoOnly?: boolean;
  /** Label grup di baris judul atas (mis. "DOKUMEN", "BARANG"). */
  group?: string;
  width?: number;
};

type OptionBase = {
  key: string;
  label: string;
  description?: string;
  /** Hanya tampil (dan berlaku) kalau opsi lain bernilai tertentu. */
  visibleWhen?: { key: string; value: string };
};

export type ImportOption =
  | (OptionBase & {
      type: "select";
      choices: { value: string; label: string; description?: string }[];
      default: string;
    })
  | (OptionBase & { type: "bool"; default: boolean })
  | (OptionBase & {
      type: "approval_template";
      /** approval_templates.type */
      templateType: string;
      /** Hanya wajib kalau opsi lain bernilai tertentu (mis. mode=normal). */
      requiredWhen?: { key: string; value: string };
    });

export type ImportPrefillMode = { value: string; label: string; description?: string };

export type ImportCategory = "master" | "update" | "dokumen";

export type ImportDefinition = {
  key: string;
  title: string;
  category: ImportCategory;
  /** Ringkasan 1–2 kalimat (kartu & Petunjuk). */
  summary: string;
  /** Apa yang terjadi saat file diproses. */
  effects: string[];
  /** Aturan pengisian penting. */
  rules: string[];
  sheetName: string;
  columns: ImportColumn[];
  /**
   * Kolom pembentuk 1 dokumen (header + beberapa baris barang). Baris dengan
   * nilai kolom ini sama = 1 dokumen. Kosong = 1 baris = 1 data.
   */
  docKey?: string[];
  /** Kolom header dokumen: harus sama di semua baris 1 dokumen. */
  docHeader?: string[];
  /** Kolom yang tidak boleh dobel dalam 1 file (selain dokumen). */
  uniqueKey?: string[];
  /**
   * Kolom pengelompok batch (baris bernilai sama selalu dikirim ke server
   * dalam 1 batch) untuk import baris-per-baris yang tetap butuh konteks
   * kelompok, mis. barang-barang 1 SPB.
   */
  groupKey?: string[];
  /** Contoh pengisian untuk sheet Contoh (default: 1 baris dari example kolom). */
  examples?: Record<string, string | number>[];
  options?: ImportOption[];
  /** Template bisa diisi data saat ini (download -> edit -> upload). */
  prefill?: { modes: ImportPrefillMode[]; withCabangFilter?: boolean };
  /** Halaman fitur terkait (link). */
  route?: string;
  /** Jumlah dokumen/baris per panggilan server saat proses (default 300 baris). */
  commitBatch?: number;
};

/** Baris hasil parse (nilai sudah sesuai tipe kolom). */
export type ImportRow = {
  row: number;
  values: Record<string, string | number | boolean | null>;
};

export type ImportRowStatus = "create" | "update" | "skip" | "error";

export type ImportRowResult = {
  row: number;
  status: ImportRowStatus;
  message?: string;
  warnings?: string[];
  /** Kode dokumen / kunci data (untuk tampilan & laporan). */
  ref?: string;
};

export type ImportOptionValues = Record<string, string | boolean | number | null>;

export type ImportRefs = Partial<Record<ImportRefKind, string[]>> & {
  approvalTemplates?: Record<string, { id: number; name: string; cabang: string | null }[]>;
};
