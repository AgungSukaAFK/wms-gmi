-- CABANG SEEDS
INSERT INTO public.cabang (id, nama_cabang, kode_cabang, is_active)
VALUES 
    (1, 'Head Office Jakarta', 'HO-JKT', true),
    (2, 'Site Balikpapan', 'BPN-01', true),
    (3, 'Site Samarinda', 'SRI-01', true)
ON CONFLICT (id) DO UPDATE SET 
    nama_cabang = EXCLUDED.nama_cabang,
    kode_cabang = EXCLUDED.kode_cabang;

-- BARANG SEEDS
INSERT INTO public.barang (id, part_number, part_name, part_satuan)
VALUES
    (1, 'OF-001', 'Oil Filter Komatsu PC200', 'PCS'),
    (2, 'FF-002', 'Fuel Filter Cummins QSK60', 'PCS'),
    (3, 'BR-6205', 'Bearing 6205-2RS', 'SET'),
    (4, 'OIL-HYD-20', 'Hydraulic Oil ISO 46 (20L)', 'PAIL'),
    (5, 'GRS-LIT-01', 'Grease Lithium Multi-Purpose (1kg)', 'CAN'),
    (6, 'BOLT-M10', 'Bolt & Nut M10x50 Grade 8.8', 'PCS'),
    (7, 'OR-KIT-A', 'O-Ring Kit Service A', 'BOX'),
    (8, 'BELT-A42', 'V-Belt A-42 Gates', 'PCS'),
    (9, 'SL-CRK', 'Seal Crankshaft Front', 'PCS'),
    (10, 'SP-01', 'Spark Plug Denso', 'PCS')
ON CONFLICT (id) DO UPDATE SET 
    part_number = EXCLUDED.part_number,
    part_name = EXCLUDED.part_name,
    part_satuan = EXCLUDED.part_satuan;

-- STOCK SEEDS
INSERT INTO public.stock (part_id, cabang_id, qty, min_qty, max_qty)
VALUES
    (1, 1, 50, 10, 100), (1, 2, 20, 5, 50), (1, 3, 10, 5, 50),
    (2, 1, 30, 10, 80),  (2, 2, 15, 5, 40), (2, 3, 5, 2, 20),
    (3, 1, 100, 20, 200), (3, 2, 50, 10, 100),
    (4, 1, 12, 5, 20),   (4, 2, 24, 10, 40), (4, 3, 18, 5, 30),
    (5, 1, 40, 10, 60),   (5, 2, 20, 5, 30),
    (6, 1, 500, 100, 1000), (6, 2, 200, 50, 500),
    (7, 1, 5, 2, 10),    (7, 2, 8, 2, 12),
    (8, 1, 25, 5, 40),   (8, 2, 12, 5, 20),
    (9, 1, 15, 5, 30),   (9, 2, 5, 2, 10),
    (10, 1, 60, 20, 100), (10, 2, 40, 10, 80)
ON CONFLICT (part_id, cabang_id) DO UPDATE SET
    qty = EXCLUDED.qty,
    min_qty = EXCLUDED.min_qty,
    max_qty = EXCLUDED.max_qty;

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
)
ON CONFLICT (id) DO NOTHING;
