# WMS-GMI - Master Plan Revisi Fitur (Eksekusi Bertahap)

Dokumen ini adalah acuan utama implementasi revisi fitur agar model AI/coder bisa bekerja akurat, cepat, dan minim error.

Tanggal baseline: 2026-05-04

---

## Tujuan

1. Menyelesaikan revisi fitur sesuai kebutuhan bisnis terbaru.
2. Menjaga perubahan tetap fokus ke fungsi, bukan styling/UI.
3. Menjalankan implementasi kecil-kecil (small batches) agar model tidak melebar.
4. Menyatukan terminologi status akhir ke `completed` untuk menghindari ambiguitas.

---

## Guardrail Wajib (Jangan Dilanggar)

1. Fokus perubahan pada logic, validasi, alur data, otorisasi, dan status dokumen.
2. Jangan ubah styling, layout, class CSS, komponen visual, atau UX yang tidak terkait requirement revisi.
3. Jangan refactor besar di luar scope chapter aktif.
4. Setiap chapter dikerjakan dalam sub-task kecil dan diverifikasi sebelum lanjut.
5. Setiap perubahan status final dokumen harus konsisten memakai `completed`.

---

## Keputusan Final Requirement (Sumber Kebenaran)

1. Job Costing: qty finish part ditambahkan sebagai input manual.
2. Job Costing: cabang asal item boleh sama dengan cabang tujuan finish part.
3. Harga PO hanya boleh dilihat role Purchasing.
4. Receive Item wajib approval berbasis template approval yang dikelola moderator/admin site.
5. Jika template approval tidak dipilih atau tidak tersedia, dokumen tidak boleh dibuat.
6. Moderator delivery bisa:
   - mengubah status tracking utama, dan
   - menambahkan catatan tracking bebas.
7. Status final tracking delivery disepakati menjadi `completed`.
8. Semua dokumen yang membutuhkan ID/kode saat create harus input manual.
9. Approval diterapkan ke semua fitur sub menu Stock Out di navbar yang membuat dokumen.
10. Status final MR, PR, dan dokumen lain diseragamkan menjadi `completed`.

---

## Daftar Jenis Template Approval (Lengkap)

Template approval harus tersedia di menu Approval Templates, minimal untuk tipe berikut:

1. Material Request
2. Purchase Requisition
3. Purchase Order
4. Receive Item
5. Stock Out - SPB
6. Stock Out - SPB PO
7. Stock Out - SPB DO
8. Stock Out - SPB Invoice
9. Return SPB
10. Job Costing (opsional, aktifkan jika bisnis butuh approval job costing)

Catatan implementasi:

1. Template harus site-aware (berdasarkan cabang/site).
2. Saat create dokumen, template wajib dipilih.
3. Tanpa template valid, submit harus ditolak dengan pesan jelas.

---

## Progress Tracker

Status nilai: `not-started`, `in-progress`, `blocked`, `completed`

| Chapter | Judul                                           | Owner | Status    | Mulai      | Selesai    | Catatan                                                                       |
| ------- | ----------------------------------------------- | ----- | --------- | ---------- | ---------- | ----------------------------------------------------------------------------- |
| C1      | Job Costing multi cabang + finish part input    | -     | completed | 2026-05-04 | 2026-05-04 | Backend + create form + detail metadata                                       |
| C2      | Bug template approval user reset                | -     | completed | 2026-05-04 | 2026-05-04 | State per-step stabil + immutable update                                      |
| C3      | Restriksi harga PO hanya Purchasing             | -     | completed | 2026-05-04 | 2026-05-04 | Helper izin + masking create/detail/print + sanitasi create backend           |
| C4      | Approval Receive Item + template wajib          | -     | completed | 2026-05-04 | 2026-05-04 | Template wajib + approval step by step + signature + final completed          |
| C5      | Moderator edit tracking + note delivery         | -     | completed | 2026-05-04 | 2026-05-04 | Override tracking+catatan custom khusus moderator/admin + guard role          |
| C6      | Finalize delivery sinkron ke tracking completed | -     | completed | 2026-05-04 | 2026-05-04 | Finalize set status+tracking completed + idempotent repeat finalize           |
| C7      | Manual ID/kode semua dokumen create             | -     | completed | 2026-05-04 | 2026-05-04 | Auto-generate dimatikan + validasi uniqueness backend lintas modul            |
| C8      | Approval semua sub fitur Stock Out              | -     | completed | 2026-05-04 | 2026-05-04 | Template wajib + approve/reject per dokumen + final approval status completed |
| C9      | Sinkron status MR/PR/dokumen ke completed       | -     | completed | 2026-05-04 | 2026-05-04 | Mapping final status legacy -> completed + patch service/UI + migration data  |

### Log Progress Harian

| Tanggal    | Chapter | Update                                                                                                                                                                                                                                                     | Risiko                                                                                                                                                          | Next Action                        |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 2026-05-04 | C1      | Implementasi multi-cabang source item + qty finish part + stok asal/tujuan                                                                                                                                                                                 | Rollback masih best-effort tanpa DB transaction penuh                                                                                                           | Lanjut C2 bug template approval    |
| 2026-05-04 | C2      | Perbaikan state template approval: key step stabil, search per-step, update targeted immutable                                                                                                                                                             | Perlu uji manual lintas browser untuk interaksi popover                                                                                                         | Lanjut C3 restriksi harga PO       |
| 2026-05-04 | C3      | Pembatasan harga PO: hanya Purchasing lihat harga, subtotal, total di create/detail/print + sanitasi server saat create                                                                                                                                    | Belum ada read API server khusus untuk masking response list/detail                                                                                             | Lanjut C6 finalize delivery        |
| 2026-05-04 | C4      | Receive Item kini wajib template approval site, create ditolak jika template kosong/tidak valid, approve/reject pakai signature, final status receive jadi completed dan posting stok dilakukan saat final approval                                        | Existing receive lama perlu migrasi status ke completed untuk kompatibilitas                                                                                    | Lanjut C6 finalize delivery        |
| 2026-05-04 | C5      | Moderator/admin kini bisa override status tracking utama delivery dan input catatan tracking custom via panel khusus; backend membatasi akses custom hanya untuk role moderator/admin                                                                      | Belum ada histori per-step tracking, catatan masih disimpan sebagai latest state                                                                                | Lanjut C6 finalize delivery        |
| 2026-05-04 | C6      | Finalize delivery kini menyinkronkan `status` dan `tracking_status` ke `completed`, termasuk guard idempotent agar finalize berulang tetap aman tanpa reposting stok                                                                                       | Nilai legacy `done/closed` masih bisa muncul dari data historis lama                                                                                            | Lanjut C9 normalisasi status akhir |
| 2026-05-04 | C7      | Seluruh kode/nomor dokumen create dipaksa manual untuk MR/PR/PO/Receive/Delivery/SPB/Return/Job Costing; auto-generate dinonaktifkan pada form terdampak; backend tambah validasi kode wajib + uniqueness eksplisit                                        | Potensi bentrok tetap ada jika data legacy duplikat belum dibersihkan                                                                                           | Lanjut C8 approval stock out       |
| 2026-05-04 | C8      | Approval wajib diterapkan di SPB/SPB PO/SPB DO/SPB Invoice/Return SPB: template picker wajib di create form, backend validasi template site-aware, action approve/reject tersedia di list, final approval status menjadi `completed`                       | Dokumen lama tanpa approval flow dimigrasikan ke completed agar kompatibel; perlu validasi ulang bila business flow ingin posting stok sebelum/selesai approval | Lanjut C9 normalisasi status akhir |
| 2026-05-04 | C9      | Final status dokumen dinormalisasi ke `completed` dengan mapping terpusat (`done/closed -> completed`) untuk MR/PR/PO/Delivery/Job Costing; flow receive menyelesaikan MR/PR/PO ke completed; UI filter/badge disesuaikan dan tetap kompatibel data legacy | Beberapa data legacy masih bisa membawa nilai lama sebelum migrasi dijalankan di environment target                                                             | Lanjut QA flow end-to-end          |
| 2026-05-04 | All     | Baseline planning dibuat                                                                                                                                                                                                                                   | Belum ada                                                                                                                                                       | Mulai dari C2/C3 sebagai quick win |

---

## Urutan Implementasi Disarankan

Agar cepat dan aman, gunakan urutan berikut:

1. C2 - bug template approval
2. C3 - visibility harga PO
3. C6 - finalize delivery -> tracking completed
4. C5 - moderator tracking status + note
5. C9 - normalisasi status completed lintas dokumen
6. C4 - approval receive item
7. C8 - approval semua dokumen stock out
8. C1 - job costing multi cabang + finish part input
9. C7 - manual code/id lintas seluruh create form

---

## Chapter Detail Eksekusi

## C1 - Job Costing Multi Cabang + Finish Part Qty Input

### Scope

1. Tambah input `qty_finish_part` pada form create Job Costing.
2. Item bahan bisa diambil dari cabang asal berbeda per line item.
3. Tambah input cabang tujuan finish part.
4. Kurangi stok dari cabang asal line item.
5. Tambah stok finish part ke cabang tujuan.

### File target utama

1. [app/(With Sidebar)/job-costing/create/page.tsx](app/(With Sidebar)/job-costing/create/page.tsx)
2. [services/finance-actions.ts](services/finance-actions.ts)
3. [components/job-costing/job-costing-detail-sheet.tsx](components/job-costing/job-costing-detail-sheet.tsx)
4. [supabase/migrations](supabase/migrations)

### Task kecil (berurutan)

1. Tambah field DB jika belum ada: `finish_part_cabang_id`, `qty_finish_part`, `source_cabang_id` per item.
2. Validasi server: stok cukup per line item berdasarkan cabang asal.
3. Insert header + details dengan data cabang.
4. Eksekusi mutasi stok asal dan tujuan.
5. Tampilkan data baru di detail sheet.

### Acceptance

1. Submit sukses saat item beda cabang.
2. Stok asal berkurang benar, stok finish part bertambah benar.
3. Jika satu line gagal stok, transaksi dibatalkan.

---

## C2 - Perbaikan Bug Approval Template (3 User atau lebih)

### Scope

1. Pilih user di satu step tidak mereset step lain.
2. Search input per-step stabil.

### File target utama

1. [components/approval/template-editor.tsx](components/approval/template-editor.tsx)

### Task kecil

1. Stabilkan key per step (id lokal permanen).
2. Pisahkan state search per-step.
3. Update step secara targeted immutable.

### Acceptance

1. Template 4-5 step tidak reset saat ganti user di step mana pun.

---

## C3 - Harga PO Hanya Role Purchasing

### Scope

1. Hanya role Purchasing yang dapat melihat harga item, subtotal, total.
2. Role lain melihat placeholder.

### File target utama

1. [app/(With Sidebar)/po/create/page.tsx](app/(With Sidebar)/po/create/page.tsx)
2. [app/(With Sidebar)/po/page.tsx](app/(With Sidebar)/po/page.tsx)
3. [components/po/po-detail-sheet.tsx](components/po/po-detail-sheet.tsx)
4. [services/procurement-actions.ts](services/procurement-actions.ts)

### Task kecil

1. Buat helper izin view harga.
2. Masking UI kolom harga untuk non-Purchasing.
3. Tambahkan sanitasi response server untuk defense-in-depth.

### Acceptance

1. Non-Purchasing tidak bisa melihat nominal di halaman create/list/detail/print PO.

---

## C4 - Approval Receive Item (Template Wajib)

### Scope

1. Receive item memakai approval flow berdasarkan template site.
2. Template wajib dipilih, tanpa template tidak bisa create.
3. Approval pakai signature.

### File target utama

1. [app/(With Sidebar)/receive/create/page.tsx](app/(With Sidebar)/receive/create/page.tsx)
2. [app/(With Sidebar)/receive/page.tsx](app/(With Sidebar)/receive/page.tsx)
3. [components/receive/receive-detail-sheet.tsx](components/receive/receive-detail-sheet.tsx)
4. [services/inventory-actions.ts](services/inventory-actions.ts)
5. [lib/approval.ts](lib/approval.ts)

### Task kecil

1. Tambah approval type `Receive Item` di template engine.
2. Paksa pemilihan template saat create.
3. Implement approve/reject dengan signature.
4. Status final receive menjadi `completed`.

### Acceptance

1. Receive tanpa template gagal dibuat.
2. Receive dengan approval selesai berubah ke `completed`.

---

## C5 - Moderator Bisa Ubah Tracking + Catatan Delivery

### Scope

1. Moderator bisa mengubah status tracking utama.
2. Moderator bisa menambah catatan tracking custom.

### File target utama

1. [components/delivery/delivery-detail-sheet.tsx](components/delivery/delivery-detail-sheet.tsx)
2. [services/inventory-actions.ts](services/inventory-actions.ts)

### Task kecil

1. Tambah authorization moderator/admin.
2. Tambah input tracking note.
3. Simpan tracking status + note secara aman.

### Acceptance

1. Moderator bisa ubah status dan note.
2. User non-moderator tidak bisa override.

---

## C6 - Perbaikan Finalize Delivery Agar Tracking Jadi completed

### Scope

1. Saat finalize dengan signature receiver, tracking ikut final `completed`.
2. Status dokumen delivery juga final `completed`.

### File target utama

1. [services/inventory-actions.ts](services/inventory-actions.ts)
2. [components/delivery/delivery-detail-sheet.tsx](components/delivery/delivery-detail-sheet.tsx)

### Task kecil

1. Sinkronkan update status delivery + tracking dalam satu flow.
2. Pastikan idempotent jika finalize dipanggil ulang.

### Acceptance

1. Tidak ada lagi kasus delivery selesai tapi tracking menggantung.

---

## C7 - Semua Dokumen ID/Kode Manual Saat Create

### Scope

1. Semua create dokumen yang butuh ID/kode wajib input manual.
2. Auto-generate dimatikan untuk semua dokumen.

### File target utama

1. Semua halaman create dokumen terkait di [app/(With Sidebar)](app/(With Sidebar))
2. Service generator seperti [services/spb-actions.ts](services/spb-actions.ts) dan generator lain sejenis

### Task kecil

1. Inventaris semua dokumen create.
2. Wajibkan input kode (required).
3. Validasi uniqueness di server.

### Acceptance

1. Tidak ada dokumen yang tetap auto-generate ID/kode pada create.

---

## C8 - Approval Semua Sub Fitur Stock Out

### Scope

Approval wajib untuk semua dokumen yang dibuat pada sub menu Stock Out, minimal:

1. SPB
2. SPB PO
3. SPB DO
4. SPB Invoice
5. Return SPB

### File target utama

1. [app/(With Sidebar)/spb/create/page.tsx](app/(With Sidebar)/spb/create/page.tsx)
2. [app/(With Sidebar)/spb/po/page.tsx](app/(With Sidebar)/spb/po/page.tsx)
3. [app/(With Sidebar)/spb/do/page.tsx](app/(With Sidebar)/spb/do/page.tsx)
4. [app/(With Sidebar)/spb/invoice/page.tsx](app/(With Sidebar)/spb/invoice/page.tsx)
5. [services/spb-actions.ts](services/spb-actions.ts)
6. [lib/approval.ts](lib/approval.ts)

### Task kecil

1. Tambah tipe template approval untuk semua dokumen stock out.
2. Paksa template dipilih sebelum create dokumen.
3. Tambah action approve/reject + status update ke `completed` saat final.

### Acceptance

1. Semua dokumen stock out yang dibuat memiliki approval flow aktif.

---

## C9 - Normalisasi Status Final Menjadi completed

### Scope

1. MR, PR, delivery, receive, stock out, dan dokumen relevan lainnya memakai final status `completed`.
2. Hindari campuran final status seperti done/closed/approved pada state akhir dokumen.

### File target utama

1. [services/procurement-actions.ts](services/procurement-actions.ts)
2. [services/inventory-actions.ts](services/inventory-actions.ts)
3. [services/spb-actions.ts](services/spb-actions.ts)
4. [type/index.ts](type/index.ts)
5. Halaman list/detail masing-masing modul

### Task kecil

1. Buat mapping transisi status final per dokumen.
2. Ubah logic action final step -> `completed`.
3. Sinkronkan badge/filter di UI agar mengenali `completed`.

### Acceptance

1. Semua dokumen akhir konsisten `completed`.

---

## SOP Eksekusi Kecil per Chapter (Agar Model Tidak Melebar)

Untuk setiap chapter, wajib ikuti urutan ini:

1. Discovery mini
   - Baca file target chapter saja.
   - Catat field/status yang dipakai.
2. Implementasi backend kecil
   - 1 action atau 1 validasi per patch.
3. Implementasi frontend kecil
   - Hanya field/logic terkait requirement.
4. Verifikasi
   - Jalankan lint file terdampak.
   - Uji happy path.
   - Uji 2 skenario gagal.
5. Update tracker
   - Update tabel progress dan log harian di README.

---

## Quick Start Dev

```bash
npm run dev
```

---

## Catatan Operasional Tim

1. Jika ada konflik requirement baru, update section "Keputusan Final Requirement" terlebih dahulu.
2. Jika ada perubahan status enum, update chapter C9 sebagai sumber konsistensi.
3. Jika implementasi menyentuh migration, jalankan perubahan terisolasi dan backward-safe.

---

## Prompt Pack Eksekusi (Siap Pakai, Anti Ngawur)

Gunakan prompt berikut untuk menjalankan tiap chapter secara konsisten. Semua prompt ini wajib menjaga perubahan tetap fokus fungsi tanpa mengubah styling/UI yang tidak perlu.

## A. Prompt Master (Wajib dipakai sebelum chapter apa pun)

```text
Ikuti README project ini sebagai source of truth. Jalankan chapter secara small-batch dan konsisten.

Aturan wajib:
1) Fokus hanya ke fungsi revisi chapter aktif (logic, validasi, status, auth, server actions, DB bila perlu).
2) Dilarang mengubah styling/UI/layout/class yang tidak relevan.
3) Dilarang refactor besar di luar scope chapter.
4) Semua status final dokumen harus menggunakan "completed".
5) Setiap perubahan harus idempotent untuk action final/approval.
6) Jika ada data kritikal, validasi di server side harus lebih dulu dari mutasi.

Format kerja yang wajib kamu kirim:
1) Ringkasan scope chapter aktif (maks 6 bullet).
2) Daftar file target yang akan diubah.
3) Rencana patch kecil (step-by-step).
4) Implementasi patch.
5) Hasil verifikasi (lint/test/manual check).
6) Update progress tracker di README (chapter status + log harian).

Jangan berhenti di analisis. Langsung implementasi sampai chapter selesai atau benar-benar blocked.
```

## B. Prompt Chapter C1

```text
Jalankan Chapter C1 sesuai README: Job Costing multi cabang + finish part qty input.

Objective:
1) Tambah input qty_finish_part (manual input).
2) Tambah source cabang per item line job costing.
3) Tambah cabang tujuan finish part.
4) Kurangi stok per source cabang item.
5) Tambah stok finish part ke cabang tujuan.

Constraint:
1) Cabang asal boleh sama dengan cabang tujuan.
2) Jangan ubah styling/UI di luar field fungsional.
3) Jika satu line gagal validasi stok, jangan ada mutasi parsial.

Output wajib:
1) Sebutkan migration/field yang ditambah (jika perlu).
2) Patch backend dulu, baru frontend.
3) Beri test scenario: happy path + minimal 2 negative case.
4) Update progress tracker README untuk C1.
```

## C. Prompt Chapter C2

```text
Jalankan Chapter C2 sesuai README: perbaiki bug approval template saat user >= 3 step agar tidak reset.

Objective:
1) Pemilihan user di satu step tidak mereset step lain.
2) Search input per step stabil.

Constraint:
1) Fokus di state management komponen template editor.
2) Jangan ubah tampilan visual yang tidak perlu.

Output wajib:
1) Jelaskan akar bug (state/key/update pattern).
2) Terapkan patch immutable targeted update per step.
3) Tulis verifikasi: create 4-5 step, edit step tengah, remove step tengah.
4) Update progress tracker README untuk C2.
```

## D. Prompt Chapter C3

```text
Jalankan Chapter C3 sesuai README: harga PO hanya boleh terlihat oleh role Purchasing.

Objective:
1) Non-Purchasing tidak bisa melihat harga item/subtotal/total.
2) Purchasing tetap bisa melihat harga normal.

Constraint:
1) Terapkan defense-in-depth: UI masking + sanitasi backend response bila diperlukan.
2) Jangan ubah desain tabel/layout.

Output wajib:
1) Tambahkan helper izin view harga.
2) Terapkan masking pada create/list/detail/print PO bila ada.
3) Verifikasi role Purchasing vs non-Purchasing.
4) Update progress tracker README untuk C3.
```

## E. Prompt Chapter C4

```text
Jalankan Chapter C4 sesuai README: approval Receive Item berbasis template approval site.

Objective:
1) Receive Item harus memilih template approval saat create.
2) Jika template tidak dipilih/tidak ada, create harus ditolak.
3) Approval/reject receive memakai signature.
4) Status final flow menjadi completed.

Constraint:
1) Approval source of truth dari approval_templates + approval_template_steps.
2) Jangan ubah UI yang tidak relevan.

Output wajib:
1) Tambah dukungan approval type Receive Item di engine/template binding.
2) Implement approve/reject receive step-by-step.
3) Uji happy path + no-template case + unauthorized approver case.
4) Update progress tracker README untuk C4.
```

## F. Prompt Chapter C5

```text
Jalankan Chapter C5 sesuai README: moderator bisa mengubah tracking status delivery dan menambah tracking note.

Objective:
1) Moderator/admin bisa edit status tracking utama.
2) Moderator/admin bisa input tracking note custom.
3) Non-moderator tidak boleh override tracking custom.

Constraint:
1) Tetap jaga alur tracking utama agar tidak rusak.
2) Jangan ubah gaya tampilan yang tidak perlu.

Output wajib:
1) Implementasi authorization check.
2) Simpan tracking status + note secara aman.
3) Verifikasi role-based behavior.
4) Update progress tracker README untuk C5.
```

## G. Prompt Chapter C6

```text
Jalankan Chapter C6 sesuai README: saat finalize delivery dengan signature, tracking final harus completed.

Objective:
1) Finalize delivery mengubah status delivery final ke completed.
2) Finalize delivery juga mengubah tracking_status final ke completed.
3) Operasi harus idempotent.

Constraint:
1) Sinkronisasi update dilakukan dalam satu flow logis.
2) Jangan ubah UI yang tidak berkaitan.

Output wajib:
1) Tunjukkan patch pada action finalize delivery.
2) Verifikasi refresh state tetap completed.
3) Verifikasi repeated finalize call aman.
4) Update progress tracker README untuk C6.
```

## H. Prompt Chapter C7

```text
Jalankan Chapter C7 sesuai README: semua dokumen yang butuh ID/kode saat create harus manual input.

Objective:
1) Matikan auto-generate kode/ID untuk semua dokumen create yang relevan.
2) Wajibkan input kode/ID manual di form.
3) Validasi uniqueness wajib di backend.

Constraint:
1) Lakukan bertahap per modul, jangan sekaligus besar.
2) Jangan ubah styling/layout.

Output wajib:
1) Inventaris dokumen yang terdampak.
2) Patch per modul (small batch) + validasi server.
3) Uji tanpa kode, duplikat kode, kode valid.
4) Update progress tracker README untuk C7.
```

## I. Prompt Chapter C8

```text
Jalankan Chapter C8 sesuai README: implement approval untuk semua sub fitur Stock Out yang membuat dokumen.

Scope minimal dokumen:
1) SPB
2) SPB PO
3) SPB DO
4) SPB Invoice
5) Return SPB

Objective:
1) Semua create dokumen stock out wajib template approval.
2) Tanpa template valid, create ditolak.
3) Approval flow bisa approve/reject dan final state completed.

Constraint:
1) Site-aware template (cabang).
2) Jangan ubah UI yang tidak diperlukan.

Output wajib:
1) Daftar approval type yang dipakai untuk tiap dokumen stock out.
2) Patch bertahap per dokumen.
3) Uji approval happy path + reject path + no-template path.
4) Update progress tracker README untuk C8.
```

## J. Prompt Chapter C9

```text
Jalankan Chapter C9 sesuai README: normalisasi status final semua dokumen ke completed.

Objective:
1) MR, PR, Delivery, Receive, Stock Out, dan dokumen final lain konsisten selesai dengan status completed.
2) Hilangkan ambigu done/closed/approved sebagai status akhir.

Constraint:
1) Terapkan via mapping status terpusat jika memungkinkan.
2) Pastikan backward-safe untuk data lama.

Output wajib:
1) Daftar status akhir lama -> status baru completed.
2) Patch service layer dan penyesuaian filter/badge UI.
3) Verifikasi alur final tiap modul utama.
4) Update progress tracker README untuk C9.
```

## K. Prompt Update Tracker (Dipakai setelah selesai 1 chapter)

```text
Update README progress tracker setelah chapter selesai:
1) Ubah status chapter menjadi completed (atau blocked jika ada blocker).
2) Isi tanggal mulai dan selesai.
3) Tambahkan 1 baris log harian berisi: chapter, ringkasan implementasi, risiko tersisa, next action.
4) Jangan ubah section lain yang tidak terkait progress.
```
