# Deploy DB: Fitur Planning Supply + Freeze MR

Migration: `supabase/migrations/20260630000001_planning_supply.sql`

## Yang harus dijalankan di Supabase VPS (self-hosted)

Jalankan isi file migration di atas pada DB produksi (psql / SQL editor).
Ringkasan perubahan:

1. `mr_sharestock_allocations` + kolom `deadline DATE`.
2. Enum `doc_status` + value `'cancelled'` (idempotent).
3. `deliveries` + kolom `cancel_reason`, `cancelled_by`, `cancelled_at`.
4. `mrs` + kolom `is_frozen`, `frozen_at`, `frozen_reason` (+ index).
5. Tabel baru `planning_supplies` (+ RLS authenticated, index, trigger updated_at).
6. Tabel baru `mr_freeze_reports` (+ RLS authenticated, index).

> Catatan: `ALTER TYPE ... ADD VALUE 'cancelled'` dibungkus DO-block idempotent,
> aman dijalankan ulang. Value enum baru tidak dipakai di transaksi yang sama.

## Query verifikasi pasca-deploy

```sql
-- 1. Kolom deadline pada alokasi
SELECT column_name FROM information_schema.columns
WHERE table_name = 'mr_sharestock_allocations' AND column_name = 'deadline';

-- 2. Enum doc_status memuat 'cancelled'
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'doc_status'::regtype ORDER BY enumsortorder;

-- 3. Kolom pembatalan pada deliveries
SELECT column_name FROM information_schema.columns
WHERE table_name = 'deliveries'
  AND column_name IN ('cancel_reason','cancelled_by','cancelled_at');

-- 4. Kolom freeze pada mrs
SELECT column_name FROM information_schema.columns
WHERE table_name = 'mrs'
  AND column_name IN ('is_frozen','frozen_at','frozen_reason');

-- 5. Tabel baru ada + RLS aktif
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('planning_supplies','mr_freeze_reports');

-- 6. Policy authenticated terpasang
SELECT tablename, policyname FROM pg_policies
WHERE tablename IN ('planning_supplies','mr_freeze_reports');
```

Semua query di atas harus mengembalikan baris (bukan kosong), dan `relrowsecurity = true`
untuk kedua tabel baru.

## Smoke test fungsional (opsional)

1. Approve MR step terakhir dengan alokasi share stock + isi **Deadline Supply** per item.
2. Buat delivery → cek baris muncul di `planning_supplies` status `in_transit`,
   dan stok cabang sumber berkurang.
3. Terima barang (finalize) → planning supply jadi `received`, stok tujuan bertambah.
4. Batalkan delivery (moderator/admin) → planning supply jadi `cancelled` + `note`,
   stok sumber kembali.
5. Set deadline lampau lalu buka MR → `mrs.is_frozen = true`, alur terkunci,
   pembuat MR bisa lapor kendala, moderator bisa unfreeze/reset.
