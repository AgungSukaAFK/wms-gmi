# Supabase Environment Guide (WMS-GMI)

Dokumen ini wajib jadi acuan saat pengembangan fitur agar tidak salah konteks database.

## 1) Arsitektur Environment

- Local development: menggunakan Supabase local (folder `supabase/`, migration lokal, URL lokal).
- Production/online: menggunakan Supabase self-hosted di VPS (bukan Supabase Cloud).
- Frontend production: jalan di Vercel dan mengarah ke Supabase VPS.

## 2) Konsekuensi Pengembangan

- Semua perubahan schema DB harus dibuat sebagai migration SQL di `supabase/migrations/`.
- Setelah fitur selesai, perubahan schema harus diterapkan juga ke Supabase VPS production.
- Jangan menganggap perubahan schema lokal otomatis sinkron ke VPS.

## 3) Sumber Kebenaran Schema

- Sumber utama schema project: folder `supabase/migrations/` di repo ini.
- State schema production dianggap valid hanya jika migration yang terpasang di VPS sudah sama dengan repo.

## 4) Workflow Wajib Saat Ada Perubahan DB

1. Buat migration baru di `supabase/migrations/<timestamp>_<deskripsi>.sql`.
2. Uji fitur di local sampai lolos.
3. Catat impact migration di deskripsi PR/task:
   - Nama migration baru.
   - Perubahan tabel/kolom/constraint/index.
   - Backfill data jika ada.
4. Saat deploy production, jalankan SQL migration ke Supabase VPS.
5. Verifikasi migration version di VPS sudah masuk.

## 5) Format Laporan Wajib (untuk AI/developer)

Setiap selesai fitur yang menyentuh DB, WAJIB sertakan blok ini di laporan:

- `DB_CHANGE`: `yes` atau `no`
- `MIGRATIONS_ADDED`: daftar file migration baru
- `SQL_TO_RUN_ON_VPS`:
  - `none` jika tidak ada perubahan DB
  - atau daftar file SQL/migration yang harus dieksekusi di VPS
- `POST_DEPLOY_CHECKS`: query verifikasi singkat

Contoh:

- DB_CHANGE: yes
- MIGRATIONS_ADDED: `supabase/migrations/20260506103000_add_xxx.sql`
- SQL_TO_RUN_ON_VPS: jalankan file migration tersebut di SQL Editor Supabase VPS
- POST_DEPLOY_CHECKS:
  - `select version from supabase_migrations.schema_migrations order by version desc limit 5;`
  - `select column_name from information_schema.columns where table_name='nama_tabel';`

## 6) Checklist Deploy Vercel + Supabase VPS

- Vercel env harus mengarah ke Supabase VPS:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Setelah update env/migration, lakukan redeploy frontend di Vercel.

## 7) Catatan Operasional

- SQL dijalankan dari SQL Editor di Supabase Studio VPS.
- Untuk perubahan enum PostgreSQL, kadang perlu dieksekusi terpisah dulu sebelum statement update data yang memakai nilai enum baru.
- Jika ada mismatch schema antara local dan VPS, jadikan migration di repo sebagai acuan rekonsiliasi.

## 8) Referensi File

- `supabase/migrations/`
- `supabase/import/20260505_sync_schema_and_seed_demo_users.sql`
- `lib/supabase/server.ts`
