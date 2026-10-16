-- ============================================================
-- SYNC CUSTOMER MASTER dari "data customer.xls"
-- (Customer List ERP, filter Suspended = Active, 589 customer)
-- ------------------------------------------------------------
-- 1) Perbaiki customer_no numerik yang rusak oleh import lama
--    (20260618120000): Excel format #,##0.00 bikin '1' jadi '1.00'
--    dan '10022014' jadi '10,022,014.00'. Di-UPDATE in-place (id
--    tetap) supaya FK dokumen yang sudah ada tidak terganggu.
-- 2) Upsert 589 customer aktif dari Excel: customer baru di-insert,
--    yang sudah ada di-set is_active = TRUE dan telepon/kontak hanya
--    diisi kalau masih kosong (data yang sudah diedit via app tidak
--    ditimpa). Nama & customer_type tidak disentuh.
-- 3) Nonaktifkan (BUKAN hapus) 109 customer dari import lama yang
--    tidak ada di export aktif (suspended di ERP). Daftarnya eksplisit,
--    jadi customer yang dibuat via app (CST-xxxxx) / import gudang
--    consignment tidak ikut kena.
-- Idempotent: aman dijalankan ulang.
-- ============================================================

-- 1) Normalisasi customer_no rusak (skip kalau bentuk benarnya sudah ada)
UPDATE public.customers c
SET customer_no = CASE WHEN c.customer_no ~ '^[0-9,]+\.00$' THEN replace(regexp_replace(c.customer_no, '\.00$', ''), ',', '') ELSE c.customer_no END
WHERE c.customer_no ~ '^[0-9,]+\.00$'
  AND NOT EXISTS (
    SELECT 1 FROM public.customers c2
    WHERE c2.customer_no = CASE WHEN c.customer_no ~ '^[0-9,]+\.00$' THEN replace(regexp_replace(c.customer_no, '\.00$', ''), ',', '') ELSE c.customer_no END
  );

-- Sisa bentuk rusak = duplikat dari baris yang sudah benar → nonaktifkan
UPDATE public.customers
SET is_active = FALSE
WHERE customer_no ~ '^[0-9,]+\.00$' AND is_active;

-- 2) Upsert customer aktif dari Excel
INSERT INTO public.customers (customer_no, customer_name, telephone, contact_name, is_active)
VALUES
  ('(USD) 14082014-02', 'PT. Gemala Sarana Upaya', '021-4403068', 'Nathan O.W', TRUE),
  ('02032015 (IDR)', 'PT. Kayan Putra Utama Coal', '0551-21877/ 0551-36996', NULL, TRUE),
  ('03/04/2013', 'PT. Kalimantan Prima Services Indonesia', '0542-7581917/18', 'Ibu Herminingsih', TRUE),
  ('03/04/2014', 'PT. United Coal Indonesia', '021-57935926', 'Raniarto', TRUE),
  ('03032015-4 (USD)', 'PT. Power Services Indonesia', 'Indonesia', '021-86861407', TRUE),
  ('070415 (USD)', 'PT. Kutai Chip Mill', '0542-7582001', 'Herminingsih', TRUE),
  ('070416 (USD)', 'PT. Medco Energi Mining Internasional', NULL, NULL, TRUE),
  ('070417 (USD)', 'PT. Indotruck Utama', '021 - 4412168', 'Bp. Paulus', TRUE),
  ('070418 (USD)', 'PT. Indotraktor Utama', '0541-251490', 'Mr. Hadi Rahardian', TRUE),
  ('070419 (IDR)', 'PT. Gaya Makmur Traktor', NULL, NULL, TRUE),
  ('080114-01 (Rp)', 'PT. Mandala Karya Prima', '021-29333189', 'Bpk. Henky Dalimarta/ Bpk. Sigit Pamungkas', TRUE),
  ('080114-02 (IDR)', 'PT. Prima Sarana Gemilang', '021-8564818 / ext.145', NULL, TRUE),
  ('080114-04 (USD)', 'PT. Sumber Mitra Jaya', '021- 526 1616', 'Dewi', TRUE),
  ('080114-05 (Kaltim)', 'PT. Samindo Utama Kaltim', '0543 - 22622', NULL, TRUE),
  ('09042017-(IDR)', 'PT. Muara Alam Sejahtera', '021 6385 1140', NULL, TRUE),
  ('09042018-(USD)', 'PT. Tunas Jaya Perkasa', '021-899071585961', 'Bpk. Ari', TRUE),
  ('09042019-(IDR)', 'PT. HPU', NULL, NULL, TRUE),
  ('09042023-(IDR)', 'Toko Auto Baru', '021.846 6692', 'Koh Aeng', TRUE),
  ('1', 'PT. Putra Perkasa Abadi Sejahtera', NULL, 'Irfan', TRUE),
  ('1 SIS-JAK', 'PT. Saptaindra Sejati', '021-7693378', 'Bp. Edy Purwadi', TRUE),
  ('10', 'PT. Jakarta Prima Crane', NULL, NULL, TRUE),
  ('100', 'CV. Borneo Sukses Mandiri', NULL, NULL, TRUE),
  ('100 PBK USD', 'PT. Pundi Bakti Khatulistiwa', '0561-747548', 'Bp. Heriyanto', TRUE),
  ('10022014', 'PT. Power Servis Indonesia', '021-86861407', NULL, TRUE),
  ('10042014-04', 'PT. Indo Traktor Utama', '021 - 29832112', NULL, TRUE),
  ('10042014-06', 'PT. Mandala Karya Prima Tarakan', NULL, NULL, TRUE),
  ('10062015 (02)', 'PT. Smada Tech', '021-32944726', NULL, TRUE),
  ('10062015 (04)', 'PT. Mahakam Sumber Jaya', '0541-7771307/ 731514', 'Mr. Ardy', TRUE),
  ('10062015 (06)', 'PT. Indocement', NULL, NULL, TRUE),
  ('10062016', 'PT. Lancarjaya Mitra Abadi', '021-82419000', NULL, TRUE),
  ('10062017 (IDR)', 'PT. Intecs Teknikatama Industri', '021-7293351', 'Bp. Wicak', TRUE),
  ('101', 'PT. Mitra Parama Gemilang', NULL, NULL, TRUE),
  ('101 UTR (USD)', 'PT. Universal Tekno Reksajaya', '021-2457 6818', 'Bp. Hendra Sukmana', TRUE),
  ('10122014-01(RP)', 'PT. Ishimaru Engineering', '021-7070 8440', 'Pak Dani / Pak Eko/Pak Mashudi', TRUE),
  ('102', 'PT. Mustika Adi Wijaya', NULL, NULL, TRUE),
  ('103', 'PT. Mustika Adi Sejahtera', NULL, NULL, TRUE),
  ('104', 'PT. Prager Kencana Servis', NULL, NULL, TRUE),
  ('105', 'PT. Wijaya Daya Jaya', NULL, NULL, TRUE),
  ('105 THIESS JKT  (IDR)', 'PT. THIESS CONTRACTORS INDONESIA', '021 - 2754 7383', 'Bp. Faruq Rizalul Alam', TRUE),
  ('106', 'PT. RMA Indonesia Group', NULL, NULL, TRUE),
  ('107', 'PT. Traktor Utama Nusantara', NULL, NULL, TRUE),
  ('108', 'PT. Karya Surya Lestari', NULL, NULL, TRUE),
  ('109', 'PT. RUKUN SEJAHTERA TEKNIK', NULL, NULL, TRUE),
  ('11', 'PT. Tata Bara Utama', NULL, NULL, TRUE),
  ('11 USD', 'PT. United Tractor', '021-24579999', 'Bp Darmono', TRUE),
  ('110', 'PT. Royaltama Mulia Kontraktorindo, Tbk', NULL, NULL, TRUE),
  ('110214-01 (USD)', 'PT. SIMS JAYA KALTIM', '0543-22522', 'Bpk. Eko Okta', TRUE),
  ('11052015', 'Sakura Motor Service', '081314505108', 'Ibu Sitohang', TRUE),
  ('111', 'PT. Bimura Putra Persada', NULL, NULL, TRUE),
  ('112', 'PT. Ricon Masinton Pratama', NULL, NULL, TRUE),
  ('113', 'PT. Parama Tunas Mining', NULL, NULL, TRUE),
  ('114', 'PT. Hanif Persada Putra', NULL, NULL, TRUE),
  ('115', 'PT. Djaja Listrik', NULL, NULL, TRUE),
  ('117', 'PT. Berca Megah Perkasa', NULL, NULL, TRUE),
  ('118', 'PT. Rent Indonesia Asia', NULL, NULL, TRUE),
  ('119', 'PT. Cakra Indo Traktor', NULL, NULL, TRUE),
  ('12', 'Batu Karang Group', NULL, NULL, TRUE),
  ('120', 'PT. Multi Nitrotama Kimia', NULL, NULL, TRUE),
  ('120315 (USD)', 'PT. KIDECO JAYA AGUNG', '0543 - 22522', 'Bp. Dwi Hanggoro', TRUE),
  ('12052015-01', 'Toko Waringin', '085218131281', 'Ibu Ima', TRUE),
  ('12052015-05', 'PT. Jaya Karya Perdana', '021-5807650', NULL, TRUE),
  ('121', 'CV. Gema Mitra Teknindo', NULL, NULL, TRUE),
  ('122', 'PT. Bumindo Mulia Mandiri', NULL, NULL, TRUE),
  ('123', 'PT. Mitra Inti Trada', NULL, NULL, TRUE),
  ('13', 'PT. BOSTON TRIKORA MAHARDIKA', '0895-3543-29469', 'Boy', TRUE),
  ('14', 'PT CAHAYA RIAU MANDIRI', '085294724203', NULL, TRUE),
  ('14 KPP.JTA', 'PT. Kalimantan Prima Persada', '081348932121', 'Mr. Khairuddin', TRUE),
  ('15', 'PT Tunas Jaya Perkasa', NULL, NULL, TRUE),
  ('16', 'PT. Tentra Eka Pratama', NULL, NULL, TRUE),
  ('17', 'PT. Harrindo Asia Persada', NULL, NULL, TRUE),
  ('17062014-01', 'PT. Prima Energy Services', '021-3503855/57/97', 'Mikhael', TRUE),
  ('17112014-01(IDR)', 'PT. KTC Coal Mining & Energy', '0541-6212460/61', NULL, TRUE),
  ('18', 'PT. Harita Parama Murti Perkasa', '021-7223685', 'Pak Jefri', TRUE),
  ('18022020', 'PT. Prima Indojaya Mandiri', '031-5683891, 5664993', 'Bpk. Abeng', TRUE),
  ('180315', 'PT. INKOR PRIMA COAL', '(0542) 8820378', NULL, TRUE),
  ('18032014-02', 'PT. Petrolog Indah', '0542-763827', NULL, TRUE),
  ('19', 'PT. Halmahera Sukses Mineral', NULL, NULL, TRUE),
  ('2', 'PT. Riung Mitra Lestari', '021-88865787', NULL, TRUE),
  ('20', 'PT Djaja Listrik', NULL, NULL, TRUE),
  ('20 THiess JKT', 'PT. THIESS CONTRACTOR INDONESIA', '021-27549523', 'Bp. Iryan Dahuri', TRUE),
  ('200315 (IDR)', 'PT. Fluidindo Solusi Utama', '081348392799', 'Mrs. Ifa', TRUE),
  ('200316 (IDR)', 'PT. Karunia Wahana Nusa', '0542-7209336', 'Mr. Heri (08125860014)', TRUE),
  ('200317 (IDR)', 'PT. Hexindo Adiperkasa Tbk.', '021-4611688', NULL, TRUE),
  ('200318 (IDR)', 'PT. Hino Motors Sales Indonesia', '021-8564570/ 4480', NULL, TRUE),
  ('20052015', 'Tujutuju Bersaudara', '085211459475', 'Pak Imam', TRUE),
  ('20215', 'PT. Kharisma Tehnik Utama', NULL, NULL, TRUE),
  ('2032017', 'PT. Intiteknindo Mega Abadi', '021-55654824', 'Mr. Alfan Rachim', TRUE),
  ('21', 'PT. Sigma Rekayasa Prima', NULL, NULL, TRUE),
  ('21052017', 'PT. Nipindo Primatama', '021 4515825', NULL, TRUE),
  ('211013-01', 'PT. TRI SAPUTRA UTAMA', '021-79182467', 'Bpk Ferry', TRUE),
  ('22', 'PT. Pama Persada Nusantara', '0815 9234 576', 'Bp. Oka Pramudia', TRUE),
  ('22072014-01 Trak Sam USD', 'PT. Trakindo Utama', '0541-260269', 'Ibu Yustien', TRUE),
  ('23', 'PT. Tangan Kanan Investama', NULL, NULL, TRUE),
  ('23/04/19', 'PT. Trimega Utama Corporindo', '021-57851028', 'Bp. Mikhael', TRUE),
  ('23/04/21', 'PT. Lestari Berkat Sejahtera', '0541-7268 205', 'Bpk. M Amirul Mu''minin', TRUE),
  ('23/04/23', 'PT. Industri Kereta Api (Persero)', '0351-452271-74', 'Bp. Ikhwan Indrawan', TRUE),
  ('230914-01(IDR)', 'PT. Sumber Niaga Utama Jaya', '021-2907 8870/71/72', NULL, TRUE),
  ('24', 'PT. Merdeka Copper Gold Tbk', NULL, NULL, TRUE),
  ('24102016', 'PT. Kalimantan Energi Lestari', '021-29961400', NULL, TRUE),
  ('24102017', 'Ridwan', '085284517393', NULL, TRUE),
  ('24102018', 'Yuli Kurniawan', NULL, NULL, TRUE),
  ('24102019', 'PT. SAMSUNG ELECTRONICS INDONESIA', NULL, NULL, TRUE),
  ('24102021', 'PT. PUNINAR FUELLER', '(021)4602278', 'PURWIYANTO', TRUE),
  ('24102024', 'PT. INDOPROTEX EKA KARYA', '(0542) 765 402', 'Mr. Markus Kende Tonapa', TRUE),
  ('25', 'PT. Batara Dharma Persada', NULL, NULL, TRUE),
  ('26', 'PT. Putra Tunggal Mandiritama', NULL, NULL, TRUE),
  ('260815', 'PT. Global Inti Sejati', '021- 82741900', 'Bayu', TRUE),
  ('260817', 'PT. Trisno Prima Coal', NULL, 'Mr. Faisal', TRUE),
  ('27', 'PT. Borneo Hijau Lestari', NULL, NULL, TRUE),
  ('27012018', 'PT. Hillcon Jaya Sakti', '021-4618458', 'Anggita Prasayu', TRUE),
  ('27022015', 'PT. Ulet Bulu Mining', '0542-3001665/3001664', 'Bpk. Septian', TRUE),
  ('27042015-(IDR)', 'PT. Layanan Prima Setia Jaya', '021-8485931', 'Ibu Wilma', TRUE),
  ('27042016-(IDR)', 'PT. PANDU TRAMPIL UTAMA', '+62 44 666 440', '87808787672', TRUE),
  ('27042018-(IDR)', 'PT. Indo Mobil', NULL, 'Mr. Deny', TRUE),
  ('28', 'PT. Global Energi Lestari', NULL, NULL, TRUE),
  ('28122016', 'Ricky Atmadja', '0818851518', NULL, TRUE),
  ('28122019', 'PT. NITTSU LEMO INDONESIA', NULL, NULL, TRUE),
  ('28122020', 'PT. Inti Semesta Sejahtera', '021 6247535/40', NULL, TRUE),
  ('28122022', 'Sugeng Widodo', '081585502224', NULL, TRUE),
  ('29', 'PT. Sentra Karya Mandiri', NULL, NULL, TRUE),
  ('3', 'Hery Cahyanto', NULL, NULL, TRUE),
  ('30', 'PT. TRAKTOR NUSANTARA', '021-4608836', 'Bp. Hanung Huboyojati', TRUE),
  ('30315', 'PT. SINAR BINTANG', NULL, 'Mrs. Ninik', TRUE),
  ('3062016', 'PT. Satria Bahana Sarana', '021-29023805', NULL, TRUE),
  ('31', 'PT. Harapan Duta Pertiwi', NULL, NULL, TRUE),
  ('31 Kitadin Embalut', 'PT. KITADIN', '021-7504390', 'Bp. Marno. M', TRUE),
  ('3102016', 'PT. Antang Gunung Meratus', NULL, NULL, TRUE),
  ('3102022', 'PT. Prima Indojaya Mandiri Jkt', '45867268/08129903211', 'Mr. Hendri Bengawan', TRUE),
  ('32', 'PT. Mustika Adijaya', '021-5661040', 'Bp. Rochan', TRUE),
  ('34', 'PT. Berlian Cranserco Indonesia', NULL, NULL, TRUE),
  ('35', 'PT. Trisaka Sentra Sarana', NULL, NULL, TRUE),
  ('36', 'PT. Mitra Muda Makmur', NULL, NULL, TRUE),
  ('37', 'PT. Manggala Kharisma Tama', NULL, NULL, TRUE),
  ('38', 'Sutianse', NULL, NULL, TRUE),
  ('39', 'PT. Equipindo Perkasa', NULL, NULL, TRUE),
  ('4', 'PT. PUSAKA BUMI TRAKTOR', '021 80877961 / 021 80870042', NULL, TRUE),
  ('40', 'PT. Belengkong Mineral Resources', NULL, NULL, TRUE),
  ('41', 'CV. Bintang Almira', NULL, NULL, TRUE),
  ('41 HIBA', 'PT. HIBA UTAMA', '(021) 4786 8828', 'Bpk. IYAN & Bpk. NURSAMSU', TRUE),
  ('4112018', 'PT. Surya Gita Sarana Jaya', '0542-424420 / 441260', NULL, TRUE),
  ('4112019', 'PT. Global Unit Myoungjin Indonesia', '021-29009631/32', NULL, TRUE),
  ('42', 'PT. Daniswara Berkah Perkasa', NULL, NULL, TRUE),
  ('43', 'PT. BAGONG DEKAKA MAKMUR', NULL, NULL, TRUE),
  ('44', 'PT. Indonesia Equipment Centre', NULL, NULL, TRUE),
  ('45 PTR JKT (Rp)', 'PT. PETROSEA, Tbk', '021-29770999', 'Bp. Agus Rahmat Santoso', TRUE),
  ('46', 'PT. LANCARJAYA MANDIRI ABADI', NULL, NULL, TRUE),
  ('47', 'PT. Trimegah Atasatu Selasa', NULL, NULL, TRUE),
  ('49', 'PT. Bumi Pasir Mandiri', NULL, NULL, TRUE),
  ('5', 'PT. Mitra Abadi Mahakam', NULL, NULL, TRUE),
  ('50', 'PT. Nipindo Pratama', NULL, NULL, TRUE),
  ('5022015', 'PT. Tri Swardana Utama', '021-79182473', NULL, TRUE),
  ('5052015', 'TOBASA OIL', '08561891220', 'Rudy Simajuntak', TRUE),
  ('51', 'PT. Harmonindo Anugerah Sentosa', NULL, NULL, TRUE),
  ('51 KPP-JA', 'PT. Kalimantan Prima Persada (USD)', '0816 210 200', 'Mugiono', TRUE),
  ('52', 'PT. Global Energitama', NULL, NULL, TRUE),
  ('53', 'CV. RAFAEYZA JAYA PERKASA', NULL, NULL, TRUE),
  ('55', 'PT. Mangun Kerta Karya', NULL, NULL, TRUE),
  ('56', 'PT. Citra Machinery Indonesia', NULL, NULL, TRUE),
  ('57', 'Pak Fikri', NULL, NULL, TRUE),
  ('58', 'PT. Hamparan Anugrah Abadi', NULL, NULL, TRUE),
  ('58 ( site Asam-asam)', 'PT. Darma Henwa Tbk', '5794.8830/38', 'Bpk Adi Wijaya', TRUE),
  ('59', 'CV. Perdana Mulia Abadi', NULL, NULL, TRUE),
  ('59 PETROSEA BP (IDR)', 'PT. PETROSEA Tbk', '0542-762299/021-29770999', 'Bp. Agus Rahmat Santoso', TRUE),
  ('6', 'PT. Duta Bara Utama', NULL, NULL, TRUE),
  ('60', 'PT. Terra Factor Indonesia', '021-4401408', 'ibu Tabah', TRUE),
  ('61', 'PT. Vermeer Sea Indonesia', NULL, NULL, TRUE),
  ('62', 'PT. KOMATSU INDONESIA', '44 00 611', 'Bpk Irwan Setyanto', TRUE),
  ('63', 'PT. Saudara Energi Muda', NULL, NULL, TRUE),
  ('64', 'PT. LEUIT ARTHO NUSANTARA', NULL, NULL, TRUE),
  ('65', 'PT. Cakrawala Putra Bersama', NULL, NULL, TRUE),
  ('65 J Resources Nusantara (USD)', 'PT. J Resources Nusantara', '021-5153335', 'Bp. Martin Wu', TRUE),
  ('6500048664', 'PT. Intraco Penta Wahana', '021-4401408', 'Bpk. Gunawan', TRUE),
  ('66', 'PT. Bersinar Jaya Perkasa', NULL, NULL, TRUE),
  ('67', 'PT. Meindo Elang Indah', NULL, NULL, TRUE),
  ('68', 'PT. Sinsumo Friction Indonesia', NULL, NULL, TRUE),
  ('68 (USD)', 'PT. PORTER REKAYASA UNGGUL', '591 8951', 'Pak Khoiri', TRUE),
  ('7', 'PT. Tempopress International Delivery', NULL, NULL, TRUE),
  ('70', 'PT. Cipta Hasil Sugiarto', NULL, NULL, TRUE),
  ('71', 'PT. Antasena Agung Jaya', NULL, NULL, TRUE),
  ('71 UTSG Tuban', 'PT. United Tractors Semen Gresik', '0356-711800', 'Bp. Harry .W', TRUE),
  ('72', 'PT. Universal Support Jambi', NULL, NULL, TRUE),
  ('72 KITADIN MELAK', 'PT. TRUBAINDO COAL MINING', '021-29976866', 'Bp. Edy .P', TRUE),
  ('73', 'PT. Rencana Mulia Baratama', NULL, NULL, TRUE),
  ('73 usd', 'PT. Komatsu Marketing and Support Indonesia', '021- 4604290', 'Bambang Haryanto', TRUE),
  ('74', 'PT. PELABUHAN UNIVERSAL SUMATERA', NULL, NULL, TRUE),
  ('75', 'PT. Duta Part Mandiri', NULL, NULL, TRUE),
  ('76', 'PT. Sanggar Sarana Baja Transpoter', '021 599 5667/5115', 'ibu Aestikani', TRUE),
  ('77', 'Myetech Engineering', NULL, NULL, TRUE),
  ('78', 'PT. Jhonlin Baratama', NULL, NULL, TRUE),
  ('79', 'PT. Sitrak Indonesia', NULL, NULL, TRUE),
  ('79 PT. RCB USD', 'PT. Ricobana Abadi', '0812 5300 3486', 'Bp. Zul Haidir', TRUE),
  ('8', 'PT. Korindo Heavy Industry', '217975959', 'Arif Rahman', TRUE),
  ('80', 'CV. Mega Jaya Prima', NULL, NULL, TRUE),
  ('81', 'RMA Indonesia Group', NULL, NULL, TRUE),
  ('82', 'PT. Indo Global Karya Mulia', NULL, NULL, TRUE),
  ('83', 'PT Mitra Jaya Sejagat', NULL, NULL, TRUE),
  ('83 PRISTINE JKT', 'PT. PRISTINE AFTERMARKET INDONESIA', '021-4401408', 'Ibu Sri Hastuti', TRUE),
  ('84', 'PT. Rana Raya', '021-875 1 4444', 'Bpk Eric', TRUE),
  ('85', 'PT. United Equipment Indonesia', '021 468 332 32', 'Bpk. Suroso', TRUE),
  ('86', 'PT. INTRACO PENTA TBK', '021. 4401408', 'Bpk. Cholil', TRUE),
  ('87', 'PT. Tricipta Sukses Bersama', NULL, NULL, TRUE),
  ('88', 'PT. Maruda', NULL, NULL, TRUE),
  ('89', 'PT. Sumitomo S.H.I', '0267 863 1779', 'Bpk Dadang', TRUE),
  ('9', 'PT. Anugerah Sinergi Lampang', NULL, NULL, TRUE),
  ('90', 'PT. Sumber Jaya Aroma', NULL, NULL, TRUE),
  ('92', 'PT. Indo Crane Pratama', NULL, NULL, TRUE),
  ('92 KTD Bontang', 'PT. KITADIN (BANPUINDO)', '0813 4761 7000', 'Bp. Badrus Salam', TRUE),
  ('93', 'PT. Trifindo Sukses Bersama', NULL, NULL, TRUE),
  ('94', 'CV. Bina Karya', NULL, NULL, TRUE),
  ('94 SSB - TGRG', 'PT. SANGGAR SARANA BAJA', '0819 1109 5137', 'Bp. Fahru Rizalullah', TRUE),
  ('95', 'Pak Yahya', NULL, NULL, TRUE),
  ('96', 'PT. NENGGAPRATAMA INTERNUSANTARA', NULL, NULL, TRUE),
  ('97', 'PT. MEGA BINTANG SANTOSO', NULL, NULL, TRUE),
  ('98', 'PT. Mutiara Barito Persada', NULL, NULL, TRUE),
  ('99', 'PT. Surya Megah Perkasa', NULL, NULL, TRUE),
  ('99 ZIE-JKT', 'PT. Ziegler', '0818424694', 'Bp. Ronal', TRUE),
  ('DO-1000', 'KPP (H)', NULL, 'Mr. Ubait', TRUE),
  ('DO-1001', 'PT PETROSEA', NULL, 'Mr. Yan Bogi Pratomo', TRUE),
  ('DO-1002', 'PT Petrosea, Tbk', NULL, 'Mr. Slamet Mujiono', TRUE),
  ('DO-1003', 'PT Prima Sarana Gemilang', NULL, 'Mr. Atis Sutisna', TRUE),
  ('DO-1004', 'PT Prima Sarana Gemilang Lahat', NULL, 'Mr. Hendy Sutrisno', TRUE),
  ('DO-1005', 'PT SIMS Jaya Kaltim', NULL, 'Mr. Agustinus Bunga', TRUE),
  ('DO-1006', 'PT Saptaindra Sejati', '021-7693378', 'Bp. Yuda', TRUE),
  ('DO-1007', 'PT Sinar Bintang Mulia (S)', NULL, 'Mrs. Ninik', TRUE),
  ('DO-1008', 'PT Terra Factor Indonesia', NULL, 'Mrs. Riesha Adelia', TRUE),
  ('DO-1009', 'PT. BAUER PRATAMA INDONESIA (S)', NULL, 'Mr. Arisdianto', TRUE),
  ('DO-1010', 'PT. Buana Centra Swakarsa', NULL, 'Mr. Irwan Gunawan', TRUE),
  ('DO-1011', 'PT. COATES HIRE INDONESIA (S)', NULL, 'Mr. Juliver', TRUE),
  ('DO-1012', 'PT. Coates Hire Surabaya', NULL, 'Mrs. Nenden Pratiwi', TRUE),
  ('DO-1013', 'PT. Duta Tambang Rekayasa', '2129953138', NULL, TRUE),
  ('DO-1014', 'PT. Indonesia Pratama (S)', NULL, 'Mr. Winarso', TRUE),
  ('DO-1022', 'PT. Kalimantan Prima Persada (Kel. Guntung Payung)', NULL, 'Mr. Purkani', TRUE),
  ('DO-1023', 'PT. Kalimantan Prima Persada (N)', '0813 81441085', 'Ubait Budi Santoso', TRUE),
  ('DO-1024', 'PT. Kalimantan Prima Persada (P)', NULL, 'Mr. Bendi Oktarando', TRUE),
  ('DO-1025', 'PT. Kalimantan Prima Persada (s)', NULL, NULL, TRUE),
  ('DO-1026', 'PT. Lancarjaya Mitra Abadi (S)', NULL, 'Mr. Barkah', TRUE),
  ('DO-1028', 'PT. Muara Alam Sejahtera (S)', '(021) 63851140', 'Mr. Vicky Aditya Ashari', TRUE),
  ('DO-1029', 'PT. PP-BPI KSO', '021-8222176/7803865', 'Bp. Hendri/Ibu Wulan/Dias', TRUE),
  ('DO-1030', 'PT. PUTRA PERKASA ABADI-ABP', NULL, 'Mr. Gatot Munhar', TRUE),
  ('DO-1031', 'PT. PUTRA PERKASA ABADI-Berau', '0852 5105 5558', 'Mr. Agus Leo', TRUE),
  ('DO-1032', 'PT. PUTRA PERKASA ABADI-S', NULL, 'Mr. Aris', TRUE),
  ('DO-1034', 'PT. Prima Sarana Gemilang Kapuas', NULL, 'Mr. Armand/ Mr. Adil', TRUE),
  ('DO-1035', 'PT. Prima Sarana Gemilang, SITE IAC', '081381924466', 'Mr. Satria', TRUE),
  ('DO-1037', 'PT. SANGGAR SSARANA BAJA (REMANUFACTURING)', '021-46827927', 'Bpk. Tri.M', TRUE),
  ('DO-1038', 'PT. Satria Bahana Sarana (S)', NULL, 'Mr. Eko Listriono', TRUE),
  ('DO-1039', 'PT. Surya Cipta Dipa (S)', '(021) 84995236', NULL, TRUE),
  ('DO-1040', 'PT. Terra Factor Indonesia (S)', NULL, 'Mrs. Riesha Adelia', TRUE),
  ('DO-1044', 'PT. United Tractors', NULL, NULL, TRUE),
  ('DO-1045', 'Shipping Service Coeclerici Group', '0542-7571136', '8115420970', TRUE),
  ('GM-20062019', 'PT. PIPIT INTIS', '0551-22886', NULL, TRUE),
  ('GMI - 11062018', 'PT. Kutai Energi', '021 579958067', 'Tri Widodo', TRUE),
  ('GMI - 19072019', 'PT. Nusantara Inti Pratama', '021 4515825', NULL, TRUE),
  ('GMI-01102019', 'PT. Harmoni Panca Utama', NULL, NULL, TRUE),
  ('GMI-03092018', 'PT. Indonesia Pratama', '0542-874632/34', NULL, TRUE),
  ('GMI-05-10-2018', 'PT. Fontana Resources Indonesia', '(021) 451 5825 FAX : (021)451 5826', NULL, TRUE),
  ('GMI-05032019', 'PT. Sentra Surya Ekajaya', '021 557 96075', NULL, TRUE),
  ('GMI-05102018', 'PT. Firman Ketaun Perkasa', '0542-874632', NULL, TRUE),
  ('GMI-06022018', 'PT. Tambang Raya Usaha Tama', '0548-20698,20699 (Ext. 2003) - 085250290949', '0548-2069520697', TRUE),
  ('GMI-062013-002', 'PT. Kepsindo Indra Utama', '0751-775859', 'Bpk. Hengky Indra, ST', TRUE),
  ('GMI-062013-006', 'PT. Persada Sukses Makmur', '08125884495', 'Bpk. Yohanis', TRUE),
  ('GMI-062013-007', 'PT. Puninar Jaya', '021-4602278', 'Bpk. Sugeng', TRUE),
  ('GMI-09102017', 'PT. Universal Support', '0741 - 21585', 'Yohanes', TRUE),
  ('GMI-10062019', 'PT. Manggala Usaha Manunggal', '021 80636888', NULL, TRUE),
  ('GMI-10102017', 'PT. Nelly Putri Persada', NULL, 'Albertus Taryono', TRUE),
  ('GMI-11032024', 'PT. Marina Bara Lestari', '021-7246345', NULL, TRUE),
  ('GMI-11032026', 'PT. Sinar Nirwana Sari', NULL, NULL, TRUE),
  ('GMI-11032027', 'PT. NUSANTARA ABADI JAYA', '0542 - 7587544 / 7587545 / 771376', NULL, TRUE),
  ('GMI-11032028', 'PT. Sarana Baja Perkasa', '081210802272', 'Maya', TRUE),
  ('GMI-11032029', 'PT. Nirwana Anugerah Jaya', '0542 - 7587544, 7587545, 771376', NULL, TRUE),
  ('GMI-11032030', 'PT. NUGRAHA ESTETIKA PERMAI', '021 6398365, 6496122', NULL, TRUE),
  ('GMI-11032032', 'PT. RMK Energy TBK', '021-5822555', NULL, TRUE),
  ('GMI-11032035', 'PT. Karya Bhumi Lestari', '(021) 29770999/ 0818-237-605 (Fauzi)', 'Ahmad Fauzi', TRUE),
  ('GMI-11032036', 'PT. PROBESCO DISATAMA', '2165704111', NULL, TRUE),
  ('GMI-11032037', 'PT. Unggul Dinamika Utama', '(0852-4740-8100', 'Eva', TRUE),
  ('GMI-11032038', 'PT. Gunbuster Nickel Industry', NULL, NULL, TRUE),
  ('GMI-11032040', 'PT. Mandiri Herindo Adiperkasa Tbk', NULL, NULL, TRUE),
  ('GMI-11032043', 'PT. Kaltim Diamond Coal', '0821-4231-2498', 'Syamsutri', TRUE),
  ('GMI-11032045', 'PT. Masdar Mitra Solar Radiance', NULL, NULL, TRUE),
  ('GMI-11032046', 'PT. Wiratama Indo Nusantara', NULL, NULL, TRUE),
  ('GMI-11032047', 'PT. Mineral Alam Abadi', NULL, NULL, TRUE),
  ('GMI-11032048', 'PT. Mutiara Tanjung Lestari', NULL, NULL, TRUE),
  ('GMI-11032049', 'PT. Indo Global traktor', NULL, NULL, TRUE),
  ('GMI-11032050', 'PT. Motor Sight International', NULL, NULL, TRUE),
  ('GMI-11032051', 'PT. Inline Group (IEC)', NULL, NULL, TRUE),
  ('GMI-11032052', 'PT. Trinity Auto', '0541-262800', NULL, TRUE),
  ('GMI-11032053', 'PT. Star Wagen Indonesia', NULL, NULL, TRUE),
  ('GMI-11032054', 'PT. Nusantara Alam Raya Sejahtera', NULL, NULL, TRUE),
  ('GMI-11032056', 'PT. PUTERA KONTRINDO ABADI', '081278385900', NULL, TRUE),
  ('GMI-11032057', 'PT. WILSON KONTRINDO ABADI', '0812-7838-5900', NULL, TRUE),
  ('GMI-11032058', 'PT. Jaga Aman Sejahtera', NULL, NULL, TRUE),
  ('GMI-11032059', 'PT. EVOTEK GLOBAL PRIMA', NULL, '82154801917', TRUE),
  ('GMI-11032060', 'PT. Rajawali Emas Accora Lestari', NULL, NULL, TRUE),
  ('GMI-11032061', 'PT. Mandiri Energi Forklift', NULL, NULL, TRUE),
  ('GMI-11032062', 'PT. BERKARYA SEJAHTRA BERSAMA', NULL, 'Aziz 081297726327', TRUE),
  ('GMI-11032063', 'PT. Aptekindo Mitra Solusitama', NULL, NULL, TRUE),
  ('GMI-11032064', 'PELANGGAN UMUM', NULL, NULL, TRUE),
  ('GMI-11032065', 'PT. Format Teknik Mandiri', NULL, NULL, TRUE),
  ('GMI-11032066', 'PT. Ksatria Mitra Kontraktor Indonesia', '021-22761125', NULL, TRUE),
  ('GMI-11032067', 'PT. Monggo Makmur Bersama', NULL, NULL, TRUE),
  ('GMI-11032068', 'PT. Jaya Bravo Lima', '0921-3115256', NULL, TRUE),
  ('GMI-11032069', 'PT. Alam Karya Gemilang', NULL, 'Pak Edy', TRUE),
  ('GMI-11032070', 'PT. Mulia Abadi Mandiri', NULL, NULL, TRUE),
  ('GMI-11032071', 'Hyundai Engineering Co., Ltd', NULL, NULL, TRUE),
  ('GMI-11032072', 'PT. Tunas Hutan Mandiri', NULL, NULL, TRUE),
  ('GMI-11032073', 'PT. Bara Permata Mining', NULL, NULL, TRUE),
  ('GMI-11032074', 'PT. Nusatama Berkah', NULL, NULL, TRUE),
  ('GMI-11032075', 'PT. Multidaya Mitra Sinergi', NULL, NULL, TRUE),
  ('GMI-11032076', 'PT. Bahtera Motor', NULL, NULL, TRUE),
  ('GMI-11032077', 'PT. Aneka Mitra Cipta', NULL, NULL, TRUE),
  ('GMI-11032078', 'PT. Eka Nusantara Line', '021-22544948 / +62-21-22535132 / +62-21-22532389', NULL, TRUE),
  ('GMI-11032079', 'PT. ARTHA PUNCAK SEMESTA INDONESIA', NULL, NULL, TRUE),
  ('GMI-11032080', 'PT. Bumi Artlantis Raya', NULL, NULL, TRUE),
  ('GMI-11032081', 'PT. Hino', NULL, NULL, TRUE),
  ('GMI-11032082', 'PT. Pelsart Tambang Kencana', NULL, NULL, TRUE),
  ('GMI-11032083', 'PT. Trimegah Bangun Persada', NULL, NULL, TRUE),
  ('GMI-11032084', 'PT. Caritas Energi Indonesia', NULL, NULL, TRUE),
  ('GMI-11032085', 'PT. Gatra Kaltim Jaya', NULL, NULL, TRUE),
  ('GMI-11032086', 'PT. Jakarta Anugerah Mandiri', NULL, NULL, TRUE),
  ('GMI-11032087', 'PT. Kobexindo Tractor', NULL, NULL, TRUE),
  ('GMI-11032089', 'PT. Sandin Group', NULL, NULL, TRUE),
  ('GMI-11032090', 'CV. LINTAS FORTUNA NUSANTARA', NULL, NULL, TRUE),
  ('GMI-11032091', 'PT. HAYYU PRATAMA DEALER', NULL, NULL, TRUE),
  ('GMI-11032092', 'PT. KEMBAR ABADI UTAMA', NULL, NULL, TRUE),
  ('GMI-11032093', 'PT. MEGA GLOBAL ENERGY', NULL, NULL, TRUE),
  ('GMI-11032094', 'PT. Arkora Hydo Sulawesi', NULL, NULL, TRUE),
  ('GMI-11032095', 'PT. Batara Laman Nusantara', NULL, NULL, TRUE),
  ('GMI-11032096', 'PT. Daya Mitra Multi', NULL, NULL, TRUE),
  ('GMI-11032097', 'PT. Sulindo Lintas Samudera', NULL, NULL, TRUE),
  ('GMI-11032098', 'PT. Universal Traktor Indonesia', NULL, NULL, TRUE),
  ('GMI-11032099', 'PT. Ceria Jasatambang Pratama', NULL, NULL, TRUE),
  ('GMI-11032100', 'PT. Hasta Prima Sejahtera', NULL, NULL, TRUE),
  ('GMI-11032101', 'PT. KARYA KEMBAR BERSAMA', NULL, NULL, TRUE),
  ('GMI-11032102', 'PT. Kaltim Prima Coal', NULL, NULL, TRUE),
  ('GMI-11032103', 'PT. Laz Coal Mandiri', NULL, NULL, TRUE),
  ('GMI-11032104', 'CV. Chitra Abadi Jaya Abadi', NULL, NULL, TRUE),
  ('GMI-11032105', 'PT. Big Dipper Mac Machinery Indonesia', NULL, NULL, TRUE),
  ('GMI-11032107', 'PT. Total Crane Indonesia', NULL, NULL, TRUE),
  ('GMI-11032108', 'PT. Indo Traktor Papua', NULL, NULL, TRUE),
  ('GMI-11032109', 'PT. Kemitraan MNK BME', NULL, NULL, TRUE),
  ('GMI-11032110', 'PT. Thriveni Indo Mining', NULL, NULL, TRUE),
  ('GMI-11032111', 'PT. Imelda Teknik Mandiri', NULL, NULL, TRUE),
  ('GMI-11032112', 'PT. Berkat Jaya Beton', NULL, NULL, TRUE),
  ('GMI-11032113', 'PT. Mulia Industri Makmur', NULL, NULL, TRUE),
  ('GMI-11032114', 'PT. Multi Andalan Sejati', NULL, NULL, TRUE),
  ('GMI-11032115', 'PT. Srikandi Utama Makmur', NULL, NULL, TRUE),
  ('GMI-11032116', 'PT. Grand Motors Indonesia', NULL, NULL, TRUE),
  ('GMI-11032117', 'PT. Hartono Raya Motor', NULL, NULL, TRUE),
  ('GMI-11032118', 'PT. Gunung Samudera Internasional', NULL, NULL, TRUE),
  ('GMI-11032119', 'PT. Jhonlin Agro Mandiri', NULL, NULL, TRUE),
  ('GMI-11032120', 'PT. Zoomlion Indonesia Heavy Industry', NULL, NULL, TRUE),
  ('GMI-11032121', 'CV. Anugerah Sejahtera Abadi', '085250694369', 'Zainul', TRUE),
  ('GMI-11032122', 'PT. Daya Mitra Multipratama', NULL, NULL, TRUE),
  ('GMI-11032123', 'PT. TEKNINDO SUPER HAUL', '2159645008', NULL, TRUE),
  ('GMI-11032124', 'PT. Pilar Pratama Dinamika', NULL, NULL, TRUE),
  ('GMI-11032125', 'Rendi Jhon Pratama', NULL, NULL, TRUE),
  ('GMI-11032126', 'PT. ANDARA PRIMA UTAMA', NULL, NULL, TRUE),
  ('GMI-11032127', 'PT. Prima Transportasi Servis Indonesia', '0761-95455', NULL, TRUE),
  ('GMI-11032128', 'PT. Jababeka Infastruktur', NULL, NULL, TRUE),
  ('GMI-11032129', 'PT. Karya Putra Romeo', NULL, NULL, TRUE),
  ('GMI-11032130', 'PT. Obagi Ogan Cemerlang', NULL, NULL, TRUE),
  ('GMI-11032131', 'PT. Nusantara Berkah Tbk', NULL, NULL, TRUE),
  ('GMI-11032132', 'PT. Ultrindo Perkasa Multimesin', NULL, NULL, TRUE),
  ('GMI-11032133', 'PT. Biruni Altha Etam', NULL, NULL, TRUE),
  ('GMI-11032134', 'PT. Sarana Sukses Sejahtera', NULL, NULL, TRUE),
  ('GMI-11032135', 'CV. Cahaya Saranghae', NULL, NULL, TRUE),
  ('GMI-11032137', 'PT. Riau Andalan Pulp and Paper', NULL, NULL, TRUE),
  ('GMI-11032138', 'PT. Mastratech Indonesia', NULL, NULL, TRUE),
  ('GMI-11032139', 'PT. Abagi Ogan Cemerlang', NULL, NULL, TRUE),
  ('GMI-11032140', 'PT. Utrindo Perkasa Multimesin', NULL, NULL, TRUE),
  ('GMI-11032141', 'PT. Multi Surya Makmur Gemilang', NULL, NULL, TRUE),
  ('GMI-11032142', 'PT. Gema Mitra Teknindo', '0813-1001-8861', NULL, TRUE),
  ('GMI-11032144', 'PT. Guruh Putra Bersama', NULL, NULL, TRUE),
  ('GMI-11032145', 'PT. Dwi Kurnia', NULL, NULL, TRUE),
  ('GMI-11032146', 'PT. Trigana Abadi Swakarsa', NULL, NULL, TRUE),
  ('GMI-11032148', 'PT. Cipta Andalan Teknindo', NULL, NULL, TRUE),
  ('GMI-11062018', 'PT. TUNAS INTI ABADI', '021-29976747/021-29976746', NULL, TRUE),
  ('GMI-11112019', 'PT. Ulima Nitra', '0711-365157 / 365158 / 365580', NULL, TRUE),
  ('GMI-11112020', 'PT. Insani Baraperkasa', '(021) 6333803/ 0541-220072', NULL, TRUE),
  ('GMI-11112021', 'PT. Indo Perkasa Mandiri', '(0542) 743430', NULL, TRUE),
  ('GMI-11112024', 'PT. Surya Cipta Dipa', '(021) 214515825', NULL, TRUE),
  ('GMI-11112026', 'PT. INDI KRAN HYDRAULIKS', '(0542) 762227', NULL, TRUE),
  ('GMI-11112027', 'PT. RODA JAYA SAKTI', '(0411) 850663', NULL, TRUE),
  ('GMI-11112028', 'PT. MITRABARA ADIPERDANA TBK', '(021) 63856211 EXT.483', NULL, TRUE),
  ('GMI-11112030', 'PT. OSCAR MAS', NULL, '(021) 5361333 / (021) 89983000 (Cikarang)', TRUE),
  ('GMI-11112031', 'PT. Jomon Persada Nusantara', '085295588539', 'Ms. Eliz', TRUE),
  ('GMI-11112032', 'PT. Karunia Rental Indonesia', '0812-55792144 sarina (hp kantor tdk ada line telp biasa)', NULL, TRUE),
  ('GMI-11112033', 'PT. Sinar Terang Mandiri', '0431-855163/856162', NULL, TRUE),
  ('GMI-11112034', 'PT. Multindo Sentral Parts', '021-55654824', 'Mr. Alfan Rachim', TRUE),
  ('GMI-11112038', 'PT. Karunia Armada Indonesia', '0542-7209336', NULL, TRUE),
  ('GMI-11112039', 'PT. Segara Hero Sakti', NULL, NULL, TRUE),
  ('GMI-11112040', 'PT. Trimitra Sinergi Nusa', '0813-68842985', 'Pak Terry', TRUE),
  ('GMI-11112041', 'PT. Zen Armada', '(021) 29941058/59', 'Arsyih Hanifah / Nursasi Hanum', TRUE),
  ('GMI-11112044', 'PT. Karunia Alam Khatulistiwa', '021-22235286', NULL, TRUE),
  ('GMI-11112045', 'PT. Sinsumo Indonesia', '(021) 6006857/6299139', NULL, TRUE),
  ('GMI-11112046', 'PT. Graha Prima Energy', '(0541) 7271031 , 7271032', NULL, TRUE),
  ('GMI-11112051', 'PT. Kobexindo Equipment', '(021) 22644808', 'Atikah', TRUE),
  ('GMI-11112053', 'PT. Ombilin Fusi Nusantara', '085751958056', 'Bp. Haris', TRUE),
  ('GMI-11112056', 'PT. Karunia Tunggal Lestari', '081350523465', 'Mr.Rizal', TRUE),
  ('GMI-11112060', 'PT. Timur Satria Perkasa', NULL, NULL, TRUE),
  ('GMI-11112062', 'Romy', NULL, NULL, TRUE),
  ('GMI-12012021', 'PT. PRIMA PUTRA KALTIM', NULL, NULL, TRUE),
  ('GMI-12012022', 'PT. Surya Dana Mahaka', NULL, NULL, TRUE),
  ('GMI-12012025', 'PT. INKA Multi Solusi', '0351-2812105', NULL, TRUE),
  ('GMI-12012026', 'PT. Energi Bumi Sakti', '024-3567488', NULL, TRUE),
  ('GMI-12012028', 'PT. Wahyu Sinar Utama', '08115163319', 'M. Jazuli', TRUE),
  ('GMI-12012030', 'PT. KSB Indonesia', '085743578436', 'Rangga', TRUE),
  ('GMI-12012032', 'PT. Gunung Mas Group', '081219968633', '081233220289 / 021 - 2262 2516', TRUE),
  ('GMI-12012034', 'PT. Sumber Mutiara Prima', '(0541) 749501 / 749502', 'Mirza Ridha', TRUE),
  ('GMI-12012035', 'PT. Karunia Khas Nusantara', '081520436366', 'Pak Ading', TRUE),
  ('GMI-12012036', 'PT. LV Logistics Indonesia', '(0542) 875490-871371', NULL, TRUE),
  ('GMI-12012037', 'PT. Epiroc Southern Asia', '(021) 22722212', NULL, TRUE),
  ('GMI-13122018', 'PT. PARAMARTA UTAMA', '0711-377777', NULL, TRUE),
  ('GMI-14-08-2017', 'PT. Arkananta Apta Pratista', NULL, 'Mr. Embang', TRUE),
  ('GMI-14-08-2018', 'PT. MITRA SUKSES RAHARJA', '021-82616407', NULL, TRUE),
  ('GMI-14092018', 'PT. Samudra Maju Perkasa', '0541-290088', NULL, TRUE),
  ('GMI-15102018', 'PT. Kalimantan Citra Bara', '0542-874632 / 0542-874603 Ext : 71219', 'Hp : 0812 5555 825', TRUE),
  ('GMI-16102017', 'PT. Minimex Indonesia', '082180043431', 'Siti Sya''diah', TRUE),
  ('GMI-17052018', 'PT. NUSA INDAH KALIMANTAN PLANTATIONS', '05427586917, 05427586918', NULL, TRUE),
  ('GMI-17102019', 'PT. Pusaka Bumi Transportasi', '021-22293106', 'Krisdiyanto', TRUE),
  ('GMI-18042018', 'PT. TARA BUMI ARTHA', '(0542) 8513311,8513322', NULL, TRUE),
  ('GMI-18092018', 'PT. Ganda Alam Makmur', '021-29675023 / 021-29675028', NULL, TRUE),
  ('GMI-19062017', 'PT. Inparts Prima Sukses', '0542-8820101', NULL, TRUE),
  ('GMI-20022018', 'PT. Puninar Mitra Abadi', '021-46835490', NULL, TRUE),
  ('GMI-20032018', 'PT. Resource Equipment Indonesia', '0542-747640', NULL, TRUE),
  ('GMI-20082019', 'PT. Mandiangin Batubara', '0741-5915966', NULL, TRUE),
  ('GMI-21082019', 'PT. MITRA PROFITAMAS MOTOR', '0511-4220281/381', NULL, TRUE),
  ('GMI-23082018', 'PT. Reksa Rekatama', '0541-735496', NULL, TRUE),
  ('GMI-24092018', 'PT. Wahana Bandhawa Kencana', '0812-5678-8214 (Kelvin)', 'kelvin.santosa@pt-wbk.co.id', TRUE),
  ('GMI-24092019', 'PT. NIPINDO BERKAT ALAM', '62214515825', NULL, TRUE),
  ('GMI-25092019', 'PT. KRIST INTI PERKASA', '0551-3802937', NULL, TRUE),
  ('GMI-26092019', 'PT. Global Makara Teknik', '021-5292 1667', NULL, TRUE),
  ('GMI-28032019', 'PT. Mira Mirza Thoha', NULL, '81350514555', TRUE),
  ('GMI-30112017', 'PT. Tiga Mandiri Jayatama', '(021) 62301777', '(021) 5258799', TRUE),
  ('GMI-310320', 'PT. Putra Perkasa Abadi', NULL, 'Mr. Agus Leo', TRUE),
  ('GMI-310322', 'Steven Tanara', '081320556666', NULL, TRUE),
  ('GMI-31082017', 'PT. Multindo Technology Utama', '0542-75813217', 'Whardana Halking', TRUE),
  ('GMI-CUST-INV-1503-01', 'PT. Karebet', NULL, NULL, TRUE),
  ('GMI-CUST-INV-1504-10', 'PT. LEMBU SWANA PERKASA', '0542-8820378', 'Mrs. Evi Pijer', TRUE),
  ('GMI-CUST-INV-1504-16', 'PT. Rhodes', '(0542) 7588026', 'Mrs. Sisil (081253757003)', TRUE),
  ('GMI-CUST-INV-1603-04', 'PT. PIPIT MUTIARA JAYA', '0551-36976/36801', 'Mr. Irfan', TRUE),
  ('GMI-CUST-INV-1603-07', 'PT. HIDROSISTEM JAYA MANDIRI', '088210582602', 'Ibu Puput Wijiyanti', TRUE),
  ('GMI-CUST-INV-1603-08', 'PT. ITCI HUTANI MANUNGGAL', '0542-7581917', 'Mrs. Hulda Pitra', TRUE),
  ('GMI-CUST-INV-1605-12', 'PT. Primatama Energi Nusantara', '(031) 3282000', NULL, TRUE),
  ('GMI-CUST-INV-1605-16', 'PT. IMST', NULL, NULL, TRUE),
  ('GMI-CUST-INV-1605-17', 'PT. PARTSINDO SERVICATAMA', '(0542) 746001', 'Harsono', TRUE),
  ('GMI-CUST-INV-1605-18', 'PT. Maju Kalimantan Hadapan', '0541-766567/ Ibu wina 081351875989', 'Mr. Faidil Reza', TRUE),
  ('GMI-CUST-INV-1605-19', 'PT. Rimba Perkasa Utama', 'logistic 0821-51708803/ acc 0821-54846962/ kantor 0541-735496', 'Mr. Hadi', TRUE),
  ('GMI-CUST-INV-1605-20', 'PT. Equalindo Makmur Alam Sejahtera', '0541 735496/ 205889/ 738737/021-21203722/21201327', 'Mr. Hadi', TRUE),
  ('GMI-CUST-INV-1605-21', 'PT. SABANG MERAUKE TRANSINDO', '021 2252 2221', 'Mr. Joko Irmanto', TRUE),
  ('GMI-CUST-INV-1605-25', 'PT. Gastech Engineering', NULL, NULL, TRUE),
  ('GMI-CUST-INV-1605-26', 'PT. Sinar Besar Abadi', '021-2452 0580', 'Mr. Handoyo', TRUE),
  ('IDR-100314', 'PT. Sinar Bintang Mulia', '081351068502', NULL, TRUE),
  ('INV-1000', 'Agisna Nur Aziz', '08568597006', NULL, TRUE),
  ('INV-1001', 'Ahmad Hasim', '08159533882 / 081283149457', 'Ahmad Hasim', TRUE),
  ('INV-1002', 'Akhmad Gunardi', '08125485907', 'Akhmad Gunardi', TRUE),
  ('INV-1003', 'Ali', NULL, NULL, TRUE),
  ('INV-1004', 'Awend', '08127132418', NULL, TRUE),
  ('INV-1005', 'BERKAH SENTOSA', '0878 8546 1554', 'Mr. Ahmad', TRUE),
  ('INV-1006', 'Bengkel Bleser Krakatau', '087772570644', 'Pak Suwarso', TRUE),
  ('INV-1007', 'Bengkel Cahaya Mandiri', '08121860174', 'Pak Tani', TRUE),
  ('INV-1008', 'Bengkel Cahaya Motor', '08121860174', 'Bpk. Kani', TRUE),
  ('INV-1009', 'Bengkel Laras Mukti', '083875101340', 'Pak Mukti', TRUE),
  ('INV-1010', 'Benydicta Roma', '081350966239', NULL, TRUE),
  ('INV-1011', 'Bintang Jaya Motor', '021-35987717', 'Pak Sukma', TRUE),
  ('INV-1012', 'Bp. Dedy', NULL, NULL, TRUE),
  ('INV-1013', 'Bunga Ratnani', NULL, NULL, TRUE),
  ('INV-1014', 'COATES HIRE INDONESIA', NULL, 'Mr. Mujaidi Wailul Amri', TRUE),
  ('INV-1015', 'COATES SERVICES INDONESIA', '(031) 749-5943', 'Inna Wara Agustina', TRUE),
  ('INV-1016', 'CV. Arvindo Equipment System', '(0542) 720 9405', 'Alie', TRUE),
  ('INV-1017', 'CV. Bintang Bintara', NULL, 'Mr. Bambang', TRUE),
  ('INV-1018', 'CV. Brima Sukses Tehnik', '0542-7063506', 'Mr. Junaidi', TRUE),
  ('INV-1019', 'CV. Guna Indah Teknikatama', '081380409268', 'Bp. Gunawan', TRUE),
  ('INV-1020', 'CV. Junior Parts', NULL, 'Bp. Karolus', TRUE),
  ('INV-1021', 'CV. Metro Motor', '0812 8190 399', 'Bp. Bakri', TRUE),
  ('INV-1022', 'CV. New Utama Technic', NULL, NULL, TRUE),
  ('INV-1023', 'CV. Sarana Prima Lestari', '0511-3269593', 'Evi Yusia', TRUE),
  ('INV-1024', 'CV. Tunas Jaya', '031-3815925', NULL, TRUE),
  ('INV-1025', 'CV. Tunas Jaya (CIKARANG)', '021-89907158', 'Eva Tengker', TRUE),
  ('INV-1026', 'Cahaya Motor', '08170801968', 'Pak Aris', TRUE),
  ('INV-1027', 'Daniel Anindhito', NULL, NULL, TRUE),
  ('INV-1028', 'Dedi Sopian', '08112233894', NULL, TRUE),
  ('INV-1029', 'Della Megantara', NULL, '81221506933', TRUE),
  ('INV-1030', 'Dua Putri Car Station', '218463675', 'Mr. Elvis', TRUE),
  ('INV-1031', 'Dwi Karya Motor', '0881 9999 269', 'Ibu Adawiyah', TRUE),
  ('INV-1032', 'Erick', NULL, 'Erick', TRUE),
  ('INV-1033', 'Fernando Aritonang', NULL, NULL, TRUE),
  ('INV-1034', 'Haji Zainal', NULL, NULL, TRUE),
  ('INV-1035', 'INTI JAYA MOBIL', '2193467079', 'Mr. Roni', TRUE),
  ('INV-1036', 'Ibu Ida', '0542-82407305', NULL, TRUE),
  ('INV-1037', 'Ilham Putra', '08567917161', NULL, TRUE),
  ('INV-1038', 'Inti Jaya Motor', NULL, 'Mas Ron', TRUE),
  ('INV-1039', 'Irwan Wahyudi', '085711105046', NULL, TRUE),
  ('INV-1040', 'J & X MOTOR', '081222960707', 'Mr. Jamal', TRUE),
  ('INV-1041', 'JAYA MOTOR', '021-8761127', 'Pak Yohan', TRUE),
  ('INV-1042', 'Karebet Mas Group', NULL, 'eko', TRUE),
  ('INV-1043', 'Komatsu Marketing Support Indonesia', NULL, NULL, TRUE),
  ('INV-1044', 'Koperasi Putra Perkasa Abadi Sejahtera', '082288892966', 'Adhyaksa', TRUE),
  ('INV-1045', 'Kristian Reza Destiawan', '089601882321', NULL, TRUE),
  ('INV-1046', 'LINC EXPRESS', NULL, NULL, TRUE),
  ('INV-1047', 'Laela Nurjamilah', '085222107629', NULL, TRUE),
  ('INV-1048', 'Lana Jaya Motor', '082111692706', 'Rizal', TRUE),
  ('INV-1049', 'M. taufik R / H. Palui', '021-53691015', 'M. taufik R / H. Palui', TRUE),
  ('INV-1050 (IDR)', 'MAN TRUCK', '0812 8383 8087', 'Ibu Dina Feronika', TRUE),
  ('INV-1051', 'Monza Motorsport', '021-29098552', 'Pertiwi', TRUE),
  ('INV-1052', 'Mr. Berty', '0821-54801971', NULL, TRUE),
  ('INV-1053', 'Mr. Marsidi', NULL, NULL, TRUE),
  ('INV-1054', 'Mr. Ronni A', NULL, NULL, TRUE),
  ('INV-1055', 'Naga Mas Motor', '021-8644226 / 276', 'Hendry D', TRUE),
  ('INV-1056', 'PATRIA PT. United Tractors Pandu Engineering', NULL, 'Wina Kartika', TRUE),
  ('INV-1057', 'PT Bamas Sejahtera', '0542-876912', 'Bp Sugianto', TRUE),
  ('INV-1058', 'PT Foresta Trastek', '021-5555994', 'joko', TRUE),
  ('INV-1059', 'PT INTRACO PENTA PRIMA SERVIS', '0542-770477', NULL, TRUE),
  ('INV-1060 (USD)', 'PT KOMATSU INDONESIA', '440 06 11', 'Bpk. Irwan Setyanto', TRUE),
  ('INV-1061', 'PT Prima Energy Services', NULL, 'Mr. Ridho', TRUE),
  ('INV-1062', 'PT Prima Jaya Persada Nusantara', '+62.31.8420295', 'Ibu Ira', TRUE),
  ('INV-1063', 'PT Ziegler Indonesia', '021-8972835', 'Bapak Tarkim', TRUE),
  ('INV-1064 (IDR)', 'PT. ABICAM', '0542-771985', 'Robby Maiwan', TRUE),
  ('INV-1065', 'PT. ANTAREJA MAHADA MAKMUR (AMM)', '021-57903456', NULL, TRUE),
  ('INV-1066', 'PT. AUTO UNIVERSAL DESIGN INDONESIA', '021-8253179/33801336', 'audi3179@yahoo.co.id', TRUE),
  ('INV-1067', 'PT. Acset Indonusa, Tbk', NULL, NULL, TRUE),
  ('INV-1068', 'PT. Adimitra Baratama Nusantara', '0541-6246596 (kantor samarinda)/ 021-57942103', 'Astri Natalia M.', TRUE),
  ('INV-1069', 'PT. Adimitra Baratama Nusantara (Sanga2)', '0541-692150/51/52', 'Mrs. Astri Natalia', TRUE),
  ('INV-1070', 'PT. Adiraya Primaline', '0542-731379- 423886', NULL, TRUE),
  ('INV-1071', 'PT. Alam Jaya Pratama', '08115535777', 'Mr. Aal', TRUE),
  ('INV-1072 (IDR)', 'PT. Altrak 1978', '0542-761978', 'Bp. Joko Sugiono', TRUE),
  ('INV-1073', 'PT. Alun Indah', '(021) 8290608', 'Sri Wahyuni', TRUE),
  ('INV-1074', 'PT. Andalan Mining', '+62216298623', NULL, TRUE),
  ('INV-1075', 'PT. Andalan Mukti Kencana', '021-46835566', 'Mr. Ardhita', TRUE),
  ('INV-1077', 'PT. Anugrah Bumi Lestari', '021-3852727', 'Pak Irfan fin (081574015982) wiliam 0819-6033840', TRUE),
  ('INV-1078', 'PT. Arista Jaya Niaga', NULL, NULL, TRUE),
  ('INV-1080', 'PT. Arkha Jayanti Persada', '87918903-09', NULL, TRUE),
  ('INV-1081', 'PT. Artamulia Tata Pratama', '021-31990302', NULL, TRUE),
  ('INV-1082', 'PT. Artha Mineral Resources', '021-666 777 80', 'Erwanty', TRUE),
  ('INV-1083', 'PT. Asiarep', '(021) 29403191/92', NULL, TRUE),
  ('INV-1084 (IDR)', 'PT. Asmin Koalindo Tuhup', '021-29573737', 'Yoshua', TRUE),
  ('INV-1085', 'PT. Atlas Persada Engineering', '082157601009', 'Bpk. Anang', TRUE),
  ('INV-1086', 'PT. BAS', NULL, NULL, TRUE),
  ('INV-1086 (IDR)', 'PT. BAUER PRATAMA INDONESIA', '021-29661988', 'Ibu Imelda / Ratna', TRUE),
  ('INV-1087 (IDR)', 'PT. BUKIT MAKMUR', '021-6613636', 'Bp. Johny Bunawan', TRUE),
  ('INV-1088', 'PT. Bahtera Putera Nusantara', NULL, NULL, TRUE),
  ('INV-1089', 'PT. Bangunan Teknik Grup', '081213953332', 'Sandi', TRUE),
  ('INV-1090', 'PT. Banshu Electrical Indonesia', '+62-21 893 47 77', 'Bpk Arief Dharmawan', TRUE),
  ('INV-1091 (IDR)', 'PT. Bara Multi Group', NULL, NULL, TRUE),
  ('INV-1092', 'PT. Baradinamika Mudasukses', '(021) 63856211 Ext.483', NULL, TRUE),
  ('INV-1093', 'PT. Barawa Karya Makmur', '081387610568', 'Mr. Isman Budi W', TRUE),
  ('INV-1094', 'PT. Bayan Resources, Tbk', '0542-874632/021-29356888', NULL, TRUE),
  ('INV-1095', 'PT. Berca Mandiri Perkasa', '081231892871', 'Pak Arizal', TRUE),
  ('INV-1096', 'PT. Berkarya Abadi Selalu', NULL, NULL, TRUE),
  ('INV-1098', 'PT. Berlian Duta Energi', '(021) 5652236', 'Nopianti Cahyani', TRUE),
  ('INV-1099', 'PT. Bhakti Coal', NULL, 'Bp. Erwin', TRUE),
  ('INV-1100', 'PT. Bhumi Phala Perkasa', '0542-764632, 746042', 'Vita Usmila Sari', TRUE),
  ('INV-1101', 'PT. Bhumi Sriwijaya Perdana Coal', '08115420961', 'Pak Erwin', TRUE),
  ('INV-1102', 'PT. Bima Putra Abadi Citranusa', '082112897845', 'Jamal Rani', TRUE),
  ('INV-1103', 'PT. Bintang Cosmos', '+62 21 6322 755', 'Mr. Bryan', TRUE),
  ('INV-1104', 'PT. Bintang Garuda Mas Raya', '0542 7581924', 'Mr. Fong Gan Tiang', TRUE),
  ('INV-1105', 'PT. Borneo Alam Semesta', '021-29378906', 'Ibu Christin / Ibu Shinta', TRUE),
  ('INV-1106', 'PT. Borneo Mitra Jaya', '(0542)873963', NULL, TRUE),
  ('INV-1108 (IDR)', 'PT. Budhi Wiguna Prima', '0542-423886 / 713', NULL, TRUE),
  ('INV-1109', 'PT. Bukit Hamparan Luas', '0542 871 909', NULL, TRUE),
  ('INV-1110', 'PT. Bukit Intan Indoperkasa', '0542-7204100/7204101', 'Mr. Taufik', TRUE),
  ('INV-1111', 'PT. Bukit Intan Manunggal', '021-4515825 / 021-4515828', NULL, TRUE),
  ('INV-1112', 'PT. Bukit Makmur Instindo Nikeltama', '021 5151665', 'Bp. Nurtyas Kadarto', TRUE),
  ('INV-1113', 'PT. Burangkeng Maju Tehnik', '(021) 29366320', 'Mr. Kiki Sugiarto', TRUE),
  ('INV-1114 (IDR)', 'PT. CIPTA KRIDATAMA', '021-29976866', 'Bp. Tezzy Yulivan MH', TRUE),
  ('INV-1115', 'PT. CMS Kaltim Utama', '0541-7283301', NULL, TRUE),
  ('INV-1116 (IDR)', 'PT. COATES HIRE INDONESIA', '0542-765584', 'Bp. Roy Hansani / Ibu Nenden Pratiwi', TRUE),
  ('INV-1117 (IDR)', 'PT. COATES SERVICES INDONESIA', '0542-760.174/765584', 'Bpk Roy Hansani', TRUE),
  ('INV-1118', 'PT. Cahaya Energi Mandiri', '0541-7283301', NULL, TRUE),
  ('INV-1119', 'PT. Cahaya Indah Madani', '215872712', NULL, TRUE),
  ('INV-1120', 'PT. Cakra Alam Persada', '081351880299', 'Nursalim', TRUE),
  ('INV-1121', 'PT. Cargil', NULL, NULL, TRUE),
  ('INV-1122', 'PT. Catur Pilar Sejati', '081285181715', 'Pak Chandra', TRUE),
  ('INV-1123 (IDR)', 'PT. Chakra Jawara', '021-2997-6849', 'ibu Rozita', TRUE),
  ('INV-1124', 'PT. Cipaganti Citra Graha', '0541-7927733', NULL, TRUE),
  ('INV-1126', 'PT. Citra Raya Tangerang', NULL, NULL, TRUE),
  ('INV-1127', 'PT. DAYA KOBELCO CONSTRUCTION MACHINERY INDONESIA', '021-22143080', 'Bp. Gustaf Virgianto', TRUE),
  ('INV-1128 (IDR)', 'PT. Darma Henwa, Tbk', '(021) 29912350', 'Achmad Bagas Adiyaksono', TRUE),
  ('INV-1128 (USD)', 'PT. Dharma Henwa', '5794.8830/38', 'Bpk Adi Wijaya', TRUE),
  ('INV-1129', 'PT. Dian Pandu Pratama', '0878-6024-6682', 'Pak Ahmad', TRUE),
  ('INV-1130', 'PT. Diesel Utama Mineral', NULL, NULL, TRUE),
  ('INV-1131', 'PT. Dizamatra Powerindo', '(021) 39043678', NULL, TRUE),
  ('INV-1132', 'PT. Djava Berkah Mineral', '(021) 7221651', 'Taufik Hidayat', TRUE),
  ('INV-1134', 'PT. EKA DHARMA JAYA SAKTI', '62-542765555', NULL, TRUE),
  ('INV-1135', 'PT. ENERGY LOGISTICS', '0542 771111,771020', 'Mr. Dwi Febrianto', TRUE),
  ('INV-1136', 'PT. Ellight Prima Indonesia', '0542-8794577', NULL, TRUE),
  ('INV-1371', 'PT. Bina Sarana Sukses', '(021) 5882245', 'Bp. Erwin Wibowo', TRUE),
  ('KH-22102015', 'PT. Khaleda Agroprima Malindo', '08115540874', NULL, TRUE),
  ('PT Teconindo (IDR)', 'PT. TECONINDO', '(62) 542 761 441', NULL, TRUE),
  ('TOKPED-50', 'Richie Febri Yanto', '081233080838', NULL, TRUE)
ON CONFLICT (customer_no) DO UPDATE SET
  is_active    = TRUE,
  telephone    = COALESCE(NULLIF(btrim(public.customers.telephone), ''), EXCLUDED.telephone),
  contact_name = COALESCE(NULLIF(btrim(public.customers.contact_name), ''), EXCLUDED.contact_name);

-- 3) Nonaktifkan customer legacy yang sudah tidak aktif di ERP
UPDATE public.customers
SET is_active = FALSE
WHERE is_active
  AND customer_no IN (
    'CST001',                           -- TES-CUSTOMERR
    '040314-USD',                       -- PT. Kayan Putra Utama Coal
    '080114-06 (Kaltim) - USD',         -- PT. Samindo Utama Kaltim
    '09042020-(USD)',                   -- PT. HPU
    '09042021-(IDR)',                   -- PT. Sumber Mitra Jaya
    '10 SIS-KM35',                      -- PT. Saptaindra Sejati
    '10042014-03 (USD)',                -- PT. Mandala Karya Prima
    '102  ITU (IDR) JKT',               -- PT. Indotruck Utama
    '116',                              -- PT. Mitra Parama Gemilang
    '120316 (IDR)',                     -- PT. Medco Energi Mining Internasional
    '12052015-06',                      -- PT. Jaya Karya Perdana
    '14082014-01',                      -- PT. Gemala Sarana Upaya
    '15 KPP-JC',                        -- PT. Kalimantan Prima Persada
    '16 KPP-JA',                        -- PT. Kalimantan Prima Persada
    '18022015 (USD)',                   -- PT. KTC Coal Mining & Energy
    '19 KPP-JSP',                       -- PT. Kalimantan Prima Persada
    '19 KPP-JSP (USD)',                 -- PT. Kalimantan Prima Persada
    '21 SIS-JB',                        -- PT. Saptaindra Sejati
    '21052014-01(USD)',                 -- PT. Prima Sarana Gemilang
    '23 PPN-J.KCMB (USD)',              -- PT. Pama Persada Nusantara
    '23/04/13',                         -- PT. Kutai Chip Mill
    '24 SIS-NAR',                       -- PT. Saptaindra Sejati
    '25 TU-JKT (USD)',                  -- PT. Trakindo Utama
    '27042017-(USD)',                   -- PT. PANDU TRAMPIL UTAMA
    '28 KM35',                          -- PT USD
    '281014-01 (USD)',                  -- PT. Intecs Teknikatama Industri
    '3 (IDR)',                          -- PT. United Tractor
    '33',                               -- PT. Putra Tunggal Mandiritama
    '33 Nar USD',                       -- PT. Saptaindra Sejati
    '34 (USD)',                         -- PT. Nipindo Primatama
    '35 SIS-BIMO',                      -- PT. Saptaindra Sejati
    '36 TU-Bt. Hijau',                  -- PT. TRAKINDO UTAMA
    '37 TU-Bt. Hijau (USD)',            -- PT. TRAKINDO UTAMA
    '39 Thiess BP',                     -- PT. Thiess Contractor Indonesia
    '4 KPP-RG',                         -- PT. Kalimantan Prima Persada
    '40 Thiess BP',                     -- PT. Thiess Contractor Indonesia
    '45',                               -- PT. INDONESIA EQUIPMENT CENTRE
    '47 PETROSEA BP (USD)',             -- PT. PETROSEA, Tbk
    '48',                               -- PT. Nipindo Primatama
    '52 SIS-SUMO',                      -- PT. Saptaindra Sejati
    '54',                               -- CV. RAFAEYZA JAYA PERKASA
    '56 SIS Jobsite Mika',              -- PT. Saptaindra Sejati
    '57 SIS Jobsite Tutupan USD',       -- PT. Saptaindra Sejati
    '61(IDR)',                          -- PT. KIDECO JAYA AGUNG
    '64 PTR JKT (USD)',                 -- PT. PETROSEA, Tbk
    '66 TU BP',                         -- PT. TRAKINDO UTAMA
    '67 SIS JKT-(USD)',                 -- PT. Saptaindra Sejati
    '69',                               -- PT. PORTER REKAYASA UNGGUL
    '7 Trak-Sam',                       -- PT. Trakindo Utama
    '75 PT. PBK IDR',                   -- PT. Pundi Bakti Khatulistiwa
    '80 PT. RCB',                       -- PT. Ricobana Abadi
    '87 KPP-RG (USD)',                  -- PT. Kalimantan Prima Persada
    '90 ITU - IDR BP',                  -- PT. Indotruck Utama
    '91',                               -- PT. Komatsu Marketing and Support Indonesia
    '95 SSB - TGRG (USD)',              -- PT. SANGGAR SARANA BAJA
    'DO-1015',                          -- PT. Indonesia Pratama (S)
    'DO-1016',                          -- PT. KIDECO JAYA AGUNG
    'DO-1017',                          -- PT. KIDECO JAYA AGUNG
    'DO-1018',                          -- PT. Kalimantan Prima Persada
    'DO-1019',                          -- PT. Kalimantan Prima Persada
    'DO-1020',                          -- PT. Kalimantan Prima Persada
    'DO-1021',                          -- PT. Kalimantan Prima Persada
    'DO-1027',                          -- PT. Lestari Berkat Sejahtera
    'DO-1033',                          -- PT. Petrosea Tbk
    'DO-1036',                          -- PT. Ricobana Abadi
    'DO-1041',                          -- PT. Tri Swardana Utama
    'DO-1042',                          -- PT. Trimega Utama Corporindo
    'DO-1043',                          -- PT. United Tractor
    'GMI-03-09-2018',                   -- PT. SUMBER MITRA JAYA
    'GMI-062013-001',                   -- PT. Tunas Jaya Perkasa
    'GMI-082013-001',                   -- PT. SIMS JAYA KALTIM
    'GMI-11032042',                     -- PT. Mitra Muda Makmur
    'GMI-11032088',                     -- PT. Nipindo Primatama
    'GMI-11032106',                     -- PT. Universal Support
    'GMI-11032136',                     -- PT. Batara Dharma Persada
    'GMI-11032147',                     -- PT. Traktor Utama Nusantara
    'GMI-111120297',                    -- PT. HARAPAN DUTA PERTIWI
    'GMI-130718',                       -- PT. Mutiara Tanjung Lestari
    'GMI-25092018',                     -- PT. Ricobana Abadi
    'GMI-310319',                       -- PT. TRAKINDO UTAMA
    'GMI-CUST-INV-1504-11',             -- PT. Puninar Mitra Abadi
    'GMI-CUST-INV-1504-17',             -- PT. PUTRA PERKASA ABADI
    'GMI-USD-062013-001',               -- PT. Kepsindo Indra Utama
    'IDR-11032014',                     -- PT. Petrolog Indah
    'IDR-11032014-02 (HO)',             -- PT. Trimega Utama Corporindo
    'INV-1050 (USD)',                   -- MAN TRUCK
    'INV-1064 (USD)',                   -- PT. ABICAM
    'INV-1072 (USD)',                   -- PT. Altrak 1978
    'INV-1076',                         -- PT. Antang Gunung Meratus
    'INV-1079 (IDR)',                   -- PT. Arkananta Apta Pratista
    'INV-1079 (USD)',                   -- PT. Arkananta Apta Pratista
    'INV-1084 (USD)',                   -- PT. Asmin Koalindo Tuhup
    'INV-1086 (USD)',                   -- PT. BAUER PRATAMA INDONESIA
    'INV-1087 (USD)',                   -- PT. BUKIT MAKMUR
    'INV-1091 (USD)',                   -- PT. Bara Multi Group
    'INV-1097',                         -- PT. Berkarya Abadi Selalu
    'INV-1107',                         -- PT. Buana Centra Swakarsa
    'INV-1108 (USD)',                   -- PT. Budhi Wiguna Prima
    'INV-1114 (USD)',                   -- PT. CIPTA KRIDATAMA
    'INV-1116 (USD)',                   -- PT. Coates Hire Indonesia
    'INV-1117 (USD)',                   -- PT. COATES SERVICES INDONESIA
    'INV-1123 (USD)',                   -- PT. Chakra Jawara
    'INV-1125',                         -- PT. Cipta Andalan Teknindo
    'INV-1133 (IDR)',                   -- PT. Duta Tambang Rekayasa
    'INV-1133 (USD)',                   -- PT. Duta Tambang Rekayasa
    'USD 191113-01',                    -- PT. United Coal Indonesia
    'USD Ship-TUC1',                    -- PT. Terra Factor Indonesia
    'USD(02)-08122014',                 -- PT. Prima Energy Services
    'USD-23/04/21'                      -- PT. Lestari Berkat Sejahtera
  );
