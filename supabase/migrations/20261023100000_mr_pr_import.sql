  -- Penanda & qty historis untuk MR/PR hasil import spreadsheet PPIC
  -- ("PR WMS <tgl>.xlsx", sheet MR Monitoring + PR OPEN WMS).
  -- Date: 2026-10-23
  --
  -- mr_items.qty_received dihitung ulang (live-recompute) dari sumber
  -- pemenuhan di WMS (lib/mr-fulfillment.ts). Qty yang sudah diterima SEBELUM
  -- MR masuk WMS tidak punya dokumen sumber, jadi disimpan terpisah di
  -- qty_received_import dan dihitung sebagai sumber pemenuhan #8. Tanpa kolom
  -- ini qty diterima hasil import akan tertimpa 0 saat item di-recompute.
  --
  -- Backward compat: kolom baru ber-default 0/false, code lama tidak membacanya;
  -- code baru tetap jalan walau migration ini belum dijalankan.
  -- Urutan: migration ini + deploy frontend DULU, baru jalankan SQL import
  -- MR/PR -- code lama tidak menghitung qty_received_import, jadi recompute di
  -- code lama akan menimpa qty diterima MR import jadi 0.

  ALTER TABLE public.mr_items
    ADD COLUMN IF NOT EXISTS qty_received_import INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE public.mr_items DROP CONSTRAINT IF EXISTS mr_items_qty_received_import_check;
  ALTER TABLE public.mr_items ADD CONSTRAINT mr_items_qty_received_import_check
    CHECK (qty_received_import >= 0);

  ALTER TABLE public.mrs
    ADD COLUMN IF NOT EXISTS mr_is_import BOOLEAN NOT NULL DEFAULT false;

  ALTER TABLE public.prs
    ADD COLUMN IF NOT EXISTS pr_is_import BOOLEAN NOT NULL DEFAULT false;

  CREATE INDEX IF NOT EXISTS idx_mrs_mr_is_import
    ON public.mrs(mr_is_import)
    WHERE mr_is_import;

  CREATE INDEX IF NOT EXISTS idx_prs_pr_is_import
    ON public.prs(pr_is_import)
    WHERE pr_is_import;

  COMMENT ON COLUMN public.mr_items.qty_received_import IS
    'Qty sudah diterima sebelum MR diimport ke WMS (spreadsheet PPIC); sumber pemenuhan MR #8.';
  COMMENT ON COLUMN public.mrs.mr_is_import IS
    'true = MR hasil import spreadsheet PPIC (MR Monitoring).';
  COMMENT ON COLUMN public.prs.pr_is_import IS
    'true = PR hasil import spreadsheet PPIC/ERP (PR OPEN WMS / NO PR di MR Monitoring).';
