# 📦 Planning Supply & Freeze MR — WMS-GMI

> 📌 **TL;DR**
> Planning Supply adalah saldo **"barang akan masuk"** ke sebuah cabang: stok yang sudah keluar dari gudang sumber tapi belum diterima di gudang tujuan. Fitur ini menambah **deadline per item** saat alokasi share stock, melacak qty selama pengiriman, dan **mem-freeze MR** kalau deadline lewat tapi delivery belum dibuat.

`[gambar banner / ilustrasi alur planning supply]`

---

## 1. Kenapa fitur ini ada?

Sebelumnya, saat share stock dialokasikan lalu dibuat delivery, stok langsung dipotong dari cabang sumber dan baru muncul di cabang tujuan ketika barang diterima. Di antara dua momen itu, qty-nya "menghilang" dari pandangan — nggak ada yang tahu pasti **berapa banyak barang yang lagi dalam perjalanan menuju cabangnya**.

Planning Supply membuat fase "dalam perjalanan" ini **terlihat dan terlacak**, plus menambahkan disiplin waktu lewat **deadline** dan mekanisme **freeze** supaya MR tidak menggantung tanpa tindak lanjut.

> 💡 Singkatnya: *"Barang apa saja, berapa banyak, dari mana, yang sedang menuju gudang saya, dan kapan batas waktunya."*

---

## 2. Istilah Penting

| Istilah | Arti |
| --- | --- |
| **Planning Supply** | Saldo barang yang sudah keluar dari sumber, sedang menuju cabang tujuan (belum diterima). |
| **Deadline Supply** | Batas tanggal per item (diisi approver terakhir) untuk membuat delivery share stock. |
| **Freeze** | Status terkunci pada MR karena deadline lewat tapi delivery belum dibuat. |
| **Admin Divisi** | Role `admin` per cabang — melihat barang yang akan masuk ke cabangnya. |
| **Moderator** | Superuser — satu-satunya yang bisa membuka (unfreeze/reset) MR yang ter-freeze. |

---

## 3. Status Planning Supply

| Status | Badge | Arti |
| --- | --- | --- |
| `in_transit` | 🔵 Dalam Pengiriman | Barang sudah keluar dari sumber, belum diterima. |
| `received` | 🟢 Diterima | Barang sampai di tujuan, stok tujuan bertambah. |
| `cancelled` | 🔴 Dibatalkan | Delivery dibatalkan, qty dikembalikan ke sumber (+ keterangan). |

---

## 4. Alur Lengkap (End-to-End)

> ⚙️ Alur ini menempel pada flow **Share Stock → Delivery** yang sudah ada. Yang baru ditandai dengan **🆕**.

### Langkah 1 — Alokasi + Set Deadline (Approver terakhir)

Saat approver terakhir menyetujui MR dan mengalokasikan share stock, ada kolom baru **🆕 Deadline Supply** per item.

- Deadline **wajib diisi** untuk setiap item yang punya alokasi share stock.
- Tidak boleh tanggal lampau.
- Deadline ini yang nanti dipakai untuk menentukan freeze.

`[gambar form alokasi share stock dengan input Deadline Supply (/mr/[id])]`

> ⚠️ Kalau approver terakhir mencoba approve tanpa mengisi deadline pada item yang ada share stock-nya, sistem menolak dengan pesan error.

---

### Langkah 2 — Buat Delivery 🆕 Masuk Planning Supply

Saat delivery share stock dibuat:

1. Qty dipotong dari **stok cabang sumber** (seperti sebelumnya).
2. **🆕** Qty dicatat sebagai **Planning Supply** dengan status `in_transit` untuk cabang tujuan.

`[gambar halaman buat delivery (/deliveries/create)]`

---

### Langkah 3 — Pantau di Halaman Planning Supply

Admin divisi membuka menu **Planning Supply** untuk melihat semua barang yang sedang menuju cabangnya.

- **Admin divisi** → hanya melihat barang menuju **cabangnya sendiri**.
- **Moderator** → melihat **semua cabang**.
- Filter status: Dalam Pengiriman / Diterima / Dibatalkan / Semua.
- Item yang lewat deadline ditandai **merah (lewat)**.

`[gambar halaman planning supply (/planning-supply)]`

---

### Langkah 4 — Barang Diterima 🆕 Planning Supply Selesai

Saat admin gudang tujuan menyelesaikan penerimaan (tanda tangan penerima):

1. Stok **cabang tujuan bertambah** (seperti sebelumnya).
2. **🆕** Planning Supply berubah status menjadi `received` (saldo ditutup).

`[gambar proses terima barang / finalize delivery di detail delivery]`

---

## 5. Pembatalan Delivery 🆕

Kalau pengiriman batal (tidak diapprove / ada kendala) **sebelum barang diterima**, moderator/admin bisa membatalkannya dari panel detail delivery.

Saat dibatalkan:

1. Qty **dikembalikan ke stok cabang sumber**.
2. Planning Supply berubah jadi `cancelled` **disertai keterangan/alasan**.
3. Delivery berstatus `cancelled` dan jatah alokasi share stock kembali tersedia.

`[gambar panel "Batalkan Delivery" di detail delivery dengan kolom alasan]`

> ❗ Delivery yang **sudah selesai (barang diterima)** tidak bisa dibatalkan dari sini.

---

## 6. Mekanisme Freeze MR 🆕

> 🧊 **Aturan freeze:** MR ter-freeze **otomatis** kalau ada item dengan alokasi share stock yang **deadline-nya sudah lewat** **DAN** **belum ada delivery sama sekali** untuk item itu.

### Yang terjadi saat MR ter-freeze

- **Seluruh MR terkunci** beserta alurnya: tidak bisa buat delivery, terima barang, update tracking, bypass, maupun buat PR.
- MR muncul dengan badge **🧊 Frozen** di list MR dan di halaman detail MR.
- **Pembuat MR** hanya bisa **melaporkan kendala** (kenapa sampai lewat deadline tapi delivery belum dibuat).
- Laporan otomatis dikirim ke **moderator** (lewat notifikasi).

`[gambar badge Frozen + panel freeze di halaman detail MR (/mr/[id])]`

### Lapor Kendala (Pembuat MR)

`[gambar form lapor kendala MR freeze]`

- Pembuat MR mengisi keterangan kendala lalu kirim.
- Selama laporan masih `open`, pembuat MR **tidak bisa** melakukan apa pun selain menunggu.

### Tindakan Moderator

Hanya moderator yang bisa membuka freeze, dengan **2 opsi**:

| Opsi | Efek |
| --- | --- |
| **Unfreeze (Lanjut)** | Membuka kunci, alur lanjut dari posisi terakhir. Deadline tidak diubah. |
| **Reset Deadline** | Membuka kunci **+** set deadline baru per item, lalu alur lanjut. |

`[gambar panel tindakan moderator: Unfreeze / Reset Deadline]`

> 🔓 Sistem **tidak pernah** membuka freeze otomatis — selalu butuh tindakan moderator.

---

## 7. Hak Akses (Ringkasan)

| Aksi | Pembuat MR | Admin Divisi | Moderator |
| --- | --- | --- | --- |
| Set deadline saat alokasi (approver terakhir) | — | ✅* | ✅* |
| Lihat Planning Supply cabang sendiri | — | ✅ | ✅ (semua cabang) |
| Batalkan delivery (kembalikan stok) | — | ✅ | ✅ |
| Lapor kendala MR freeze | ✅ | — | — |
| Unfreeze / Reset MR | — | — | ✅ |

> *Tergantung siapa approver terakhir pada template approval MR tersebut.

---

## 8. Diagram Alur (Ringkas)

```
Approve MR (set Deadline) 
        │
        ▼
Buat Delivery ──► stok sumber − qty
        │         + Planning Supply (in_transit)
        ▼
   [Dalam Pengiriman]
        │
        ├─► Terima Barang ─► stok tujuan + qty ─► Planning Supply (received) ✅
        │
        └─► Batal Delivery ─► stok sumber + qty ─► Planning Supply (cancelled) 🔴

  Jika Deadline lewat & belum ada delivery ─► MR FREEZE 🧊
        │
        ├─ Pembuat MR: lapor kendala ─► Moderator
        └─ Moderator: Unfreeze / Reset deadline ─► alur lanjut
```

`[gambar diagram alur versi visual]`

---

## 9. FAQ / Troubleshooting

> ❓ **Kenapa qty di Planning Supply tidak masuk-masuk ke stok tujuan?**
> Karena barang belum diterima/di-finalize di gudang tujuan. Selesaikan penerimaan (tanda tangan penerima) agar status jadi `received` dan stok tujuan bertambah.

> ❓ **MR saya tiba-tiba terkunci (Frozen), kenapa?**
> Ada item share stock yang deadline-nya sudah lewat tapi delivery-nya belum dibuat. Laporkan kendalanya ke moderator dari halaman MR.

> ❓ **Saya moderator, sudah unfreeze tapi besok ke-freeze lagi.**
> Berarti deadline-nya masih tanggal lampau. Gunakan **Reset Deadline** (bukan Unfreeze biasa) untuk memberi tanggal baru.

> ❓ **Delivery sudah terlanjur dibuat tapi salah, gimana?**
> Selama barang **belum diterima**, moderator/admin bisa membatalkan delivery dari detail delivery. Qty otomatis kembali ke cabang sumber.

---

## 10. Catatan Teknis (untuk tim dev)

> 🛠️ Bagian ini opsional, untuk referensi developer.

- Deteksi deadline bersifat **lazy** (dicek saat halaman/aksi terkait dibuka), bukan cron.
- Tabel baru: `planning_supplies`, `mr_freeze_reports`. Kolom baru: `mr_sharestock_allocations.deadline`, `mrs.is_frozen/frozen_at/frozen_reason`, `deliveries.cancel_reason/cancelled_by/cancelled_at`, enum `doc_status` + `cancelled`.
- Migration: `supabase/migrations/20260630000001_planning_supply.sql`. Panduan deploy: `supabase/DEPLOY_planning_supply.md`.
- Logika utama: `services/freeze-actions.ts`, `services/inventory-actions.ts`.

---

*Dokumen ini dibuat untuk fitur Planning Supply WMS-GMI. Ganti seluruh `[gambar ...]` dengan screenshot sesuai keterangannya.*
