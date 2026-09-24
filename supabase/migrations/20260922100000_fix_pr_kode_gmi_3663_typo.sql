-- Fix typo pada nomor PR: "PR/GMI-3663" -> "PR-GMI-3663"
-- pr_kode adalah TEXT bebas (diisi manual saat create PR), bukan generated/sequence,
-- dan direferensikan oleh dokumen lain (PO, PR items, approvals) hanya lewat FK pr_id,
-- jadi update di sini otomatis konsisten ke seluruh join/view/RPC yang membaca prs.pr_kode.

UPDATE public.prs
SET pr_kode = 'PR-GMI-3663'
WHERE pr_kode = 'PR/GMI-3663';

-- Sinkronkan snapshot teks lama di notifications (title/message/metadata) yang sudah
-- terlanjur menyimpan kode PR lama secara literal saat notifikasi dibuat.
UPDATE public.notifications
SET
  title = replace(title, 'PR/GMI-3663', 'PR-GMI-3663'),
  message = replace(message, 'PR/GMI-3663', 'PR-GMI-3663'),
  metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{document_number}',
    '"PR-GMI-3663"',
    true
  )
WHERE title LIKE '%PR/GMI-3663%'
   OR message LIKE '%PR/GMI-3663%'
   OR metadata->>'document_number' = 'PR/GMI-3663';
