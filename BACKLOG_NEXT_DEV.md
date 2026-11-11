# Backlog Development WMS-GMI (Next)

Sumber: catatan meeting/feedback user (dirapikan 2026-11-10, update 2026-11-11).
Status: **Open** = belum dikerjakan · **Partial** = sebagian sudah ada · **Konfirmasi** = desain sudah diusulkan, tinggal dicek user.

## Glosarium & Keputusan (sudah dikonfirmasi)
- **EGI** = penjualan yang di-forecast. Forecast-nya dibuat di fitur forecasting WMS (modul Maintenance → Forecasting AC). Tidak semua forecast benar-benar jadi penjualan.
- **Realisasi forecast** = **SPB sudah dibuat**. Tahap sesudahnya (PO/DO/Invoice) tidak menentukan realisasi.
- **Pencocokan forecast ↔ SPB:** pakai referensi forecast di SPB. Kalau belum ada referensinya, dicocokkan lewat **nomor WO** (`spb.spb_no_wo`).
- **No WO (SPB)** = nomor WO dari customer di SPB (`spb.spb_no_wo`). Dipakai untuk forecast vs realisasi dan analitik per WO.
- **Consumable** = **hanya pencatatan untuk reporting** (tidak mengurangi stok). Diinput di **Job Costing** dan di **Working Order**. Job Costing **tidak** ditambah kolom WO.
- **Web GA** di luar scope backlog ini (catatan untuk sistem lain).

---

## A. Keputusan Desain (diusulkan, mohon dicek)

### A1. No WO di data forecast
- Forecast punya kolom **No WO opsional**. Diisi kalau sudah diketahui, bisa saat forecast dibuat atau diedit belakangan.
- Urutan pencocokan forecast ↔ SPB:
  1. Referensi forecast di SPB (SPB dibuat lewat tombol aktualisasi, lihat B4).
  2. No WO sama (tanpa membedakan huruf besar/kecil dan spasi tepi).
  3. **Tautkan manual**: user memilih SPB untuk forecast yang belum cocok.
- Forecast yang lewat periode tanpa SPB dan **tanpa No WO** ditandai khusus ("belum bisa dicocokkan"), terpisah dari "tidak terealisasi". Tujuannya supaya angka % realisasi tidak turun hanya karena data WO belum diisi.

### A2. Dua status SPB
Keduanya **dihitung otomatis** dari data yang ada, bukan diinput manual. Kolom `spb_status` yang sekarang tetap dipakai, jadi kode lama aman.

**Base Status** (kelengkapan data awal, "sampai PIC PPA"):
| Status | Syarat |
|---|---|
| `Belum Lengkap` | Salah satu field wajib masih kosong. |
| `Lengkap` | Field wajib terisi: No WO, Section, PIC GMI, **PIC PPA**, Kode Unit, Tipe Unit, dan minimal 1 item. |

Di list ditampilkan juga field apa saja yang masih kosong.

**Completing Status** (progres proses, status tertinggi yang sudah dicapai):
| Urutan | Status | Dasar |
|---|---|---|
| 1 | `Quotation` | SPB dibuat (`DONE QUOT`) |
| 2 | `PO Customer` | Sudah ada SPB PO (`PO_ATTACH`) |
| 3 | `Delivered` | Sudah ada SPB DO (`DO_ATTACH`) |
| 4 | `Invoiced` | Sudah ada SPB Invoice |
| 5 | `Paid` | Semua invoice `payment_status = 'paid'` |
| — | `Cancelled` | `spb_status = 'CANCELLED'` |

Opsional: tampilkan progres sebagian per item (mis. "PO 3/5 item") memakai data qty sudah/belum PO dari dashboard SPB.

---

## B. Forecast Penjualan (EGI) vs Realisasi SPB

### B1. Forecast yang tidak terealisasi — **Open**
- **Masalah:** Ada EGI yang sudah di-forecast dan sudah dibuatkan pengajuan, tapi SPB-nya tidak pernah dibuat.
- **Kebutuhan:** Report "Forecast tidak terealisasi": forecast yang sudah lewat periodenya tanpa SPB terkait (aturan A1).
- **Input alasan:** ditunda, unit breakdown/dijual, customer batal, part tidak tersedia, kalah harga, dll. Dipakai untuk evaluasi akurasi forecast.

### B2. SPB tanpa forecast — **Open**
- **Masalah:** Ada EGI yang terjadi (SPB dibuat) padahal tidak ada di forecast.
- **Kebutuhan:** Report "Penjualan di luar forecast": SPB yang tidak punya referensi forecast, No WO-nya tidak cocok dengan forecast mana pun, dan tidak ditautkan manual.

### B3. Halaman Forecast vs Actual — **Open** (gabungan B1 + B2)
- Empat kategori: **terealisasi**, **tidak terealisasi**, **belum bisa dicocokkan** (tanpa No WO), **SPB di luar forecast**.
- KPI: **% realisasi forecast** (jumlah & nilai), per periode, per site/cabang, per unit/model, per section.
- Tampilkan cara cocoknya per baris (referensi / No WO / manual) supaya mudah diaudit.

### B4. Trigger aktualisasi Forecast → SPB Project — **Open** (fondasi B1–B3)
- Dari baris forecast ada aksi **"Aktualisasi → Buat SPB"** yang mengisi SPB otomatis (unit, No WO, item paket + extra items, qty).
- SPB menyimpan **referensi ke forecast asal**. Begitu SPB dibuat, forecast otomatis berstatus **terealisasi**.
- Status forecast: `forecast` → `terealisasi` / `batal` (dengan alasan, lihat B1).
- **DB:** kolom No WO di forecast (A1), referensi forecast di `spb`, status & alasan forecast → wajib migration.

### B5. Forecast per Part Number: dipakai di unit & site mana — **Open**
- Untuk satu PN, tampilkan unit mana saja yang akan memakainya, di site/cabang mana, bulan kapan, dan total qty forecast.
- Use case: perencanaan stok & distribusi antar site sebelum penjualan terjadi.

---

## C. Consumable (Job Costing & Working Order) + Analitik per No WO

### C1. Input consumable di Job Costing — **Open**
- Kondisi sekarang: Job Costing punya **bahan** (`job_costing_items`, PN sumber) dan **finish part** (`job_costing_finish_parts`, PN tujuan). Belum ada bagian consumable.
- **Kebutuhan:** Section baru **Consumable** di form Job Costing. Contoh: bahan PN A + PN B, consumable cat 2 kaleng.
- Field: barang (pilih dari master, opsional) / nama bebas, qty, satuan, harga satuan (opsional), catatan.
- **Tidak mengurangi stok** dan tidak mengubah alur approval/stok Job Costing.
- Ditampilkan sebagai subtotal terpisah, **tidak** mengubah `total_cost` yang sudah ada.
- Tampil di detail, print, dan export Job Costing.
- **DB:** tabel baru `job_costing_consumables` → wajib migration.

### C2. Input consumable tambahan di Working Order — **Open**
- **Kebutuhan:** Catat consumable **tambahan** (di luar formula/BOM) per WO, supaya terlihat pemakaian per unit yang diproduksi.
- Field sama dengan C1. Consumable per unit = qty consumable ÷ qty item target WO.
- **Tidak mengurangi stok** (formula/BOM tetap menjadi satu-satunya yang mengurangi stok Gudang WO).
- **DB:** tabel baru `working_order_consumables` → wajib migration.

### C3. Dashboard consumable — **Open** (butuh C1 + C2)
- **Consumable vs WO yang dibuat:** jumlah WO / Job Costing vs total consumable, rata-rata consumable per WO dan per unit hasil.
- Per jenis consumable: tren per periode, per cabang/gudang, per PN hasil (finish part / item target WO).
- Highlight dokumen dengan pemakaian di atas rata-rata.
- Export Excel.

### C4. Informasi historis per No WO / unit (SPB) — **Open**
- Tren pemakaian part per unit dan per periode, dari SPB yang ber-No WO.
- **History pembelian** untuk PN yang sama (vendor, harga beli, tanggal, qty dari PO pembelian) sebagai **dasar negosiasi harga**.
- Info lain: frekuensi order per unit, harga jual vs harga beli (margin), lead time.

---

## D. SPB

### D1. Dashboard SPB — **Partial** (v1 di `/spb/dashboard`, migration `20261109100000_spb_dashboard.sql`)
Sudah ada:
- Jumlah SPB total + per status, jumlah SPB PO / DO / Invoice (per approval & payment), Return SPB.
- Filter No WO → list item per WO + qty sudah PO / belum PO + nomor PO/DO/Invoice.

Sisa / perbaikan:
- [ ] Review dengan user apakah angka & layout sesuai ekspektasi.
- [x] Ringkasan per Base Status & Completing Status (A2).
- [ ] Filter tambahan (lihat E2): section, PIC, kode/tipe unit, brand, site.
- [ ] Export Excel.
- [ ] Catatan teknis: `spb_po_details` tidak menyimpan qty (item masuk PO utuh). Kalau nanti butuh **partial PO per item**, skema harus diubah.

### D2. Implementasi Base Status & Completing Status — **Done (2026-11-11)**
- Migration `20261111100000_spb_base_completing_status.sql`: computed column `spb_base_status`, `spb_base_missing`, `spb_completing_status` di tabel `spb`, kolom yang sama di `v_spb_report`, RPC `get_spb_status_summary`.
- Tampil + filter di list SPB, Report SPB (termasuk export Excel), dan 2 kartu baru di Dashboard SPB.
- Invoice yang di-reject tidak dihitung untuk Invoiced/Paid.
- Belum ada halaman detail SPB tersendiri; status tampil di list.

---

## E. Dashboard, Filter & Report Umum (WMS)

### E1. Pembaruan dashboard Consignment & dashboard lain — **Partial**
- Perbarui dashboard consignment (`consignment_dashboard_view`) supaya sinkron dengan modul baru (IK, penerimaan, Vendor Consignment GR/rekonsil).
- [x] Dashboard utama `/dashboard` dibangun ulang (2026-11-11, migration `20261111120000_main_dashboard.sql`): antrian "perlu tindakan", approval per user, section per role, analitik atasan (lead time, tren, level MR, umur approval, lokasi & stok, vendor/barang teratas, penjualan), semua kartu bisa diklik → daftar + Excel. Atasan = moderator/manager/spv/pjo/gl; nilai Rupiah PO hanya purchasing.
- [ ] Review angka & layout dashboard utama bersama atasan.

### E2. Filter lebih detail — **Open**
- Terapkan di list & dashboard utama: rentang tanggal, cabang/site, project, dept, status, PIC, vendor, PN, unit, No WO.
- Pakai komponen filter reusable supaya konsisten antar halaman; simpan filter terakhir per user.

### E3. Tarikan RI di WMS: tambah Dept, Project, Site — **Open**
- Report/export RI (Receive Item) menampilkan **Departemen, Project, dan Site** asal kebutuhan (ditarik dari MR → PR → PO → RI).

---

## Usulan Prioritas

| Prioritas | Item | Alasan |
|---|---|---|
| P1 | D2, sisa D1, E3 | Melengkapi dashboard SPB yang baru rilis; scope jelas. |
| P2 | C1, C2 → C3 | Scope jelas, hanya pencatatan (risiko stok nol). |
| P3 | B4 → B1/B2/B3 | B4 jadi fondasi supaya realisasi forecast terukur. |
| P4 | C4, B5, E2, E1 | Analitik & perbaikan umum; butuh data historis cukup. |

---

## Catatan Deploy (aturan proyek)
Setiap item yang menyentuh DB: buat migration di `supabase/migrations/`, tulis SQL yang harus dijalankan di Supabase VPS, dan sertakan query verifikasi pasca deploy.
