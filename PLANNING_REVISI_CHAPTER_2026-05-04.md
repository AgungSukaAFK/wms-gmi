# PLANNING REVISI WMS-GMI (PER CHAPTER)

Tanggal: 2026-05-04  
Tujuan: Menyusun rencana implementasi revisi fitur secara terstruktur, detail, dan aman dieksekusi oleh AI/coder tanpa error beruntun.

---

## 1. Prinsip Eksekusi Global

### 1.1 Aturan Teknis Wajib

- Semua perubahan data kritikal wajib lewat server actions (folder services), bukan direct mutation dari client.
- Setiap perubahan status dokumen harus idempotent (aman dipanggil ulang).
- Semua perubahan stok harus pakai validasi pre-check: stok cukup, data part ada, cabang valid.
- Untuk fitur approval: source of truth adalah template approval per type + cabang.
- Untuk fitur yang berkaitan ttd/signature: validasi user ownership + status dokumen sebelum finalize.

### 1.2 Definisi Done (DoD) Global

- Lint lulus untuk file yang berubah.
- Tidak ada runtime error di flow utama create/list/detail/approve/finalize.
- Status dokumen konsisten setelah aksi utama (approve/reject/finalize/share-stock complete).
- Revalidate path untuk halaman list + detail terkait.
- UAT checklist tiap chapter lulus minimal happy path + 2 negative case.

### 1.3 Urutan Implementasi Disarankan (Aman Dependensi)

1. Chapter 2 (bug template approval)
2. Chapter 3 (visibility harga PO by role)
3. Chapter 6 (delivery tracking finalize bug)
4. Chapter 5 (moderator edit tracking)
5. Chapter 9 (bug status MR setelah share stock)
6. Chapter 4 (approval receive)
7. Chapter 8 (approval stock out/SPB)
8. Chapter 1 (revisi besar job costing multi-cabang)
9. Chapter 7 (manual kode/ID lintas modul, final harmonisasi)

Catatan: Chapter 1, 4, 8 berpotensi butuh migration DB tambahan, jadi dikerjakan setelah bug fix cepat selesai.

---

## 2. Chapter 1 - Revisi Job Costing Multi Cabang + Finish Part Lokasi Tujuan

### 2.1 Ringkasan Requirement

- Saat membuat Job Costing, user bisa memilih material/part dari lebih dari satu cabang asal.
- Hasil proses tetap menghasilkan 1 finish part number baru.
- Harus ada input cabang tujuan untuk finish part.
- Stok material berkurang pada cabang asal masing-masing part.
- Stok finish part bertambah pada cabang tujuan.

### 2.2 Dampak Modul

- app/(With Sidebar)/job-costing/create/page.tsx
- app/(With Sidebar)/job-costing/page.tsx
- components/job-costing/job-costing-detail-sheet.tsx
- services/finance-actions.ts
- kemungkinan services/stock-actions.ts atau services/inventory-actions.ts untuk helper stok
- supabase/migrations (jika butuh kolom baru)

### 2.3 Analisis Data Model

- Cek tabel job_costing dan job_costing_items: pastikan item line menyimpan cabang asal per line (contoh: source_cabang_id).
- Header job_costing perlu menyimpan finish_part_cabang_id (cabang tujuan hasil akhir).
- Pastikan relasi stok berbasis pasangan (part_id + cabang_id) sudah tersedia dan konsisten.

### 2.4 Rencana Implementasi

#### Backend

- Tambah/validasi skema:
  - job_costing.finish_part_cabang_id BIGINT REFERENCES cabang(id)
  - job_costing_items.source_cabang_id BIGINT REFERENCES cabang(id)
- Buat transaksi logis create job costing:
  - Validasi semua part ada di cabang asal masing-masing.
  - Validasi qty tersedia per line.
  - Insert header + line items.
  - Kurangi stok per source_cabang_id.
  - Tambah stok finish part di finish_part_cabang_id.
- Tambahkan guard anti race condition (minimal re-check stok sebelum update final).

#### Frontend

- Form create:
  - Tambah field cabang asal per item line.
  - Tambah field cabang tujuan finish part di header.
  - UX multi-line item dari cabang berbeda.
- Detail/list:
  - Tampilkan ringkasan asal-cabang item dan cabang tujuan finish part.

### 2.5 Validasi & Test Case

- Happy path: 3 line item, 2 cabang asal berbeda, finalize sukses.
- Negative: satu line stok kurang -> seluruh proses gagal, tidak ada stok berubah parsial.
- Negative: finish_part_cabang_id kosong -> block submit.
- Data integrity: total pengurangan stok = total qty bahan dipakai, dan penambahan finish part sesuai output.

### 2.6 Acceptance Criteria

- User bisa submit job costing dengan item lintas cabang.
- Stok asal dan tujuan berubah sesuai aturan.
- Tidak ada mismatch status/job data setelah refresh.

### 2.7 Risiko

- Risiko inkonsistensi stok jika update tidak atomic.
- Risiko performa bila query stok per-item belum di-batch.

---

## 3. Chapter 2 - Bug Approval Template (>= 3 User) Saat Search User

### 3.1 Ringkasan Requirement

- Saat tambah/edit approval template, memilih user hasil pencarian tidak boleh mereset input/step user yang sudah dipilih sebelumnya.

### 3.2 Dampak Modul

- components/approval/template-editor.tsx
- app/(With Sidebar)/approval-templates/page.tsx

### 3.3 Rencana Implementasi

#### Frontend State Fix

- Audit key list rendering untuk steps (hindari key berbasis index murni bila item bisa reorder/remove).
- Pisahkan state search input per-step, jangan shared global yang memicu rerender reset.
- Pastikan handler select user hanya update step target, bukan replace seluruh array tanpa merge.
- Gunakan immutable update yang stabil untuk step id lokal (uuid temporary di client).

#### Backend (Jika perlu)

- Tidak ada perubahan struktural; hanya validasi payload steps tetap lengkap saat submit.

### 3.4 Validasi & Test Case

- Tambah 4 step approval, search user per step, pilih user acak -> step sebelumnya tetap.
- Edit template existing 5 step -> ganti user di step 3, step lain tidak berubah.
- Hapus step tengah -> step lain tetap konsisten.

### 3.5 Acceptance Criteria

- Tidak ada reset value user terpilih saat mencari/pilih user di step lain.

### 3.6 Risiko

- Bug masih muncul jika masih ada controlled/uncontrolled input campuran.

---

## 4. Chapter 3 - Harga Barang di PO Hanya Untuk Role Purchasing

### 4.1 Ringkasan Requirement

- Pada create/detail PO, informasi harga item hanya terlihat untuk role Purchasing.
- Role selain Purchasing tidak boleh melihat nominal harga.

### 4.2 Dampak Modul

- app/(With Sidebar)/po/create/page.tsx
- app/(With Sidebar)/po/page.tsx
- components/po/po-detail-sheet.tsx
- stores/auth-store.ts (konsumsi role/permissions)
- services/procurement-actions.ts (sanitasi response jika diperlukan)

### 4.3 Rencana Implementasi

#### Authorization Layer

- Tentukan helper tunggal: canViewPOPrice(userPermissions).
- UI hide price column, subtotal, total amount jika unauthorized.
- Server-side sanitasi opsional untuk defense-in-depth: response PO untuk non-purchasing di-mask pada field harga.

#### UX

- Untuk non-purchasing tampilkan placeholder "Restricted" atau "-".
- Perhitungan total di UI non-purchasing tidak dirender.

### 4.4 Validasi & Test Case

- Login purchasing: harga terlihat penuh.
- Login non-purchasing: harga tidak terlihat di list, create form, detail, print (jika ada).
- Cek network payload (opsional): field harga termasking untuk non-purchasing.

### 4.5 Acceptance Criteria

- Tidak ada kebocoran nominal harga pada role non-purchasing.

### 4.6 Risiko

- Kebocoran data jika masking hanya di UI tanpa proteksi server.

---

## 5. Chapter 4 - Implementasi Approval Untuk Receive Item

### 5.1 Ringkasan Requirement

- Receive item harus punya alur approval seperti modul lain (MR/PR/PO).
- Approval menggunakan template approval.
- Approval/final approval menggunakan tanda tangan digital.

### 5.2 Dampak Modul

- app/(With Sidebar)/receive/create/page.tsx
- app/(With Sidebar)/receive/page.tsx
- components/receive/receive-detail-sheet.tsx
- services/inventory-actions.ts
- lib/approval.ts (reuse)
- type/index.ts (status/typing receive + approvals)
- supabase/migrations (jika tabel receive belum ada kolom approvals/status approval)

### 5.3 Analisis Data Model

- Receive header perlu kolom approvals (jsonb) dan receive_status yang mendukung open/approved/rejected.
- Simpan jejak signature_url, processed_at per step pada approvals.

### 5.4 Rencana Implementasi

#### Backend

- Saat create receive:
  - Build approval flow dari template sesuai cabang + type "Receive Item" (atau type final sesuai naming project).
  - Jika template kosong: fallback auto-approved (sesuai kebijakan, perlu konfirmasi).
- Approve receive step:
  - Validasi current user adalah pending approver.
  - Simpan signature_url.
  - Jika step terakhir approved -> receive_status menjadi approved, lanjut proses inventory posting jika memang tertunda.
- Reject receive step:
  - Ubah step pending jadi rejected + note wajib.
  - receive_status menjadi rejected.

#### Frontend

- Create page:
  - Dropdown template approval.
  - Preview step approver.
- Detail sheet:
  - Timeline approval.
  - Action approve/reject + signature dialog.

### 5.5 Validasi & Test Case

- Approval 2 step berhasil sampai final -> status approved.
- Rejection di step 1 -> status rejected.
- User non-pending approver tidak bisa approve.

### 5.6 Acceptance Criteria

- Receive memiliki alur approval end-to-end + ttd, konsisten dengan PO/PR.

### 5.7 Risiko

- Salah mapping approval type ke template menyebabkan flow kosong.

---

## 6. Chapter 5 - Moderator Dapat Mengetik Status Tracking Delivery

### 6.1 Ringkasan Requirement

- Moderator dapat mengisi/mengetik status tracking delivery (bukan hanya next step fixed button).

### 6.2 Dampak Modul

- components/delivery/delivery-detail-sheet.tsx
- services/inventory-actions.ts (updateDeliveryTracking)
- type/index.ts (opsi tracking jika enum)

### 6.3 Rencana Implementasi

#### Authorization

- Hanya moderator/admin (atau role policy disepakati) bisa custom input tracking.

#### Frontend

- Tambah input teks atau combobox editable untuk tracking status.
- Tetap sediakan mode guided step untuk user biasa.

#### Backend

- updateDeliveryTracking menerima mode:
  - structured tracking status (enum lama), atau
  - custom_note tracking untuk moderator.
- Jika tetap wajib enum, custom input disimpan di kolom tracking_note terpisah.

### 6.4 Validasi & Test Case

- Moderator bisa isi tracking note custom.
- Non-moderator tidak bisa edit custom tracking.
- Tracking timeline tidak rusak akibat custom status.

### 6.5 Acceptance Criteria

- Moderator bisa input tracking manual tanpa merusak flow utama delivery.

### 6.6 Risiko

- Timeline bisa kacau bila custom text langsung menggantikan enum status utama.

---

## 7. Chapter 6 - Bug Delivery Selesai Dengan TTD Tapi Tracking Tidak Menjadi Selesai

### 7.1 Ringkasan Requirement

- Setelah delivery finalize dengan receiver signature, status tracking harus ikut menjadi final (selesai), tidak menggantung di step terakhir non-final.

### 7.2 Dampak Modul

- services/inventory-actions.ts (finalizeDelivery)
- components/delivery/delivery-detail-sheet.tsx

### 7.3 Rencana Implementasi

#### Backend Fix

- Pada finalizeDelivery:
  - update status delivery -> done/closed.
  - update tracking_status -> final value (contoh: completed/closed sesuai enum).
  - pastikan update dilakukan dalam satu operasi logis.
- Tambah guard: jika sudah finalized, operasi idempotent.

#### Frontend

- UI timeline treat final status sebagai completed all steps.
- Badge status dan tracking sinkron.

### 7.4 Validasi & Test Case

- Finalize dari tracking delivered + signature valid -> status done dan tracking final.
- Refresh halaman -> tetap final, tidak rollback visual.
- Re-finalize call kedua -> tidak error fatal.

### 7.5 Acceptance Criteria

- Tidak ada kasus status done tetapi tracking masih menggantung.

### 7.6 Risiko

- Konflik enum tracking lama vs status baru.

---

## 8. Chapter 7 - Semua Input Kode/ID Dibuat Manual

### 8.1 Ringkasan Requirement

- Seluruh input kode/ID dokumen dibuat manual oleh user (bukan auto-generate), sesuai modul yang disepakati.

### 8.2 Dampak Modul

- Semua create page yang saat ini auto-generate kode:
  - MR, PR, PO, Receive, Delivery, Job Costing, SPB, Return SPB, dll.
- services terkait generator kode (misal generateSpbKode dan pola serupa)

### 8.3 Rencana Implementasi

#### Scope Locking

- Buat daftar final field kode mana saja yang manual mandatory.
- Tentukan format validasi per dokumen (regex, panjang, uniqueness).

#### Backend

- Hapus ketergantungan generator otomatis pada alur create.
- Tambah validasi uniqueness di server sebelum insert.
- Error message jelas bila kode duplikat.

#### Frontend

- Semua form create menampilkan input kode required.
- Hilangkan auto-fill generator yang tidak relevan.
- Tambah helper text format kode.

### 8.4 Validasi & Test Case

- Submit tanpa kode -> block.
- Submit kode duplikat -> gagal dengan pesan jelas.
- Submit kode valid unik -> sukses.

### 8.5 Acceptance Criteria

- Tidak ada dokumen baru yang bergantung auto-generate untuk kode/ID yang discope manual.

### 8.6 Risiko

- Potensi human error entry kode tinggi; butuh validasi format yang ketat.

---

## 9. Chapter 8 - Implementasi Approval Untuk Submenu Stock Out / SPB

### 9.1 Ringkasan Requirement

- Fitur di submenu stock out (SPB flow) harus punya approval/persetujuan.

### 9.2 Dampak Modul

- app/(With Sidebar)/spb/page.tsx
- app/(With Sidebar)/spb/create/page.tsx
- app/(With Sidebar)/spb/po/page.tsx
- app/(With Sidebar)/spb/do/page.tsx
- app/(With Sidebar)/spb/invoice/page.tsx
- app/(With Sidebar)/spb/report/page.tsx
- services/spb-actions.ts
- type/index.ts
- lib/approval.ts
- supabase/migrations (jika butuh approvals jsonb di entitas SPB)

### 9.3 Rencana Implementasi

#### Strategi Approval

- Tentukan level approval minimal:
  - Opsi A: approval hanya di header SPB.
  - Opsi B: approval per tahap SPB->PO->DO->Invoice.
- Rekomendasi awal: mulai dari Opsi A untuk kontrol kompleksitas.

#### Backend

- Tambah approvals + status approval pada entitas target.
- Create SPB inisialisasi flow dari template by cabang + type "Stock Out/SPB".
- Approve/reject action serupa PO/PR.
- Posting pengurangan stok final dilakukan setelah approval final (jika policy demikian).

#### Frontend

- Tambah pemilihan template approval di create SPB.
- Detail/list menampilkan badge approval dan timeline step.
- Tombol aksi approve/reject hanya muncul ke approver aktif.

### 9.4 Validasi & Test Case

- SPB dengan template 2 step approved hingga selesai.
- SPB reject pada step 1.
- User non-approver tidak bisa mengeksekusi approval.

### 9.5 Acceptance Criteria

- SPB memiliki workflow approval yang bisa ditrack dan tervalidasi.

### 9.6 Risiko

- Scope creep jika langsung memasukkan approval untuk semua sub-entitas sekaligus.

---

## 10. Chapter 9 - Bug Status MR Tidak Berubah Setelah Share Stock Terpenuhi

### 10.1 Ringkasan Requirement

- MR yang dipenuhi lewat share stock harus berubah status otomatis ketika share stock selesai dan stok tujuan sudah bertambah.

### 10.2 Dampak Modul

- services/inventory-actions.ts (share stock completion)
- services/procurement-actions.ts (status MR)
- components/mr/mr-detail-sheet.tsx
- app/(With Sidebar)/mr/page.tsx

### 10.3 Rencana Implementasi

#### Backend Fix

- Setelah finalize share stock/delivery terkait:
  - hitung pemenuhan qty MR item (received/allocated).
  - jika seluruh item terpenuhi, set mr_status ke status final yang disepakati (contoh: Completed atau Waiting PO sesuai flow bisnis).
- Pastikan status update berjalan setiap kali event penyelesaian terjadi.

#### Consistency Check

- Tambah util kalkulasi status MR berdasarkan item-level fulfillment.
- Hindari hardcode status di banyak tempat (single helper).

### 10.4 Validasi & Test Case

- MR 3 item, semua terpenuhi share stock -> status MR berubah final.
- Baru sebagian terpenuhi -> status belum final.
- Re-run sync status -> hasil tetap benar (idempotent).

### 10.5 Acceptance Criteria

- Tidak ada MR yang stuck status lama setelah fulfillment share stock selesai.

### 10.6 Risiko

- Salah definisi status final MR terhadap flow PR/PO yang sudah berjalan.

---

## 11. Matriks Dependensi Antar Chapter

- Chapter 4 dan Chapter 8 bergantung stabilitas engine approval/template.
- Chapter 6 dan Chapter 9 saling terkait event finalize delivery/share stock.
- Chapter 1 bergantung aturan manual kode (Chapter 7) jika no job costing ikut dimanualkan.
- Chapter 3 independen dan bisa cepat ditutup.

---

## 12. Checklist Eksekusi Per Chapter (Template Untuk AI)

Gunakan checklist ini setiap chapter agar minim miss:

1. Discovery

- Identifikasi field DB, action server, komponen UI terdampak.
- Verifikasi naming status existing agar tidak pecah kompatibilitas.

2. Design

- Tentukan source of truth status.
- Tentukan fallback behavior jika template approval tidak ada.

3. Implement

- Ubah migration/schema (jika perlu).
- Ubah server actions + guard authorization.
- Ubah komponen UI + validasi form.

4. Verify

- Jalankan lint untuk file terdampak.
- Jalankan uji manual happy path + negative case.
- Cek revalidatePath dan refresh data.

5. Release

- Pastikan backward compatibility untuk data lama.
- Dokumentasikan perubahan enum/status yang dipakai.

---

## 13. Pertanyaan Klarifikasi (Wajib Dijawab Sebelum Eksekusi Besar)

1. Untuk Chapter 1, output finish part qty dihitung dari field mana (qty output manual, atau derivasi dari formula/BOM)?
2. Untuk Chapter 1, bolehkah source cabang item sama dengan cabang tujuan finish part?
3. Untuk Chapter 3, role yang boleh lihat harga hanya "Purchasing" saja, atau juga Admin/Finance?
4. Untuk Chapter 4, approval type untuk receive mau dinamakan apa persisnya di template (contoh: "Receive Item")?
5. Untuk Chapter 4, jika tidak ada template approval receive, default-nya auto-approved atau block create?
6. Untuk Chapter 5, "moderator mengetik status tracking" maksudnya:
   - mengganti enum status utama, atau
   - menambahkan catatan tracking bebas?
7. Untuk Chapter 6, final tracking status yang diinginkan label pastinya apa (done/closed/completed)?
8. Untuk Chapter 7, sebutkan daftar dokumen mana saja yang wajib manual kode/ID (MR, PR, PO, Delivery, Receive, Job Costing, SPB, Return SPB, dll).
9. Untuk Chapter 8, approval diterapkan hanya di header SPB atau sampai SPB-PO-DO-Invoice semua tahap?
10. Untuk Chapter 9, status final MR setelah share stock terpenuhi harus menjadi apa persisnya (Completed, Close 3, atau status lain)?

---

## 14. Rekomendasi Cara Eksekusi Supaya Cepat dan Aman

- Batch 1 (quick wins, low risk): Chapter 2, 3, 6, 9.
- Batch 2 (medium): Chapter 5, 7.
- Batch 3 (high impact): Chapter 4, 8, 1.

Setiap batch wajib ditutup dengan:

- smoke test halaman list + detail modul terkait,
- verifikasi role authorization,
- verifikasi konsistensi status & stok.
