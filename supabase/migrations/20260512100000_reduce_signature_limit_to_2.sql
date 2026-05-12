-- Reduce Signature Manager quota from 10 to 2 per user
CREATE OR REPLACE FUNCTION public.check_signature_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM public.user_signatures WHERE user_id = NEW.user_id) >= 2 THEN
        RAISE EXCEPTION 'User has reached the maximum limit of 2 signatures.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
