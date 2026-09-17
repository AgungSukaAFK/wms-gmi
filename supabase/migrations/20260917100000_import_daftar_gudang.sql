-- Migration: Import Daftar Gudang (legacy ERP warehouse export) into cabang/customers/vendors
-- Date: 2026-09-17
-- Source: 'Daftar Gudang 01-09-2026 (1).xls' (export sistem lama, dipelajari & dipetakan manual)
-- Catatan pemetaan (lihat diskusi/keputusan sebelum migration ini dibuat):
--   - Entitas GMI-* & GIS(...) fisik  -> public.cabang (gudang baru)
--   - Entitas customer/site konsinyasi (PT..., PTRO-*, Gunung Mas, dst) -> public.customers, customer_type = 'consignment'
--   - Entitas 'Vendor ...' -> public.vendors
--   - 'CENTRE' di-skip (tidak ada data pendukung, kemungkinan bukan gudang riil)
--   - 'GMI-Jakarta' di-skip: production sudah punya cabang ini (nama asli 'GMI-JAKARTA', bukan 'GMI-HO'
--     seperti dugaan awal dari migration lama di repo -- lihat catatan drift di bawah)
--   - 11 nama GMI-* yang persis sama dengan cabang existing (BA, BIB, BPP, DIZA, ENIM, IPT, LKP, MIFA, MIP, TAL, AMI) di-skip, sudah ada
--
-- PENTING - DB DRIFT: migration '20260410004600_approval_templates.sql' di repo ini nge-TRUNCATE
-- cabang lalu seed 12 baris gaya 'GMI-HO'/'HO'. Tapi cabang di production VPS (dicek manual
-- 2026-09-17) ternyata punya 19 baris dengan konvensi penamaan BEDA (UPPERCASE + kode berhyphen,
-- co. 'GMI-JAKARTA'/'JKT', 'GMI-JAKARTA DS'/'JKT-DS', 'GMI-MAN JAKARTA'/'MAN-JKT',
-- 'GMI-MAN BPP'/'MAN-BPP', 'GMI-SERVICE JAKARTA'/'SRV-JKT', 'GMI-SERVICE BPP'/'SRV-BPP',
-- 'GMI-SERVICE TABANG'/'SRV-TBG', 'GMI-SERVICE ENIM'/'SRV-ENIM', semua timestamp identik
-- 2026-04-22 -- artinya cabang production di-reseed manual langsung di VPS setelah migration itu,
-- TANPA migration baru yang dicommit ke repo. Karena nama_cabang case-sensitive, 6 kandidat baru
-- di bawah ini (Jakarta DS, Man Jakarta, Man BPP, Service Jakarta, Service BPP, Service Enim)
-- SUDAH ADA di production dengan casing berbeda, jadi sengaja TIDAK di-insert lagi di migration
-- ini (kalau tetap diinsert, ON CONFLICT (nama_cabang) tidak akan mendeteksinya sbg duplikat
-- karena beda case, dan akan bikin baris ganda). 'GMI-Service BIB' & 'GMI-Man Fatigue' TETAP
-- diinsert krn tidak ada padanannya di 19 baris production tsb.

-- ============================================================
-- 1) CABANG BARU (26 gudang: 11 GMI + 15 GIS)
-- ============================================================

INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GA', 'GA', NULL)
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GMI-BIB Bawah', 'BIBB', 'Gudang GMI-BIB Bawah')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GMI-Bengalon', 'BGL', 'AMM SITE BCP (Mess KUB), Sepaso Timur - Bengalon')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GMI-Berau', 'BRU', 'Jl. Murjani 2, RT 02, Karang, Karang Ambun, Tanjung Redep, 77315')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GMI-Man Fatigue', 'MANFTG', 'GMI HO')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GMI-PIK', 'PIK', 'Kec. Bengalon, Kabupaten Kutai Timur, Kalimantan Timur')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GMI-Service BIB', 'SVCBIB', NULL)
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GMI-Sumbawa', 'SBW', NULL)
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GMI-Tabalong', 'TBL', NULL)
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GMI-Warranty', 'WRT', 'GMI HO')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('Gudang 2025', 'GDG25', 'Hasil SO 2025')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (BPP) DO', 'GISBPPDO', 'Ruko Maple Blok C-7, Kompleks Borneo Paradiso,, Batakan, Balikpapan 76116')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (BPP) Man', 'GISBPPMAN', 'Ruko Maple Blok B-12, Kompleks Borneo Paradiso,, Batakan, Balikpapan 76116')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (BPP) Stock', 'GISBPPSTK', 'Ruko Maple Blok C-7, Kompleks Borneo Paradiso,, Batakan, Balikpapan 76116')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (Berau) DO', 'GISBRUDO', 'Jl. Murjani 2, RT 02, Karang, Karang Ambun, Tanjung Redep, 77315')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (Berau) Stock', 'GISBRUSTK', 'Jl. Kedaung (Perum. Borneo, Indah Blok 3A No.39) RT 09,Kel, Sei Bedungun Tj.Redeb 77314')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (Jakarta) DO', 'GISJKTDO', NULL)
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (Jakarta) Stock', 'GISJKTSTK', NULL)
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (Manufacture) DO', 'GISMANDO', 'GMI Head Office')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (R & D)', 'GISRND', 'GIS Building')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (Service/BAST)', 'GISSVC', 'Global Inti Sejati HO')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (Tabalong) DO', 'GISTBLDO', 'RT 01 Mabuun, Simpang 3, Guru Danau, Murung Pundak, Tanjung Tabalong, KalSel')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (Tabalong) Man', 'GISTBLMAN', 'RT 01 Mabuun, Simpang 3, Guru Danau, Murung Pundak, Tanjung Tabalong, KalSel')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (Tabalong) Stock', 'GISTBLSTK', 'RT 01 Mabuun, Simpang 3, Guru Danau, Murung Pundak, Tanjung Tabalong, KalSel')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (Tj. Enim)', 'GISENIM', 'Jl. Kiemas depan komp, No 99 B RT 7 RW 2,, lingkungan mandala tj enim')
  ON CONFLICT (nama_cabang) DO NOTHING;
INSERT INTO public.cabang (nama_cabang, kode_cabang, alamat)
  VALUES ('GIS (Warranty) DO', 'GISWRTDO', 'GIS Jakarta')
  ON CONFLICT (nama_cabang) DO NOTHING;

-- ============================================================
-- 2) VENDOR BARU (13)
-- ============================================================

INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-Artcoating', 'Artcoating', NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'Artcoating');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-Azghav', 'Azghav', NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'Azghav');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-CV. Dunia AC', 'CV. Dunia AC', 'Mr. Dodi', 'Balikpapan'
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'CV. Dunia AC');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-Dea Restu', 'Dea Restu', NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'Dea Restu');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-GITRONIK', 'GITRONIK', 'Mr. Gigih', 'City Home Regency Blok F No. 3, Jl. Keputih Timur Jaya,, Sukolilo, Surabaya.'
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'GITRONIK');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-Harapan Jaya', 'Harapan Jaya', NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'Harapan Jaya');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-Hendra', 'Hendra', 'Hendra', 'Balikpapan'
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'Hendra');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-Indah Jaya', 'Indah Jaya', NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'Indah Jaya');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-KMS', 'KMS', 'Mr. Yudi', 'Jl. Raya Karanggan RT 01/01, Desa Puspasari, Citeureup, Bogor'
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'KMS');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-MEKTEK TANJUN', 'MEKTEK TANJUN', NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'MEKTEK TANJUN');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-Mr. Tsubogo', 'Mr. Tsubogo', 'Mr. Tsubogo', 'Perakitan Pama'
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'Mr. Tsubogo');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-Odea', 'Odea', 'Mr Hendy', 'Jak-ut'
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'Odea');
INSERT INTO public.vendors (vendor_no, vendor_name, pic_name, address)
  SELECT 'TMP-VEND-Qualis SNI', 'Qualis SNI', NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE vendor_name = 'Qualis SNI');

-- Assign vendor_no final format VND-00001 (konsisten dgn generateVendorCode() di services/master-actions.ts)
UPDATE public.vendors SET vendor_no = 'VND-' || LPAD(id::text, 5, '0')
  WHERE vendor_no LIKE 'TMP-VEND-%';

-- ============================================================
-- 3) CUSTOMER BARU (46, semua customer_type = 'consignment')
-- ============================================================

INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-Gunung Mas Group', 'Gunung Mas Group', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'Gunung Mas Group');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-Gunung Mas Ternate', 'Gunung Mas Ternate', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'Gunung Mas Ternate');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-MITRA MUDA MAKMUR', 'MITRA MUDA MAKMUR', NULL, 'Kantor Pusat Jakarta,, Jl.Suryopranoto No.2, Harmoni Plaza Blok A-8', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'MITRA MUDA MAKMUR');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT AMM BCP', 'PT AMM BCP', NULL, 'Bengalon', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT AMM BCP');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT AMM MIFA', 'PT AMM MIFA', NULL, 'ACEH', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT AMM MIFA');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT AMM PIK', 'PT AMM PIK', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT AMM PIK');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT Coates Hire', 'PT Coates Hire', NULL, 'Balikpapan', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT Coates Hire');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT DMM Sangata', 'PT DMM Sangata', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT DMM Sangata');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT HPU', 'PT HPU', NULL, 'Agrinas Palma Nusantara, Jl H R Rasuna Said Blok X2, Jakarta Selatan', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT HPU');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT KDC', 'PT KDC', NULL, 'Berau', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT KDC');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT KDC BERAU', 'PT KDC BERAU', NULL, 'Berau', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT KDC BERAU');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT KPP BPOP', 'PT KPP BPOP', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT KPP BPOP');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT KPP CILE', 'PT KPP CILE', NULL, 'CILEUNGSI', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT KPP CILE');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT KPP Indexim', 'PT KPP Indexim', 'Mr. Afik Dalmawan', 'Jl. Yos Sudarso III,, Gg. Sepakat no. 44a Sangatta', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT KPP Indexim');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT KPP Jakarta', 'PT KPP Jakarta', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT KPP Jakarta');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT KPP Sumbawa', 'PT KPP Sumbawa', NULL, 'Jl. Cendrawasih Gg 24 No 1 Kel, Brang Biji RT 03 RW 02 Kec, Sumbawa Kab Sumbawa Besar', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT KPP Sumbawa');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT PPA MIP Lahat', 'PT PPA MIP Lahat', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT PPA MIP Lahat');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT PPA Site AMI', 'PT PPA Site AMI', NULL, 'TUHUP', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT PPA Site AMI');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT PPA Site BIB', 'PT PPA Site BIB', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT PPA Site BIB');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT PPA Tabalong', 'PT PPA Tabalong', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT PPA Tabalong');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT PPA-BA Site BANKO', 'PT PPA-BA Site BANKO', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT PPA-BA Site BANKO');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT SNUJ Jakarta', 'PT SNUJ Jakarta', NULL, 'Gading Bukit Indah Blok SA 10, Jl Bukit Gading Raya, Kelapa G', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT SNUJ Jakarta');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT Suryagita', 'PT Suryagita', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT Suryagita');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT Trakindo', 'PT Trakindo', NULL, 'Jl. Sukapura Timur 5 No.8, RT.3/RW.2, Sukapura, Kec. Cilincing, Jakarta Utara', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT Trakindo');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT UT Banjarmasin', 'PT UT Banjarmasin', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT UT Banjarmasin');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT UT Jakarta', 'PT UT Jakarta', 'Mr. Aji', 'Jl Raya Bekasi Km. 22, Cakung Barat - Jakarta Timur', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT UT Jakarta');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT UT Samarinda', 'PT UT Samarinda', 'Mr. Wiwied', 'Samarinda', 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT UT Samarinda');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PT United Equipment', 'PT United Equipment', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PT United Equipment');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-BBB', 'PTRO-BBB', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-BBB');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-BC PROJECT', 'PTRO-BC PROJECT', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-BC PROJECT');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-BPM', 'PTRO-BPM', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-BPM');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-BSL', 'PTRO-BSL', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-BSL');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-CEP', 'PTRO-CEP', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-CEP');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-DBK', 'PTRO-DBK', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-DBK');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-FRP', 'PTRO-FRP', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-FRP');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-GBM', 'PTRO-GBM', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-GBM');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-IBP', 'PTRO-IBP', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-IBP');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-KJA', 'PTRO-KJA', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-KJA');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-KS (MELAK)', 'PTRO-KS (MELAK)', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-KS (MELAK)');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-KSM', 'PTRO-KSM', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-KSM');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-MUTU', 'PTRO-MUTU', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-MUTU');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-PBP', 'PTRO-PBP', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-PBP');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-PRC', 'PTRO-PRC', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-PRC');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-PSF', 'PTRO-PSF', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-PSF');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-SDA', 'PTRO-SDA', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-SDA');
INSERT INTO public.customers (customer_no, customer_name, pic_name, address, customer_type)
  SELECT 'TMP-CUST-PTRO-VALE BAHADOI', 'PTRO-VALE BAHADOI', NULL, NULL, 'consignment'
  WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_name = 'PTRO-VALE BAHADOI');

-- Assign customer_no final format CST-00001 (konsisten dgn generateCustomerCode() di services/master-actions.ts)
UPDATE public.customers SET customer_no = 'CST-' || LPAD(id::text, 5, '0')
  WHERE customer_no LIKE 'TMP-CUST-%';
