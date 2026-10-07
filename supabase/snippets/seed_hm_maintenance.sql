-- Seed DEMO modul HM Maintenance (Periodic Maintenance + Forecasting AC) —
-- LOKAL SAJA, jangan dijalankan di VPS production.
--
-- Satu set data untuk kedua fitur: unit yang sama (hm_units) dipakai jadwal
-- part Periodic Maintenance DAN Forecasting AC, dibagi per site lewat
-- hm_units.cabang_id. Contoh 2 site: GMI-ENIM & GMI-AMI. Kode/model/HM unit
-- diambil dari "Forcasting AC.xlsx" (unit berakhiran AMM = site AMI).
-- Paket part & harga AC dari file yang sama. Part di-link ke master barang
-- lokal lewat Part Number (11L-/14L-) supaya PN tampil sebagai identitas
-- utama; Oli SP10 sengaja tanpa PN (tidak ada di master) sebagai contoh.
--
-- Menggantikan seed_hm_periodic_maintenance.sql + seed_hm_ac_forecast.sql.
-- Jalankan: psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -f supabase/snippets/seed_hm_maintenance.sql

BEGIN;

TRUNCATE
  public.hm_ac_schedules, public.hm_ac_extra_items, public.hm_ac_units,
  public.hm_ac_package_items, public.hm_ac_packages,
  public.hm_replacements, public.hm_services, public.hm_parts, public.hm_units
RESTART IDENTITY CASCADE;

-- ============================================================
-- 1. Unit per site
-- ============================================================
-- family = template part PM (lihat bagian 2), bukan kolom tabel.

CREATE TEMP TABLE seed_units (
  site TEXT, code TEXT, name TEXT, model TEXT, current_hm INTEGER, family TEXT
) ON COMMIT DROP;

INSERT INTO seed_units VALUES
  -- GMI-ENIM
  ('GMI-ENIM', 'D1521',    'Bulldozer Pit Utara',          'Komatsu D155A-6',      43834, 'dozer'),
  ('GMI-ENIM', 'D1558',    'Bulldozer Disposal Barat',     'Komatsu D155A-6',      19981, 'dozer'),
  ('GMI-ENIM', 'D85150',   'Bulldozer Front Loading',      'Komatsu D85ESS-2',     21460, 'dozer'),
  ('GMI-ENIM', 'D85171',   'Bulldozer Jalan Hauling',      'Komatsu D85ESS-2',      9977, 'dozer'),
  ('GMI-ENIM', 'GD823',    'Motor Grader Jalan Angkut',    'Komatsu GD825A-2',     41594, 'grader'),
  ('GMI-ENIM', 'DA25002',  'Fuel Truck Pit Utara',         'Mercedes AXOR 2528 CH', 14473, 'truck'),
  ('GMI-ENIM', 'DA25070',  'Water Truck Jalan Hauling',    'Mercedes AXOR 2528 CH',  9585, 'truck'),
  ('GMI-ENIM', 'DT4001',   'Dump Truck Hauling OB',        'Volvo FMX400',         27699, 'truck'),
  -- GMI-AMI
  ('GMI-AMI',  'D5107AMM', 'Bulldozer Pit Timur',          'Komatsu D155A-6',      25987, 'dozer'),
  ('GMI-AMI',  'D5109AMM', 'Bulldozer Stockpile',          'Komatsu D155A-6',      27772, 'dozer'),
  ('GMI-AMI',  'G5802AMM', 'Motor Grader Pit Timur',       'Komatsu GD825A-2',     39511, 'grader'),
  ('GMI-AMI',  'H54005AMM','Rigid Dump Truck',             'Komatsu HD465-7R',     51840, 'heavy'),
  ('GMI-AMI',  'SV512AMM', 'Vibratory Compactor',          'Sakai SV526D',         15938, 'heavy'),
  ('GMI-AMI',  'F54042AMM','Dump Truck Hauling Coal',      'Volvo FMX400',         22782, 'truck'),
  ('GMI-AMI',  'P54605AMM','Dump Truck Hauling OB',        'Scania P460 B8X4HZ',   12877, 'truck');

INSERT INTO public.hm_units (code, name, model, current_hm, cabang_id)
SELECT su.code, su.name, su.model, su.current_hm, c.id
FROM seed_units su
JOIN public.cabang c ON c.nama_cabang = su.site;

-- ============================================================
-- 2. Part Periodic Maintenance (template per keluarga unit)
-- ============================================================
-- Kode part = Part Number master barang (part di-link ke barang, jadi Stock
-- on Hand ikut stok WMS di gudang site). HM ganti terakhir = kelipatan
-- interval terakhir sebelum HM unit, jadi sisa HM bervariasi alami; ~1 dari 5
-- part sengaja mundur 1 interval (lewat).

CREATE TEMP TABLE seed_part_templates (
  family TEXT, ord INTEGER, part_number TEXT, name TEXT, interval_hm INTEGER
) ON COMMIT DROP;

INSERT INTO seed_part_templates VALUES
  ('dozer', 1, '11L-1199',      'Filter Oli Mesin', 250),
  ('dozer', 2, '11L-1207',      'Filter Solar', 250),
  ('dozer', 3, '11L-1211',      'Filter Udara (Element Air Cleaner)', 500),
  ('dozer', 4, '11L-1197',      'Filter Hidrolik', 1000),
  ('dozer', 5, '11L-3340',      'Filter Element Hidrolik Return', 2000),
  ('dozer', 6, '14L-0208-B57',  'V-Belt Alternator B57', 2000),
  ('grader', 1, '11L-1209',     'Filter Oli Mesin', 250),
  ('grader', 2, '11L-1215',     'Filter Solar', 250),
  ('grader', 3, '11L-1200',     'Filter Udara (Air Cleaner)', 500),
  ('grader', 4, '11L-3208',     'Filter Hidrolik Spin On', 1000),
  ('grader', 5, '14L-0208-GD',  'V-Belt GD825', 2000),
  ('truck', 1, '11L-1218',      'Filter Oli Mesin', 500),
  ('truck', 2, '11L-4641',      'Filter Solar (Element)', 500),
  ('truck', 3, '11L-1198',      'Filter Solar Sekunder', 1000),
  ('truck', 4, '11L-1206',      'Filter Udara (Air Cleaner)', 1000),
  ('truck', 5, '14L-0208-A40',  'V-Belt A40', 3000),
  ('heavy', 1, '11L-1199',      'Filter Oli Mesin', 250),
  ('heavy', 2, '11L-1207',      'Filter Solar', 250),
  ('heavy', 3, '11L-1208',      'Filter Udara (Air Cleaner)', 500),
  ('heavy', 4, '11L-1197',      'Filter Hidrolik', 1000),
  ('heavy', 5, '14L-0208-465',  'V-Belt HD465 (8PK1315)', 2000);

INSERT INTO public.hm_parts (unit_id, barang_id, code, name, interval_hm, last_replacement_hm)
SELECT
  u.id, b.id, t.part_number, t.name, t.interval_hm,
  GREATEST(
    (u.current_hm / t.interval_hm) * t.interval_hm
      - CASE WHEN (u.id + t.ord) % 5 = 0 THEN t.interval_hm ELSE 0 END,
    0
  )
FROM public.hm_units u
JOIN seed_units su ON su.code = u.code
JOIN seed_part_templates t ON t.family = su.family
LEFT JOIN public.barang b ON b.part_number = t.part_number
ORDER BY u.id, t.ord;

-- Riwayat penggantian untuk ~2/3 part (sisanya tampil "Belum diganti").
-- Tanggal dihitung mundur dengan asumsi ~20 HM per hari.
INSERT INTO public.hm_replacements (part_id, unit_id, hm, date, note)
SELECT
  p.id, p.unit_id, p.last_replacement_hm,
  NOW() - make_interval(days => ((u.current_hm - p.last_replacement_hm) / 20)),
  'Penggantian rutin'
FROM public.hm_parts p
JOIN public.hm_units u ON u.id = p.unit_id
WHERE p.id % 3 <> 0 AND p.last_replacement_hm > 0;

INSERT INTO public.hm_services (unit_id, kind, date, hm, note)
SELECT u.id, v.kind::public.hm_service_kind, NOW() - make_interval(days => v.days_ago),
  u.current_hm - v.days_ago * 20, v.note
FROM (VALUES
  ('D1521',    'inspeksi',  3,  'Inspeksi undercarriage'),
  ('D85171',   'perbaikan', 10, 'Ganti hose hidrolik blade'),
  ('GD823',    'rutin',     6,  'Greasing harian & cek tekanan ban'),
  ('D5107AMM', 'perbaikan', 4,  'Perbaikan kebocoran radiator'),
  ('H54005AMM','inspeksi',  8,  'Inspeksi rem & suspensi')
) AS v(code, kind, days_ago, note)
JOIN public.hm_units u ON u.code = v.code;

-- ============================================================
-- 3. Forecasting AC (unit yang sama, dari "Forcasting AC.xlsx")
-- ============================================================

WITH pkg AS (
  INSERT INTO public.hm_ac_packages (name, note) VALUES
    ('Paket AC D155A-6', 'Dozer D155A-6 (Section Track)'),
    ('Paket AC D85ESS-2', 'Dozer D85ESS-2 (Section Track)'),
    ('Paket AC Grader GD825A-2', 'Grader GD825A-2 (Section Wheel)'),
    ('Paket AC Truck FM260JD/AXOR', 'Water/Fuel/Lube truck (Section Support)')
  RETURNING id, name
)
INSERT INTO public.hm_ac_package_items (package_id, barang_id, name, qty, unit_price)
SELECT pkg.id, b.id, v.item, 1, v.price
FROM pkg
JOIN (VALUES
  ('Paket AC D155A-6', 1, '14L-0237',      'Expansi Valve', 504000),
  ('Paket AC D155A-6', 2, '14L-0094-24',   'Thermostat Elektrik', 203000),
  ('Paket AC D155A-6', 3, '14L-0093',      'Dryer', 250000),
  ('Paket AC D155A-6', 4, '14L-0208-B38',  'V-Belt B38', 453250),
  ('Paket AC D155A-6', 5, '14L-0107-2',    'Oli ND08', 313500),
  ('Paket AC D85ESS-2', 1, '14L-0657',     'Expansi Kapiler', 307725),
  ('Paket AC D85ESS-2', 2, '14L-0094-24',  'Thermostat Elektrik', 203000),
  ('Paket AC D85ESS-2', 3, '14L-0337',     'Dryer 3/8', 450000),
  ('Paket AC D85ESS-2', 4, '14L-0208-B57', 'V-Belt B57', 132300),
  ('Paket AC D85ESS-2', 5, NULL,           'Oli SP10', 313500),
  ('Paket AC Grader GD825A-2', 1, '14L-0657',     'Expansi Kapiler', 307725),
  ('Paket AC Grader GD825A-2', 2, '14L-0094',     'Thermostat', 203000),
  ('Paket AC Grader GD825A-2', 3, '14L-0337',     'Dryer Long', 250000),
  ('Paket AC Grader GD825A-2', 4, '14L-0107-2',   'Oli ND08', 313500),
  ('Paket AC Grader GD825A-2', 5, '14L-0208-B35', 'V-Belt B-35', 126225),
  ('Paket AC Truck FM260JD/AXOR', 1, '14L-0728',     'Expansi Valve', 504000),
  ('Paket AC Truck FM260JD/AXOR', 2, '14L-0337',     'Dryer 3/8', 450000),
  ('Paket AC Truck FM260JD/AXOR', 3, '14L-0094',     'Thermostat', 203000),
  ('Paket AC Truck FM260JD/AXOR', 4, '14L-0107-2',   'Oli ND08', 313500),
  ('Paket AC Truck FM260JD/AXOR', 5, '14L-0208-A40', 'V-Belt A-40', 197175),
  ('Paket AC Truck FM260JD/AXOR', 6, '14L-0217-A',   'Idle Pulley', 302500)
) AS v(pkg, ord, part_number, item, price) ON v.pkg = pkg.name
LEFT JOIN public.barang b ON b.part_number = v.part_number
ORDER BY pkg.id, v.ord;

-- Unit hauler/compactor (FMX400, P460, HD465, SV526D) sengaja tidak diatur
-- untuk AC, sama seperti di Excel. HM servis AC terakhir dibuat bervariasi
-- supaya forecast 3 bulan terisi (DA25002 sudah lewat jatuh tempo).
INSERT INTO public.hm_ac_units (unit_id, section, package_id, interval_hm, last_service_hm, daily_hm)
SELECT u.id, v.section, p.id, 2000, v.last_hm, v.daily
FROM (VALUES
  ('D1521',    'track',   'Paket AC D155A-6',            42000, 20),
  ('D1558',    'track',   'Paket AC D155A-6',            18000, 20),
  ('D85150',   'track',   'Paket AC D85ESS-2',           20000, 18),
  ('D85171',   'track',   'Paket AC D85ESS-2',            8000, 18),
  ('GD823',    'wheel',   'Paket AC Grader GD825A-2',    40000, 16),
  ('DA25002',  'support', 'Paket AC Truck FM260JD/AXOR', 12000, 20),
  ('DA25070',  'support', 'Paket AC Truck FM260JD/AXOR',  8000, 20),
  ('D5107AMM', 'track',   'Paket AC D155A-6',            24000, 20),
  ('D5109AMM', 'track',   'Paket AC D155A-6',            26000, 20),
  ('G5802AMM', 'wheel',   'Paket AC Grader GD825A-2',    38000, 16)
) AS v(code, section, pkg, last_hm, daily)
JOIN public.hm_units u ON u.code = v.code
JOIN public.hm_ac_packages p ON p.name = v.pkg;

-- Part mayor tambahan bulan berjalan.
INSERT INTO public.hm_ac_extra_items (unit_id, period, barang_id, name, qty, unit_price, note)
SELECT u.id, date_trunc('month', CURRENT_DATE)::DATE, b.id, v.name, 1, v.price, v.note
FROM (VALUES
  ('D1558',    '14L-0100-K',    'Compressor Assy',      3378200, 'Compressor bocor'),
  ('DA25002',  '14L-0458',      'Magnet Clutch',        1872780, ''),
  ('D5107AMM', '14L-0135-D155', 'Motor Blower D155',    1450000, 'Blower lemah')
) AS v(code, part_number, name, price, note)
JOIN public.hm_units u ON u.code = v.code
LEFT JOIN public.barang b ON b.part_number = v.part_number;

COMMIT;
