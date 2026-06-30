-- Apakah ada notifikasi yang masuk sama sekali?
SELECT count(*) AS total, max(created_at) AS terakhir FROM public.notifications;
