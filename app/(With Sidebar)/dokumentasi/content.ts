// Isi halaman /dokumentasi. Dipisah dari page.tsx supaya teks panduan mudah
// diperbarui tanpa menyentuh tata letak. Bahasa: formal, singkat, hindari
// istilah teknis. Kalau alur di aplikasi berubah, perbarui juga di sini.

export type FlowStep = {
  /** Nama singkat di diagram alur. */
  short: string;
  title: string;
  /** Siapa yang biasanya mengerjakan. */
  who: string;
  /** Hal yang perlu diisi / dilakukan. */
  input: string[];
  /** Pengaruh ke stok; kosong = tidak mengubah stok. */
  stock?: { kind: "in" | "out" | "move"; text: string };
  url?: string;
};

export type Flow = {
  key: string;
  label: string;
  summary: string;
  steps: FlowStep[];
  notes?: string[];
};

export const gettingStarted = [
  {
    title: "Aktifkan Akun",
    desc: "Setelah mendaftar, akun menunggu aktivasi. Administrator menetapkan cabang, jabatan (role), dan NRP Anda.",
  },
  {
    title: "Buat Tanda Tangan",
    desc: "Buka Signature Manager, gambar tanda tangan, lalu buat password khusus tanda tangan. Wajib sebelum mengajukan atau menyetujui dokumen.",
    url: "/signatures",
  },
  {
    title: "Cek Notifikasi",
    desc: "Dokumen yang menunggu persetujuan Anda muncul di tab \"Perlu Tindakan\" pada halaman Notifikasi.",
    url: "/notifications",
  },
  {
    title: "Cari Cepat",
    desc: "Tekan Ctrl + K (Windows) atau ⌘ + K (Mac) untuk mencari nomor dokumen, part number, atau menu.",
  },
];

export const glossary: { term: string; meaning: string }[] = [
  { term: "MR", meaning: "Material Request — permintaan barang dari site/cabang." },
  { term: "PR", meaning: "Purchase Request — permintaan pembelian, dibuat dari MR." },
  { term: "PO", meaning: "Purchase Order — pesanan resmi ke vendor." },
  { term: "RI", meaning: "Receive Item — pencatatan barang dari vendor yang sudah tiba." },
  { term: "IT", meaning: "Item Transfer — pengiriman barang antar gudang." },
  { term: "Share Stock", meaning: "Memenuhi MR dengan stok milik cabang lain, dikirim lewat Delivery." },
  { term: "SPB", meaning: "Surat Permintaan Barang — barang keluar untuk proyek/unit." },
  { term: "SO / DO", meaning: "Sales Order (pesanan customer) / Delivery Order (surat jalan ke customer)." },
  { term: "IK", meaning: "Invoice Konsinyasi — pengiriman barang titipan ke site customer." },
  { term: "GR", meaning: "Goods Receipt — penerimaan barang titipan dari vendor." },
  { term: "PN", meaning: "Part Number — kode unik barang." },
  { term: "Alur Approval", meaning: "Urutan orang yang harus menyetujui dokumen, dipilih saat membuat dokumen." },
];

export const flows: Flow[] = [
  {
    key: "pengadaan",
    label: "Pengadaan",
    summary:
      "Alur utama saat site membutuhkan barang: diminta lewat MR, dipenuhi dari stok cabang lain (Share Stock) atau dibeli (PR → PO → RI).",
    steps: [
      {
        short: "MR",
        title: "Buat Material Request",
        who: "Admin site / Service",
        input: [
          "Nomor dokumen, tanggal, due date, kategori, dan lokasi site.",
          "Daftar barang (PN) beserta qty dan prioritas per item.",
          "Pilih alur approval, lalu konfirmasi dengan tanda tangan.",
        ],
        url: "/mr/create",
      },
      {
        short: "Approval",
        title: "Persetujuan & Alokasi",
        who: "Approver sesuai alur",
        input: [
          "Approver menyetujui berurutan; hanya bisa saat giliran Anda.",
          "Approver terakhir membagi qty tiap item: Share Stock (stok cabang lain) atau PR (beli baru).",
          "Bila memilih Share Stock, deadline pengiriman wajib diisi.",
          "Item yang tidak diperlukan dapat ditolak per item dengan keterangan.",
        ],
        url: "/notifications",
      },
      {
        short: "PR",
        title: "Buat Purchase Request",
        who: "PPIC / Purchasing",
        input: [
          "Cari MR yang sudah disetujui, centang item yang akan dibeli.",
          "Qty boleh melebihi MR, tetapi keterangan wajib diisi.",
          "Pilih alur approval.",
        ],
        url: "/pr/create",
      },
      {
        short: "PO",
        title: "Buat Purchase Order",
        who: "Purchasing",
        input: [
          "Pilih PR, centang item, tentukan vendor dan harga.",
          "Atur pajak (PPN/PPh), diskon, ongkir, dan mata uang bila perlu.",
          "Pilih gudang penerima dan alur approval.",
        ],
        url: "/po/create",
      },
      {
        short: "RI",
        title: "Terima Barang (Receive Item)",
        who: "Warehouse",
        input: [
          "Pilih PO, isi qty yang benar-benar diterima.",
          "Pilih gudang penerima untuk setiap item.",
          "Pilih alur approval.",
        ],
        stock: { kind: "in", text: "Stok gudang penerima bertambah setelah approval terakhir." },
        url: "/receive/create",
      },
      {
        short: "IT",
        title: "Kirim ke Site (Item Transfer)",
        who: "Warehouse",
        input: [
          "Gunakan \"Cari dari RI\" agar qty tercatat sebagai pemenuhan MR.",
          "Isi gudang asal, gudang tujuan, ekspedisi, dan detail koli.",
          "Setelah barang tiba, penerima menekan Terima (finalisasi).",
        ],
        stock: {
          kind: "move",
          text: "Keluar dari gudang asal saat disetujui, masuk ke gudang tujuan saat diterima.",
        },
        url: "/item-transfer/create",
      },
    ],
    notes: [
      "Jika barang langsung diterima di gudang site peminta, MR otomatis terpenuhi tanpa perlu IT.",
      "Jalur Share Stock: MR muncul di menu Share Stock, lalu cabang pemilik stok membuat Delivery.",
      "Bila deadline Share Stock terlewat dan belum ada pengiriman, MR dibekukan (Freeze). Hanya moderator yang dapat membukanya.",
    ],
  },
  {
    key: "pengiriman",
    label: "Pengiriman Antar Gudang",
    summary:
      "Dua dokumen untuk memindahkan barang antar gudang. Delivery khusus pemenuhan Share Stock; Item Transfer untuk pemindahan lain.",
    steps: [
      {
        short: "Delivery",
        title: "Delivery (Share Stock)",
        who: "Warehouse cabang pemilik stok",
        input: [
          "Pilih item MR yang dialokasikan ke Share Stock.",
          "Isi cabang asal, cabang tujuan, PIC, penerima, ekspedisi, dan tanda tangan pengirim.",
        ],
        stock: { kind: "out", text: "Stok cabang asal berkurang saat Delivery disimpan." },
        url: "/deliveries/create",
      },
      {
        short: "Tracking",
        title: "Perbarui Status Pengiriman",
        who: "Pengirim / penerima",
        input: ["Perbarui status perjalanan barang (dikemas, dikirim, tiba) agar mudah dipantau."],
      },
      {
        short: "Terima",
        title: "Finalisasi oleh Penerima",
        who: "Warehouse tujuan",
        input: ["Setelah barang tiba dan dicek, penerima menekan Terima dengan tanda tangan."],
        stock: { kind: "in", text: "Stok cabang tujuan bertambah; qty MR ikut terpenuhi." },
      },
    ],
    notes: [
      "Selama perjalanan, barang tampil di menu \"Barang dalam Pengiriman\".",
      "Ekspedisi wajib mengisi layanan kurir, rate per kg, dan berat koli. Estimasi biaya dihitung otomatis.",
    ],
  },
  {
    key: "spb",
    label: "Stock Out Project",
    summary:
      "Pengeluaran barang untuk proyek/unit customer, dilanjutkan dengan dokumen PO customer, DO, dan Invoice.",
    steps: [
      {
        short: "SPB",
        title: "Buat SPB",
        who: "Admin site",
        input: [
          "Isi tanggal, PIC, section, kode unit, tipe unit, brand, dan HM.",
          "Tambahkan part dan qty, pilih template tanda tangan.",
          "Untuk barang titipan vendor, aktifkan Konsinyasi dan pilih vendor.",
        ],
        stock: { kind: "out", text: "Stok cabang SPB berkurang saat SPB disimpan." },
        url: "/spb/create",
      },
      {
        short: "PO",
        title: "Lampirkan PO Customer",
        who: "Admin",
        input: ["Pilih satu atau beberapa SPB, isi nomor PO dari customer."],
        url: "/spb/po",
      },
      {
        short: "DO",
        title: "Buat Delivery Order",
        who: "Admin",
        input: ["Pilih SPB-PO yang akan dikirim dan isi data DO."],
        url: "/spb/do",
      },
      {
        short: "Invoice",
        title: "Buat Invoice",
        who: "Admin",
        input: ["Pilih DO, isi data invoice, lalu proses approval.", "Status pembayaran diperbarui oleh Finance di Report SPB."],
        url: "/spb/invoice",
      },
      {
        short: "Return",
        title: "Return SPB (bila ada)",
        who: "Admin site",
        input: ["Pilih SPB, isi qty yang dikembalikan, tanggal, dan alur approval."],
        stock: { kind: "in", text: "Stok kembali bertambah setelah approval selesai." },
        url: "/return-spb/create",
      },
    ],
    notes: ["Seluruh progres SPB dapat dipantau dan difilter per kolom di menu Report SPB."],
  },
  {
    key: "so",
    label: "SO Reguler",
    summary:
      "Penjualan ke customer. SO tidak memerlukan approval; barang dipenuhi dari stok (DO Reguler) atau pembelian (PO dari SO).",
    steps: [
      {
        short: "SO",
        title: "Buat SO Reguler",
        who: "Marketing",
        input: [
          "Pilih customer, kategori (Kontrak / Repeat Order / Quotation / Instalasi).",
          "Isi nomor & tanggal PO customer bila ada, lalu daftar barang.",
        ],
        url: "/so-reguler/so/create",
      },
      {
        short: "PO",
        title: "Beli Barang (bila stok kurang)",
        who: "Purchasing",
        input: ["Buat PO dengan jenis SO, pilih SO dan gudang penerima. Qty dibatasi sisa SO."],
        url: "/po/create",
      },
      {
        short: "DO",
        title: "Kirim dengan DO Reguler",
        who: "Warehouse",
        input: ["Pilih SO (opsional), gudang pengirim, qty, dan data ekspedisi."],
        stock: { kind: "out", text: "Stok gudang pengirim berkurang saat DO disimpan." },
        url: "/so-reguler/do/create",
      },
    ],
    notes: ["SO selesai bila seluruh qty sudah dikirim dan semua DO-nya sudah diterima customer."],
  },
  {
    key: "consignment",
    label: "Consignment Customer",
    summary: "Barang GMI dititipkan di site customer dan dipantau per customer.",
    steps: [
      {
        short: "SO",
        title: "SO Consignment",
        who: "Marketing",
        input: ["Pilih customer, site, dan barang. PN customer wajib diisi."],
        url: "/so-reguler/consignment/so/create",
      },
      {
        short: "IK",
        title: "Kirim (Invoice Konsinyasi)",
        who: "Warehouse",
        input: [
          "Pilih SO, gudang asal, dan site tujuan customer.",
          "Isi qty kirim; boleh sebagian. Nomor IK terisi otomatis.",
        ],
        stock: { kind: "out", text: "Stok gudang asal langsung berkurang (tanpa approval)." },
        url: "/so-reguler/consignment/ik/create",
      },
      {
        short: "Penerimaan",
        title: "Konfirmasi Penerimaan",
        who: "Staff (atas konfirmasi customer)",
        input: ["Pilih IK, isi nama penerima dan qty diterima.", "Bila tidak sesuai, tandai Komplain dengan catatan."],
        stock: { kind: "in", text: "Qty diterima masuk ke Stok di Customer." },
        url: "/so-reguler/consignment/penerimaan/create",
      },
    ],
  },
  {
    key: "vendor",
    label: "Konsinyasi Vendor",
    summary: "Barang titipan vendor (AC part) di gudang GMI. Dibayar ke vendor setelah terpakai dan direkonsiliasi.",
    steps: [
      {
        short: "PR",
        title: "PR Konsinyasi",
        who: "PPIC",
        input: ["Pilih vendor dan barang yang diminta untuk dititipkan."],
        url: "/vendor-consignment/pr/create",
      },
      {
        short: "GR",
        title: "Terima Barang Titipan (GR)",
        who: "Warehouse",
        input: ["Pilih PR Konsinyasi, isi no. surat jalan supplier dan qty diterima. Selisih dicatat sebagai komplain."],
        stock: { kind: "in", text: "Masuk ke Stok Konsinyasi (terpisah dari stok GMI)." },
        url: "/vendor-consignment/gr/create",
      },
      {
        short: "IT / SPB",
        title: "Kirim & Pakai",
        who: "Warehouse / Admin site",
        input: ["Buat Item Transfer atau SPB seperti biasa, aktifkan opsi Konsinyasi dan pilih vendor."],
        stock: { kind: "out", text: "Stok Konsinyasi berkurang sesuai dokumen." },
      },
      {
        short: "Rekonsil",
        title: "Rekonsil & BAST",
        who: "Admin + PJO",
        input: ["Pilih site, vendor, dan baris SPB yang terpakai. Cetak BAST sebagai dasar PO ke vendor."],
        url: "/vendor-consignment/rekonsil/create",
      },
    ],
  },
];

export const otherFeatures = [
  {
    name: "Scheduled MR",
    url: "/mr/scheduled",
    desc: "Perencanaan kebutuhan hingga 3 bulan. Due date per item tidak boleh di bulan berjalan; alokasi Share Stock/PR ditentukan saat membuat.",
  },
  {
    name: "PO Non-PR → Job Costing",
    url: "/po/non-pr",
    desc: "Untuk pembelian dengan PN/satuan berbeda dari PR. Barang diterima di gudang Jakarta lalu dikonversi lewat Job Costing.",
  },
  {
    name: "Working Order",
    url: "/working-order",
    desc: "Perintah kerja untuk item MR: pilih referensi MR, gudang WO, dan departemen, lalu proses approval.",
  },
  {
    name: "Request Stok",
    url: "/stock-requests",
    desc: "Bila item tidak bisa ditambahkan ke MR, tekan \"Minta atur stok\". Pengelola stok mengatur min/max di sini.",
  },
  {
    name: "HM Maintenance",
    url: "/maintenance",
    desc: "Jadwal perawatan unit per site. Mencatat penggantian part akan memotong stok gudang unit.",
  },
  {
    name: "Import Data Excel",
    url: "/import",
    desc: "Khusus moderator: unduh template, isi, lalu unggah untuk memasukkan data dalam jumlah banyak.",
  },
];

export const stockMoves: { doc: string; out: string; in: string }[] = [
  { doc: "MR, PR, PO, SO", out: "—", in: "—" },
  { doc: "Receive Item (RI)", out: "—", in: "Gudang penerima, setelah approval terakhir" },
  { doc: "Item Transfer", out: "Gudang asal, setelah approval terakhir", in: "Gudang tujuan, saat diterima" },
  { doc: "Delivery (Share Stock)", out: "Cabang asal, saat disimpan", in: "Cabang tujuan, saat diterima" },
  { doc: "SPB", out: "Cabang SPB, saat disimpan", in: "—" },
  { doc: "Return SPB", out: "—", in: "Cabang SPB, setelah approval selesai" },
  { doc: "DO Reguler", out: "Gudang pengirim, saat disimpan", in: "—" },
  { doc: "IK Konsinyasi", out: "Gudang asal, saat disimpan", in: "Stok di Customer, saat penerimaan" },
  { doc: "GR Konsinyasi", out: "—", in: "Stok Konsinyasi vendor" },
  { doc: "Ganti part (HM)", out: "Gudang unit", in: "—" },
];

export const inputRules = [
  "Periksa nomor dokumen sebelum menyimpan. Nomor SPB, IK, GR, dan Rekonsil terisi otomatis; lainnya diisi sesuai format cabang.",
  "Qty tidak boleh 0. Pastikan PN dan satuan sesuai sebelum menyimpan.",
  "Approval berjalan berurutan. Tombol Setujui hanya muncul saat dokumen sampai di giliran Anda.",
  "Penolakan wajib disertai alasan agar pembuat dokumen dapat memperbaiki.",
  "Dokumen yang sudah menggerakkan stok tidak dapat dihapus sendiri. Hubungi moderator untuk koreksi.",
  "Gunakan dokumen resmi untuk setiap perpindahan barang agar stok dan riwayat tetap akurat.",
];

export const faqs: { q: string; a: string }[] = [
  {
    q: "Muncul halaman \"Akun Belum Aktif\"",
    a: "Akun Anda belum diaktifkan. Hubungi administrator untuk penetapan cabang, role, dan NRP.",
  },
  {
    q: "Tombol Setujui tidak muncul",
    a: "Pastikan dokumen masih berstatus Open, approver sebelumnya sudah menyetujui, dan nama Anda tercantum pada langkah berikutnya di alur approval.",
  },
  {
    q: "Diminta tanda tangan, tetapi daftar kosong",
    a: "Buat tanda tangan terlebih dahulu di Signature Manager. Password yang diminta adalah password khusus tanda tangan, bukan password login.",
  },
  {
    q: "Barang tidak bisa ditambahkan ke MR",
    a: "Batas stok (min/max) barang tersebut belum diatur atau sudah tercapai. Tekan \"Minta atur stok\" pada notifikasi yang muncul.",
  },
  {
    q: "Pilihan \"Alur Approval\" kosong",
    a: "Belum ada template approval untuk jenis dokumen dan cabang Anda. Hubungi admin/moderator untuk membuatkannya.",
  },
  {
    q: "MR berstatus Freeze",
    a: "Deadline Share Stock terlewat dan belum ada pengiriman. Hubungi moderator untuk membuka dan menetapkan deadline baru.",
  },
  {
    q: "Salah input setelah dokumen disimpan",
    a: "Sebagian dokumen (misalnya PO, SO, dan Item Transfer) dapat diedit sesuai hak akses. Bila tombol Edit tidak tersedia, hubungi moderator.",
  },
  {
    q: "Arti status MR OPEN 1 sampai CLOSE 2B",
    a: "OPEN 1: PR belum dibuat · OPEN 2: PO belum dibuat · OPEN 3: menunggu vendor/budget · OPEN 4: dikirim vendor, belum tiba · OPEN 5: sudah di warehouse, belum ke site · CLOSE 1: terkirim sebagian · CLOSE 2: terpenuhi penuh.",
  },
];
