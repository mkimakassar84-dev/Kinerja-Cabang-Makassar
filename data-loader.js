/* ==========================================================================
   DATA LOADER
   Mengambil data dari Google Sheets menggunakan endpoint export CSV publik
   (bukan gviz/tq). Endpoint export CSV mengambil isi sel sebenarnya tanpa
   terpengaruh filter biasa (ikon corong) yang sedang aktif di sheet siapa
   pun yang sedang membukanya — beda dengan gviz/tq yang mengikuti filter
   visual yang tersimpan, sehingga baris yang sedang difilter ikut hilang
   dari hasil publik. Endpoint ini bisa diakses tanpa API key selama sheet
   di-set "Anyone with the link can view". Setiap kali halaman dimuat, data
   ditarik langsung dari Google Sheets sehingga dashboard otomatis ter-update
   mengikuti input baru di spreadsheet, tanpa perlu deploy ulang.

   Struktur tab yang dibaca (hasil inspeksi langsung terhadap spreadsheet).
   Index kolom selalu absolut dari kolom A (0-based), identik dengan posisi
   sel sebenarnya di sheet — ini penting karena calc.js mengakses banyak
   kolom lewat row.__row[index] secara langsung:

   1. Grand Data 2026 (gid 1703817529, header baris 1)
      A Order Date | B No Invoice | C Payment | D Customer | E Kode Barang
      F Quantity | G Amount | H Status (Same Day/Cut Off) | I Company
      J Koli | K Stage | L Status Ekspedisi | M Lokasi (Kab/Kota) | N Tanggal Terkirim

   2. Rev SUM (gid 1062237088, header baris 1, kolom A-E)
      A Payment Date | B No Faktur | C Customer | D Pelunasan | E Company

   3. Sales SUM (gid 1234708655, header baris 1, kolom AS-BB — ringkasan bulanan)
      AS Label Bulan | AT Target Sales/Revenue Bulanan
      AU Label Rev2025 | AV Nominal Rev2025
      AW Label Rev2026 | AX Nominal Rev2026
      AY Label Sales2025 | AZ Nominal Sales2025
      BA Label Sales2026 | BB Nominal Sales2026

   4. KPI MONITORING (gid 64738765, header baris 1, kolom M-Z — rekap wilayah)
      M Kabupaten/Kota | N..Y Jan..Des (invoice unik per bulan) | Z Total

   5. Stock GD MKS (gid 507949843, header baris 2)
      A Kode Barang | B Deskripsi | C Harga Satuan | D Nilai Stock GD
      E MKI Turnover | F CFN Turnover | G MKI&CFN Turnover
      H Stock MKI | I Stock CFN | J Stock MKI&CFN | K (kosong)
      L GD MKI (base stock) | M GD CFN (base stock)
      G Stock MKI | H Stock CFN | I Stock MKI&CFN  (acuan stock hari ini)
      (Kolom K, L diabaikan sesuai instruksi)

   6. PO Gudang (gid 2047354384, header baris 1, kolom A-K)
      A No | B Order Date | C No PO | D Company | E Kode Barang | F Quantity
      G No Surat Jalan | H Status Ekspedisi | I Stage | J Qty Diterima GD MKS
      K Tanggal Masuk GD MKS

   7. AR 2026 (gid 1407414424, header baris 1, kolom posisi absolut L-S)
      A..K (blok lain, diabaikan) | L Tanggal | M No Faktur | N Nama Customer
      O Nilai Faktur | P Sisa Saldo Piutang | Q Aging | R Kategori | S Company
   ========================================================================== */

const SHEET_ID = '1_uou6JDGV-Tm80oALMrduuj9ZIVWM1r9ppuQsYq7_qo';

// Sheet terpisah — sumber data sistem KPI Personel (absensi & kepatuhan
// harian tiap staf cabang). Tab DATA_ARCHIVE tersembunyi di spreadsheet
// aslinya tapi tetap bisa diakses lewat export CSV publik.
const KPI_SHEET_ID = '1WSp2VmHs2LqCD16cMc8JI1l1HHfnP0MAgK-G_kf4Rqw';

const SHEET_TABS = {
  grandData:   { name: 'Grand Data 2026', gid: '1703817529', headerRow: 1 },
  revSum:      { name: 'Rev SUM',         gid: '1062237088', headerRow: 1 },
  salesSum:    { name: 'Sales SUM',       gid: '1234708655', headerRow: 1 },
  kpiMonitor:  { name: 'KPI MONITORING',  gid: '64738765',   headerRow: 1 },
  stock:       { name: 'Stock GD MKS',    gid: '507949843',  headerRow: 2 },
  poGudang:    { name: 'PO Gudang',       gid: '2047354384', headerRow: 1 },
  ar:          { name: 'AR 2026',         gid: '1407414424', headerRow: 1 },
  kpiPersonel: { name: 'DATA_ARCHIVE',    gid: '1890830079', headerRow: 1, sheetId: KPI_SHEET_ID, rawStrings: true },
};

function exportCsvUrl(gid, sheetId = SHEET_ID) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}&_=${Date.now()}`;
}

/**
 * Parser CSV sesuai RFC 4180: menangani field yang dikutip dengan tanda
 * kutip ganda (termasuk yang berisi koma, newline, atau kutip ganda
 * literal yang di-escape sebagai ""). Mengembalikan array of array string.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; i += 2; continue;
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field); rows.push(row); row = []; field = ''; i += 1; continue;
    }
    field += ch; i += 1;
  }
  // Baris/field terakhir tanpa newline penutup
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  return rows;
}

const MONTH_ABBR_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6,
  agu: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11,
};

/**
 * Mengonversi satu nilai sel CSV (selalu berupa string mentah, atau string
 * kosong untuk sel kosong) menjadi tipe data yang sesuai, meniru perilaku
 * gviz lama: tanggal menjadi objek Date, angka (termasuk yang berformat
 * "Rp1,520,000" atau "-Rp1,152,000") menjadi number, sisanya tetap string.
 * Ini penting agar toNumber()/toDate()/toStr() di calc.js — yang sudah
 * punya fast-path untuk tipe number/Date — tetap bekerja tanpa perubahan.
 */
function parseCsvCell(raw) {
  if (raw === undefined || raw === null) return null;
  const v = raw.trim();
  if (v === '') return null;

  // Tanggal format "2-Jan-2026" atau "27-Jun-2026" (D-MMM-YYYY, locale ID/EN campur)
  const dateMatch = v.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const monthAbbr = dateMatch[2].toLowerCase();
    const year = parseInt(dateMatch[3], 10);
    const monthIdx = MONTH_ABBR_MAP[monthAbbr];
    if (monthIdx !== undefined) {
      const d = new Date(year, monthIdx, day);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Angka berformat Rupiah, contoh: "Rp1,520,000", "-Rp1,152,000", "1,520,000", "-4", "123"
  const numMatch = v.match(/^-?(?:Rp)?-?[\d,]+(?:\.\d+)?%?$/);
  if (numMatch) {
    const isPercent = v.endsWith('%');
    const isNegative = v.startsWith('-');
    const digits = v.replace(/[^0-9.]/g, '');
    if (digits !== '') {
      let n = parseFloat(digits);
      if (!isNaN(n)) {
        if (isNegative) n = -n;
        if (isPercent) n = n / 100;
        return n;
      }
    }
  }

  return v;
}

/**
 * Mengambil satu tab sheet (via gid) dan mengembalikan array of object,
 * key sesuai nama header pada headerRow, dengan __row berisi array nilai
 * mentah per kolom (sudah dikonversi tipe) untuk akses by-index — sama
 * persis seperti struktur yang dihasilkan loader gviz sebelumnya.
 */
async function fetchSheetTabRaw(sheetName, gid, headerRow = 1, sheetId = SHEET_ID, rawStrings = false) {
  const url = exportCsvUrl(gid, sheetId);
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    throw new Error(`Gagal menghubungi Google Sheets untuk tab "${sheetName}". Periksa koneksi internet, atau pastikan sheet sudah di-share "Anyone with link can view".`);
  }
  if (!res.ok) {
    throw new Error(`Tab "${sheetName}" tidak ditemukan atau tidak bisa diakses (HTTP ${res.status}).`);
  }
  const text = await res.text();
  if (!text || text.trim() === '') {
    throw new Error(`Tab "${sheetName}" kosong atau tidak ditemukan.`);
  }

  const rawRows = parseCsv(text);
  if (rawRows.length === 0) {
    throw new Error(`Gagal mem-parse data tab "${sheetName}".`);
  }

  // Baris pada index (headerRow - 1) adalah header; baris setelahnya adalah data.
  const headerIdx = headerRow - 1;
  const headerArrRaw = rawRows[headerIdx] || [];
  const headerArr = headerArrRaw.map(h => (h === null || h === undefined) ? '' : String(h).trim());
  const dataRowsRaw = rawRows.slice(headerIdx + 1);

  const dataRowsParsed = dataRowsRaw.map(r => r.map(cell =>
    rawStrings ? (cell === undefined || cell === null ? '' : cell) : parseCsvCell(cell)
  ));

  const rows = dataRowsParsed
    .filter(row => row && row.some(v => v !== null && v !== undefined && v !== ''))
    .map(row => {
      const obj = {};
      headerArr.forEach((h, i) => { if (h) obj[h] = row[i] === undefined ? null : row[i]; });
      obj.__row = row; // simpan array mentah juga untuk akses by-index (kolom tanpa header jelas)
      return obj;
    });

  return { sheetName, header: headerArr, rows };
}

/**
 * Memuat semua tab yang didefinisikan di SHEET_TABS secara paralel.
 * Mengembalikan { data: {...}, errors: [...] }
 */
async function loadAllSheetData() {
  const entries = Object.entries(SHEET_TABS);
  const settled = await Promise.allSettled(
    entries.map(([key, cfg]) => fetchSheetTabRaw(cfg.name, cfg.gid, cfg.headerRow, cfg.sheetId || SHEET_ID, !!cfg.rawStrings))
  );

  const data = {};
  const errors = [];
  settled.forEach((result, idx) => {
    const [key, cfg] = entries[idx];
    if (result.status === 'fulfilled') {
      data[key] = result.value;
    } else {
      errors.push({ sheetName: cfg.name, message: result.reason ? result.reason.message : 'Gagal memuat' });
      data[key] = { sheetName: cfg.name, header: [], rows: [] };
    }
  });

  return { data, errors };
}
