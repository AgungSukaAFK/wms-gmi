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
    '{"nama": "Admin SITE DEMO", "nrp": "999999", "cabang_id": 1, "role": "admin", "is_active": true}', 
    false, 
    'authenticated', 
    'authenticated', 
    '', '', '', 0, now(), now(), '', NULL, ''
),
(
    '66666666-6666-6666-6666-666666666666', 
    '00000000-0000-0000-0000-000000000000', 
    'moderator@demo.com', 
    crypt('demo123', gen_salt('bf')), 
    now(), 
    '{"provider":"email","providers":["email"]}', 
    '{"nama": "Moderator Superuser", "nrp": "000000", "cabang_id": 1, "role": "moderator", "is_active": true}', 
    false, 
    'authenticated', 
    'authenticated', 
    '', '', '', 0, now(), now(), '', NULL, ''
),
(
    '11111111-1111-1111-1111-111111111111', 
    '00000000-0000-0000-0000-000000000000', 
    'warehouse@demo.com', 
    crypt('demo123', gen_salt('bf')), 
    now(), 
    '{"provider":"email","providers":["email"]}', 
    '{"nama": "Warehouse DEMO", "nrp": "888888", "cabang_id": 1, "role": "warehouse", "is_active": true}', 
    false, 
    'authenticated', 
    'authenticated', 
    '', '', '', 0, now(), now(), '', NULL, ''
),
(
    '22222222-2222-2222-2222-222222222222', 
    '00000000-0000-0000-0000-000000000000', 
    'approver@demo.com', 
    crypt('demo123', gen_salt('bf')), 
    now(), 
    '{"provider":"email","providers":["email"]}', 
    '{"nama": "Approver DEMO", "nrp": "777777", "cabang_id": 1, "role": "approver", "is_active": true}', 
    false, 
    'authenticated', 
    'authenticated', 
    '', '', '', 0, now(), now(), '', NULL, ''
),
(
    '33333333-3333-3333-3333-333333333333', 
    '00000000-0000-0000-0000-000000000000', 
    'purchasing@demo.com', 
    crypt('demo123', gen_salt('bf')), 
    now(), 
    '{"provider":"email","providers":["email"]}', 
    '{"nama": "Purchasing DEMO", "nrp": "666666", "cabang_id": 1, "role": "purchasing", "is_active": true}', 
    false, 
    'authenticated', 
    'authenticated', 
    '', '', '', 0, now(), now(), '', NULL, ''
),
(
    '44444444-4444-4444-4444-444444444444', 
    '00000000-0000-0000-0000-000000000000', 
    'finance@demo.com', 
    crypt('demo123', gen_salt('bf')), 
    now(), 
    '{"provider":"email","providers":["email"]}', 
    '{"nama": "Finance DEMO", "nrp": "555555", "cabang_id": 1, "role": "finance", "is_active": true}', 
    false, 
    'authenticated', 
    'authenticated', 
    '', '', '', 0, now(), now(), '', NULL, ''
),
(
    '55555555-5555-5555-5555-555555555555', 
    '00000000-0000-0000-0000-000000000000', 
    'ga@demo.com', 
    crypt('demo123', gen_salt('bf')), 
    now(), 
    '{"provider":"email","providers":["email"]}', 
    '{"nama": "GA DEMO", "nrp": "444444", "cabang_id": 1, "role": "ga", "is_active": true}', 
    false, 
    'authenticated', 
    'authenticated', 
    '', '', '', 0, now(), now(), '', NULL, ''
);

-- Note: The trigger public.handle_new_user() will automatically insert 
-- the corresponding row into public.profiles using the metadata above.
