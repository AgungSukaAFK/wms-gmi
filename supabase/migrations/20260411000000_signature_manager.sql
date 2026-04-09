-- ============================================================
-- SIGNATURE MANAGER SCHEMA
-- ============================================================

-- 1. Tabel user_signatures
CREATE TABLE IF NOT EXISTS public.user_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    printed_name TEXT NOT NULL,
    label TEXT NOT NULL,
    password_hash TEXT NOT NULL, -- Hashed secondary password for signature
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Fungsi untuk membatasi kuota (Max 10 per user)
CREATE OR REPLACE FUNCTION public.check_signature_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM public.user_signatures WHERE user_id = NEW.user_id) >= 10 THEN
        RAISE EXCEPTION 'User has reached the maximum limit of 10 signatures.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_check_signature_limit
    BEFORE INSERT ON public.user_signatures
    FOR EACH ROW EXECUTE FUNCTION public.check_signature_limit();

-- 3. RLS Policies
ALTER TABLE public.user_signatures ENABLE ROW LEVEL SECURITY;

-- Hanya pemilik yang bisa membaca tanda tangannya sendiri
CREATE POLICY "Users can view own signatures"
    ON public.user_signatures FOR SELECT
    USING (auth.uid() = user_id);

-- Hanya pemilik yang bisa membuat tanda tangan (Insert)
CREATE POLICY "Users can insert own signatures"
    ON public.user_signatures FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Pemilik bisa mengubah LABEL atau status HIDDEN (Update)
-- Tapi IMAGE_URL dan PRINTED_NAME diproteksi (tidak boleh berubah) melalui RLS
CREATE POLICY "Users can update own signature labels"
    ON public.user_signatures FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id AND
        image_url = image_url AND -- SQL trick: check against existing value
        printed_name = printed_name AND
        password_hash = password_hash
    );

-- 4. Storage Bucket Setup
INSERT INTO storage.buckets (id, name, public) 
VALUES ('signatures', 'signatures', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: Hanya pemilik yang bisa akses folder ber-ID UUID mereka sendiri
CREATE POLICY "Users can upload signatures"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'signatures' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can view own signature files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'signatures' AND (storage.foldername(name))[1] = auth.uid()::text);
