-- Seed Update Web: changelog aplikasi 15 Sep 2026 - 5 Okt 2026, disusun dari
-- riwayat commit (1 post per tanggal rilis). Jalankan manual di SQL editor
-- (local / VPS) sebagai postgres - BUKAN migration, karena isinya data konten.
--
-- - Versi: lanjut patch +1 dari versi tertinggi yang sudah ada (1.0.0 kalau
--   tabel masih kosong), urut tanggal.
-- - created_at = tanggal rilis jam 17:00 WIB, supaya urutan di /update-web
--   sesuai kronologi dan cuma post 7 hari terakhir yang nyalain badge "baru".
-- - created_by = publisher pertama (moderator + it), NULL kalau tidak ada.
-- - Idempotent: post yang judulnya sudah ada dilewati.
-- - content dibangun ke Tiptap JSON: H2 per section + bullet list.

DO $$
DECLARE
  v_author UUID;
  v_major INT;
  v_minor INT;
  v_patch INT;
  v_post JSONB;
  v_content JSONB;
  v_posts JSONB := $json$
[
  {
    "date": "2026-09-15",
    "title": "Penerimaan Consignment & Tabel Lebih Nyaman",
    "highlights": [
      "Menu baru Penerimaan Consignment untuk konfirmasi barang diterima customer",
      "Halaman Customer Stock konsinyasi",
      "Field Kategori di MR",
      "Header tabel tetap terlihat saat di-scroll"
    ],
    "sections": [
      {"h": "Fitur Baru", "items": [
        "Penerimaan Consignment: staff menginput konfirmasi customer atas IK (sesuai / komplain). Qty diterima masuk ke stok customer, selisihnya tetap di gudang tujuan.",
        "Halaman Customer Stock untuk melihat stok konsinyasi yang sudah ada di customer.",
        "Field Kategori pada pembuatan & detail MR, serta bisa difilter di daftar MR.",
        "Alamat cabang bisa diisi di Master Cabang."
      ]},
      {"h": "Peningkatan", "items": [
        "Header tabel SPB (PO, DO, Invoice, Report) dan Return SPB tetap menempel di atas saat tabel di-scroll, termasuk di Safari.",
        "Perapihan tampilan tabel di beberapa halaman."
      ]}
    ]
  },
  {
    "date": "2026-09-16",
    "title": "PO: Pajak, Diskon, Ongkir & Approval Lebih Jelas",
    "highlights": [
      "PPN/PPh bisa persen atau nominal Rp, plus diskon & ongkir di PO",
      "Kolom Progress Approval di daftar PO seperti di PR",
      "Status konversi PR ke PO (Belum/Partial/Lengkap)",
      "Kode IK dibuat otomatis"
    ],
    "sections": [
      {"h": "Fitur Baru", "items": [
        "PO: PPN & PPh bisa diisi persen atau nominal Rp manual (default Rp), diskon persen/Rp, ongkos kirim, dan opsi harga sudah termasuk pajak. Tampil juga di detail & cetak PO.",
        "Vendor PO dipilih sekali per dokumen, tidak lagi per item.",
        "Badge & filter status konversi PR ke PO (Belum / Partial / Lengkap) di daftar PR, pemilih PR saat buat PO, dan widget Dashboard.",
        "Detail informasi PO langsung dari halaman PR: tiap item PR menampilkan status Belum/Partial/Sudah PO beserta link nomor PO-nya.",
        "Kode IK (Invoice Konsinyasi) dibuat otomatis dengan format IK-00001."
      ]},
      {"h": "Peningkatan", "items": [
        "Daftar PO kini menampilkan Progress Approval yang sama dengan PR, sehingga terlihat sedang menunggu approval siapa.",
        "Qty PR yang dibuat dari MR boleh melebihi qty MR (ditandai badge)."
      ]},
      {"h": "Perbaikan", "items": [
        "Pencarian MR saat membuat PR sekarang mencari ke seluruh MR approved, tidak hanya 15 MR terbaru."
      ]}
    ]
  },
  {
    "date": "2026-09-17",
    "title": "Job Costing & Master Gudang",
    "highlights": [
      "Job Costing mendukung customer & lokasi",
      "Daftar gudang diperbarui dari data ERP",
      "Perbaikan form DO Reguler"
    ],
    "sections": [
      {"h": "Peningkatan", "items": [
        "Form Job Costing kini mencatat customer dan lokasi, dengan tampilan detail yang lebih lengkap.",
        "Data gudang diperbarui mengikuti daftar gudang dari ERP lama.",
        "Penyesuaian form pembuatan DO Reguler."
      ]}
    ]
  },
  {
    "date": "2026-09-24",
    "title": "Hapus Dokumen, Status Payment SPB & Cetak Barcode",
    "highlights": [
      "Moderator bisa hapus dokumen beserta turunannya sekaligus",
      "Status Payment (paid/unpaid) di Report SPB untuk role Finance",
      "Cetak label barcode / QR barang",
      "Gudang penerima per item di Receive Item"
    ],
    "sections": [
      {"h": "Fitur Baru", "items": [
        "Moderator dapat menghapus dokumen (MR, PR, PO, RI, Delivery, Item Transfer, Scheduled MR) beserta dokumen turunannya dalam satu langkah, dengan preview dampak sebelum konfirmasi. Stok otomatis disesuaikan.",
        "Kolom Status Payment (paid / unpaid) di Report SPB, dapat diubah oleh role baru Finance.",
        "Cetak label barcode / QR code barang dari Master Barang.",
        "Preview keputusan MR sebelum approve/reject.",
        "Receive Item: pilih gudang penerima per item. Barang untuk cabang lain didistribusikan lewat Item Transfer yang dibuat dari RI."
      ]}
    ]
  },
  {
    "date": "2026-09-25",
    "title": "Working Order, Notifikasi Suara & Dashboard Consignment",
    "highlights": [
      "Modul baru Working Order lengkap dengan formula & material release",
      "Pengaturan notifikasi (suara) di halaman Profil",
      "Grafik tren & KPI di Dashboard Consignment"
    ],
    "sections": [
      {"h": "Fitur Baru", "items": [
        "Working Order: pembuatan WO, formula material, material release, riwayat edit, dan alur approval WO.",
        "Pengaturan notifikasi di halaman Profil, termasuk suara notifikasi yang bisa dinyalakan/dimatikan.",
        "Dashboard Consignment: grafik tren dan tile KPI dengan perbandingan periode sebelumnya."
      ]},
      {"h": "Peningkatan", "items": [
        "Notifikasi kini menampilkan siapa yang melakukan aksi.",
        "Master Cabang memiliki tipe cabang."
      ]}
    ]
  },
  {
    "date": "2026-09-29",
    "title": "Validasi Qty Item MR",
    "highlights": [
      "MR hanya bisa dibuat jika item memiliki qty lebih dari 0"
    ],
    "sections": [
      {"h": "Perbaikan", "items": [
        "Pembuatan MR sekarang menolak item dengan qty 0, baik di form maupun di server."
      ]}
    ]
  },
  {
    "date": "2026-09-30",
    "title": "Ukuran Font, Update Web & Detail Pengiriman",
    "highlights": [
      "Pilihan ukuran font Medium / Large / Extra Large per akun",
      "Halaman Update Web menggantikan Update Logs",
      "Detail koli, layanan kurir & rate per kg di pengiriman",
      "Export Item Transfer ke Excel"
    ],
    "sections": [
      {"h": "Fitur Baru", "items": [
        "Ukuran font tampilan (Medium / Large / Extra Large) bisa diatur per akun di halaman Profil. Hasil cetak tetap ukuran normal.",
        "Update Web: halaman pengumuman update aplikasi untuk semua user, dengan reaction emoji dan komentar. Menggantikan halaman Update Logs.",
        "Detail koli, layanan kurir, dan rate per kg di Item Transfer, Delivery, dan DO Reguler, lengkap dengan estimasi biaya kirim.",
        "Export Item Transfer ke Excel."
      ]},
      {"h": "Peningkatan", "items": [
        "Penyesuaian pilihan jenis pengiriman di form pengiriman.",
        "Perbaikan tampilan tabel agar tidak bertumpuk saat ukuran font besar."
      ]}
    ]
  },
  {
    "date": "2026-10-01",
    "title": "Filter Kolom Report SPB",
    "highlights": [
      "Panel filter per kolom di Report SPB",
      "Filter berdasarkan cabang"
    ],
    "sections": [
      {"h": "Fitur Baru", "items": [
        "Report SPB memiliki panel filter per kolom yang bisa dibuka-tutup, termasuk filter cabang. Filter diproses di server sehingga tetap cepat untuk data besar."
      ]}
    ]
  },
  {
    "date": "2026-10-02",
    "title": "Site Customer & Performa Consignment",
    "highlights": [
      "Master site per customer",
      "Site SO & gudang tujuan IK menyesuaikan customer",
      "Tab Performance di Dashboard Consignment"
    ],
    "sections": [
      {"h": "Fitur Baru", "items": [
        "Site Customer: setiap customer bisa memiliki beberapa site (dengan gudang), diatur dari Master Customer.",
        "Tab Performance di Dashboard Consignment, termasuk grafik lead time."
      ]},
      {"h": "Peningkatan", "items": [
        "Pilihan Site di SO Consignment dan Gudang Tujuan di IK kini difilter sesuai customer.",
        "Perapihan lebar dialog di berbagai halaman."
      ]}
    ]
  },
  {
    "date": "2026-10-05",
    "title": "Tampilan Login Baru & Periodic Maintenance",
    "highlights": [
      "Tampilan halaman Login & Daftar baru",
      "Modul Periodic Maintenance unit (HM)",
      "Forecast kebutuhan part AC",
      "Balas komentar di Update Web"
    ],
    "sections": [
      {"h": "Fitur Baru", "items": [
        "Periodic Maintenance: pencatatan jadwal & penggantian part berdasarkan HM unit, stok terhubung ke Master Barang dan dipotong saat penggantian.",
        "Forecast AC: perkiraan kebutuhan part AC service per model unit.",
        "Komentar di Update Web sekarang bisa dibalas."
      ]},
      {"h": "Peningkatan", "items": [
        "Tampilan baru halaman Login dan Daftar, dengan slideshow dan logo perusahaan grup."
      ]}
    ]
  }
]
$json$;
BEGIN
  SELECT ur.user_id INTO v_author
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE r.name IN ('moderator', 'it')
  GROUP BY ur.user_id
  HAVING COUNT(DISTINCT r.name) = 2
  LIMIT 1;

  SELECT version_major, version_minor, version_patch
    INTO v_major, v_minor, v_patch
  FROM public.update_web_posts
  ORDER BY version_major DESC, version_minor DESC, version_patch DESC
  LIMIT 1;

  FOR v_post IN SELECT value FROM jsonb_array_elements(v_posts) LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.update_web_posts WHERE title = v_post->>'title'
    );

    IF v_major IS NULL THEN
      v_major := 1; v_minor := 0; v_patch := 0;
    ELSE
      v_patch := v_patch + 1;
    END IF;

    SELECT jsonb_build_object('type', 'doc', 'content', jsonb_agg(block ORDER BY s_ord, b_ord))
      INTO v_content
    FROM (
      SELECT s.ord AS s_ord, 1 AS b_ord, jsonb_build_object(
        'type', 'heading',
        'attrs', jsonb_build_object('level', 2),
        'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', s.sec->>'h'))
      ) AS block
      FROM jsonb_array_elements(v_post->'sections') WITH ORDINALITY AS s(sec, ord)
      UNION ALL
      SELECT s.ord, 2, jsonb_build_object(
        'type', 'bulletList',
        'content', (
          SELECT jsonb_agg(jsonb_build_object(
            'type', 'listItem',
            'content', jsonb_build_array(jsonb_build_object(
              'type', 'paragraph',
              'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', i.item #>> '{}'))
            ))
          ) ORDER BY i.ord)
          FROM jsonb_array_elements(s.sec->'items') WITH ORDINALITY AS i(item, ord)
        )
      )
      FROM jsonb_array_elements(v_post->'sections') WITH ORDINALITY AS s(sec, ord)
    ) blocks;

    INSERT INTO public.update_web_posts (
      version_major, version_minor, version_patch,
      title, highlights, content, created_by, created_at, updated_at
    ) VALUES (
      v_major, v_minor, v_patch,
      v_post->>'title',
      v_post->'highlights',
      v_content,
      v_author,
      ((v_post->>'date') || ' 17:00:00+07')::timestamptz,
      ((v_post->>'date') || ' 17:00:00+07')::timestamptz
    );
  END LOOP;
END $$;

-- Verifikasi:
-- SELECT version, title, created_at, jsonb_array_length(highlights) AS n_highlight
-- FROM public.update_web_posts ORDER BY created_at;
