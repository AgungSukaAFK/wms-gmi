# Deskripsi Tugas WMS-GMI (Backend Services)

Proyek WMS-GMI (Warehouse Management System) baru saja diinisiasi dengan framework **Next.js 16 (App Router)** dan **Supabase**. Struktur database telah dibuat dan berjalan di local (lihat `supabase/migrations/`).
Saat ini, **Server Actions dan Services** (untuk fetching dan mutasi ke Supabase) perlu dirutekan dari awal untuk menyesuaikan dengan skema baru.

## 🏗️ Aturan Pengerjaan & Konvensi
1. Semua fungsi data harus di-_refactor_ menjadi rute **Next.js Server Actions** menggunakan `@supabase/ssr` (`createServerClient`).
2. Tinjau struktur `supabase/migrations/` secara ketat. Proyek ini memakai `cabang_id` dan boolean `is_active` untuk entitas, **bukan** memakai kolom lawas seperti `nrp`, `company`, dan `department`.

---

## ✅ Task 1: Auth Services & Profiles Management
- **Login Actions**: Buat aksi untuk Supabase `signInWithPassword()`. Tambahkan logika pemblokiran *Pending Approval* jika `is_active` milik profil `=== false` sesaat setelah autentikasi.
- **Register Actions**: Pada *form* Sign-Up, pastikan pengguna wajib memilih *Cabang* sehingga Supabase Trigger menangkap isiannya dan memetakannya ke `cabang_id` di `public.profiles`. Akun di-*set* default *inactive*.
- **Logout Actions**: Panggil `signOut()`.

---

## ✅ Task 2: Master Data Services
Siapkan modul *backend* (CRUD):
- `services/cabang.ts`: Kelola daftar cabang Gudang yang valid.
- `services/barang.ts`: Kelola *Part Number*, *Part Name*, *Satuan*.
- `services/vendors.ts` dan `services/customers.ts`.

---

## ✅ Task 3: Procurement Pipeline
Harus bisa melacak perjalanan status dari Pemesanan ke Penerimaan dengan integritas data SQL (Header + Item rows):
- **MR (Material Request)**: API untuk simpan header dokumen dan insert *items* yang dipesan.
- **PR (Purchase Request)** & **PO (Purchase Order)**: Validasi perubahan / translasi rujukan *foreign Key* MR ke PR, dan PR ke PO beserta nilai harga/estimasi.
- **Receive (Goods Receipt)**: Saat status *receive confirmation* dikirim, siapkan integrasi otomatis (RSC / RPG RPC) agar qty tersebut masuk/menaikkan nilai di tabel `stock` sesuai `cabang_id` penerima.

---

## ✅ Task 4: Inventory & Distribution
- **Deliveries (`services/delivery.ts`)**: Fitur pencatatan pengiriman dari Gudang A (`dari_cabang_id`) ke Gudang B (`ke_cabang_id`) diiringi perhitungan potong mutasi stok.

**🔥 Milestone:** Selesaikan **Task 1** (Auth) dalam bentuk Server Actions (pengganti `ga-web` client components yang usang) sebagai Sprint 1!
