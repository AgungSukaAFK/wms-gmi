"""
Convert Book1.csv (export ERP: KODE UNIT + Type Unit) → migration seed master Unit.

Format CSV (delimiter ';'):
  col 0   → "Row Labels" (pivot daftar tipe, diabaikan)
  col 7   → kode_unit
  col 8   → tipe_unit

Aturan:
  - Kode "0", "-", "(blank)", "Grand Total" & kosong dilewati (sisa pivot, bukan unit).
  - Unit dengan tipe "(blank)" / "-" / "NOT REGISTERED" / kosong TIDAK diimport
    (permintaan user: unit tanpa tipe terdaftar bukan unit valid).
  - Brand ditebak dari tipe (BRAND_RULES, urutan = prioritas), ditulis HURUF
    BESAR senada data SPB lama. Tipe yang brand-nya tidak bisa dipastikan
    dibiarkan NULL, diisi moderator via UI.

Pakai:
  python3 supabase/import/convert_units_to_sql.py [path/Book1.csv]
"""

import csv
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CSV_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "Book1.csv")
OUT_PATH = os.path.join(
    ROOT, "supabase", "migrations", "20261030110000_units_seed_book1.sql"
)

SKIP_CODES = {"", "0", "-", "(BLANK)", "GRAND TOTAL"}
SKIP_TYPES = {"", "-", "(BLANK)", "NOT REGISTERED"}

# (regex atas tipe_unit UPPERCASE, brand)
BRAND_RULES = [
    (r"^(AROCS|ACTROS|AXOR)\b", "MERCEDES-BENZ"),
    (r"KOMATSU", "KOMATSU"),
    (r"^(WA\d{3}-\d|HB365|FD50AYT|FD30T)", "KOMATSU"),
    (r"^CAT\b", "CATERPILLAR"),
    (r"^(CS79B|C15-|DE\d)", "CATERPILLAR"),
    (r"^FMX\d", "VOLVO"),
    (r"^FM260", "HINO"),
    (r"^[PR]\d{3}\s?[A-Z]", "SCANIA"),
    (r"^IVECO", "IVECO"),
    (r"^(SKT|SRT)\d+|^SYZ\d", "SANY"),
    (r"^SV\d{3}", "SAKAI"),
    (r"^(HILIGHT|HIHLIGHT|XAHS|XAS|QES|GA\d|U 190 PACE)", "ATLAS COPCO"),
    (r"^(MILLER|BIG BLUE)", "MILLER"),
    (r"(SAMSON|HERCULES)", "DIECI"),
    (r"^MHT-X", "MANITOU"),
    (r"^P72\.10", "MERLO"),
    (r"^ZX\d", "HITACHI"),
    (r"^MITSUBISHI", "MITSUBISHI"),
    (r"^HILUX", "TOYOTA"),
    (r"^LT9\b", "JCB"),
    (r"^GR-500", "TADANO"),
]


def brand_for(tipe):
    if not tipe:
        return None
    t = tipe.upper()
    for pattern, brand in BRAND_RULES:
        if re.search(pattern, t):
            return brand
    return None


def sql_str(val):
    if val is None:
        return "NULL"
    return "'" + val.replace("'", "''") + "'"


def main():
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f, delimiter=";"))[1:]

    seen = set()
    units = []
    for r in rows:
        if len(r) < 9:
            continue
        kode = " ".join(r[7].split())
        tipe = " ".join(r[8].split())
        if kode.upper() in SKIP_CODES or tipe.upper() in SKIP_TYPES:
            continue
        if kode.upper() in seen:
            continue
        seen.add(kode.upper())
        units.append((kode, tipe, brand_for(tipe)))

    lines = [
        "-- Migration: Seed master Unit dari Book1.csv (export ERP KODE UNIT + Type Unit)",
        "-- Date: 2026-10-30",
        "-- GENERATED oleh supabase/import/convert_units_to_sql.py -- jangan edit manual.",
        "--   Unit bertipe (blank) / - / NOT REGISTERED tidak diimport.",
        "--   Brand (HURUF BESAR) ditebak dari tipe unit; yang tidak pasti dibiarkan NULL.",
        "--   Idempotent: kode yang sudah ada TIDAK ditimpa (ON CONFLICT DO NOTHING),",
        "--   jadi perubahan moderator di UI aman bila migration di-run ulang.",
        f"--   Total baris: {len(units)}",
        "",
        "INSERT INTO public.units (kode_unit, tipe_unit, brand) VALUES",
    ]
    values = [
        f"  ({sql_str(k)}, {sql_str(t)}, {sql_str(b)})" for k, t, b in units
    ]
    lines.append(",\n".join(values))
    lines.append("ON CONFLICT ((UPPER(kode_unit))) DO NOTHING;")
    lines.append("")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    no_brand = sorted({t for _, t, b in units if t and not b})
    print(f"{len(units)} unit → {OUT_PATH}")
    print(f"tanpa brand: {sum(1 for _, _, b in units if not b)}")
    print(f"tipe tanpa brand ({len(no_brand)}): {no_brand}")


if __name__ == "__main__":
    main()
