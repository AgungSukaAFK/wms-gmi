-- Migration sebelumnya (20260922100000) gagal match karena nilai asli tersimpan huruf kecil
-- "pr/gmi-3663", bukan "PR/GMI-3663" (exact match case-sensitive jadi 0 baris kena).
-- Migration ini pakai ILIKE (case-insensitive) supaya benar-benar kena baris id=59.

UPDATE public.prs
SET pr_kode = 'PR-GMI-3663'
WHERE pr_kode ILIKE 'pr/gmi-3663';

-- Sinkronkan snapshot teks lama di notifications (title/message/metadata), case-insensitive juga.
UPDATE public.notifications
SET
  title = regexp_replace(title, 'pr/gmi-3663', 'PR-GMI-3663', 'i'),
  message = regexp_replace(message, 'pr/gmi-3663', 'PR-GMI-3663', 'i'),
  metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{document_number}',
    '"PR-GMI-3663"',
    true
  )
WHERE title ILIKE '%pr/gmi-3663%'
   OR message ILIKE '%pr/gmi-3663%'
   OR metadata->>'document_number' ILIKE 'pr/gmi-3663';
