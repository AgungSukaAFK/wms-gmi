-- ============================================================
-- Edit PR Konsinyasi oleh moderator/admin/PPIC
-- (services/vendor-consignment-actions.ts -> updateConsignmentPr)
--
-- Edit dicatat di moderator_edit_logs (doc_type 'pr') supaya muncul di
-- "Riwayat Edit" halaman /pr/[id]. Sebelumnya INSERT hanya untuk moderator,
-- jadi log edit oleh PPIC/admin gagal diam-diam. Policy diperluas: moderator
-- tetap bebas, admin/PPIC hanya boleh menulis log atas nama dirinya sendiri.
-- ============================================================

DROP POLICY IF EXISTS "Moderators can insert moderator_edit_logs"
  ON public.moderator_edit_logs;

CREATE POLICY "Moderators can insert moderator_edit_logs"
  ON public.moderator_edit_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_moderator()
    OR (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = auth.uid()
          AND r.name IN ('admin', 'ppic')
      )
    )
  );
