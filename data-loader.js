/* ==========================================================================
   DATA LOADER
   Mengambil data dari Google Sheets menggunakan endpoint publik gviz/tq.
   Endpoint ini bisa diakses tanpa API key selama sheet di-set "Anyone with
   the link can view". Setiap kali halaman dimuat, data ditarik langsung
   dari Google Sheets sehingga dashboard otomatis ter-update mengikuti
   input baru di spreadsheet, tanpa perlu deploy ulang.

   Struktur tab yang dibaca (hasil inspeksi langsung terhadap spreadsheet):

   1. Grand Data 2026 (header baris 1)
      A Order Date | B No Invoice | C Payment | D Customer | E Kode Barang
      F Quantity | G Amount | H Status (Same Day/Cut Off) | I Company
      J Koli | K Stage | L Status Ekspedisi | M Lokasi (Kab/Kota) | N Tanggal Terkirim

   2. Rev SUM (header baris 1, kolom A-E)
      A Payment Date | B No Faktur | C Customer | D Pelunasan | E Company

   3. Sales SUM (header baris 1, kolom AS-BB — ringkasan bulanan)
      AS Label Bulan | AT Target Sales/Revenue Bulanan
      AU Label Rev2025 | AV Nominal Rev2025
      AW Label Rev2026 | AX Nominal Rev2026
      AY Label Sales2025 | AZ Nominal Sales2025
      BA Label Sales2026 | BB Nominal Sales2026

   4. KPI MONITORING (header baris 1, kolom M-Z — rekap wilayah)
      M Kabupaten/Kota | N..Y Jan..Des (invoice unik per bulan) | Z Total

   5. Stock GD MKS (header baris 1)
      A Jenis Barang | B Kode Barang | C Deskripsi
      D MKI Turnover | E CFN Turnover | F MKI&CFN Turnover
      G Stock MKI | H Stock CFN | I Stock MKI&CFN  (acuan stock hari ini)
      (Kolom K, L diabaikan sesuai instruksi)

   6. PO Gudang (header baris 1, kolom A-K)
      A No | B Order Date | C No PO | D Company | E Kode Barang | F Quantity
      G No Surat Jalan | H Status Ekspedisi | I Stage | J Qty Diterima GD MKS
      K Tanggal Masuk GD MKS

   7. AR 2026 (header baris 1, kolom posisi relatif L-S di sheet asli,
      namun saat dibaca via gviz tab ini hanya berisi kolom-kolom tsb)
      A Tanggal | B No Faktur | C Nama Customer | D Nilai Faktur
      E Sisa Saldo Piutang | F Paid Amount | G Aging | H Kategori
      I Status | J Company
   ========================================================================== */

const SHEET_ID = '1_uou6JDGV-Tm80oALMrduuj9ZIVWM1r9ppuQsYq7_qo';

const SHEET_TABS = {
  grandData:  { name: 'Grand Data 2026', headerRow: 1 },
  revSum:     { name: 'Rev SUM',         headerRow: 1 },
  salesSum:   { name: 'Sales SUM',       headerRow: 1 },
  kpiMonitor: { name: 'KPI MONITORING',  headerRow: 1 },
  stock:      { name: 'Stock GD MKS',    headerRow: 2 },
  poGudang:   { name: 'PO Gudang',       headerRow: 1 },
  ar:         { name: 'AR 2026',         headerRow: 1 },
};

function gvizUrl(sheetName) {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`;
  return `${base}?sheet=${encodeURIComponent(sheetName)}&tqx=out:json&_=${Date.now()}`;
}

/**
 * Parse satu cell dari format respons gviz Google Visualization API.
 * Untuk tanggal, gviz mengirim string seperti "Date(2026,0,2)" (bulan 0-based).
 */
function parseGvizCell(cell) {
  if (!cell) return null;
  if (cell.v === null || cell.v === undefined) return null;
  if (typeof cell.v === 'string' && cell.v.startsWith('Date(')) {
    const parts = cell.v.replace('Date(', '').replace(')', '').split(',').map(Number);
    return new Date(parts[0], parts[1], parts[2] || 1);
  }
  return cell.v;
}

/**
 * Mengambil satu tab sheet dan mengembalikan array of object,
 * key sesuai nama header pada headerRow.
 */
async function fetchSheetTabRaw(sheetName, headerRow = 1) {
  const url = gvizUrl(sheetName);
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
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) {
    throw new Error(`Format respons tidak dikenali untuk tab "${sheetName}". Sheet mungkin belum dibagikan secara publik.`);
  }
  let json;
  try {
    json = JSON.parse(match[1]);
  } catch (e) {
    throw new Error(`Gagal mem-parse data tab "${sheetName}".`);
  }
  if (json.status === 'error') {
    const msg = (json.errors && json.errors[0] && json.errors[0].detailed_message) || 'unknown error';
    throw new Error(`Google Sheets menolak permintaan untuk tab "${sheetName}": ${msg}`);
  }

  const table = json.table;
  const dataRowsRaw = table.rows || [];

  // PENTING: table.cols (label kolom bawaan gviz) sering kosong ("") untuk
  // sheet dengan baris pertama berupa merged cell, tanggal, atau campuran
  // tipe data — ini terjadi pada beberapa sheet di spreadsheet ini (Stock GD
  // MKS, KPI Monitoring). Karena itu table.cols TIDAK dipakai sebagai sumber
  // header. Sebagai gantinya, dataRowsRaw dianggap merepresentasikan baris
  // sheet asli mulai dari baris 1 secara berurutan, dan header diambil dari
  // baris ke-N (headerRow) sesuai posisi visualnya di Google Sheets.
  const allSheetRowsArr = [];
  dataRowsRaw.forEach(r => {
    const arr = [];
    if (r && r.c) r.c.forEach((cell, i) => { arr[i] = parseGvizCell(cell); });
    allSheetRowsArr.push(arr);
  });

  const headerIdx = headerRow - 1;
  const headerArrRaw = allSheetRowsArr[headerIdx] || [];
  const headerArr = headerArrRaw.map(h => (h === null || h === undefined) ? '' : String(h).trim());

  const dataRows = allSheetRowsArr.slice(headerIdx + 1)
    .filter(row => row && row.some(v => v !== null && v !== undefined && v !== ''))
    .map(row => {
      const obj = {};
      headerArr.forEach((h, i) => { if (h) obj[h] = row[i] === undefined ? null : row[i]; });
      obj.__row = row; // simpan array mentah juga untuk akses by-index (kolom tanpa header jelas)
      return obj;
    });

  return { sheetName, header: headerArr, rows: dataRows };
}

/**
 * Memuat semua tab yang didefinisikan di SHEET_TABS secara paralel.
 * Mengembalikan { data: {...}, errors: [...] }
 */
async function loadAllSheetData() {
  const entries = Object.entries(SHEET_TABS);
  const settled = await Promise.allSettled(
    entries.map(([key, cfg]) => fetchSheetTabRaw(cfg.name, cfg.headerRow))
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
