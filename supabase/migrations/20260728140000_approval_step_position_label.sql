-- Tambah label posisi/jabatan opsional per step approval template (mis. "GL Plant",
-- "Planner", "Logistics"). Dipakai sebagai subtitle di bawah kolom tanda tangan saat
-- SPB dicetak, karena level ('menyetujui'/'mengetahui') saja tidak cukup deskriptif
-- untuk form fisik yang butuh nama jabatan.

ALTER TABLE public.approval_template_steps
  ADD COLUMN IF NOT EXISTS position_label TEXT;
