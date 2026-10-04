# Modul HM Maintenance — Spesifikasi Lengkap

Spesifikasi untuk memindahkan aplikasi **"Panel Kontrol — Periodic Maintenance"** menjadi fitur di web utama (Next.js + Supabase).

Sumber aslinya adalah aplikasi Caffeine.ai di Internet Computer: backend Motoko di `src/backend/`, frontend React di `src/frontend/`. Semua aturan, rumus, urutan sortir, validasi, dan teks UI di bawah ini diambil langsung dari kode sumber tersebut. **Hasil implementasi baru harus memberi output yang sama untuk input yang sama.** Bagian 14 memuat tabel hasil yang diharapkan dari data seed sebagai acuan uji.

> Konvensi: istilah **HM** (hour meter) adalah jam kerja mesin, berupa bilangan bulat ≥ 0. Semua teks yang tampil ke pengguna berbahasa Indonesia, dan nilai HM selalu diberi akhiran "HM".

---

## Daftar isi

1. Gambaran sistem
2. Model data
3. Algoritma inti
4. Operasi (API) dan perilakunya
5. Otorisasi
6. Validasi form
7. Format tampilan
8. Ekspor CSV
9. Halaman dan UI
10. Skema Supabase (SQL)
11. Lapisan akses data Next.js
12. Referensi TypeScript (fungsi murni)
13. Data seed
14. Tabel verifikasi (hasil yang diharapkan)
15. Catatan perilaku asli yang harus diperhatikan
16. Desain visual

---

## 1. Gambaran sistem

Aplikasi ini menjadwalkan perawatan berkala alat berat berdasarkan HM. Setiap **unit** (excavator, wheel loader, dump truck, dan lain-lain) punya HM terkini dan daftar **part** dengan interval penggantian dalam HM. Sistem menghitung kapan setiap part jatuh tempo, menandai statusnya, dan menyimpan riwayat penggantian part serta riwayat servis umum.

**Fitur:**

- Jadwal prioritas semua part dari semua unit, yang paling mendesak tampil paling atas.
- Daftar unit dengan ringkasan status part per unit.
- Detail unit: daftar part dan interval, kode part, stok di gudang, riwayat penggantian per part, dan riwayat servis umum.
- Admin bisa membuat, mengubah, dan menghapus unit dan part, memperbarui HM unit, mencatat penggantian part, dan mencatat servis.
- Admin bisa mengekspor seluruh riwayat (penggantian dan servis) ke CSV.

**Peran:**

| Peran | Hak |
|---|---|
| Publik / pengunjung (tanpa login) | Membaca semua data: jadwal, unit, part, riwayat |
| User login non-admin | Sama dengan publik (tidak boleh menulis) |
| Admin | Semua operasi tulis dan ekspor CSV |

---

## 2. Model data

Semua ID adalah bilangan bulat yang bertambah otomatis per entitas, dimulai dari 0 di sistem asli. Semua nilai HM, interval, dan stok adalah bilangan bulat ≥ 0. Satu-satunya nilai bertanda adalah `remainingHm`.

### 2.1 Unit

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | int | PK |
| `code` | text | Kode unit, mis. `EXC-01`. **Tidak dibuat unik** di sistem asli |
| `name` | text | Nama unit, mis. `Excavator Tambang Utara` |
| `model` | text | Model, mis. `Komatsu PC200` |
| `currentHm` | int ≥ 0 | HM terkini unit |

### 2.2 Part

Setiap part terikat ke satu unit. Part dengan nama sama di unit berbeda adalah baris yang berbeda.

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | int | PK |
| `unitId` | int | FK ke Unit. **Tidak bisa diubah** setelah dibuat |
| `code` | text | Kode part, mis. `FLT-OLI` |
| `name` | text | Nama part |
| `intervalHm` | int | Interval penggantian dalam HM (form mensyaratkan > 0) |
| `lastReplacementHm` | int ≥ 0 | HM saat terakhir diganti, yaitu awal interval berjalan |
| `stockOnHand` | int ≥ 0 | Stok di gudang. **Hanya diubah manual** lewat form part |

### 2.3 Replacement (riwayat penggantian part)

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | int | PK |
| `partId` | int | FK ke Part |
| `unitId` | int | FK ke Unit. Disalin otomatis dari `part.unitId` saat dicatat |
| `hm` | int ≥ 0 | HM unit saat penggantian |
| `date` | timestamp | Tanggal penggantian. Asli: nanodetik sejak epoch; baru: `timestamptz` |
| `note` | text | Catatan, boleh kosong |

### 2.4 ServiceRecord (riwayat servis umum)

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | int | PK |
| `unitId` | int | FK ke Unit |
| `kind` | enum | `rutin` \| `perbaikan` \| `inspeksi` |
| `date` | timestamp | Tanggal servis |
| `hm` | int ≥ 0 | HM saat servis |
| `note` | text | Catatan, boleh kosong |

Label tampilan `kind`: `rutin` → "Servis Rutin", `perbaikan` → "Perbaikan", `inspeksi` → "Inspeksi".

### 2.5 Data turunan (dihitung, tidak disimpan)

**PartView** adalah Part ditambah field berikut:

| Field | Tipe | Rumus |
|---|---|---|
| `dueHm` | int | `lastReplacementHm + intervalHm` |
| `remainingHm` | int (bisa negatif) | `dueHm − unit.currentHm` |
| `status` | `aman` \| `segera` \| `lewat` | lihat §3.2 |
| `replacedThisInterval` | bool | lihat §3.3 |

**UnitSummary** adalah Unit ditambah `partCount`, `amanCount`, `segeraCount`, `lewatCount`, `notReplacedCount` (lihat §3.6).

**UnitDetail** berisi `{ unit, parts: PartView[] }`.

**HistoryRow** adalah gabungan penggantian dan servis untuk CSV (lihat §3.10):
`{ kind, unitCode, unitName, partName, serviceKind, date, hm, note }`.

---

## 3. Algoritma inti

### 3.1 Jatuh tempo dan sisa HM

```
dueHm       = part.lastReplacementHm + part.intervalHm
remainingHm = dueHm − unit.currentHm          // bilangan bertanda
```

Jika unit tidak ditemukan (kasus yang seharusnya tidak terjadi), `currentHm` dianggap **0**.

Contoh: EXC-03 dengan HM 3260, part Oli Mesin dengan interval 250 dan HM ganti terakhir 3000. Maka `dueHm = 3250` dan `remainingHm = 3250 − 3260 = −10`, sehingga statusnya **Lewat**.

### 3.2 Status part

Ambang batas "segera" adalah konstanta **50 HM** (`soonThreshold`).

```
if remainingHm <= 0   → "lewat"   (label: Lewat)
elif remainingHm <= 50 → "segera" (label: Segera)
else                   → "aman"   (label: Aman)
```

Nilai batas:

| remainingHm | Status |
|---|---|
| −10, 0 | Lewat |
| 1, 50 | Segera |
| 51 | Aman |

Legenda di footer: "Aman — sisa > 50 HM", "Segera — sisa 0–50 HM", "Lewat — sisa ≤ 0 HM". Teks legenda "0–50" memang kurang tepat (0 sebenarnya masuk Lewat), tetapi **aturan kodenya yang berlaku**.

### 3.3 `replacedThisInterval` (sudah diganti pada interval berjalan)

```
replacedThisInterval(part) =
  ADA replacement r dengan r.partId == part.id DAN r.hm >= part.lastReplacementHm
```

Aturan ini dipakai persis seperti itu. Implikasinya dibahas di §15.1.

### 3.4 Status penggantian di UI (kolom "Penggantian")

```
if part.replacedThisInterval:
    state = "replaced", overdue = false          → "Sudah diganti" (hijau, ikon centang)
else:
    state = "pending", overdue = (status == "lewat")
    overdue  → "Belum diganti" versi peringatan: merah, ikon segitiga berdenyut,
               title = "Part sudah lewat jatuh tempo dan belum ada catatan penggantian pada interval berjalan."
               aria-label = "Belum diganti — part sudah lewat jatuh tempo tanpa catatan penggantian"
    !overdue → "Belum diganti" (abu-abu, ikon lingkaran kosong)
```

### 3.5 Status terburuk unit (warna rail kartu dan badge unit)

```
if lewatCount > 0  → "lewat"
elif segeraCount > 0 → "segera"
else               → "aman"     // termasuk unit tanpa part
```

### 3.6 Ringkasan unit (UnitSummary)

Untuk setiap unit, iterasi semua part milik unit tersebut, hitung PartView-nya, lalu:

```
partCount        = jumlah part
amanCount        = jumlah part dengan status aman
segeraCount      = jumlah part dengan status segera
lewatCount       = jumlah part dengan status lewat
notReplacedCount = jumlah part dengan replacedThisInterval == false
```

Daftar unit diurutkan berdasarkan `unit.id` dari kecil ke besar.

### 3.7 Urutan jadwal (listSchedule)

Jadwal berisi **semua part dari semua unit** sebagai PartView, diurutkan:

1. Berdasarkan peringkat urgensi: `lewat` = 0, `segera` = 1, `aman` = 2 (naik).
2. Jika peringkatnya sama, berdasarkan `remainingHm` (naik, paling kecil atau paling negatif di atas).
3. Jika masih sama, urutan sisip asli (sortir stabil). Ini **setara dengan `id` naik**. Hasilnya sudah diverifikasi pada data seed (§14).

SQL: `order by status_rank, remaining_hm, id`.

### 3.8 Mencatat penggantian part (recordReplacement)

Prosesnya atomik dalam satu transaksi:

```
part = cari part by partId; jika tidak ada → kembalikan null (tidak ada perubahan)
buat replacement { partId, unitId = part.unitId, hm, date, note }
jika hm > part.lastReplacementHm:          // strictly greater
    part.lastReplacementHm = hm            // field lain tidak berubah
kembalikan replacement
```

Yang perlu dicatat:

- HM yang **sama atau lebih kecil** dari `lastReplacementHm` tetap disimpan sebagai riwayat, tetapi tidak menggeser jatuh tempo.
- `stockOnHand` **tidak** berkurang.
- `unit.currentHm` **tidak** ikut diperbarui.
- Tidak ada validasi bahwa `hm <= unit.currentHm`.

### 3.9 Hapus berantai

- **Hapus unit**: unit, semua part unit tersebut, semua replacement dengan `unitId` itu, dan semua servis unit itu ikut terhapus. Hasilnya `false` jika unit tidak ada.
- **Hapus part**: part dan semua replacement dengan `partId` itu ikut terhapus. Hasilnya `false` jika part tidak ada.

### 3.10 Riwayat gabungan (listHistory, untuk CSV)

```
rows = []
untuk setiap replacement (urutan id naik):
    unit = units[replacement.unitId]   (jika tidak ada: unitCode = "", unitName = "")
    part = parts[replacement.partId]   (jika tidak ada: partName = "")
    rows.add { kind: "Penggantian Part", unitCode, unitName, partName,
               serviceKind: "", date, hm, note }
untuk setiap service (urutan id naik):
    unit = units[service.unitId]
    rows.add { kind: "Servis Umum", unitCode, unitName, partName: "",
               serviceKind: "rutin"|"perbaikan"|"inspeksi", date, hm, note }
urutkan rows berdasarkan date TURUN, stabil
```

Jika tanggalnya sama, penggantian tampil sebelum servis, lalu berdasarkan id naik. SQL: `order by date desc, kind_order, id`.

### 3.11 Urutan daftar lainnya

| Daftar | Urutan |
|---|---|
| `listUnits` | `unit.id` naik |
| `listParts(unitId)` / `getUnitDetail.parts` | urutan sisip, yaitu `part.id` naik (**tidak** diurutkan per status) |
| `listReplacements(partId)` | `date` turun (lalu `id` naik) |
| `listServices(unitId)` | `date` turun (lalu `id` naik) |

---

## 4. Operasi (API) dan perilakunya

### 4.1 Baca (publik)

| Operasi | Input | Output | Catatan |
|---|---|---|---|
| `listUnits` | – | `UnitSummary[]` | §3.6, urut id |
| `getUnitDetail` | `unitId` | `UnitDetail \| null` | `null` jika unit tidak ada |
| `listSchedule` | – | `PartView[]` | §3.7 |
| `listParts` | `unitId` | `PartView[]` | Unit tidak ada: `currentHm = 0`, hasil part kosong |
| `listReplacements` | `partId` | `Replacement[]` | §3.11 |
| `listServices` | `unitId` | `ServiceRecord[]` | §3.11 |
| `listHistory` | – | `HistoryRow[]` | §3.10. Hanya dipakai tombol ekspor (admin) |
| `isCallerAdmin` | – | `boolean` | |

### 4.2 Tulis (admin saja)

Jika pemanggil bukan admin, operasi gagal dengan pesan **"Tidak diizinkan: hanya admin"**.

| Operasi | Input | Output | Perilaku |
|---|---|---|---|
| `createUnit` | code, name, model, currentHm | `Unit` | Membuat unit dengan id baru |
| `updateUnit` | unitId, code, name, model | `Unit \| null` | Hanya mengubah code, name, model. **`currentHm` tidak berubah** walaupun form mengirimnya (§15.3). `null` jika unit tidak ada |
| `updateUnitHm` | unitId, currentHm | `Unit \| null` | Hanya mengubah `currentHm`. Boleh turun maupun naik |
| `deleteUnit` | unitId | `boolean` | Hapus berantai (§3.9) |
| `createPart` | unitId, code, name, intervalHm, lastReplacementHm, stockOnHand | `Part \| null` | `null` jika unit tidak ada |
| `updatePart` | partId, code, name, intervalHm, lastReplacementHm, stockOnHand | `Part \| null` | `unitId` tetap. `lastReplacementHm` boleh diubah bebas, naik maupun turun. `null` jika part tidak ada |
| `deletePart` | partId | `boolean` | Hapus berantai (§3.9) |
| `recordReplacement` | partId, hm, date, note | `Replacement \| null` | §3.8 |
| `recordService` | unitId, kind, date, hm, note | `ServiceRecord \| null` | `null` jika unit tidak ada. Tidak mengubah data lain |

Backend tidak memvalidasi isi teks atau angka. Semua validasi ada di form (§6).

---

## 5. Otorisasi

**Sistem asli:** login memakai Internet Identity. Pengguna terautentikasi **pertama** yang menginisialisasi access control menjadi admin, dan yang berikutnya menjadi user biasa. Pengguna anonim tidak pernah bisa menjadi admin. Semua query baca terbuka untuk publik.

**Di web utama:** pakai Supabase Auth dan sistem peran yang sudah ada. Yang wajib dipertahankan:

- Baca terbuka untuk publik. Jika di web utama modul ini harus di balik login, ubah policy `select` ke `authenticated`. Itu keputusan produk, bukan bagian dari logika.
- Semua operasi tulis hanya untuk admin, ditegakkan di **database (RLS)**, bukan hanya di UI.
- Di UI, tombol admin muncul hanya jika `isCallerAdmin` bernilai true. Tombol login/logout ada di header.

Mekanisme "pengguna pertama menjadi admin" **tidak perlu** ditiru. Admin ditetapkan lewat fungsi `hm_is_admin()` (§10), yang bisa diarahkan ke tabel peran web utama.

---

## 6. Validasi form

Semua input angka di-parse dengan `parseHmInput` (§7): **semua karakter non-digit dibuang** lalu diubah ke bilangan. Akibatnya `"1.250"` menjadi 1250, `"-5"` menjadi 5, `"abc"` atau string kosong menjadi `null` (tidak valid). Teks di-`trim()` sebelum dikirim. Validasi dijalankan berurutan dan berhenti di error pertama. Pesan error tampil di bawah form.

### 6.1 Form Unit ("Tambah Unit" / "Ubah Unit")

Field: Kode Unit (placeholder `EXC-01`), Nama Unit (`Excavator Tambang Blok A`), Model (`Komatsu PC200`), HM Terkini (`4820`).

1. Kode, nama, atau model kosong setelah trim: "Kode, nama, dan model unit wajib diisi."
2. HM tidak valid: "HM terkini harus berupa angka."

Deskripsi dialog: "Data unit dipakai untuk menghitung jatuh tempo seluruh part." Tombol: "Batal", "Simpan Unit" ("Menyimpan…" saat proses). Dalam mode ubah, field diisi nilai unit saat ini, **termasuk HM** (lihat §15.3).

### 6.2 Form Part ("Tambah Part" / "Ubah Part")

Field: Kode Part (`FLT-OLI-250`), Nama Part (`Filter Oli Mesin`), Interval (HM) (`250`), HM Ganti Terakhir (`4500`), Stock on Hand (`12`).

1. Kode kosong: "Kode part wajib diisi."
2. Nama kosong: "Nama part wajib diisi."
3. Interval tidak valid atau ≤ 0: "Interval HM harus berupa angka lebih dari 0."
4. HM ganti terakhir tidak valid: "HM ganti terakhir harus berupa angka."
5. Stok tidak valid: "Stock on hand harus berupa angka."

Deskripsi dialog: "Jatuh tempo dihitung dari HM ganti terakhir + interval part." Tombol "Simpan Part".

### 6.3 Form Catat Penggantian

Judul "Catat Penggantian". Deskripsi: "`{nama part}` — HM ganti terakhir dan jatuh tempo akan dihitung ulang."
Field: HM Saat Ganti (default `unit.currentHm`), Tanggal (`<input type="date">`, default hari ini), Catatan (textarea, placeholder "Mekanik, kondisi part, merek filter…").

1. HM tidak valid: "HM saat ganti harus berupa angka."
2. Tanggal kosong atau tidak valid: "Tanggal penggantian wajib diisi."

Tanggal dari input diubah menjadi **tengah malam waktu lokal** pada tanggal itu (`new Date(y, m-1, d)`). Tombol "Simpan Penggantian".

### 6.4 Form Catat Servis Umum

Judul "Catat Servis Umum". Deskripsi: "Servis rutin, perbaikan, atau inspeksi unit."
Field: Jenis Servis (select, default `rutin`), Tanggal (default hari ini), HM Saat Servis (default `unit.currentHm`), Catatan (placeholder "Pekerjaan yang dilakukan, temuan, spare part…").

1. HM tidak valid: "HM servis harus berupa angka."
2. Tanggal kosong: "Tanggal servis wajib diisi."

Tombol "Simpan Servis".

### 6.5 Dialog Perbarui HM Unit

Judul "Perbarui HM Unit". Deskripsi: "HM terkini dipakai untuk menghitung sisa HM seluruh part." Field HM Terkini, terisi `currentHm` saat dialog dibuka.
Error: "HM harus berupa angka." Tombol "Simpan HM".

### 6.6 Dialog konfirmasi hapus

- **Hapus Part**: "Part “{nama}” beserta riwayat penggantiannya akan dihapus. Tindakan ini tidak dapat dibatalkan." Tombol "Batal" dan "Hapus Part" ("Menghapus…").
- **Hapus Unit**: "Unit {kode} beserta seluruh part dan riwayatnya akan dihapus. Tindakan ini tidak dapat dibatalkan." Tombol "Hapus Unit". Setelah berhasil, pengguna diarahkan ke `/unit`.

### 6.7 Toast

| Aksi | Sukses | Gagal |
|---|---|---|
| Tambah unit | Unit ditambahkan | Gagal menambahkan unit |
| Ubah unit | Unit diperbarui | Gagal memperbarui unit |
| Perbarui HM | HM unit diperbarui | Gagal memperbarui HM |
| Hapus unit | Unit dihapus | Gagal menghapus unit |
| Tambah part | Part ditambahkan | Gagal menambahkan part |
| Ubah part | Part diperbarui | Gagal memperbarui part |
| Hapus part | Part dihapus | Gagal menghapus part |
| Catat penggantian | Penggantian dicatat | Gagal mencatat penggantian |
| Catat servis | Servis dicatat | Gagal mencatat servis |
| Ekspor CSV | Riwayat diekspor ke CSV | Gagal mengekspor riwayat. Coba lagi. |
| Ekspor CSV kosong | (info) Tidak ada riwayat untuk diekspor | – |

Setelah mutasi apa pun berhasil, **semua** data dimuat ulang: unit, jadwal, detail unit, part, replacement, dan servis. Di Next.js: `revalidatePath` untuk route modul ini, atau invalidasi seluruh query key modul.

---

## 7. Format tampilan

Locale yang dipakai adalah `id-ID`, sehingga pemisah ribuan berupa titik.

| Fungsi | Aturan | Contoh |
|---|---|---|
| `formatHm(v)` | `v.toLocaleString("id-ID") + " HM"` | `12450` → `12.450 HM` |
| `formatRemaining(v)` | Tanda `+` jika v > 0, 0 tanpa tanda, negatif dengan `-` | `130` → `+130 HM`; `0` → `0 HM`; `-10` → `-10 HM` |
| `formatCount(v)` | `v.toLocaleString("id-ID")` | `1250` → `1.250` |
| `formatDate(d)` | `Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" })`. Tanggal tidak valid → `—` | `12 Agu 2025` |
| `parseHmInput(s)` | Buang semua non-digit; kosong → `null`; selain itu bilangan | `"1.250"` → `1250` |
| Teks kosong | Kode part atau catatan kosong ditampilkan `—` | |

Warna sel "Sisa HM" mengikuti status: lewat = destructive (merah), segera = warning (kuning), aman = success (hijau).

> Catatan Next.js: di sistem asli, `formatDate` berjalan di browser dengan zona waktu lokal. Jika diformat di Server Component, set `timeZone: "Asia/Jakarta"` (atau zona waktu operasional) agar tanggal tidak bergeser.

---

## 8. Ekspor CSV

- Tombol "Ekspor CSV" (ikon download) **hanya tampil untuk admin**. Tombol ini ada di halaman Jadwal dan Detail Unit, dan di kedua halaman **selalu mengekspor riwayat seluruh unit**.
- Data yang diekspor: `listHistory` (§3.10), diambil ulang saat tombol diklik. Saat proses, label tombol menjadi "Menyiapkan…".
- Jika tidak ada baris, tampilkan toast info "Tidak ada riwayat untuk diekspor" dan tidak ada file yang diunduh.
- Header kolom (urutan tetap): `Jenis,Kode Unit,Nama Unit,Part,Jenis Servis,Tanggal,HM,Catatan`
- Isi per baris:

| Kolom | Penggantian Part | Servis Umum |
|---|---|---|
| Jenis | `Penggantian Part` | `Servis Umum` |
| Kode Unit / Nama Unit | dari unit | dari unit |
| Part | nama part | kosong |
| Jenis Servis | kosong | `rutin` / `perbaikan` / `inspeksi` (nilai mentah, huruf kecil) |
| Tanggal | `formatDate` (mis. `12 Agu 2025`) | sama |
| HM | angka **tanpa** pemisah ribuan dan tanpa "HM" | sama |
| Catatan | note | note |

  Penentuan jenis baris: `row.kind.trim().toLowerCase().startsWith("penggantian")`.

- Escape: field yang mengandung `"`, `,`, CR, atau LF dibungkus tanda kutip ganda, dan `"` di dalamnya digandakan menjadi `""`.
- Pemisah baris: **CRLF** (`\r\n`). File diawali **BOM UTF-8** (`﻿`) agar terbaca benar di Excel.
- MIME type: `text/csv;charset=utf-8`. Nama file: `riwayat-servis-YYYY-MM-DD.csv`, memakai tanggal lokal saat ekspor.

---

## 9. Halaman dan UI

Di web utama, letakkan route di bawah prefix modul, misalnya `/maintenance`. Path di bawah ini relatif terhadap prefix tersebut.

### 9.1 Layout modul

- **Header** (sticky): logo ikon gauge, judul "Panel Kontrol" dan subjudul "Periodic Maintenance". Navigasi: "Jadwal" (`/`, aktif hanya jika path persis sama) dan "Unit" (`/unit`). Di kanan: badge "Admin" serta tombol "Keluar" saat login, atau tombol "Masuk Admin" ("Menghubungkan…" saat proses).
- **Footer**: "Legenda Status" dengan tiga titik warna (§3.2). Tautan "Built with caffeine.ai" **tidak perlu** dibawa.

### 9.2 `/` — Jadwal

- Label "Jadwal Periodic Maintenance", judul "Prioritas Penggantian Part". Deskripsi: "Part paling mendesak ditampilkan paling atas. Jatuh tempo dihitung dari HM ganti terakhir ditambah interval part."
- Tombol: Ekspor CSV (admin) dan "Muat Ulang" (memuat ulang jadwal dan unit; ikon berputar saat proses).
- **Strip ringkasan** (4 angka): Total Part, Lewat (merah), Segera (kuning), Aman (hijau). Dihitung dari hasil `listSchedule`.
- Jika gagal memuat: "Gagal memuat jadwal dari backend. Periksa koneksi lalu coba lagi." dengan tombol "Coba Lagi".
- **Tabel Jadwal** (judul "Tabel Jadwal", tautan "Lihat semua unit →"). Kolom:
  `[rail status 3px] | Kode Part | Part (tautan ke detail unit) | Unit (kode unit) | Interval | HM Ganti Terakhir | HM Jatuh Tempo | Sisa HM | Stock on Hand | Status (badge) | Penggantian (§3.4)`
  Kolom angka rata kanan dengan font mono. Header tabel sticky.
- Jika kosong: "Belum ada part terjadwal". Teks tambahan: "Tambahkan part pada halaman detail unit untuk mulai memantau jatuh tempo."
- Di bawahnya: **Ringkasan Unit** ("{n} unit") berupa grid kartu unit (§9.5).

### 9.3 `/unit` — Daftar Unit

- Label "Manajemen Unit", judul "Armada & HM Terkini". Deskripsi: "Setiap unit punya daftar part sendiri dengan interval HM yang berbeda. Klik unit untuk melihat detail part dan riwayat servis."
- Tombol: "Muat Ulang" dan "Tambah Unit" (admin, membuka form §6.1).
- **Strip ringkasan**: Jumlah Unit, Total Part (Σ `partCount`), Part Lewat (Σ `lewatCount`), Part Segera (Σ `segeraCount`).
- Jika gagal memuat: "Gagal memuat daftar unit dari backend." dengan tombol "Coba Lagi".
- Grid kartu unit (§9.5).

### 9.4 `/unit/[unitId]` — Detail Unit

- Tautan "← Semua Unit". Jika `unitId` tidak valid atau unit tidak ada: "Unit tidak ditemukan", "Unit mungkin sudah dihapus atau tautan tidak valid.", tombol "Kembali ke Daftar Unit".
- Header: label = model, judul = kode unit, subjudul = nama. Tombol: Ekspor CSV (admin), "Ubah Unit" (admin), "Hapus Unit" (admin, merah).
- **Panel HM Terkini Unit**: angka besar `formatHm(currentHm)`. Admin melihat tombol "Perbarui HM" (§6.5). Non-admin melihat "Masuk sebagai admin untuk memperbarui HM."
- **Ringkasan Status Part** (5 angka): Total Part, Lewat, Segera, Aman (dihitung dari `detail.parts`), dan **Belum diganti** (= `notReplacedCount` dari `listUnits` untuk unit ini).
- **Daftar Part & Interval** (subjudul "Jatuh tempo = HM ganti terakhir + interval part", tombol "Tambah Part" untuk admin). Kolom:
  `[rail] | Kode Part | Nama Part | Interval | HM Ganti Terakhir | HM Jatuh Tempo | Sisa HM | Stock on Hand | Status | Penggantian | Aksi`
  Aksi: ikon Riwayat (semua orang), Ubah dan Hapus (admin). Urutan baris mengikuti §3.11 (id naik).
  Jika kosong: "Unit ini belum punya part". Admin melihat "Tambahkan part beserta interval HM untuk mulai memantau jatuh tempo." dan tombol "Tambah Part". Non-admin melihat "Masuk sebagai admin untuk menambahkan part."
- **Dialog Riwayat Penggantian** (dari ikon Riwayat): judul "Riwayat Penggantian", deskripsi "{nama part} — urut dari yang terbaru." Tabel Tanggal | HM | Catatan dengan tinggi maksimal ±22rem dan scroll. Jika kosong: "Belum ada penggantian tercatat untuk part ini." Tombol "Tutup", dan untuk admin "Catat Penggantian" yang menutup dialog ini lalu membuka form §6.3.
- **Riwayat Servis Umum** (subjudul "Servis rutin, perbaikan, dan inspeksi unit", tombol "Catat Servis" untuk admin). Tabel Jenis (label) | Tanggal | HM | Catatan (dipotong). Jika kosong: "Belum ada riwayat servis". Admin melihat "Catat servis rutin, perbaikan, atau inspeksi unit ini." Non-admin melihat "Masuk sebagai admin untuk mencatat servis."

### 9.5 Kartu unit

Seluruh kartu adalah tautan ke `/unit/{id}`. Isi kartu:
- Rail kiri 3px berwarna status terburuk (§3.5).
- Kode unit (tebal), nama, model, dan badge status terburuk.
- "HM Terkini" (`formatHm`) dan "Part" (`partCount`).
- Baris hitungan: `{aman} Aman`, `{segera} Segera`, `{lewat} Lewat`, dan panah →.
- Grid responsif: 1 kolom, lalu 2 (sm), 3 (lg), 4 (xl).
- Jika tidak ada unit: "Belum ada unit terdaftar", "Masuk sebagai admin untuk menambahkan unit dan daftar part-nya."

### 9.6 Status loading

Semua tabel dan grid memakai skeleton saat memuat: jadwal 6 baris, part 5 baris, servis dan riwayat 3 baris, kartu unit 8.

---

## 10. Skema Supabase (SQL)

Semua objek diberi prefix `hm_` agar tidak bentrok dengan tabel web utama. Jalankan sebagai migration.

```sql
-- ============ Tabel ============
create table hm_units (
  id          bigint generated by default as identity primary key,
  code        text   not null,
  name        text   not null,
  model       text   not null,
  current_hm  integer not null default 0 check (current_hm >= 0),
  created_at  timestamptz not null default now()
);

create table hm_parts (
  id                  bigint generated by default as identity primary key,
  unit_id             bigint  not null references hm_units(id) on delete cascade,
  code                text    not null,
  name                text    not null,
  interval_hm         integer not null check (interval_hm >= 0),
  last_replacement_hm integer not null check (last_replacement_hm >= 0),
  stock_on_hand       integer not null default 0 check (stock_on_hand >= 0),
  created_at          timestamptz not null default now()
);
create index hm_parts_unit_id_idx on hm_parts(unit_id);

create table hm_replacements (
  id         bigint generated by default as identity primary key,
  part_id    bigint  not null references hm_parts(id) on delete cascade,
  unit_id    bigint  not null references hm_units(id) on delete cascade,
  hm         integer not null check (hm >= 0),
  date       timestamptz not null,
  note       text    not null default '',
  created_at timestamptz not null default now()
);
create index hm_replacements_part_hm_idx on hm_replacements(part_id, hm);
create index hm_replacements_unit_id_idx on hm_replacements(unit_id);

create type hm_service_kind as enum ('rutin', 'perbaikan', 'inspeksi');

create table hm_services (
  id         bigint generated by default as identity primary key,
  unit_id    bigint  not null references hm_units(id) on delete cascade,
  kind       hm_service_kind not null,
  date       timestamptz not null,
  hm         integer not null check (hm >= 0),
  note       text    not null default '',
  created_at timestamptz not null default now()
);
create index hm_services_unit_id_idx on hm_services(unit_id);

-- `unit_id` pada part tidak boleh berubah (sesuai updatePart asli).
create function hm_parts_lock_unit() returns trigger language plpgsql as $$
begin
  if new.unit_id <> old.unit_id then
    raise exception 'unit_id part tidak dapat diubah';
  end if;
  return new;
end $$;
create trigger hm_parts_lock_unit before update on hm_parts
  for each row execute function hm_parts_lock_unit();

-- ============ Admin ============
-- Ganti isi fungsi ini dengan sistem peran web utama (mis. profiles.role = 'admin').
create table hm_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create function hm_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from hm_admins where user_id = auth.uid());
$$;

-- ============ View turunan (logika §3) ============
create view hm_part_views with (security_invoker = true) as
select
  p.id,
  p.unit_id,
  p.code,
  p.name,
  p.interval_hm,
  p.last_replacement_hm,
  p.stock_on_hand,
  (p.last_replacement_hm + p.interval_hm)                                   as due_hm,
  (p.last_replacement_hm + p.interval_hm) - coalesce(u.current_hm, 0)       as remaining_hm,
  case
    when (p.last_replacement_hm + p.interval_hm) - coalesce(u.current_hm, 0) <= 0  then 'lewat'
    when (p.last_replacement_hm + p.interval_hm) - coalesce(u.current_hm, 0) <= 50 then 'segera'
    else 'aman'
  end                                                                       as status,
  case
    when (p.last_replacement_hm + p.interval_hm) - coalesce(u.current_hm, 0) <= 0  then 0
    when (p.last_replacement_hm + p.interval_hm) - coalesce(u.current_hm, 0) <= 50 then 1
    else 2
  end                                                                       as status_rank,
  exists (
    select 1 from hm_replacements r
    where r.part_id = p.id and r.hm >= p.last_replacement_hm
  )                                                                         as replaced_this_interval
from hm_parts p
left join hm_units u on u.id = p.unit_id;

-- Jadwal: select * from hm_part_views order by status_rank, remaining_hm, id;
-- Part per unit: select * from hm_part_views where unit_id = $1 order by id;

create view hm_unit_summaries with (security_invoker = true) as
select
  u.id, u.code, u.name, u.model, u.current_hm,
  count(v.id)                                          as part_count,
  count(v.id) filter (where v.status = 'aman')         as aman_count,
  count(v.id) filter (where v.status = 'segera')       as segera_count,
  count(v.id) filter (where v.status = 'lewat')        as lewat_count,
  count(v.id) filter (where not v.replaced_this_interval) as not_replaced_count
from hm_units u
left join hm_part_views v on v.unit_id = u.id
group by u.id;
-- Urutan: order by id

create view hm_history with (security_invoker = true) as
select
  'Penggantian Part'::text as kind,
  0                        as kind_order,
  r.id,
  coalesce(u.code, '')     as unit_code,
  coalesce(u.name, '')     as unit_name,
  coalesce(p.name, '')     as part_name,
  ''::text                 as service_kind,
  r.date, r.hm, r.note
from hm_replacements r
left join hm_units u on u.id = r.unit_id
left join hm_parts p on p.id = r.part_id
union all
select
  'Servis Umum', 1, s.id,
  coalesce(u.code, ''), coalesce(u.name, ''), '',
  s.kind::text, s.date, s.hm, s.note
from hm_services s
left join hm_units u on u.id = s.unit_id;
-- Urutan: order by date desc, kind_order, id

-- ============ RPC: catat penggantian (§3.8, atomik) ============
create function hm_record_replacement(
  p_part_id bigint, p_hm integer, p_date timestamptz, p_note text
) returns hm_replacements
language plpgsql security invoker as $$
declare
  v_part hm_parts;
  v_rep  hm_replacements;
begin
  if not hm_is_admin() then
    raise exception 'Tidak diizinkan: hanya admin';
  end if;

  select * into v_part from hm_parts where id = p_part_id for update;
  if not found then
    return null;
  end if;

  insert into hm_replacements (part_id, unit_id, hm, date, note)
  values (v_part.id, v_part.unit_id, p_hm, p_date, coalesce(p_note, ''))
  returning * into v_rep;

  if p_hm > v_part.last_replacement_hm then
    update hm_parts set last_replacement_hm = p_hm where id = v_part.id;
  end if;

  return v_rep;
end $$;

-- ============ RLS ============
alter table hm_units        enable row level security;
alter table hm_parts        enable row level security;
alter table hm_replacements enable row level security;
alter table hm_services     enable row level security;
alter table hm_admins       enable row level security;

-- Baca: publik (sesuai aslinya). Ganti `anon, authenticated` → `authenticated` jika modul wajib login.
create policy hm_units_read        on hm_units        for select to anon, authenticated using (true);
create policy hm_parts_read        on hm_parts        for select to anon, authenticated using (true);
create policy hm_replacements_read on hm_replacements for select to anon, authenticated using (true);
create policy hm_services_read     on hm_services     for select to anon, authenticated using (true);

-- Tulis: admin saja.
create policy hm_units_write        on hm_units        for all to authenticated using (hm_is_admin()) with check (hm_is_admin());
create policy hm_parts_write        on hm_parts        for all to authenticated using (hm_is_admin()) with check (hm_is_admin());
create policy hm_replacements_write on hm_replacements for all to authenticated using (hm_is_admin()) with check (hm_is_admin());
create policy hm_services_write     on hm_services     for all to authenticated using (hm_is_admin()) with check (hm_is_admin());

create policy hm_admins_self_read on hm_admins for select to authenticated using (user_id = auth.uid());

grant select on hm_part_views, hm_unit_summaries, hm_history to anon, authenticated;
grant execute on function hm_is_admin() to anon, authenticated;
grant execute on function hm_record_replacement(bigint, integer, timestamptz, text) to authenticated;
```

Catatan skema:

- `check (interval_hm >= 0)` dipakai alih-alih `> 0` agar setara dengan backend asli, yang menerima 0. Aturan "> 0" hanya ditegakkan oleh form.
- Hapus berantai ditangani oleh `on delete cascade`. Replacement terhapus baik lewat `part_id` maupun `unit_id`, sama seperti §3.9.
- `createPart` atau `recordService` untuk unit yang tidak ada akan gagal karena FK. Di lapisan aksi, perlakukan kegagalan ini sebagai hasil `null` atau toast gagal.
- `hm_history` hanya dipakai untuk ekspor (admin). Jika ingin ditutup dari publik, cek admin di server action sebelum query.

---

## 11. Lapisan akses data Next.js

Struktur yang disarankan, dengan route di bawah `app/(main)/maintenance/`:

```
maintenance/
  layout.tsx                 # header nav modul + footer legenda
  page.tsx                   # Jadwal (Server Component)
  unit/page.tsx              # Daftar unit
  unit/[unitId]/page.tsx     # Detail unit
  actions.ts                 # Server Actions (mutasi), revalidatePath('/maintenance', 'layout')
  lib/hm.ts                  # fungsi murni §12 + format §7 + csv §8
  components/                # ScheduleTable, PartTable, UnitCard, StatusBadge, forms, ExportCsvButton
```

| Operasi | Implementasi Supabase |
|---|---|
| listUnits | `from('hm_unit_summaries').select('*').order('id')` |
| getUnitDetail | `from('hm_units').select('*').eq('id', id).maybeSingle()` + `from('hm_part_views').select('*').eq('unit_id', id).order('id')` |
| listSchedule | `from('hm_part_views').select('*').order('status_rank').order('remaining_hm').order('id')` |
| listReplacements | `from('hm_replacements').select('*').eq('part_id', id).order('date', { ascending: false }).order('id')` |
| listServices | `from('hm_services').select('*').eq('unit_id', id).order('date', { ascending: false }).order('id')` |
| listHistory | `from('hm_history').select('*').order('date', { ascending: false }).order('kind_order').order('id')` |
| isCallerAdmin | `rpc('hm_is_admin')` |
| createUnit | `insert({ code, name, model, current_hm })` |
| updateUnit | `update({ code, name, model }).eq('id', id)`. **Jangan** sertakan `current_hm` |
| updateUnitHm | `update({ current_hm }).eq('id', id)` |
| deleteUnit | `delete().eq('id', id)` (cascade) |
| createPart | `insert({ unit_id, code, name, interval_hm, last_replacement_hm, stock_on_hand })` |
| updatePart | `update({ code, name, interval_hm, last_replacement_hm, stock_on_hand }).eq('id', id)` |
| deletePart | `delete().eq('id', id)` (cascade) |
| recordReplacement | `rpc('hm_record_replacement', { p_part_id, p_hm, p_date, p_note })` |
| recordService | `insert({ unit_id, kind, date, hm, note })` |

Setiap server action tetap memanggil `hm_is_admin()` (atau mengandalkan RLS) dan mengembalikan `{ ok: boolean }`, supaya UI bisa menampilkan toast dari §6.7.

---

## 12. Referensi TypeScript (fungsi murni)

Fungsi-fungsi ini memodelkan logika asli dan bisa dipakai untuk unit test, atau untuk menghitung di klien jika tidak memakai view.

```ts
export type StatusLevel = "aman" | "segera" | "lewat";
export type ServiceKind = "rutin" | "perbaikan" | "inspeksi";

export type Unit = { id: number; code: string; name: string; model: string; currentHm: number };
export type Part = {
  id: number; unitId: number; code: string; name: string;
  intervalHm: number; lastReplacementHm: number; stockOnHand: number;
};
export type Replacement = { id: number; partId: number; unitId: number; hm: number; date: Date; note: string };
export type ServiceRecord = { id: number; unitId: number; kind: ServiceKind; date: Date; hm: number; note: string };
export type PartView = Part & {
  dueHm: number; remainingHm: number; status: StatusLevel; replacedThisInterval: boolean;
};
export type UnitSummary = {
  unit: Unit; partCount: number; amanCount: number; segeraCount: number;
  lewatCount: number; notReplacedCount: number;
};

export const SOON_THRESHOLD = 50;

export const STATUS_LABEL: Record<StatusLevel, string> = { aman: "Aman", segera: "Segera", lewat: "Lewat" };
export const STATUS_RANK: Record<StatusLevel, number> = { lewat: 0, segera: 1, aman: 2 };
export const SERVICE_KIND_LABEL: Record<ServiceKind, string> = {
  rutin: "Servis Rutin", perbaikan: "Perbaikan", inspeksi: "Inspeksi",
};

export function computeStatus(remainingHm: number): StatusLevel {
  if (remainingHm <= 0) return "lewat";
  if (remainingHm <= SOON_THRESHOLD) return "segera";
  return "aman";
}

export function isReplacedThisInterval(part: Part, replacements: Replacement[]): boolean {
  return replacements.some((r) => r.partId === part.id && r.hm >= part.lastReplacementHm);
}

export function toPartView(part: Part, currentHm: number, replacements: Replacement[]): PartView {
  const dueHm = part.lastReplacementHm + part.intervalHm;
  const remainingHm = dueHm - currentHm;
  return {
    ...part,
    dueHm,
    remainingHm,
    status: computeStatus(remainingHm),
    replacedThisInterval: isReplacedThisInterval(part, replacements),
  };
}

export function toUnitSummary(unit: Unit, parts: Part[], replacements: Replacement[]): UnitSummary {
  const s: UnitSummary = { unit, partCount: 0, amanCount: 0, segeraCount: 0, lewatCount: 0, notReplacedCount: 0 };
  for (const part of parts) {
    if (part.unitId !== unit.id) continue;
    const v = toPartView(part, unit.currentHm, replacements);
    s.partCount += 1;
    if (v.status === "aman") s.amanCount += 1;
    else if (v.status === "segera") s.segeraCount += 1;
    else s.lewatCount += 1;
    if (!v.replacedThisInterval) s.notReplacedCount += 1;
  }
  return s;
}

export function listSchedule(units: Unit[], parts: Part[], replacements: Replacement[]): PartView[] {
  const hmByUnit = new Map(units.map((u) => [u.id, u.currentHm]));
  return parts
    .map((p) => toPartView(p, hmByUnit.get(p.unitId) ?? 0, replacements))
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        a.remainingHm - b.remainingHm ||
        a.id - b.id,
    );
}

export function worstStatus(s: UnitSummary): StatusLevel {
  if (s.lewatCount > 0) return "lewat";
  if (s.segeraCount > 0) return "segera";
  return "aman";
}

export function replacementState(part: PartView): { state: "replaced" | "pending"; overdue: boolean } {
  if (part.replacedThisInterval) return { state: "replaced", overdue: false };
  return { state: "pending", overdue: part.status === "lewat" };
}

/** Efek recordReplacement terhadap part (§3.8). Mengembalikan part baru. */
export function applyReplacement(part: Part, hm: number): Part {
  return hm > part.lastReplacementHm ? { ...part, lastReplacementHm: hm } : part;
}

// ---------- Format (§7) ----------
export const formatHm = (v: number) => `${v.toLocaleString("id-ID")} HM`;
export const formatRemaining = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("id-ID")} HM`;
export const formatCount = (v: number) => v.toLocaleString("id-ID");
const DATE_FORMAT = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" });
export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "—" : DATE_FORMAT.format(date);
}
export function parseHmInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d]/g, "");
  return cleaned === "" ? null : Number(cleaned);
}
export function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function fromDateInputValue(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d); // tengah malam waktu lokal
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------- CSV (§8) ----------
export type HistoryRow = {
  kind: string; unitCode: string; unitName: string; partName: string;
  serviceKind: string; date: Date | string; hm: number; note: string;
};
export const CSV_HEADERS = ["Jenis", "Kode Unit", "Nama Unit", "Part", "Jenis Servis", "Tanggal", "HM", "Catatan"];
const escapeField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (rows: string[][]) => rows.map((r) => r.map(escapeField).join(",")).join("\r\n");
export function historyRowToCsv(row: HistoryRow): string[] {
  const isRep = row.kind.trim().toLowerCase().startsWith("penggantian");
  return [
    isRep ? "Penggantian Part" : "Servis Umum",
    row.unitCode, row.unitName,
    isRep ? row.partName : "",
    isRep ? "" : row.serviceKind,
    formatDate(row.date),
    String(row.hm),
    row.note,
  ];
}
export const buildHistoryCsv = (rows: HistoryRow[]) => `﻿${toCsv([CSV_HEADERS, ...rows.map(historyRowToCsv)])}`;
export const buildCsvFilename = (d = new Date()) => `riwayat-servis-${toDateInputValue(d)}.csv`;
```

---

## 13. Data seed

Ini data awal sistem asli: 10 unit, 69 part, 22 riwayat penggantian, dan 12 servis.

Asal kode part dan stok: data awal belum punya `code` dan `stockOnHand`. Keduanya diisi oleh migrasi kedua berdasarkan nama part:

| Nama part | Kode | Stok awal |
|---|---|---|
| Filter Oli Mesin | FLT-OLI | 12 |
| Filter Solar | FLT-SLR | 10 |
| Filter Udara | FLT-UDR | 6 |
| Filter Hidrolik | FLT-HDR | 4 |
| Filter Transmisi | FLT-TRS | 4 |
| Filter Bahan Bakar | FLT-BBK | 8 |
| Oli Mesin | OLI-MSN | 20 |
| Oli Hidrolik | OLI-HDR | 15 |
| Oli Transmisi | OLI-TRS | 10 |
| Oli Gardan | OLI-GRD | 8 |
| Grease Bearing Boom | GRS-BRG | 24 |
| Kampas Rem | KMP-REM | 6 |
| Minyak Rem | MNY-REM | 10 |
| Busi Pemanas | BUS-PMS | 8 |
| V-Belt Alternator | VBL-ALT | 5 |
| (lainnya) | PRT-UMU | 5 |

Tanggal asli (nanodetik) sudah dikonversi ke UTC.

```sql
insert into hm_units (id, code, name, model, current_hm) values
  (0, 'EXC-01', 'Excavator Tambang Utara', 'Komatsu PC200', 5120),
  (1, 'EXC-02', 'Excavator Tambang Selatan', 'Komatsu PC200', 7480),
  (2, 'EXC-03', 'Excavator Loading Pit A', 'Hitachi ZX210', 3260),
  (3, 'WL-01', 'Wheel Loader Stockpile', 'Caterpillar 950GC', 8940),
  (4, 'WL-02', 'Wheel Loader Hauling', 'Caterpillar 950GC', 4310),
  (5, 'WL-03', 'Wheel Loader Crusher', 'Volvo L120H', 6180),
  (6, 'DT-01', 'Dump Truck Rute Utama', 'Hino FM260JD', 12450),
  (7, 'DT-02', 'Dump Truck Rute Timur', 'Hino FM260JD', 9870),
  (8, 'BD-01', 'Bulldozer Land Clearing', 'Komatsu D65', 5640),
  (9, 'GR-01', 'Motor Grader Jalan Angkut', 'Komatsu GD555', 7020);

insert into hm_parts (id, unit_id, code, name, interval_hm, last_replacement_hm, stock_on_hand) values
  (0, 0, 'FLT-OLI', 'Filter Oli Mesin', 250, 5000, 12),
  (1, 0, 'FLT-SLR', 'Filter Solar', 250, 5000, 10),
  (2, 0, 'FLT-UDR', 'Filter Udara', 500, 5000, 6),
  (3, 0, 'FLT-HDR', 'Filter Hidrolik', 1000, 4500, 4),
  (4, 0, 'OLI-MSN', 'Oli Mesin', 250, 5000, 20),
  (5, 0, 'OLI-HDR', 'Oli Hidrolik', 2000, 4000, 15),
  (6, 0, 'OLI-TRS', 'Oli Transmisi', 1000, 4500, 10),
  (7, 0, 'GRS-BRG', 'Grease Bearing Boom', 250, 5000, 24),
  (65, 0, 'BUS-PMS', 'Busi Pemanas', 1000, 4500, 8),
  (8, 1, 'FLT-OLI', 'Filter Oli Mesin', 250, 7250, 12),
  (9, 1, 'FLT-SLR', 'Filter Solar', 250, 7250, 10),
  (10, 1, 'FLT-UDR', 'Filter Udara', 500, 7000, 6),
  (11, 1, 'FLT-HDR', 'Filter Hidrolik', 1000, 6500, 4),
  (12, 1, 'OLI-MSN', 'Oli Mesin', 250, 7250, 20),
  (13, 1, 'OLI-HDR', 'Oli Hidrolik', 2000, 6000, 15),
  (14, 1, 'OLI-TRS', 'Oli Transmisi', 1000, 6500, 10),
  (15, 1, 'GRS-BRG', 'Grease Bearing Boom', 250, 7250, 24),
  (16, 2, 'FLT-OLI', 'Filter Oli Mesin', 250, 3000, 12),
  (17, 2, 'FLT-SLR', 'Filter Solar', 250, 3000, 10),
  (18, 2, 'FLT-UDR', 'Filter Udara', 500, 3000, 6),
  (19, 2, 'FLT-HDR', 'Filter Hidrolik', 1000, 2500, 4),
  (20, 2, 'OLI-MSN', 'Oli Mesin', 250, 3000, 20),
  (21, 2, 'OLI-HDR', 'Oli Hidrolik', 2000, 2000, 15),
  (22, 2, 'OLI-TRS', 'Oli Transmisi', 1000, 2500, 10),
  (66, 2, 'VBL-ALT', 'V-Belt Alternator', 2000, 2000, 5),
  (23, 3, 'FLT-OLI', 'Filter Oli Mesin', 500, 8500, 12),
  (24, 3, 'FLT-SLR', 'Filter Solar', 500, 8500, 10),
  (25, 3, 'FLT-UDR', 'Filter Udara', 1000, 8000, 6),
  (26, 3, 'FLT-TRS', 'Filter Transmisi', 1000, 8000, 4),
  (27, 3, 'OLI-MSN', 'Oli Mesin', 500, 8500, 20),
  (28, 3, 'OLI-TRS', 'Oli Transmisi', 2000, 7000, 10),
  (29, 4, 'FLT-OLI', 'Filter Oli Mesin', 500, 4000, 12),
  (30, 4, 'FLT-SLR', 'Filter Solar', 500, 4000, 10),
  (31, 4, 'FLT-UDR', 'Filter Udara', 1000, 4000, 6),
  (32, 4, 'FLT-TRS', 'Filter Transmisi', 1000, 3500, 4),
  (33, 4, 'OLI-MSN', 'Oli Mesin', 500, 4000, 20),
  (34, 4, 'OLI-TRS', 'Oli Transmisi', 2000, 3000, 10),
  (35, 5, 'FLT-OLI', 'Filter Oli Mesin', 500, 6000, 12),
  (36, 5, 'FLT-SLR', 'Filter Solar', 500, 6000, 10),
  (37, 5, 'FLT-UDR', 'Filter Udara', 1000, 5500, 6),
  (38, 5, 'FLT-TRS', 'Filter Transmisi', 1000, 5500, 4),
  (39, 5, 'OLI-MSN', 'Oli Mesin', 500, 6000, 20),
  (40, 5, 'OLI-TRS', 'Oli Transmisi', 2000, 5000, 10),
  (41, 6, 'FLT-OLI', 'Filter Oli Mesin', 500, 12000, 12),
  (42, 6, 'FLT-SLR', 'Filter Solar', 500, 12000, 10),
  (43, 6, 'FLT-UDR', 'Filter Udara', 1000, 11500, 6),
  (44, 6, 'OLI-MSN', 'Oli Mesin', 500, 12000, 20),
  (45, 6, 'OLI-GRD', 'Oli Gardan', 2000, 11000, 8),
  (46, 6, 'KMP-REM', 'Kampas Rem', 3000, 10000, 6),
  (67, 6, 'FLT-BBK', 'Filter Bahan Bakar', 500, 12000, 8),
  (47, 7, 'FLT-OLI', 'Filter Oli Mesin', 500, 9500, 12),
  (48, 7, 'FLT-SLR', 'Filter Solar', 500, 9500, 10),
  (49, 7, 'FLT-UDR', 'Filter Udara', 1000, 9000, 6),
  (50, 7, 'OLI-MSN', 'Oli Mesin', 500, 9500, 20),
  (51, 7, 'OLI-GRD', 'Oli Gardan', 2000, 8500, 8),
  (52, 7, 'KMP-REM', 'Kampas Rem', 3000, 7500, 6),
  (53, 8, 'FLT-OLI', 'Filter Oli Mesin', 250, 5500, 12),
  (54, 8, 'FLT-SLR', 'Filter Solar', 250, 5500, 10),
  (55, 8, 'FLT-UDR', 'Filter Udara', 500, 5500, 6),
  (56, 8, 'FLT-HDR', 'Filter Hidrolik', 1000, 5000, 4),
  (57, 8, 'OLI-MSN', 'Oli Mesin', 250, 5500, 20),
  (58, 8, 'OLI-HDR', 'Oli Hidrolik', 2000, 4500, 15),
  (59, 9, 'FLT-OLI', 'Filter Oli Mesin', 500, 7000, 12),
  (60, 9, 'FLT-SLR', 'Filter Solar', 500, 7000, 10),
  (61, 9, 'FLT-UDR', 'Filter Udara', 1000, 6500, 6),
  (62, 9, 'FLT-HDR', 'Filter Hidrolik', 1000, 6500, 4),
  (63, 9, 'OLI-MSN', 'Oli Mesin', 500, 7000, 20),
  (64, 9, 'OLI-HDR', 'Oli Hidrolik', 2000, 6000, 15),
  (68, 9, 'MNY-REM', 'Minyak Rem', 2000, 6000, 10);

insert into hm_replacements (id, part_id, unit_id, hm, date, note) values
  (0, 0, 0, 5000, '2025-08-12 12:00:00+00', 'Ganti filter oli mesin rutin'),
  (1, 1, 0, 5000, '2025-08-12 12:00:00+00', 'Ganti filter solar'),
  (2, 2, 0, 5000, '2025-08-11 08:13:20+00', 'Filter udara dibersihkan lalu diganti'),
  (3, 3, 0, 4500, '2025-07-08 18:40:00+00', 'Ganti filter hidrolik'),
  (4, 8, 1, 7250, '2025-08-24 01:46:40+00', 'Ganti filter oli mesin'),
  (5, 9, 1, 7250, '2025-08-24 01:46:40+00', 'Ganti filter solar'),
  (6, 10, 1, 7000, '2025-07-31 22:13:20+00', 'Ganti filter udara'),
  (7, 16, 2, 3000, '2025-07-20 08:26:40+00', 'Ganti filter oli mesin'),
  (8, 17, 2, 3000, '2025-07-20 08:26:40+00', 'Ganti filter solar'),
  (9, 23, 3, 8500, '2025-08-18 06:53:20+00', 'Ganti filter oli mesin'),
  (10, 24, 3, 8500, '2025-08-18 06:53:20+00', 'Ganti filter solar'),
  (11, 25, 3, 8000, '2025-07-26 03:20:00+00', 'Ganti filter udara'),
  (12, 29, 4, 4000, '2025-07-14 13:33:20+00', 'Ganti filter oli mesin'),
  (13, 35, 5, 6000, '2025-08-06 17:06:40+00', 'Ganti filter oli mesin'),
  (14, 41, 6, 12000, '2025-08-21 18:13:20+00', 'Ganti filter oli mesin'),
  (15, 42, 6, 12000, '2025-08-21 18:13:20+00', 'Ganti filter solar'),
  (16, 47, 7, 9500, '2025-07-22 16:00:00+00', 'Ganti filter oli mesin'),
  (17, 53, 8, 5500, '2025-08-14 19:33:20+00', 'Ganti filter oli mesin'),
  (18, 59, 9, 7000, '2025-08-10 04:26:40+00', 'Ganti filter oli mesin'),
  (19, 60, 9, 7000, '2025-08-10 04:26:40+00', 'Ganti filter solar'),
  (20, 65, 0, 4500, '2025-07-06 11:06:40+00', 'Ganti busi pemanas'),
  (21, 67, 6, 12000, '2025-08-21 18:13:20+00', 'Ganti filter bahan bakar');

insert into hm_services (id, unit_id, kind, date, hm, note) values
  (0, 0, 'rutin', '2025-08-12 12:00:00+00', 5000, 'Servis rutin 250 HM'),
  (1, 0, 'inspeksi', '2025-07-20 08:26:40+00', 4750, 'Inspeksi kebocoran hidrolik'),
  (2, 1, 'perbaikan', '2025-08-06 17:06:40+00', 7100, 'Perbaikan selang hidrolik bocor'),
  (3, 1, 'rutin', '2025-08-24 01:46:40+00', 7250, 'Servis rutin 250 HM'),
  (4, 2, 'inspeksi', '2025-07-08 18:40:00+00', 2900, 'Inspeksi sistem pendingin'),
  (5, 3, 'rutin', '2025-08-18 06:53:20+00', 8500, 'Servis rutin 500 HM'),
  (6, 4, 'perbaikan', '2025-07-02 23:46:40+00', 3800, 'Perbaikan rem parkir'),
  (7, 5, 'rutin', '2025-08-06 17:06:40+00', 6000, 'Servis rutin 500 HM'),
  (8, 6, 'inspeksi', '2025-08-21 18:13:20+00', 12000, 'Inspeksi menyeluruh sebelum operasi'),
  (9, 7, 'perbaikan', '2025-06-27 04:53:20+00', 9200, 'Perbaikan sistem kelistrikan'),
  (10, 8, 'rutin', '2025-08-14 19:33:20+00', 5500, 'Servis rutin 250 HM'),
  (11, 9, 'inspeksi', '2025-08-10 04:26:40+00', 7000, 'Inspeksi blade dan hidrolik');

-- Lanjutkan sequence setelah id seed (nextUnitId=10, nextPartId=69, nextReplacementId=22, nextServiceId=12).
select setval(pg_get_serial_sequence('hm_units','id'), 9);
select setval(pg_get_serial_sequence('hm_parts','id'), 68);
select setval(pg_get_serial_sequence('hm_replacements','id'), 21);
select setval(pg_get_serial_sequence('hm_services','id'), 11);
```

---

## 14. Tabel verifikasi (hasil yang diharapkan)

Hasil di bawah dihitung dari data seed persis dengan aturan §3. Implementasi baru **harus** menghasilkan angka dan urutan yang sama.

**Total jadwal:** 69 part: **3 Lewat**, **12 Segera**, **54 Aman**. Part yang belum diganti pada interval berjalan: **47**.

**Ringkasan per unit (`listUnits`, urut id):**

| id | Unit | HM | Part | Aman | Segera | Lewat | Belum diganti | Status terburuk |
|---|---|---|---|---|---|---|---|---|
| 0 | EXC-01 | 5.120 | 9 | 9 | 0 | 0 | 4 | Aman |
| 1 | EXC-02 | 7.480 | 8 | 1 | 7 | 0 | 5 | Segera |
| 2 | EXC-03 | 3.260 | 8 | 5 | 0 | 3 | 6 | Lewat |
| 3 | WL-01 | 8.940 | 6 | 6 | 0 | 0 | 3 | Aman |
| 4 | WL-02 | 4.310 | 6 | 6 | 0 | 0 | 5 | Aman |
| 5 | WL-03 | 6.180 | 6 | 6 | 0 | 0 | 5 | Aman |
| 6 | DT-01 | 12.450 | 7 | 2 | 5 | 0 | 4 | Segera |
| 7 | DT-02 | 9.870 | 6 | 6 | 0 | 0 | 5 | Aman |
| 8 | BD-01 | 5.640 | 6 | 6 | 0 | 0 | 5 | Aman |
| 9 | GR-01 | 7.020 | 7 | 7 | 0 | 0 | 5 | Aman |

**Kasus uji yang menunjukkan aturan khusus:**

- **Batas Segera = 50:** DT-01 Filter Oli Mesin (500 / 12.000, HM unit 12.450) menghasilkan sisa **+50**, sehingga statusnya **Segera**, bukan Aman.
- **Lewat tapi "Sudah diganti":** EXC-03 Filter Oli Mesin punya sisa −10 dan ada replacement di HM 3000 yang ≥ `lastReplacementHm` 3000, sehingga tampil "Sudah diganti" (§15.1).
- **Lewat dan "Belum diganti" (overdue):** EXC-03 Oli Mesin punya sisa −10 tanpa replacement, sehingga tampil peringatan merah.
- **Penggantian dengan HM sama:** jika dicatat penggantian dengan HM = `lastReplacementHm`, riwayat bertambah tetapi jatuh tempo tidak berubah.
- **Penggantian maju:** mencatat penggantian di HM 3260 untuk EXC-03 Oli Mesin membuat `lastReplacementHm` menjadi 3260, `dueHm` 3510, sisa +250, status Aman, dan "Sudah diganti".
- **Kriteria uji backend asli:** unit HM 1000 dengan part interval 250 dan HM ganti terakhir 900 awalnya `replacedThisInterval = false`. Setelah penggantian di HM 900, nilainya menjadi `true`. Unit dengan 2 part yang salah satunya sudah diganti punya `notReplacedCount = 1`.

**Urutan lengkap `listSchedule` (69 baris):**

<details>
<summary>Tampilkan tabel</summary>

| # | part id | Unit | Part | Interval | HM Ganti Terakhir | HM Jatuh Tempo | Sisa HM | Status | Penggantian |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 16 | EXC-03 | Filter Oli Mesin | 250 | 3000 | 3250 | -10 | Lewat | Sudah diganti |
| 2 | 17 | EXC-03 | Filter Solar | 250 | 3000 | 3250 | -10 | Lewat | Sudah diganti |
| 3 | 20 | EXC-03 | Oli Mesin | 250 | 3000 | 3250 | -10 | Lewat | Belum diganti ⚠ (overdue) |
| 4 | 8 | EXC-02 | Filter Oli Mesin | 250 | 7250 | 7500 | +20 | Segera | Sudah diganti |
| 5 | 9 | EXC-02 | Filter Solar | 250 | 7250 | 7500 | +20 | Segera | Sudah diganti |
| 6 | 10 | EXC-02 | Filter Udara | 500 | 7000 | 7500 | +20 | Segera | Sudah diganti |
| 7 | 11 | EXC-02 | Filter Hidrolik | 1000 | 6500 | 7500 | +20 | Segera | Belum diganti |
| 8 | 12 | EXC-02 | Oli Mesin | 250 | 7250 | 7500 | +20 | Segera | Belum diganti |
| 9 | 14 | EXC-02 | Oli Transmisi | 1000 | 6500 | 7500 | +20 | Segera | Belum diganti |
| 10 | 15 | EXC-02 | Grease Bearing Boom | 250 | 7250 | 7500 | +20 | Segera | Belum diganti |
| 11 | 41 | DT-01 | Filter Oli Mesin | 500 | 12000 | 12500 | +50 | Segera | Sudah diganti |
| 12 | 42 | DT-01 | Filter Solar | 500 | 12000 | 12500 | +50 | Segera | Sudah diganti |
| 13 | 43 | DT-01 | Filter Udara | 1000 | 11500 | 12500 | +50 | Segera | Belum diganti |
| 14 | 44 | DT-01 | Oli Mesin | 500 | 12000 | 12500 | +50 | Segera | Belum diganti |
| 15 | 67 | DT-01 | Filter Bahan Bakar | 500 | 12000 | 12500 | +50 | Segera | Sudah diganti |
| 16 | 23 | WL-01 | Filter Oli Mesin | 500 | 8500 | 9000 | +60 | Aman | Sudah diganti |
| 17 | 24 | WL-01 | Filter Solar | 500 | 8500 | 9000 | +60 | Aman | Sudah diganti |
| 18 | 25 | WL-01 | Filter Udara | 1000 | 8000 | 9000 | +60 | Aman | Sudah diganti |
| 19 | 26 | WL-01 | Filter Transmisi | 1000 | 8000 | 9000 | +60 | Aman | Belum diganti |
| 20 | 27 | WL-01 | Oli Mesin | 500 | 8500 | 9000 | +60 | Aman | Belum diganti |
| 21 | 28 | WL-01 | Oli Transmisi | 2000 | 7000 | 9000 | +60 | Aman | Belum diganti |
| 22 | 53 | BD-01 | Filter Oli Mesin | 250 | 5500 | 5750 | +110 | Aman | Sudah diganti |
| 23 | 54 | BD-01 | Filter Solar | 250 | 5500 | 5750 | +110 | Aman | Belum diganti |
| 24 | 57 | BD-01 | Oli Mesin | 250 | 5500 | 5750 | +110 | Aman | Belum diganti |
| 25 | 0 | EXC-01 | Filter Oli Mesin | 250 | 5000 | 5250 | +130 | Aman | Sudah diganti |
| 26 | 1 | EXC-01 | Filter Solar | 250 | 5000 | 5250 | +130 | Aman | Sudah diganti |
| 27 | 4 | EXC-01 | Oli Mesin | 250 | 5000 | 5250 | +130 | Aman | Belum diganti |
| 28 | 7 | EXC-01 | Grease Bearing Boom | 250 | 5000 | 5250 | +130 | Aman | Belum diganti |
| 29 | 47 | DT-02 | Filter Oli Mesin | 500 | 9500 | 10000 | +130 | Aman | Sudah diganti |
| 30 | 48 | DT-02 | Filter Solar | 500 | 9500 | 10000 | +130 | Aman | Belum diganti |
| 31 | 49 | DT-02 | Filter Udara | 1000 | 9000 | 10000 | +130 | Aman | Belum diganti |
| 32 | 50 | DT-02 | Oli Mesin | 500 | 9500 | 10000 | +130 | Aman | Belum diganti |
| 33 | 29 | WL-02 | Filter Oli Mesin | 500 | 4000 | 4500 | +190 | Aman | Sudah diganti |
| 34 | 30 | WL-02 | Filter Solar | 500 | 4000 | 4500 | +190 | Aman | Belum diganti |
| 35 | 32 | WL-02 | Filter Transmisi | 1000 | 3500 | 4500 | +190 | Aman | Belum diganti |
| 36 | 33 | WL-02 | Oli Mesin | 500 | 4000 | 4500 | +190 | Aman | Belum diganti |
| 37 | 18 | EXC-03 | Filter Udara | 500 | 3000 | 3500 | +240 | Aman | Belum diganti |
| 38 | 19 | EXC-03 | Filter Hidrolik | 1000 | 2500 | 3500 | +240 | Aman | Belum diganti |
| 39 | 22 | EXC-03 | Oli Transmisi | 1000 | 2500 | 3500 | +240 | Aman | Belum diganti |
| 40 | 35 | WL-03 | Filter Oli Mesin | 500 | 6000 | 6500 | +320 | Aman | Sudah diganti |
| 41 | 36 | WL-03 | Filter Solar | 500 | 6000 | 6500 | +320 | Aman | Belum diganti |
| 42 | 37 | WL-03 | Filter Udara | 1000 | 5500 | 6500 | +320 | Aman | Belum diganti |
| 43 | 38 | WL-03 | Filter Transmisi | 1000 | 5500 | 6500 | +320 | Aman | Belum diganti |
| 44 | 39 | WL-03 | Oli Mesin | 500 | 6000 | 6500 | +320 | Aman | Belum diganti |
| 45 | 55 | BD-01 | Filter Udara | 500 | 5500 | 6000 | +360 | Aman | Belum diganti |
| 46 | 56 | BD-01 | Filter Hidrolik | 1000 | 5000 | 6000 | +360 | Aman | Belum diganti |
| 47 | 2 | EXC-01 | Filter Udara | 500 | 5000 | 5500 | +380 | Aman | Sudah diganti |
| 48 | 3 | EXC-01 | Filter Hidrolik | 1000 | 4500 | 5500 | +380 | Aman | Sudah diganti |
| 49 | 6 | EXC-01 | Oli Transmisi | 1000 | 4500 | 5500 | +380 | Aman | Belum diganti |
| 50 | 65 | EXC-01 | Busi Pemanas | 1000 | 4500 | 5500 | +380 | Aman | Sudah diganti |
| 51 | 59 | GR-01 | Filter Oli Mesin | 500 | 7000 | 7500 | +480 | Aman | Sudah diganti |
| 52 | 60 | GR-01 | Filter Solar | 500 | 7000 | 7500 | +480 | Aman | Sudah diganti |
| 53 | 61 | GR-01 | Filter Udara | 1000 | 6500 | 7500 | +480 | Aman | Belum diganti |
| 54 | 62 | GR-01 | Filter Hidrolik | 1000 | 6500 | 7500 | +480 | Aman | Belum diganti |
| 55 | 63 | GR-01 | Oli Mesin | 500 | 7000 | 7500 | +480 | Aman | Belum diganti |
| 56 | 13 | EXC-02 | Oli Hidrolik | 2000 | 6000 | 8000 | +520 | Aman | Belum diganti |
| 57 | 45 | DT-01 | Oli Gardan | 2000 | 11000 | 13000 | +550 | Aman | Belum diganti |
| 58 | 46 | DT-01 | Kampas Rem | 3000 | 10000 | 13000 | +550 | Aman | Belum diganti |
| 59 | 51 | DT-02 | Oli Gardan | 2000 | 8500 | 10500 | +630 | Aman | Belum diganti |
| 60 | 52 | DT-02 | Kampas Rem | 3000 | 7500 | 10500 | +630 | Aman | Belum diganti |
| 61 | 31 | WL-02 | Filter Udara | 1000 | 4000 | 5000 | +690 | Aman | Belum diganti |
| 62 | 34 | WL-02 | Oli Transmisi | 2000 | 3000 | 5000 | +690 | Aman | Belum diganti |
| 63 | 21 | EXC-03 | Oli Hidrolik | 2000 | 2000 | 4000 | +740 | Aman | Belum diganti |
| 64 | 66 | EXC-03 | V-Belt Alternator | 2000 | 2000 | 4000 | +740 | Aman | Belum diganti |
| 65 | 40 | WL-03 | Oli Transmisi | 2000 | 5000 | 7000 | +820 | Aman | Belum diganti |
| 66 | 58 | BD-01 | Oli Hidrolik | 2000 | 4500 | 6500 | +860 | Aman | Belum diganti |
| 67 | 5 | EXC-01 | Oli Hidrolik | 2000 | 4000 | 6000 | +880 | Aman | Belum diganti |
| 68 | 64 | GR-01 | Oli Hidrolik | 2000 | 6000 | 8000 | +980 | Aman | Belum diganti |
| 69 | 68 | GR-01 | Minyak Rem | 2000 | 6000 | 8000 | +980 | Aman | Belum diganti |
</details>

---

## 15. Catatan perilaku asli yang harus diperhatikan

Perilaku berikut **ada di sistem asli** dan didokumentasikan apa adanya. Spesifikasi ini mempertahankannya agar hasilnya sama persis. Jika ingin mengubahnya, jadikan keputusan terpisah dan perbarui §14.

1. **`replacedThisInterval` hampir selalu `true` setelah penggantian pertama.** `recordReplacement` mengisi `lastReplacementHm = hm`, sehingga replacement itu sendiri selalu memenuhi `r.hm >= lastReplacementHm`, bahkan setelah part kembali Lewat. Akibatnya peringatan "Belum diganti" (overdue) hanya muncul untuk part yang belum punya replacement di HM ≥ `lastReplacementHm`. Nilainya bisa kembali `false` jika admin menaikkan `lastReplacementHm` lewat form Ubah Part tanpa mencatat replacement.
2. **Stok tidak berkurang** saat penggantian dicatat.
3. **Form Ubah Unit menampilkan field HM, tetapi perubahannya diabaikan.** `updateUnit` hanya menyimpan code, name, dan model. HM hanya bisa diubah lewat "Perbarui HM".
4. **Badge "Admin" di header muncul untuk siapa saja yang login**, karena yang dicek `isAuthenticated`, bukan `isCallerAdmin`. Tombol aksi admin lainnya sudah benar memakai `isCallerAdmin`. Di web utama, badge sebaiknya memakai `isCallerAdmin`. Ini perubahan tampilan, bukan logika.
5. **Tidak ada validasi silang:** kode unit dan kode part boleh duplikat, HM penggantian atau servis boleh melebihi HM unit, HM unit boleh diturunkan, dan `lastReplacementHm` boleh lebih besar dari HM unit.
6. **`parseHmInput` membuang tanda minus dan titik**, jadi input `-5` dibaca 5 dan `1.250` dibaca 1250.
7. **Legenda footer "Segera — sisa 0–50 HM"**, padahal sisa 0 berstatus Lewat (§3.2).
8. **Ekspor CSV di halaman detail unit** tetap mengekspor riwayat **semua** unit.
9. **Endpoint `execute`, `schema`, dan `getApiDoc`** adalah fitur bawaan Caffeine (OQL) dan **tidak** dibawa.

---

## 16. Desain visual

Detail lengkap ada di `DESIGN.md` proyek asli. Ringkasan untuk menyesuaikan dengan web utama:

- Konsep: konsol kontrol industri dengan tema gelap sebagai tema utama. Angka HM dan tanggal memakai font mono tabular.
- Token warna status (OKLCH, tema gelap): **success/Aman** `0.72 0.15 155`, **warning/Segera** `0.80 0.15 82`, **destructive/Lewat** `0.64 0.20 26`. Primary amber `0.78 0.16 68`, accent teal `0.72 0.11 200`.
- Font: Space Grotesk (judul), DM Sans (isi), Geist Mono (angka).
- Ciri khas: **rail warna 3px** di kiri setiap baris tabel dan kartu unit, sesuai status. Titik status "Lewat" berdenyut, dan ikon peringatan overdue juga berdenyut.
- Badge status berbentuk pill dengan titik warna dan label huruf besar.
- Jika web utama sudah punya design system, cukup petakan tiga warna status, rail, dan font mono untuk angka. Sisanya mengikuti web utama.
