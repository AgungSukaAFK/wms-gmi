"""
Convert Data Vendor.xls → vendors_seed.sql
Mapping kolom Excel:
  col 1 → vendor_no    (No Pemasok)
  col 3 → vendor_name  (Nama Pemasok)
  col 5 → telephone    (Telepon)
  col 7 → contact_name (Nama kontak)
  col 9 → address      (Alamat 1)
"""

import xlrd
import os

XLS_PATH = os.path.join(os.path.dirname(__file__), "Data Vendor.xls")
OUT_PATH = os.path.join(os.path.dirname(__file__), "vendors_seed.sql")

DATA_START_ROW = 5  # row 0-3 = title, row 4 = headers


def clean(val) -> str:
    """Convert cell value to clean string, None if empty."""
    s = str(val).strip() if val not in (None, "") else ""
    # xlrd stores numbers as float, e.g. '81216169733.0' → '81216169733'
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    return s or None


def escape(val) -> str:
    if val is None:
        return "NULL"
    escaped = val.replace("'", "''")
    return f"'{escaped}'"


def main():
    wb = xlrd.open_workbook(XLS_PATH)
    sh = wb.sheet_by_index(0)

    rows = []
    skipped = 0
    for r in range(DATA_START_ROW, sh.nrows):
        vendor_no = clean(sh.cell_value(r, 1))
        vendor_name = clean(sh.cell_value(r, 3))

        if not vendor_no or not vendor_name:
            skipped += 1
            continue

        telephone = clean(sh.cell_value(r, 5))
        contact_name = clean(sh.cell_value(r, 7))
        address = clean(sh.cell_value(r, 9))

        rows.append((vendor_no, vendor_name, telephone, contact_name, address))

    print(f"Rows to insert : {len(rows)}")
    print(f"Rows skipped   : {skipped}")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("-- Auto-generated from Data Vendor.xls\n")
        f.write("-- Run this on Supabase local OR VPS\n\n")
        f.write("INSERT INTO public.vendors\n")
        f.write("  (vendor_no, vendor_name, telephone, contact_name, address, is_active)\n")
        f.write("VALUES\n")

        for i, (vno, vname, tel, contact, addr) in enumerate(rows):
            comma = "," if i < len(rows) - 1 else ";"
            f.write(
                f"  ({escape(vno)}, {escape(vname)}, {escape(tel)}, {escape(contact)}, {escape(addr)}, TRUE){comma}\n"
            )

        f.write("\n-- Verification query\n")
        f.write("-- SELECT COUNT(*) FROM public.vendors;\n")

    print(f"Output: {OUT_PATH}")


if __name__ == "__main__":
    main()
