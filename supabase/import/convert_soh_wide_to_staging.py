#!/usr/bin/env python3
"""Convert wide SOH CSV (one row per part, many branch columns) to staging import CSV.

Input example header:
No. Barang;Deskripsi Barang;GMI-HO;GMI-BPP;...

Output columns:
batch_code,part_number,nama_cabang,qty,source_row
"""

from __future__ import annotations

import csv
import math
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path


def parse_decimal_id(value: str, decimal_policy: str) -> int:
    """Parse Indonesian numeric style into integer qty with configurable decimal handling."""
    raw = (value or "").strip()
    if raw == "":
        return 0

    # Handle common Indonesian formatting: 1.234,00
    normalized = raw.replace(".", "").replace(",", ".")
    try:
        d = Decimal(normalized)
    except InvalidOperation as exc:
        raise ValueError(f"invalid qty: {value!r}") from exc

    if d != d.to_integral_value():
        if decimal_policy == "error":
            raise ValueError(f"qty is not integer: {value!r}")
        if decimal_policy == "round":
            return int(d.to_integral_value(rounding="ROUND_HALF_UP"))
        if decimal_policy == "floor":
            return math.floor(float(d))
        raise ValueError(f"unknown decimal policy: {decimal_policy}")

    return int(d)


def main() -> int:
    if len(sys.argv) < 4:
        print(
            "Usage: python3 convert_soh_wide_to_staging.py <input_csv> <output_csv> <batch_code> [decimal_policy]",
            file=sys.stderr,
        )
        print("decimal_policy: error | round | floor (default: error)", file=sys.stderr)
        return 2

    input_csv = Path(sys.argv[1])
    output_csv = Path(sys.argv[2])
    batch_code = sys.argv[3]
    decimal_policy = (sys.argv[4].strip().lower() if len(sys.argv) >= 5 else "error")

    if not input_csv.exists():
        print(f"Input file not found: {input_csv}", file=sys.stderr)
        return 1

    with input_csv.open("r", encoding="utf-8-sig", newline="") as f:
        # Source file uses semicolon delimiter
        reader = csv.reader(f, delimiter=";")
        rows = list(reader)

    if len(rows) < 2:
        print("Input CSV does not contain enough rows", file=sys.stderr)
        return 1

    # Find header row where first 2 columns are expected names
    header_idx = None
    for i, row in enumerate(rows[:20]):
        c0 = (row[0].strip() if len(row) > 0 else "").lower()
        c1 = (row[1].strip() if len(row) > 1 else "").lower()
        if c0 in {"no. barang", "part_number", "part number"} and c1 in {
            "deskripsi barang",
            "part_name",
            "part name",
        }:
            header_idx = i
            break

    if header_idx is None:
        print("Could not find valid header row", file=sys.stderr)
        return 1

    header = rows[header_idx]
    data_rows = rows[header_idx + 1 :]

    # Branch columns are from index 2 until before summary column like SUM SOH
    branch_cols: list[tuple[int, str]] = []
    for idx, col in enumerate(header[2:], start=2):
        name = col.strip()
        if name == "":
            continue
        if name.upper().startswith("SUM"):
            break
        branch_cols.append((idx, name))

    if not branch_cols:
        print("No branch columns detected", file=sys.stderr)
        return 1

    output_csv.parent.mkdir(parents=True, exist_ok=True)

    if decimal_policy not in {"error", "round", "floor"}:
        print(f"Invalid decimal policy: {decimal_policy}", file=sys.stderr)
        return 2

    out_count = 0
    fractional_cells = 0
    with output_csv.open("w", encoding="utf-8", newline="") as fo:
        writer = csv.writer(fo)
        writer.writerow(["batch_code", "part_number", "nama_cabang", "qty", "source_row"])

        for i, row in enumerate(data_rows, start=header_idx + 2):
            if not row:
                continue

            part_number = (row[0].strip() if len(row) > 0 else "")
            if part_number == "":
                continue

            for col_idx, cabang_name in branch_cols:
                raw_qty = row[col_idx].strip() if len(row) > col_idx else ""
                normalized = raw_qty.replace(".", "").replace(",", ".") if raw_qty else "0"
                try:
                    d = Decimal(normalized)
                    if d != d.to_integral_value():
                        fractional_cells += 1
                except InvalidOperation:
                    pass

                qty = parse_decimal_id(raw_qty, decimal_policy)
                writer.writerow([batch_code, part_number, cabang_name, qty, i])
                out_count += 1

    print(f"Converted rows: {out_count}")
    print(f"Output: {output_csv}")
    print(f"Detected branch columns: {len(branch_cols)}")
    print(f"Fractional source cells detected: {fractional_cells}")
    print(f"Decimal policy used: {decimal_policy}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
