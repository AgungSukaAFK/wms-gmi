-- Seed Cabang Data
INSERT INTO public.cabang (nama_cabang, kode_cabang, is_active)
VALUES 
('Site LOURDES', 'LDS', TRUE),
('Head Office', 'HO', TRUE),
('Tanjung Enim', 'TE', TRUE),
('Balikpapan', 'BPN', TRUE);

-- Seed Admin Demo User
-- Password: demo123
INSERT INTO auth.users (
    id, 
    instance_id, 
    email, 
    encrypted_password, 
    email_confirmed_at, 
    raw_app_meta_data, 
    raw_user_meta_data, 
    is_super_admin, 
    role, 
    aud, 
    confirmation_token, 
    recovery_token, 
    email_change_token_new, 
    email_change_confirm_status,
    created_at,
    updated_at,
    email_change,
    phone,
    phone_change
)
VALUES (
    '00000000-0000-0000-0000-000000000000', 
    '00000000-0000-0000-0000-000000000000', 
    'admin@demo.com', 
    crypt('demo123', gen_salt('bf')), 
    now(), 
    '{"provider":"email","providers":["email"]}', 
    '{"nama": "Admin DEMO", "nrp": "999999", "cabang_id": 1, "role": "admin", "is_active": true}', 
    false, 
    'authenticated', 
    'authenticated', 
    '', 
    '', 
    '', 
    0,
    now(),
    now(),
    '',
    '',
    ''
);

-- Note: The trigger public.handle_new_user() will automatically insert 
-- the corresponding row into public.profiles using the metadata above.
