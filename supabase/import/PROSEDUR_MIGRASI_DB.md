# PROSEDUR MIGRASI DATABASE WMS LAMA → SUPABASE

> **Dokumen ini berisi langkah-langkah lengkap untuk memindahkan data dari database WMS lama (MySQL/MariaDB, phpMyAdmin) ke Supabase (PostgreSQL).**
> Dirancang agar bisa dikerjakan oleh AI model step-by-step tanpa ambiguitas.

---

## REKOMENDASI FORMAT: CSV

**Gunakan CSV**, bukan SQL. Alasan:

| Aspek                  | CSV                          | SQL                                          |
| ---------------------- | ---------------------------- | -------------------------------------------- |
| Export dari phpMyAdmin | ✅ Native support            | ⚠️ MySQL syntax, tidak compatible PostgreSQL |
| Data cleaning          | ✅ Mudah pakai script        | ❌ Harus edit SQL syntax                     |
| Import ke Supabase     | ✅ `\copy` atau Dashboard    | ❌ Perlu konversi syntax                     |
| Inspeksi manual        | ✅ Bisa buka di Excel/Sheets | ❌ Susah dibaca                              |
| Handling karakter aneh | ✅ Mudah di-sanitize         | ❌ Bisa break SQL                            |

---

## DAFTAR ISI

1. [Persiapan & Export dari phpMyAdmin](#1-persiapan--export-dari-phpmyadmin)
2. [Tabel Cabang (Lokasi) - Buat Manual](#2-tabel-cabang-lokasi---buat-manual)
3. [Migrasi Tabel Master (Barang, Vendors, Customers)](#3-migrasi-tabel-master)
4. [Migrasi Users → Supabase Auth + Profiles](#4-migrasi-users)
5. [Migrasi Stock](#5-migrasi-stock)
6. [Migrasi Material Request (MR)](#6-migrasi-material-request)
7. [Migrasi Purchase Request (PR)](#7-migrasi-purchase-request)
8. [Migrasi Purchase Order (PO)](#8-migrasi-purchase-order)
9. [Migrasi Receive Item](#9-migrasi-receive-item)
10. [Migrasi Delivery](#10-migrasi-delivery)
11. [Migrasi SPB & Sub-tabel](#11-migrasi-spb)
12. [Migrasi Return SPB](#12-migrasi-return-spb)
13. [Validasi Akhir](#13-validasi-akhir)

---

## URUTAN IMPORT (WAJIB DIIKUTI)

Urutan ini berdasarkan dependensi foreign key. **Tidak boleh dibolak-balik.**

```
1. cabang           (tidak ada FK, buat manual)
2. barang           (tidak ada FK)
3. vendors          (tidak ada FK)
4. customers        (tidak ada FK)
5. users/profiles   (FK → cabang)         ← MANUAL, bukan CSV import
6. stock            (FK → barang, cabang)
7. mrs + mr_items   (FK → cabang, barang, profiles)
8. prs + pr_items   (FK → cabang, profiles, mrs, barang)
9. pos + po_items   (FK → prs, mrs, barang)
10. receives + receive_items (FK → pos, mrs, barang, cabang)
11. deliveries + delivery_items (FK → mrs, cabang, barang)
12. spb             (FK → cabang)
13. spb_details     (FK → spb, barang)
14. spb_po          (FK → spb)
15. spb_do          (FK → spb_po)
16. spb_invoice     (FK → spb_do)
17. return_spb      (FK → spb)
18. return_spb_details (FK → return_spb, spb_details, barang)
```

---

## 1. PERSIAPAN & EXPORT DARI PHPMYADMIN

### 1.1 Tabel yang Perlu Di-export

Export **hanya** tabel-tabel ini dari phpMyAdmin. Abaikan tabel Laravel framework (cache, sessions, jobs, migrations, dll).

| No  | Tabel MySQL            | Nama File CSV               |
| --- | ---------------------- | --------------------------- |
| 1   | `tb_barang`            | `exp_barang.csv`            |
| 2   | `vendors`              | `exp_vendors.csv`           |
| 3   | `customers`            | `exp_customers.csv`         |
| 4   | `users`                | `exp_users.csv`             |
| 5   | `tb_stock`             | `exp_stock.csv`             |
| 6   | `tb_material_request`  | `exp_mr.csv`                |
| 7   | `tb_purchase_request`  | `exp_pr.csv`                |
| 8   | `tb_purchase_order`    | `exp_po.csv`                |
| 9   | `tb_receive_item`      | `exp_receive.csv`           |
| 10  | `tb_delivery`          | `exp_delivery.csv`          |
| 11  | `tb_spb`               | `exp_spb.csv`               |
| 12  | `tb_spb_detail`        | `exp_spb_detail.csv`        |
| 13  | `tb_spb_po`            | `exp_spb_po.csv`            |
| 14  | `tb_spb_do`            | `exp_spb_do.csv`            |
| 15  | `tb_spb_invoice`       | `exp_spb_invoice.csv`       |
| 16  | `tb_return_spb`        | `exp_return_spb.csv`        |
| 17  | `tb_return_spb_detail` | `exp_return_spb_detail.csv` |

### 1.2 Cara Export CSV dari phpMyAdmin

Untuk **setiap tabel** di atas:

1. Buka phpMyAdmin → pilih database `wmse9113_wms`
2. Klik tabel yang akan di-export
3. Klik tab **"Export"**
4. Pilih method: **"Custom"**
5. Format: **"CSV"**
6. Opsi CSV:
   - Columns separated with: `,`
   - Columns enclosed with: `"`
   - Columns escaped with: `\`
   - Lines terminated with: `\n` (auto/LF)
   - ✅ Centang **"Put columns names in the first row"**
   - NULL ditulis sebagai: `\N` (backslash-N)
7. Klik **"Go"** → simpan file dengan nama sesuai tabel di atas

### 1.3 Tempat Menyimpan File CSV

Simpan semua file CSV ke folder:

```
supabase/import/csv/
```

---

## 2. TABEL CABANG (LOKASI) - BUAT MANUAL

Tabel `cabang` **tidak ada di WMS lama**. Perlu dibuat manual berdasarkan semua lokasi unik yang ditemukan di data lama.

### 2.1 Daftar Lokasi Unik dari WMS Lama

Berikut semua lokasi unik yang muncul di berbagai tabel WMS lama:

| Kode Lokasi Lama | Muncul di Tabel                |
| ---------------- | ------------------------------ |
| `JAKARTA`        | mr, stock, delivery, pr, users |
| `HO`             | users                          |
| `SITE AMI`       | stock, spb, users              |
| `SITE BA`        | mr, stock                      |
| `SITE BIB`       | stock, spb                     |
| `SITE DIZE`      | stock, spb, users              |
| `SITE MIFA`      | mr, stock, spb, users          |
| `SITE MIP`       | stock, spb                     |
| `SITE TAL`       | mr, stock, delivery, spb       |
| `SITE TABANG`    | mr, stock, spb                 |

### 2.2 Mapping ke Cabang Baru

Supabase sudah punya 3 cabang dari seed data. Perlu ditambahkan sisanya.

**Seed data yang sudah ada:**

| id  | nama_cabang         | kode_cabang |
| --- | ------------------- | ----------- |
| 1   | Head Office Jakarta | HO-JKT      |
| 2   | Site Balikpapan     | BPN-01      |
| 3   | Site Samarinda      | SRI-01      |

**KEPUTUSAN YANG HARUS DIAMBIL MANUAL oleh tim:**

`JAKARTA` dan `HO` kemungkinan = `Head Office Jakarta` (id=1). Tapi yang lain perlu diputuskan:

| Lokasi Lama   | Mapping ke cabang_id | Catatan                                     |
| ------------- | -------------------- | ------------------------------------------- |
| `JAKARTA`     | 1                    | = Head Office Jakarta                       |
| `HO`          | 1                    | = Head Office Jakarta                       |
| `SITE BA`     | ?                    | Perlu buat cabang baru atau map ke existing |
| `SITE AMI`    | ?                    | Perlu buat cabang baru                      |
| `SITE BIB`    | ?                    | Perlu buat cabang baru                      |
| `SITE DIZE`   | ?                    | Perlu buat cabang baru                      |
| `SITE MIFA`   | ?                    | Perlu buat cabang baru                      |
| `SITE MIP`    | ?                    | Perlu buat cabang baru                      |
| `SITE TAL`    | ?                    | Perlu buat cabang baru                      |
| `SITE TABANG` | ?                    | Perlu buat cabang baru                      |

### 2.3 SQL untuk Menambah Cabang Baru

Setelah tim memutuskan mapping, jalankan SQL ini di Supabase SQL Editor. **Sesuaikan nama_cabang dan kode_cabang dengan keputusan tim.**

```sql
-- Contoh: tambah cabang baru (sesuaikan nama resmi)
INSERT INTO public.cabang (nama_cabang, kode_cabang) VALUES
  ('Site BA', 'SITE-BA'),
  ('Site AMI', 'SITE-AMI'),
  ('Site BIB', 'SITE-BIB'),
  ('Site DIZE', 'SITE-DIZE'),
  ('Site MIFA', 'SITE-MIFA'),
  ('Site MIP', 'SITE-MIP'),
  ('Site TAL', 'SITE-TAL'),
  ('Site Tabang', 'SITE-TABANG');
```

### 2.4 Tabel Lookup Final

Setelah INSERT di atas, jalankan query ini dan **catat hasilnya** — akan dipakai di semua langkah berikutnya:

```sql
SELECT id, nama_cabang, kode_cabang FROM public.cabang ORDER BY id;
```

**Simpan hasilnya sebagai file `cabang_lookup.csv`** di folder `supabase/import/csv/`.

Format yang diharapkan:

```
id,nama_cabang,kode_cabang,lokasi_lama
1,Head Office Jakarta,HO-JKT,"JAKARTA,HO"
4,Site BA,SITE-BA,SITE BA
5,Site AMI,SITE-AMI,SITE AMI
... dst
```

Kolom `lokasi_lama` berisi string lokasi dari WMS lama yang di-map ke cabang ini (bisa lebih dari satu, pisahkan dengan koma).

---

## 3. MIGRASI TABEL MASTER

### 3.1 Barang (tb_barang → barang)

**File sumber:** `exp_barang.csv`

**Kolom mapping:**

| Kolom CSV (lama)   | Kolom Supabase (baru) | Transformasi                                                               |
| ------------------ | --------------------- | -------------------------------------------------------------------------- |
| `part_id`          | —                     | **ABAIKAN** (id auto-generated)                                            |
| `part_number`      | `part_number`         | Salin apa adanya                                                           |
| `part_name`        | `part_name`           | Salin apa adanya                                                           |
| `part_satuan`      | `part_satuan`         | Salin apa adanya. Jika kosong, isi `"PCS"`                                 |
| `part_description` | —                     | **ABAIKAN** (kolom tidak ada di schema baru)                               |
| `created_at`       | `created_at`          | Jika `0000-00-00 00:00:00` atau NULL → ganti dengan `2024-01-01T00:00:00Z` |
| `updated_at`       | `updated_at`          | Sama seperti created_at                                                    |

**Langkah transformasi (script Python/Node):**

1. Baca `exp_barang.csv`
2. Buang kolom `part_id` dan `part_description`
3. Ganti tanggal `0000-00-00 00:00:00` → `2024-01-01T00:00:00+00:00`
4. Ganti `part_satuan` kosong → `PCS`
5. Deduplikasi berdasarkan `part_number` (ambil yang pertama jika duplikat)
6. Simpan sebagai `import_barang.csv` dengan kolom: `part_number,part_name,part_satuan,created_at,updated_at`

**Import ke Supabase:**

```sql
-- Jalankan di Supabase SQL Editor atau psql
\copy public.barang(part_number, part_name, part_satuan, created_at, updated_at)
FROM '/path/to/import_barang.csv'
WITH (FORMAT csv, HEADER true, NULL '\N');
```

**Atau via Supabase Dashboard:** Table Editor → barang → Import CSV

**Verifikasi:**

```sql
SELECT COUNT(*) FROM public.barang;
-- Harus sekitar 15.000+ rows
```

**Simpan lookup ID:** Setelah import, export mapping lama→baru:

```sql
-- Jalankan dan simpan hasilnya sebagai barang_lookup.csv
SELECT id, part_number FROM public.barang ORDER BY id;
```

### 3.2 Vendors (vendors → vendors)

**File sumber:** `exp_vendors.csv`

**Kolom mapping:**

| Kolom CSV (lama) | Kolom Supabase (baru) | Transformasi                       |
| ---------------- | --------------------- | ---------------------------------- |
| `id`             | —                     | **ABAIKAN**                        |
| `vendor_no`      | `vendor_no`           | Hapus `\r` (carriage return)       |
| `vendor_name`    | `vendor_name`         | Hapus `\r`                         |
| `telephone`      | `telephone`           | Hapus `\r`. NULL → tetap NULL      |
| `contact_name`   | `contact_name`        | Hapus `\r`. NULL → tetap NULL      |
| `is_active`      | `is_active`           | `1` → `true`, `0` → `false`        |
| `created_at`     | `created_at`          | NULL → `2024-01-01T00:00:00+00:00` |
| `updated_at`     | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00` |

**Langkah transformasi:**

1. Baca `exp_vendors.csv`
2. Buang kolom `id`
3. Hapus karakter `\r` dari semua field teks
4. Deduplikasi berdasarkan `vendor_no` (ambil yang pertama)
5. Konversi `is_active`: `1` → `true`, `0` → `false`
6. Ganti NULL timestamps → `2024-01-01T00:00:00+00:00`
7. Simpan sebagai `import_vendors.csv`

**Import ke Supabase:**

```sql
\copy public.vendors(vendor_no, vendor_name, telephone, contact_name, is_active, created_at, updated_at)
FROM '/path/to/import_vendors.csv'
WITH (FORMAT csv, HEADER true, NULL '\N');
```

**Verifikasi:**

```sql
SELECT COUNT(*) FROM public.vendors;
```

**Simpan lookup:**

```sql
SELECT id, vendor_no FROM public.vendors ORDER BY id;
-- Simpan sebagai vendors_lookup.csv
```

### 3.3 Customers (customers → customers)

**File sumber:** `exp_customers.csv`

**Kolom mapping:** Sama persis seperti vendors (struktur identik).

| Kolom CSV (lama) | Kolom Supabase (baru) | Transformasi                       |
| ---------------- | --------------------- | ---------------------------------- |
| `id`             | —                     | **ABAIKAN**                        |
| `customer_no`    | `customer_no`         | Hapus `\r`                         |
| `customer_name`  | `customer_name`       | Hapus `\r`                         |
| `telephone`      | `telephone`           | Hapus `\r`. NULL → tetap NULL      |
| `contact_name`   | `contact_name`        | Hapus `\r`. NULL → tetap NULL      |
| `is_active`      | `is_active`           | `1` → `true`, `0` → `false`        |
| `created_at`     | `created_at`          | NULL → `2024-01-01T00:00:00+00:00` |
| `updated_at`     | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00` |

**Langkah transformasi:** Sama seperti vendors.

**⚠️ Perhatian khusus untuk customers:**

- Ada data corrupt di sekitar baris 163 file SQL (multi-line records). Jika di CSV juga corrupt, hapus baris yang tidak valid secara manual.
- `customer_no` ada yang berformat aneh: `"02032015 (IDR)"`, `"03/04/2013"`, `"1.00"`. **Biarkan apa adanya** kecuali tim memutuskan untuk di-normalize.
- Schema baru punya `UNIQUE` constraint di `customer_no` dan `customer_name`. Jika ada duplikat, hapus yang lama (ambil yang terakhir updated).

**Import & verifikasi:** Sama seperti vendors.

---

## 4. MIGRASI USERS

> ⚠️ **INI ADALAH LANGKAH PALING KOMPLEKS.** Users tidak bisa di-import via CSV karena Supabase menggunakan `auth.users` (UUID) terpisah dari `profiles`.

### 4.1 Strategi

Ada **2 opsi**:

**Opsi A: Buat Ulang User via Supabase Auth API (DIREKOMENDASIKAN)**

- Buat user baru via Supabase Admin API untuk setiap user aktif
- Password di-reset (user harus set ulang password)
- UUID baru akan ter-generate otomatis

**Opsi B: Hanya Impor Data Profile (tanpa login)**

- Import nama dan email ke profiles
- User tidak bisa login sampai didaftarkan ulang
- Cocok untuk data arsip

### 4.2 Opsi A: Langkah Detail

**A1. Filter user aktif dari `exp_users.csv`:**

- Ambil hanya user dengan `is_active = 1` DAN `approval_status = 'approved'`
- Atau ambil semua jika ingin migrasi lengkap

**A2. Buat script yang melakukan untuk setiap user:**

```
Untuk setiap baris di exp_users.csv:
  1. Panggil Supabase Admin API: supabase.auth.admin.createUser({
       email: [email dari CSV],
       password: [generate random atau tetapkan default sementara],
       email_confirm: true
     })
  2. Ambil UUID yang dikembalikan
  3. INSERT ke profiles:
     INSERT INTO public.profiles (id, nama, email, is_active, cabang_id, created_at, updated_at)
     VALUES ([UUID], [nama], [email], [is_active → boolean], [cabang_id dari lookup], [created_at], [updated_at])
  4. INSERT ke user_roles:
     INSERT INTO public.user_roles (user_id, role_id)
     VALUES ([UUID], [role_id dari mapping])
```

**A3. Mapping role lama → role baru:**

| Role Lama (users.role) | Role Baru (roles.name)  | role_id             |
| ---------------------- | ----------------------- | ------------------- |
| `superadmin`           | `moderator`             | 1                   |
| `admin`                | `admin`                 | 2                   |
| `spv`                  | `spv`                   | 3                   |
| `gl_mekanik`           | `gl`                    | 4                   |
| `manager`              | `manager`               | 6                   |
| `ppic`                 | `ppic`                  | 9                   |
| `logistik`             | `logistik`              | 10                  |
| `purchasing`           | `purchasing`            | 11                  |
| `vendor`               | `vendor`                | 12                  |
| `customer`             | `customer`              | 13                  |
| `warehouse`            | _tidak ada exact match_ | **Tentukan manual** |
| `finance`              | _tidak ada exact match_ | **Tentukan manual** |
| `marketing`            | _tidak ada exact match_ | **Tentukan manual** |
| `user`                 | _tidak ada exact match_ | **Tentukan manual** |

> **⚠️ KEPUTUSAN MANUAL:** Beberapa role lama tidak ada padanannya di schema baru. Tim harus memutuskan: (a) buat role baru, atau (b) map ke role terdekat.

**A4. Mapping lokasi lama → cabang_id:**

Gunakan `cabang_lookup.csv` dari Langkah 2.4.

| users.lokasi (lama) | cabang_id (baru)     |
| ------------------- | -------------------- |
| `JAKARTA`           | 1                    |
| `HO`                | 1                    |
| `SITE AMI`          | _dari cabang_lookup_ |
| `SITE DIZE`         | _dari cabang_lookup_ |
| `SITE MIFA`         | _dari cabang_lookup_ |
| ...                 | ...                  |

**A5. Simpan mapping user lama → UUID baru:**

Setelah semua user dibuat, simpan sebagai `users_lookup.csv`:

```
old_id,old_nama,old_email,new_uuid
1,Ahmad,ahmad@email.com,550e8400-e29b-41d4-a716-446655440000
2,Budi,budi@email.com,6ba7b810-9dad-11d1-80b4-00c04fd430c8
...
```

File ini **KRITIS** — dibutuhkan untuk mapping `mr_pic`, `pr_pic`, dll di langkah selanjutnya.

---

## 5. MIGRASI STOCK

**File sumber:** `exp_stock.csv`

**Kolom mapping:**

| Kolom CSV (lama) | Kolom Supabase (baru) | Transformasi                                                      |
| ---------------- | --------------------- | ----------------------------------------------------------------- |
| `stk_id`         | —                     | **ABAIKAN**                                                       |
| `part_id`        | `part_id`             | Lookup: cari `id` di `barang` berdasarkan `part_number` yang sama |
| `stk_qty`        | `qty`                 | Salin apa adanya                                                  |
| `stk_min`        | `min_qty`             | Salin apa adanya                                                  |
| `stk_max`        | `max_qty`             | Salin apa adanya                                                  |
| `stk_location`   | `cabang_id`           | Lookup dari `cabang_lookup.csv`                                   |
| `created_at`     | `created_at`          | NULL → `2024-01-01T00:00:00+00:00`                                |
| `updated_at`     | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00`                                |

**Langkah transformasi:**

1. Baca `exp_stock.csv`
2. Untuk setiap baris:
   - Cari `part_id` baru: join dengan `barang_lookup.csv` via `part_number` (perlu join tambahan: `exp_barang.csv` punya `part_id` ↔ `part_number`, dan `barang_lookup.csv` punya `new_id` ↔ `part_number`)
   - Ganti `stk_location` → `cabang_id` dari `cabang_lookup.csv`
3. Rename kolom: `stk_qty` → `qty`, `stk_min` → `min_qty`, `stk_max` → `max_qty`
4. **Deduplikasi:** Schema baru punya `UNIQUE(part_id, cabang_id)`. Jika ada duplikat (part yang sama di lokasi yang sama), **jumlahkan qty-nya**
5. Simpan sebagai `import_stock.csv` dengan kolom: `part_id,qty,min_qty,max_qty,cabang_id,created_at,updated_at`

**Part ID Lookup - PENTING:**

Karena `part_id` lama ≠ `part_id` baru (auto-generated), perlu tahapan:

1. Dari `exp_barang.csv`: buat mapping `old_part_id → part_number`
2. Dari Supabase setelah import barang: buat mapping `part_number → new_part_id`
3. Gabungkan: `old_part_id → part_number → new_part_id`

Query untuk mendapatkan mapping:

```sql
SELECT id as new_part_id, part_number FROM public.barang;
-- Simpan sebagai barang_id_lookup.csv
```

**Import:**

```sql
\copy public.stock(part_id, qty, min_qty, max_qty, cabang_id, created_at, updated_at)
FROM '/path/to/import_stock.csv'
WITH (FORMAT csv, HEADER true, NULL '\N');
```

**Verifikasi:**

```sql
SELECT COUNT(*) FROM public.stock;
SELECT s.cabang_id, c.nama_cabang, COUNT(*), SUM(s.qty)
FROM public.stock s JOIN public.cabang c ON s.cabang_id = c.id
GROUP BY s.cabang_id, c.nama_cabang;
```

---

## 6. MIGRASI MATERIAL REQUEST

### 6.1 MR Header (tb_material_request → mrs)

**File sumber:** `exp_mr.csv`

**Kolom mapping:**

| Kolom CSV (lama)             | Kolom Supabase (baru) | Transformasi                                         |
| ---------------------------- | --------------------- | ---------------------------------------------------- |
| `mr_id`                      | —                     | **ABAIKAN** (tapi catat untuk lookup items)          |
| `mr_kode`                    | `mr_kode`             | Salin apa adanya                                     |
| `mr_lokasi`                  | `cabang_id`           | Lookup dari `cabang_lookup.csv`                      |
| `mr_pic`                     | `mr_pic`              | Salin apa adanya (nama text)                         |
| `mr_pic`                     | `mr_pic_id`           | Lookup UUID dari `users_lookup.csv` berdasarkan nama |
| `mr_tanggal`                 | `mr_tanggal`          | Jika `0000-00-00` → `NULL`                           |
| `mr_due_date`                | `mr_due_date`         | Jika `0000-00-00` → `NULL`                           |
| `mr_status`                  | `mr_status`           | Mapping: lihat tabel di bawah                        |
| `mr_last_edit_by`            | —                     | **ABAIKAN**                                          |
| `mr_last_edit_at`            | —                     | **ABAIKAN**                                          |
| `signature_url`              | —                     | **ABAIKAN**                                          |
| `sign_at` s/d `signed_gl_at` | —                     | **ABAIKAN** (semua signature fields)                 |
| `created_at`                 | `created_at`          | NULL → `2024-01-01T00:00:00+00:00`                   |
| `updated_at`                 | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00`                   |

**Mapping status MR:**

| Status Lama | Status Baru (doc_status) |
| ----------- | ------------------------ |
| `pending`   | `open`                   |
| `open`      | `open`                   |
| `approved`  | `approved`               |
| `closed`    | `closed`                 |
| `partial`   | `approved`               |
| `rejected`  | `rejected`               |
| `done`      | `done`                   |
| _(lainnya)_ | `open`                   |

**⚠️ mr_pic_id (UUID) lookup:**

- `mr_pic` di WMS lama berisi **nama orang** (contoh: "Ahmad Fauzi")
- Perlu di-match ke `users_lookup.csv` berdasarkan nama
- Jika tidak ditemukan, **gunakan UUID admin/default user**
- Schema baru: `mr_pic_id UUID REFERENCES profiles(id) NOT NULL` — field ini **wajib diisi**

**Simpan lookup MR:**
Setelah import, export mapping:

```sql
SELECT id as new_mr_id, mr_kode FROM public.mrs;
-- Simpan sebagai mr_lookup.csv
```

Dan buat juga mapping `old_mr_id → mr_kode → new_mr_id` untuk import items.

### 6.2 MR Items

**⚠️ WMS lama TIDAK memiliki tabel `mr_items` terpisah.** Items MR di WMS lama embedded di relasi lain (atau tidak ada di dump).

**Opsi:**

- Jika WMS lama punya tabel items yang tidak ter-export → export dari phpMyAdmin
- Jika tidak ada → skip. MR header tetap diimport tapi tanpa detail items
- Cek apakah ada tabel `tb_mr_detail` atau sejenisnya di WMS lama

---

## 7. MIGRASI PURCHASE REQUEST

### 7.1 PR Header (tb_purchase_request → prs)

**File sumber:** `exp_pr.csv`

**Kolom mapping:**

| Kolom CSV (lama)                | Kolom Supabase (baru) | Transformasi                                         |
| ------------------------------- | --------------------- | ---------------------------------------------------- |
| `pr_id`                         | —                     | **ABAIKAN** (catat untuk lookup)                     |
| `pr_kode`                       | `pr_kode`             | Salin apa adanya                                     |
| `pr_lokasi`                     | `cabang_id`           | Lookup dari `cabang_lookup.csv`                      |
| `pr_tanggal`                    | `pr_tanggal`          | Jika `0000-00-00` → tanggal dari `created_at`        |
| `pr_status`                     | `pr_status`           | Mapping sama seperti MR status                       |
| `pr_pic`                        | `pr_pic_id`           | Lookup UUID dari `users_lookup.csv` berdasarkan nama |
| `signature_url` s/d `sign_step` | —                     | **ABAIKAN** (semua signature fields)                 |
| `created_at`                    | `created_at`          | NULL → `2024-01-01T00:00:00+00:00`                   |
| `updated_at`                    | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00`                   |

**Simpan lookup:**

```sql
SELECT id as new_pr_id, pr_kode FROM public.prs;
-- Simpan sebagai pr_lookup.csv
```

### 7.2 PR Items

Sama seperti MR Items — cek apakah ada tabel detail di WMS lama.

---

## 8. MIGRASI PURCHASE ORDER

### 8.1 PO Header (tb_purchase_order → pos)

**File sumber:** `exp_po.csv`

**Kolom mapping:**

| Kolom CSV (lama)                    | Kolom Supabase (baru) | Transformasi                                  |
| ----------------------------------- | --------------------- | --------------------------------------------- |
| `po_id`                             | —                     | **ABAIKAN**                                   |
| `po_kode`                           | `po_kode`             | Salin apa adanya                              |
| `pr_id`                             | `pr_id`               | Lookup: `old_pr_id → pr_kode → new_pr_id`     |
| `po_tanggal`                        | `po_tanggal`          | Jika `0000-00-00` → tanggal dari `created_at` |
| `po_estimasi`                       | `po_estimasi`         | Jika `0000-00-00` → `NULL`                    |
| `po_payment_term`                   | —                     | **ABAIKAN**                                   |
| `po_keterangan`                     | `po_keterangan`       | Salin apa adanya                              |
| `po_status`                         | `po_status`           | Mapping sama seperti MR status                |
| `sign_step` s/d `signed_pengaju_at` | —                     | **ABAIKAN**                                   |
| `po_detail_status`                  | —                     | **ABAIKAN**                                   |
| `po_pic`                            | —                     | **ABAIKAN**                                   |
| —                                   | `vendor_id`           | **BARU**, isi `NULL` jika tidak diketahui     |
| `created_at`                        | `created_at`          | NULL → `2024-01-01T00:00:00+00:00`            |
| `updated_at`                        | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00`            |

**⚠️ pr_id lookup:**

- `pr_id` di WMS lama adalah integer
- Perlu mapping: WMS lama `pr_id` → `pr_kode` (dari `exp_pr.csv`) → new `pr_id` (dari `pr_lookup.csv`)

---

## 9. MIGRASI RECEIVE ITEM

### 9.1 Receive Header (tb_receive_item → receives)

**File sumber:** `exp_receive.csv`

**Kolom mapping:**

| Kolom CSV (lama)    | Kolom Supabase (baru) | Transformasi                                  |
| ------------------- | --------------------- | --------------------------------------------- |
| `ri_id`             | —                     | **ABAIKAN**                                   |
| `ri_kode`           | `ri_kode`             | Salin apa adanya                              |
| `po_id`             | `po_id`               | Lookup: old_po_id → po_kode → new_po_id       |
| `ri_lokasi`         | `cabang_id`           | Lookup dari `cabang_lookup.csv`               |
| `ri_pic`            | `ri_pic`              | Salin apa adanya                              |
| `signed_penerima_*` | —                     | **ABAIKAN**                                   |
| `ri_tanggal`        | `ri_tanggal`          | Jika `0000-00-00` → tanggal dari `created_at` |
| `ri_keterangan`     | `ri_keterangan`       | Salin apa adanya                              |
| `created_at`        | `created_at`          | NULL → `2024-01-01T00:00:00+00:00`            |
| `updated_at`        | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00`            |

---

## 10. MIGRASI DELIVERY

### 10.1 Delivery Header (tb_delivery → deliveries)

**File sumber:** `exp_delivery.csv`

**Kolom mapping:**

| Kolom CSV (lama)                | Kolom Supabase (baru) | Transformasi                                           |
| ------------------------------- | --------------------- | ------------------------------------------------------ |
| `dlv_id`                        | —                     | **ABAIKAN**                                            |
| `dlv_kode`                      | `dlv_kode`            | Salin apa adanya                                       |
| `dlv_kode_it`                   | —                     | **ABAIKAN**                                            |
| `mr_id`                         | `mr_id`               | Lookup: old_mr_id → mr_kode → new_mr_id                |
| `dlv_dari_gudang`               | `dari_cabang_id`      | Lookup dari `cabang_lookup.csv`                        |
| `dlv_ke_gudang`                 | `ke_cabang_id`        | Lookup dari `cabang_lookup.csv`                        |
| `dlv_ekspedisi`                 | `ekspedisi`           | Salin apa adanya                                       |
| `dlv_jumlah_koli`               | `jumlah_koli`         | Salin apa adanya                                       |
| `dlv_pic`                       | `pic`                 | Salin apa adanya                                       |
| `dlv_no_resi`                   | `no_resi`             | Salin apa adanya                                       |
| `dlv_status`                    | `status`              | Mapping: `"delivered"` → `"done"`, `"open"` → `"open"` |
| `signed_*` (10 kolom)           | —                     | **ABAIKAN**                                            |
| `packing_at` s/d `delivered_at` | —                     | **ABAIKAN**                                            |
| `dlv_tanggal`                   | —                     | **ABAIKAN**                                            |
| `created_at`                    | `created_at`          | NULL → `2024-01-01T00:00:00+00:00`                     |
| `updated_at`                    | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00`                     |

**Mapping status delivery:**

| Status Lama   | Status Baru (doc_status) |
| ------------- | ------------------------ |
| `open`        | `open`                   |
| `delivered`   | `done`                   |
| `on_delivery` | `approved`               |
| `cancelled`   | `rejected`               |
| _(lainnya)_   | `open`                   |

---

## 11. MIGRASI SPB & SUB-TABEL

### 11.1 SPB Header (tb_spb → spb)

**File sumber:** `exp_spb.csv`

**Kolom mapping:**

| Kolom CSV (lama)     | Kolom Supabase (baru) | Transformasi                               |
| -------------------- | --------------------- | ------------------------------------------ |
| `spb_id`             | —                     | **ABAIKAN** (catat untuk lookup)           |
| `spb_tanggal`        | `spb_tanggal`         | `0000-00-00` → `2024-01-01T00:00:00+00:00` |
| `spb_no`             | `spb_no`              | Salin apa adanya                           |
| `spb_kode_unit`      | `spb_kode_unit`       | Salin apa adanya                           |
| `spb_tipe_unit`      | `spb_tipe_unit`       | Salin apa adanya                           |
| `spb_brand`          | `spb_brand`           | Salin apa adanya                           |
| `spb_hm`             | `spb_hm`              | Salin apa adanya                           |
| `spb_problem_remark` | `spb_problem_remark`  | Salin apa adanya                           |
| `spb_no_wo`          | `spb_no_wo`           | Salin apa adanya                           |
| `spb_section`        | `spb_section`         | Salin apa adanya                           |
| `spb_pic_gmi`        | `spb_pic_gmi`         | Salin apa adanya                           |
| `spb_pic_ppa`        | `spb_pic_ppa`         | Salin apa adanya                           |
| `spb_pic`            | `spb_pic`             | Salin apa adanya                           |
| `spb_gudang`         | `spb_gudang`          | Salin apa adanya                           |
| `spb_gudang`         | `cabang_id`           | **JUGA** lookup dari `cabang_lookup.csv`   |
| `spb_status`         | `spb_status`          | Salin apa adanya                           |
| `spb_is_deleted`     | `spb_is_deleted`      | `0` → `false`, `1` → `true`                |
| —                    | `created_by`          | `NULL` (opsional, atau map ke UUID admin)  |
| `created_at`         | `created_at`          | NULL → `2024-01-01T00:00:00+00:00`         |
| `updated_at`         | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00`         |

**Simpan lookup:**

```sql
SELECT id as new_spb_id, spb_no FROM public.spb;
-- Simpan sebagai spb_lookup.csv
```

### 11.2 SPB Detail (tb_spb_detail → spb_details)

**File sumber:** `exp_spb_detail.csv`

**Kolom mapping:**

| Kolom CSV (lama)       | Kolom Supabase (baru)  | Transformasi                                    |
| ---------------------- | ---------------------- | ----------------------------------------------- |
| `spb_dtl_id`           | —                      | **ABAIKAN** (catat untuk lookup return)         |
| `spb_id`               | `spb_id`               | Lookup: old_spb_id → spb_no → new_spb_id        |
| `part_id`              | `part_id`              | Lookup: old_part_id → part_number → new_part_id |
| `dtl_spb_part_number`  | `dtl_spb_part_number`  | Salin apa adanya                                |
| `dtl_spb_part_name`    | `dtl_spb_part_name`    | Salin apa adanya                                |
| `dtl_spb_part_satuan`  | `dtl_spb_part_satuan`  | Salin apa adanya                                |
| `dtl_spb_qty`          | `dtl_spb_qty`          | Salin apa adanya                                |
| `dtl_spb_qty_returned` | `dtl_spb_qty_returned` | Salin apa adanya                                |
| `created_at`           | `created_at`           | NULL → `2024-01-01T00:00:00+00:00`              |
| `updated_at`           | `updated_at`           | NULL → `2024-01-01T00:00:00+00:00`              |

**Simpan lookup:**

```sql
SELECT sd.id as new_spb_dtl_id, sd.spb_id, sd.dtl_spb_part_number
FROM public.spb_details sd;
-- Simpan sebagai spb_detail_lookup.csv
```

### 11.3 SPB PO (tb_spb_po → spb_po)

**File sumber:** `exp_spb_po.csv`

| Kolom CSV (lama) | Kolom Supabase (baru) | Transformasi                       |
| ---------------- | --------------------- | ---------------------------------- |
| `spb_po_id`      | —                     | **ABAIKAN**                        |
| `spb_id`         | `spb_id`              | Lookup: old_spb_id → new_spb_id    |
| `po_no`          | `po_no`               | Salin apa adanya                   |
| `so_no`          | `so_no`               | Salin apa adanya                   |
| `so_date`        | `so_date`             | `0000-00-00` → `NULL`              |
| `created_at`     | `created_at`          | NULL → `2024-01-01T00:00:00+00:00` |
| `updated_at`     | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00` |

**Simpan lookup:**

```sql
SELECT id as new_spb_po_id, spb_id, po_no FROM public.spb_po;
-- Simpan sebagai spb_po_lookup.csv
```

### 11.4 SPB DO (tb_spb_do → spb_do)

**File sumber:** `exp_spb_do.csv`

| Kolom CSV (lama) | Kolom Supabase (baru) | Transformasi                               |
| ---------------- | --------------------- | ------------------------------------------ |
| `spb_do_id`      | —                     | **ABAIKAN**                                |
| `spb_po_id`      | `spb_po_id`           | Lookup: old_spb_po_id → new_spb_po_id      |
| `po_id`          | —                     | **ABAIKAN** (kolom dihapus di schema baru) |
| `do_no`          | `do_no`               | Salin apa adanya                           |
| `do_date`        | `do_date`             | `0000-00-00` → `NULL`                      |
| `do_status_part` | `do_status_part`      | Salin apa adanya. NULL → `"DELIVERED"`     |
| —                | `do_pic`              | `NULL` (field baru, opsional)              |
| `created_at`     | `created_at`          | NULL → `2024-01-01T00:00:00+00:00`         |
| `updated_at`     | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00`         |

**Simpan lookup:**

```sql
SELECT id as new_spb_do_id, do_no FROM public.spb_do;
-- Simpan sebagai spb_do_lookup.csv
```

### 11.5 SPB Invoice (tb_spb_invoice → spb_invoice)

**File sumber:** `exp_spb_invoice.csv`

| Kolom CSV (lama)     | Kolom Supabase (baru) | Transformasi                          |
| -------------------- | --------------------- | ------------------------------------- |
| `spb_invoice_id`     | —                     | **ABAIKAN**                           |
| `spb_do_id`          | `spb_do_id`           | Lookup: old_spb_do_id → new_spb_do_id |
| `invoice_no`         | `invoice_no`          | Salin apa adanya                      |
| `invoice_date`       | `invoice_date`        | `0000-00-00` → `NULL`                 |
| `invoice_email_date` | `invoice_email_date`  | `0000-00-00` → `NULL`                 |
| `created_at`         | `created_at`          | NULL → `2024-01-01T00:00:00+00:00`    |
| `updated_at`         | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00`    |

---

## 12. MIGRASI RETURN SPB

### 12.1 Return SPB Header (tb_return_spb → return_spb)

**File sumber:** `exp_return_spb.csv`

| Kolom CSV (lama) | Kolom Supabase (baru) | Transformasi                                  |
| ---------------- | --------------------- | --------------------------------------------- |
| `rtn_id`         | —                     | **ABAIKAN**                                   |
| `rtn_kode`       | `rtn_kode`            | Salin apa adanya                              |
| `spb_id`         | `spb_id`              | Lookup: old_spb_id → new_spb_id               |
| `rtn_tanggal`    | `rtn_tanggal`         | date → timestamp: tambahkan `T00:00:00+00:00` |
| `rtn_note`       | `rtn_note`            | Salin apa adanya                              |
| `rtn_status`     | `rtn_status`          | `"posted"` → `"Posted"` (capitalize)          |
| `created_at`     | `created_at`          | NULL → `2024-01-01T00:00:00+00:00`            |
| `updated_at`     | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00`            |

### 12.2 Return SPB Detail (tb_return_spb_detail → return_spb_details)

**File sumber:** `exp_return_spb_detail.csv`

| Kolom CSV (lama)     | Kolom Supabase (baru) | Transformasi                            |
| -------------------- | --------------------- | --------------------------------------- |
| `rtn_dtl_id`         | —                     | **ABAIKAN**                             |
| `rtn_id`             | `rtn_id`              | Lookup: old_rtn_id → new_rtn_id         |
| `spb_dtl_id`         | `spb_dtl_id`          | Lookup: old_spb_dtl_id → new_spb_dtl_id |
| `part_id`            | `part_id`             | Lookup: old_part_id → new_part_id       |
| `dtl_rtn_qty_return` | `dtl_rtn_qty_return`  | Salin apa adanya                        |
| `created_at`         | `created_at`          | NULL → `2024-01-01T00:00:00+00:00`      |
| `updated_at`         | `updated_at`          | NULL → `2024-01-01T00:00:00+00:00`      |

---

## 13. VALIDASI AKHIR

Setelah semua tabel selesai diimport, jalankan query validasi berikut di Supabase SQL Editor:

### 13.1 Cek Jumlah Record

```sql
SELECT 'barang' as tabel, COUNT(*) as jumlah FROM public.barang
UNION ALL SELECT 'vendors', COUNT(*) FROM public.vendors
UNION ALL SELECT 'customers', COUNT(*) FROM public.customers
UNION ALL SELECT 'profiles', COUNT(*) FROM public.profiles
UNION ALL SELECT 'stock', COUNT(*) FROM public.stock
UNION ALL SELECT 'mrs', COUNT(*) FROM public.mrs
UNION ALL SELECT 'prs', COUNT(*) FROM public.prs
UNION ALL SELECT 'pos', COUNT(*) FROM public.pos
UNION ALL SELECT 'receives', COUNT(*) FROM public.receives
UNION ALL SELECT 'deliveries', COUNT(*) FROM public.deliveries
UNION ALL SELECT 'spb', COUNT(*) FROM public.spb
UNION ALL SELECT 'spb_details', COUNT(*) FROM public.spb_details
UNION ALL SELECT 'spb_po', COUNT(*) FROM public.spb_po
UNION ALL SELECT 'spb_do', COUNT(*) FROM public.spb_do
UNION ALL SELECT 'spb_invoice', COUNT(*) FROM public.spb_invoice
UNION ALL SELECT 'return_spb', COUNT(*) FROM public.return_spb
UNION ALL SELECT 'return_spb_details', COUNT(*) FROM public.return_spb_details
ORDER BY tabel;
```

**Jumlah yang diharapkan (perkiraan dari WMS lama):**

| Tabel       | Perkiraan Jumlah                                     |
| ----------- | ---------------------------------------------------- |
| barang      | ~15.000                                              |
| vendors     | ~150+                                                |
| customers   | ~100+ (setelah dedup ~665 asli, tapi ada data kotor) |
| profiles    | ~66 (atau kurang jika hanya yang aktif)              |
| stock       | ~tergantung dedup, bisa ~40.000+                     |
| mrs         | ~78                                                  |
| prs         | ~9                                                   |
| pos         | ~4 (mungkin 0 jika tidak ada data)                   |
| spb         | ~90                                                  |
| spb_details | ~250                                                 |

### 13.2 Cek Foreign Key Integrity

```sql
-- Stock → Barang (harus 0)
SELECT COUNT(*) as orphan_stock FROM public.stock s
WHERE NOT EXISTS (SELECT 1 FROM public.barang b WHERE b.id = s.part_id);

-- Stock → Cabang (harus 0)
SELECT COUNT(*) as orphan_stock_cabang FROM public.stock s
WHERE NOT EXISTS (SELECT 1 FROM public.cabang c WHERE c.id = s.cabang_id);

-- MRS → Cabang (harus 0)
SELECT COUNT(*) as orphan_mrs FROM public.mrs m
WHERE NOT EXISTS (SELECT 1 FROM public.cabang c WHERE c.id = m.cabang_id);

-- SPB Details → SPB (harus 0)
SELECT COUNT(*) as orphan_spb_dtl FROM public.spb_details sd
WHERE NOT EXISTS (SELECT 1 FROM public.spb s WHERE s.id = sd.spb_id);

-- SPB Details → Barang (harus 0)
SELECT COUNT(*) as orphan_spb_dtl_part FROM public.spb_details sd
WHERE NOT EXISTS (SELECT 1 FROM public.barang b WHERE b.id = sd.part_id);
```

### 13.3 Cek Data Quality

```sql
-- Tanggal yang mencurigakan
SELECT 'barang' as tabel, COUNT(*) FROM public.barang WHERE created_at < '2020-01-01'
UNION ALL SELECT 'stock', COUNT(*) FROM public.stock WHERE created_at < '2020-01-01'
UNION ALL SELECT 'mrs', COUNT(*) FROM public.mrs WHERE created_at < '2020-01-01'
UNION ALL SELECT 'spb', COUNT(*) FROM public.spb WHERE created_at < '2020-01-01';

-- Duplikat yang lolos
SELECT part_number, COUNT(*) FROM public.barang GROUP BY part_number HAVING COUNT(*) > 1;
SELECT vendor_no, COUNT(*) FROM public.vendors GROUP BY vendor_no HAVING COUNT(*) > 1;
SELECT customer_no, COUNT(*) FROM public.customers GROUP BY customer_no HAVING COUNT(*) > 1;
```

---

## TABEL YANG TIDAK DIMIGRASI

Tabel-tabel berikut dari WMS lama **TIDAK perlu dimigrasi:**

| Tabel MySQL                          | Alasan                                      |
| ------------------------------------ | ------------------------------------------- |
| `cache`, `cache_locks`               | Laravel framework, tidak relevan            |
| `sessions`                           | Laravel framework                           |
| `jobs`, `job_batches`, `failed_jobs` | Laravel queue, tidak relevan                |
| `migrations`                         | Laravel migration tracker                   |
| `password_reset_tokens`              | Diganti Supabase Auth                       |
| `personal_access_tokens`             | Diganti Supabase Auth                       |
| `tb_peminjman`                       | Tidak ada tabel equivalent di schema baru   |
| `job_costing` (detail)               | Schema sangat berbeda, perlu reentry manual |

---

## RINGKASAN LOOKUP FILES YANG DIHASILKAN

Selama proses migrasi, file-file lookup ini harus dibuat dan disimpan:

| File                    | Dibuat di Langkah | Dipakai di Langkah    |
| ----------------------- | ----------------- | --------------------- |
| `cabang_lookup.csv`     | 2                 | 5, 6, 7, 8, 9, 10, 11 |
| `barang_id_lookup.csv`  | 3.1               | 5, 6, 11, 12          |
| `vendors_lookup.csv`    | 3.2               | 8 (opsional)          |
| `users_lookup.csv`      | 4                 | 6, 7, 8               |
| `mr_lookup.csv`         | 6                 | 8, 9, 10              |
| `pr_lookup.csv`         | 7                 | 8                     |
| `spb_lookup.csv`        | 11.1              | 11.2, 11.3, 12        |
| `spb_detail_lookup.csv` | 11.2              | 12.2                  |
| `spb_po_lookup.csv`     | 11.3              | 11.4                  |
| `spb_do_lookup.csv`     | 11.4              | 11.5                  |

---

## CHECKLIST KEPUTUSAN MANUAL (Harus Diputuskan Tim Sebelum Mulai)

- [ ] Mapping semua lokasi lama ke cabang_id (Langkah 2.2)
- [ ] Role lama yang tidak ada padanannya: `warehouse`, `finance`, `marketing`, `user` → map ke mana? (Langkah 4.2 A3)
- [ ] Apakah semua 66 user dimigrasi atau hanya yang aktif? (Langkah 4.2 A1)
- [ ] Password strategy: random + kirim reset email, atau default sementara? (Langkah 4.2 A2)
- [ ] `customer_no` yang formatnya aneh dibiarkan atau di-normalize? (Langkah 3.3)
- [ ] Apakah ada tabel detail MR/PR/PO di WMS lama yang belum ter-export? (Langkah 6.2, 7.2)
- [ ] Job costing di-skip atau di-reentry manual? (Tabel Tidak Dimigrasi)
