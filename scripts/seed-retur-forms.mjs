// Seed definisi Formulir Inspeksi Material Retur (01-A..01-O) ke tabel retur_form_template.
// Sumber: file contoh Excel dari user (Fromulir_Checklist_Material_Bekas_UID_Bali.xlsx) —
// struktur judul seksi, mata uji, persayaratan, & kesimpulan ditulis ulang persis.
// Jalankan: node scripts/seed-retur-forms.mjs > /tmp/seed.sql  (lalu pipe ke psql STB),
// atau: node scripts/seed-retur-forms.mjs --psql "<psql args>" (langsung).
// Definisi JSONB dibaca: UI input Data Material (buat-tab), kesimpulan (verifikasi-tab),
// dan renderer Cetak Formulir (components/retur/form-xlsx.ts).

const F = (key, label, hint) => ({ key, label, ...(hint ? { hint } : {}) });
const R = (no, label, opts = {}) => ({
  no, label, persyaratan: opts.req ?? "", ket: opts.ket ?? "",
  ...(opts.level ? { level: opts.level } : {}),
  ...(opts.section ? { section: opts.section } : {}),
  ...(opts.parent ? { parent: true } : {}),
  ...(opts.textValue ? { textValue: opts.textValue } : {}),
  ...(opts.satuan ? { satuan: opts.satuan } : {}),
});

// Header kiri formulir — statis sesuai contoh; "UNIT …" sengaja dibiarkan titik-titik
// (ditulis tangan pengawas vendor sesuai arahan user).
const HEADER = { line1: "PT PLN (PERSERO)", line2: "UID BALI", line3: "UNIT …" };
const SIG = { left: "Yang Menyerahkan", right: "PIC Gudang" };
const CORET = (labels) => ({
  mode: "coret",
  options: labels.map((label) => ({ code: label.match(/\((K\d)\)/)[1], label })),
});

const DEFS = {
  "form-01-a-kwh-meter": {
    formCode: "Formulir 01-A",
    title: "FORMULIR INSPEKSI MATERIAL RETUR KWH METER",
    intro: "kWh Meter",
    fields: {
      left: [F("idPelanggan", "ID Pelanggan"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun Produksi")],
      right: [F("tipe", "Tipe kWh Meter"), F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan")],
    },
    sections: [{ kode: "B", judul: "PEMERIKSAAN VISUAL DAN KONSTRUKSI", colL: "BAIK", colR: "RUSAK" }],
    rows: [
      R("1.0", "Masa pakai", { req: "< 5 tahun", textValue: "tahun" }),
      R("2.0", "Kondisi body kWh Meter", { req: "Baik", ket: "termasuk kaca depan meter" }),
      R("3.0", "Kondisi segel meterologi", { req: "Baik" }),
      R("4.0", "Kondisi terminal", { req: "Baik" }),
      R("5.0", "Kondisi stand kWh Meter", { req: "Baik" }),
      R("6.0", "Kondisi cover terminal kWh Meter", { req: "Baik", ket: "tutup terminal dan MCB" }),
      R("7.0", "Kondisi nameplate", { req: "Baik" }),
    ],
    kesimpulan: CORET(["bekas layak pakai (K6)", "masih garansi (K7)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-b-mcb": {
    formCode: "Formulir 01-B",
    title: "FORMULIR INSPEKSI MATERIAL RETUR MCB",
    intro: "MCB",
    fields: {
      left: [F("idPelanggan", "ID Pelanggan"), F("ulp", "Unit Layanan Pelanggan")],
      right: [F("tipe", "Tipe MCB", "1 fasa / 3 fasa* ; .......... A"), F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan")],
    },
    sections: [{ kode: "B", judul: "PEMERIKSAAN VISUAL DAN KONSTRUKSI", colL: "Baik", colR: "Rusak" }],
    rows: [
      R("1.0", "Pengujian ketidakhapusan penandaan", { req: "Baik" }),
      R("2.0", "Pengujian toggle switch", { req: "Baik" }),
      R("3.0", "Pengujian keandalan sekrup, bagian yang menghantar arus dan sambungan", { req: "Baik", ket: "Pengujian dapat dilakukan bersamaan dengan memutar sekrup" }),
      R("4.0", "Pengujian keandalan terminal untuk penghantar luar", { req: "Baik" }),
    ],
    kesimpulan: CORET(["bekas layak pakai (K6)", "masih garansi (K7)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-c-kotak-app": {
    formCode: "Formulir 01-C",
    title: "FORMULIR INSPEKSI MATERIAL RETUR KOTAK APP",
    intro: "Kotak APP",
    fields: {
      left: [F("lokasi", "Lokasi akhir terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun produksi")],
      right: [F("tipe", "Tipe Kotak APP"), F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan")],
    },
    sections: [
      { kode: "B", judul: "PEMERIKSAAN VISUAL", colL: "Ada", colR: "Tidak ada" },
      { kode: "C", judul: "UJI MEKANIK", colL: "Baik", colR: "Tidak baik" },
    ],
    rows: [
      R("1.0", "Nameplate", { req: "Ada dan data lengkap (Nama pabrikan, merek, SN, tipe, IPXX, tegangan dan arus pengenal, tahun pembuatan, dan standar)" }),
      R("2.0", "Kondisi selungkup dan pintu kotak APP (+tutup gembok untuk tipe APP-PTL)", { req: "Tidak ada retak/longgar/karat/cacat lain" }),
      R("3.0", "Kunci pengaman", { req: "Ada dan baik" }),
      R("4.0", "Ventilasi", { req: "Ada dan baik" }),
      R("5.0", "Jendela kaca", { req: "Ada dan baik" }),
      R("6.0", "Kuping pemasang", { req: "Ada dan baik" }),
      R("7.0", "Seal", { req: "Ada dan baik" }),
      R("8.0", "Logo PLN dan tanda peringatan bahaya", { req: "Ada dan baik" }),
      R("9.0", "Kotak kontak", { req: "Ada dan baik" }),
      R("10.0", "Papan montase", { req: "Ada dan baik" }),
      R("11.0", "Rangka dan jendela MCB/MCCB (APP-PL-CB dan APP-PTL)", { req: "Ada dan baik" }),
      R("12.0", "Rel MCB tipe DIN rail (APP-PL-CB dan APP-PTL)", { req: "Ada dan baik" }),
      R("13.0", "Lubang kabel dilengkapi cable gland", { req: "Ada dan baik" }),
      R("14.0", "Busbar fasa R S T (APP-PTL)", { req: "Ada dan baik" }),
      R("15.0", "Busbar netral (APP-PL-CB dan APP-PTL)", { req: "Ada dan baik" }),
      R("16.0", "Insulator busbar (APP-PL-CB dan APP-PTL)", { req: "Ada dan baik" }),
      R("17.0", "Indikator shunt trip (APP-PTL)", { req: "Ada dan baik" }),
      R("18.0", "Saku modem, lubang modem dan topi pelindung antena", { req: "Ada dan baik" }),
      R("1.0", "Pengujian mekanik:", { section: "C", parent: true }),
      R("", "Buka tutup pintu kotak APP 5x", { section: "C", req: "Pintu tetap beroperasi dengan baik", level: 1 }),
    ],
    kesimpulan: CORET(["bekas layak pakai (K6)", "bekas bisa diperbaiki (K7)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-d-cable-power": {
    formCode: "Formulir 01-D",
    title: "FORMULIR INSPEKSI MATERIAL RETUR CABLE POWER",
    intro: "Cable Power",
    fields: {
      left: [F("lokasi", "Lokasi akhir terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunPemasangan", "Tahun pemasangan")],
      right: [F("jenis", "Jenis Cable Power", "LVTIC/NYY/XLPE/MVTIC/…............./ ................. mm2 *)"), F("luasPenampang", "Luas Penampang"), F("panjang", "Panjang")],
    },
    sections: [{ kode: "B", judul: "PENGUJIAN NON ELEKTRIK", colL: "Nilai", colR: "Satuan", nilaiSatuan: true }],
    rows: [
      R("1.0", "Pemeriksaan kondisi visual dan penandaan", { req: "Baik (Tidak Rantas, Tidak Mekar & Isolasi Tidak Rusak)", textValue: "Baik / Rusak *" }),
      R("2.0", "Pengujian dimensi (diameter konduktor)", { req: "+/- 1%", satuan: "mm", ket: "+/- 1% dari diameter standar konduktor" }),
    ],
    kesimpulan: {
      mode: "meter",
      options: [{ code: "K6", label: "bekas layak pakai (K6)", meterKey: "meterLayak" }, { code: "K8", label: "bekas tidak layak pakai (K8)", meterKey: "meterTidakLayak" }],
    },
  },

  "form-01-e-konduktor": {
    formCode: "Formulir 01-E",
    title: "FORMULIR INSPEKSI MATERIAL RETUR KONDUKTOR",
    intro: "Konduktor",
    fields: {
      left: [F("lokasi", "Lokasi akhir terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunPemasangan", "Tahun pemasangan")],
      right: [F("jenis", "Jenis Konduktor", "AAAC/AAAC-S/CCSXT …......... mm2 *)"), F("luasPenampang", "Luas Penampang"), F("panjang", "Panjang")],
    },
    sections: [{ kode: "B", judul: "PENGUJIAN NON ELEKTRIK", colL: "Nilai", colR: "Satuan", nilaiSatuan: true }],
    rows: [
      R("1.0", "Pemeriksaan kondisi visual", { req: "Baik", ket: "Tidak Rantas, Tidak Mekar & Isolasi Tidak Rusak", textValue: "Baik / Rusak *" }),
      R("2.0", "Pengujian dimensi (diameter konduktor)", { req: "+/- 1%", satuan: "mm", ket: "+/- 1% dari diameter standar konduktor" }),
    ],
    note: "Keterangan: Kesesuaian Poin B nomor 1 adalah Mandatory",
    kesimpulan: {
      mode: "meter",
      options: [{ code: "K6", label: "Bekas layak pakai (K6)", meterKey: "meterLayak" }, { code: "K8", label: "Bekas tidak layak pakai (K8)", meterKey: "meterTidakLayak" }],
    },
  },

  "form-01-f-trafo": {
    formCode: "Formulir 01-F",
    title: "FORMULIR INSPEKSI MATERIAL RETUR TRAFO DISTRIBUSI",
    intro: "Trafo Distribusi",
    fields: {
      left: [F("lokasi", "Lokasi akhir terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun produksi")],
      right: [F("tipe", "Tipe Trafo Distribusi"), F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan")],
    },
    sections: [{ kode: "B", judul: "PEMERIKSAAN VISUAL", colL: "Ada", colR: "Tidak ada" }],
    rows: [
      R("1.0", "Nameplate", { req: "Ada" }),
      R("2.0", "Penandaaan Terminal Primer dan Sekunder", { req: "Ada" }),
      R("3.0", "Pengaman tekanan lebih", { req: "Ada" }),
      R("4.0", "Kondisi tangki (ada kebocoran/bengkak/cacat radiator(sirip)/seal top cover rembes)", { req: "Tidak ada" }),
      R("5.0", "Kondisi fisik bushing HV dan LV (ada retak/longgar dari tangki/seal bushing rembes)", { req: "Tidak ada", ket: "*) Rusak pada fasa R/S/T/N" }),
    ],
    kesimpulan: CORET(["bekas layak pakai (K6)", "bekas bisa diperbaiki (K7)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-g-la": {
    formCode: "Formulir 01-G",
    title: "FORMULIR INSPEKSI MATERIAL RETUR LIGHTNING ARRESTER",
    intro: "Lightning Arrester",
    fields: {
      left: [F("lokasi", "Lokasi Akhir Terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun Produksi")],
      right: [F("tipe", "Tipe Lightning Arrester"), F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan")],
    },
    sections: [{ kode: "B", judul: "PEMERIKSAAN VISUAL DAN KONSTRUKSI", colL: "Baik", colR: "Rusak" }],
    rows: [R("1.0", "Pemeriksaan visual / sifat tampak", { req: "Baik" })],
    kesimpulan: CORET(["bekas layak pakai (K6)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-h-fco": {
    formCode: "Formulir 01-H",
    title: "FORMULIR INSPEKSI MATERIAL RETUR FUSE CUT OUT",
    intro: "Fuse Cut Out",
    fields: {
      left: [F("lokasi", "Lokasi Akhir Terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun Produksi")],
      right: [F("tipe", "Tipe Fuse-Cutout"), F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan")],
    },
    sections: [
      { kode: "B", judul: "PEMERIKSAAN PENANDAAN", colL: "Ada", colR: "Tidak ada" },
      { kode: "C", judul: "PEMERIKSAAN KONSTRUKSI DAN KELENGKAPAN KOMPONEN", colL: "Baik", colR: "Rusak" },
    ],
    rows: [
      R("1.0", "Penandaan pada Fuse base", { req: "Ada" }),
      R("2.0", "Penandaan pada Fuse carrier", { req: "Ada" }),
      R("1.0", "Bagian utama fuse cutout:", { section: "C", parent: true }),
      R("a.", "Fuse holder, terdiri dari:", { section: "C", level: 1 }),
      R("-", "Fuse base", { section: "C", req: "Baik", level: 2 }),
      R("-", "Fuse carrier", { section: "C", req: "Baik", level: 2 }),
      R("b.", "Bracket", { section: "C", level: 1 }),
      R("2.0", "Mekanisme kontak", { section: "C", req: "Baik", ket: "Posisi kontak antara fuse carrier dengan fuse base" }),
      R("3.0", "Fuse base", { section: "C", req: "Baik" }),
      R("4.0", "Kondisi Insulator", { section: "C", req: "Baik", ket: "Bebas retak dan rongga (void)" }),
      R("5.0", "Bracket", { section: "C", req: "Baik" }),
      R("6.0", "Fuse carrier", { section: "C", req: "Baik", ket: "Terdiri dari tabung pelebur, konektor tabung pelebur, kepala tabung, dan trunnion" }),
    ],
    kesimpulan: CORET(["bekas layak pakai (K6)", "bekas bisa diperbaiki (K7)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-i-isolator": {
    formCode: "Formulir 01-I",
    title: "FORMULIR INSPEKSI MATERIAL RETUR ISOLATOR",
    intro: "Isolator",
    fields: {
      left: [F("lokasi", "Lokasi Akhir Terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun Produksi")],
      right: [F("tipe", "Tipe Isolator", "Pin / Pin Post / Line post / Suspension"), F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan")],
    },
    sections: [{ kode: "B", judul: "PEMERIKSAAN VISUAL DAN KONSTRUKSI", colL: "Baik", colR: "Rusak" }],
    rows: [
      R("1.0", "Pengujian visual / sifat tampak", { req: "Baik" }),
      R("a.", "Perubahan warna", { req: "Baik", level: 1 }),
      R("b.", "Tidak pecah", { req: "Baik", level: 1 }),
      R("c.", "Gores permukaan", { req: "Baik", level: 1 }),
      R("d.", "Korosi", { req: "Baik", level: 1 }),
    ],
    kesimpulan: CORET(["bekas layak pakai (K6)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-j-cubicle": {
    formCode: "Formulir 01-J",
    title: "FORMULIR INSPEKSI MATERIAL RETUR PHBTM / CUBICLE",
    intro: "PHBTM/Cubicle",
    fields: {
      left: [F("lokasi", "Lokasi akhir terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun produksi")],
      right: [F("tipe", "Tipe PHBTM / Cubicle"), F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan")],
    },
    sections: [
      { kode: "B", judul: "PEMERIKSAAN VISUAL", colL: "Ada", colR: "Tidak ada" },
      { kode: "C", judul: "PENGUJIAN MEKANIK", colL: "Baik", colR: "Tidak Baik" },
    ],
    rows: [
      R("1.0", "Nameplate", { req: "Ada" }),
      R("2.0", "Kelengkapan peralatan/komponen", { req: "Ada" }),
      R("3.0", "Busbar dan penyangga busbar", { req: "Ada" }),
      R("4.0", "Kondisi pembumian dan kelengkapannya", { req: "Ada" }),
      R("5.0", "Kondisi selungkup untuk PHBTM (ada retak/longgar dari selungkup)", { req: "Tidak ada" }),
      R("1.0", "Pengujian mekanik:", { section: "C", parent: true }),
      R("", "Pengujian operasi LBS & ES (torsi/manual)", { section: "C", req: "Baik", level: 1 }),
      R("", "Pengujian interlock mekanik", { section: "C", req: "Baik", level: 1 }),
    ],
    kesimpulan: CORET(["bekas layak pakai (K6)", "bekas bisa diperbaiki (K7)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-k-phbtr": {
    formCode: "Formulir 01-K",
    title: "FORMULIR INSPEKSI MATERIAL RETUR PHBTR",
    intro: "PHBTR",
    fields: {
      left: [F("lokasi", "Lokasi akhir terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun produksi")],
      right: [F("tipe", "Tipe PHBTR"), F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan")],
    },
    sections: [
      { kode: "B", judul: "PEMERIKSAAN VISUAL", colL: "Ada", colR: "Tidak ada" },
      { kode: "C", judul: "PENGUJIAN MEKANIK", colL: "Baik", colR: "Tidak Baik" },
    ],
    rows: [
      R("1.0", "Nameplate", { req: "Ada" }),
      R("2.0", "Busbar dan penyangga busbar", { req: "Ada" }),
      R("3.0", "Saklar utama", { req: "Ada" }),
      R("4.0", "NH Fuse", { req: "Ada" }),
      R("5.0", "Fuse Rail", { req: "Ada" }),
      R("6.0", "Kondisi selungkup untuk PHBTR pasangan luar (ada retak/longgar dari selungkup)", { req: "Tidak ada" }),
      R("1.0", "Pengujian mekanik:", { section: "C", parent: true }),
      R("a)", "Buka tutup saklar utama 5x", { section: "C", req: "Saklar tetap beroperasi dengan baik", level: 1 }),
      R("b)", "Buka tutup pintu PHBTR untuk pasangan luar 5x", { section: "C", req: "Pintu tetap beroperasi dengan baik", level: 1 }),
    ],
    note: "Keterangan: Kesesuaian seluruh mata uji poin D adalah mandatory.",
    kesimpulan: CORET(["bekas layak pakai (K6)", "bekas bisa diperbaiki (K7)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-l-ct": {
    formCode: "Formulir 01-L",
    title: "FORMULIR INSPEKSI MATERIAL RETUR TRAFO ARUS (CT)",
    intro: "Trafo Arus",
    fields: {
      left: [F("lokasi", "Lokasi akhir terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun produksi"), F("tipe", "Tipe Trafo Arus", "Indoor / Outdoor")],
      right: [F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan"), F("rasio", "Rasio"), F("kelasPengukuran", "Kelas Pengukuran"), F("kelasProteksi", "Kelas Proteksi")],
    },
    sections: [{ kode: "B", judul: "PEMERIKSAAN VISUAL", colL: "Ada", colR: "Tidak ada" }],
    rows: [
      R("1.0", "Retak pada resin", { req: "Tidak ada", ket: "Periksa secara visual ada atau tidak item yang diperiksa" }),
      R("2.0", "Nameplate", { req: "Ada" }),
      R("3.0", "Penandaaan Terminal Primer dan Sekunder", { req: "Ada" }),
      R("4.0", "Terminal Primer", { req: "Ada" }),
      R("5.0", "Terminal Sekunder", { req: "Ada" }),
      R("4.0", "Kelengkapan Baut Terminal Primer", { req: "Ada" }),
      R("5.0", "Kelengkapan Baut Terminal Sekunder", { req: "Ada" }),
      R("6.0", "Cover terminal sekunder", { req: "Ada" }),
    ],
    kesimpulan: CORET(["bekas layak pakai (K6)", "bekas bisa diperbaiki (K7)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-m-pt": {
    formCode: "Formulir 01-M",
    title: "FORMULIR INSPEKSI MATERIAL RETUR TRAFO TEGANGAN (PT)",
    intro: "Trafo Tegangan",
    fields: {
      left: [F("lokasi", "Lokasi akhir terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun produksi"), F("tipe", "Tipe Trafo Tegangan", "Indoor / Outdoor")],
      right: [F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan"), F("rasioTegangan", "Rasio Tegangan")],
    },
    sections: [{ kode: "B", judul: "PEMERIKSAAN VISUAL", colL: "Ada", colR: "Tidak ada" }],
    rows: [
      R("1.0", "Retak pada resin", { req: "Tidak ada", ket: "Periksa secara visual ada atau tidak item yang diperiksa" }),
      R("2.0", "Nameplate", { req: "Ada" }),
      R("3.0", "Penandaaan Terminal Primer dan Sekunder", { req: "Ada" }),
      R("4.0", "Terminal Primer", { req: "Ada" }),
      R("5.0", "Terminal Sekunder", { req: "Ada" }),
      R("4.0", "Kelengkapan Baut Terminal Primer", { req: "Ada" }),
      R("5.0", "Kelengkapan Baut Terminal Sekunder", { req: "Ada" }),
      R("6.0", "Cover terminal sekunder", { req: "Ada" }),
    ],
    kesimpulan: CORET(["bekas layak pakai (K6)", "bekas bisa diperbaiki (K7)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-n-lbs": {
    formCode: "Formulir 01-N",
    title: "FORMULIR INSPEKSI MATERIAL RETUR LBS",
    intro: "LBS",
    fields: {
      left: [F("lokasi", "Lokasi akhir terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun produksi")],
      right: [F("tipe", "Tipe LBS", "Vacuum/SF6 *)"), F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan")],
    },
    sections: [
      { kode: "B", judul: "PEMERIKSAAN VISUAL", colL: "Ada", colR: "Tidak ada" },
      { kode: "C", judul: "PENGUJIAN MEKANIK", colL: "Berhasil", colR: "Gagal" },
    ],
    rows: [
      R("1.0", "Papan nama", { req: "Ada", ket: "Periksa secara visual ada atau tidak item yang diperiksa" }),
      R("2.0", "Penandaan Terminal", { req: "Ada" }),
      R("3.0", "Counter mekanis LBS", { req: "Ada" }),
      R("4.0", "Kondisi fisik bushing HV (ada retak/longgar dari tangki/seal bushing rembes)", { req: "Tidak ada" }),
      R("5.0", "Indikator posisi LBS", { req: "Ada" }),
      R("6.0", "Fisik RTU", { req: "Ada" }),
      R("7.0", "Indikator kegagalan interuptor pada vacuum atau Indikator low pressure pada gas SF6", { req: "Tidak ada" }),
      R("1.0", "Buka tutup switch secara manual 5 x", { section: "C", req: "Berhasil" }),
      R("2.0", "Buku tutup switch dengan panel kontrol 5 x", { section: "C", req: "Berhasil" }),
    ],
    kesimpulan: CORET(["bekas layak pakai (K6)", "bekas bisa diperbaiki (K7)", "bekas tidak layak pakai (K8)"]),
  },

  "form-01-o-tiang-listrik": {
    formCode: "Formulir 01-O",
    title: "FORMULIR INSPEKSI MATERIAL RETUR TIANG LISTRIK",
    intro: "Tiang Listrik",
    fields: {
      left: [F("lokasi", "Lokasi Akhir Terpasang"), F("ulp", "Unit Layanan Pelanggan"), F("tahunProduksi", "Tahun Produksi")],
      right: [F("tipe", "Tipe Tiang Listrik", "Baja / Beton / ….................................*)"), F("sn", "No Serial"), F("pabrikan", "Nama Pabrikan")],
    },
    sections: [
      { kode: "B", judul: "PEMERIKSAAN VISUAL", colL: "Baik", colR: "Rusak" },
      { kode: "C", judul: "PENGUJIAN DIMENSI", colL: "Meter", colR: "daN" },
      { kode: "D", judul: "PENGUJIAN KONSTRUKSI", colL: "Baik", colR: "Rusak" },
    ],
    rows: [
      R("1.0", "Pengujian visual / sifat tampak", { req: "Baik", ket: "Jika Tiang Baja terdapat karatan ringan tanpa keropos, maka dapat diperbaiki (cat ulang)" }),
      R("1.0", "Panjang", { section: "C", req: "Sesuai Standar", ket: "Beban kerja (daN) diisi jika masih ada di penandaan tiang" }),
      R("1.0", "Kelurusan Tiang", { section: "D", req: "Baik" }),
      R("2.0", "Kualitas penyambungan", { section: "D", req: "Baik", ket: "untuk tiang listrik baja" }),
    ],
    kesimpulan: CORET(["bekas layak pakai (K6)", "bekas bisa diperbaiki (K7)", "bekas tidak layak pakai (K8)"]),
  },
};

// Header & blok tanda tangan identik di semua formulir — disuntik ke tiap definition.
for (const def of Object.values(DEFS)) {
  def.header = HEADER;
  def.signature = SIG;
  def.legend = [
    { mark: "✓", label: "sesuai" },
    { mark: "✗", label: "tidak sesuai" },
  ];
  def.coretNote = "coret yang tidak diperlukan";
}

const NAMES = Object.fromEntries(
  Object.entries(DEFS).map(([key, def]) => [key, `${def.formCode} — ${def.title.replace("FORMULIR INSPEKSI MATERIAL RETUR ", "")}`]),
);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(DEFS, null, 2));
} else {
  const out = ["-- Auto-generated oleh scripts/seed-retur-forms.mjs — jangan diedit manual.", "BEGIN;"];
  for (const [key, def] of Object.entries(DEFS)) {
    const j = JSON.stringify(def).replace(/'/g, "''");
    const n = NAMES[key].replace(/'/g, "''");
    out.push(
      `INSERT INTO retur_form_template (form_key, name, definition, updated_at) VALUES ('${key}', '${n}', '${j}'::jsonb, NOW()) ON CONFLICT (form_key) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = NOW();`,
    );
  }
  out.push("COMMIT;", "-- Verifikasi: SELECT form_key, name FROM retur_form_template ORDER BY form_key;");
  console.log(out.join("\n"));
}
