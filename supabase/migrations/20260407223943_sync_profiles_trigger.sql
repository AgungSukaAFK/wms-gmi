-- Trigger function to create a profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, nama, email, nrp, cabang_id, role, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nama', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'nrp',
    (NEW.raw_user_meta_data->>'cabang_id')::bigint,
    COALESCE(NEW.raw_user_meta_data->>'role', 'warehouse')::public.user_role,
    COALESCE((NEW.raw_user_meta_data->>'is_active')::boolean, FALSE)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
