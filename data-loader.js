/* ============================================================
   DATA LOADER — Mengambil data dari Google Sheets (gviz/tq API)
   ============================================================
   Cara kerja:
   - Google Sheets menyediakan endpoint publik /gviz/tq yang
     mengembalikan data tiap tab/sheet dalam format JSON
     (dibungkus dengan google.visualization.Query.setResponse(...))
   - Endpoint ini bisa dibaca tanpa API key, selama sheet di-set
     "Anyone with link can view".
   - Fetch ini terjadi di browser ORANG YANG MEMBUKA dashboard,
     sehingga selalu mengambil data TERBARU setiap kali dibuka
     atau di-refresh — tidak ada proses "build ulang" yang perlu
     dilakukan manual.

   CATATAN PENTING tentang struktur sheet sumber (hasil inspeksi):
   Beberapa tab punya BLOK GANDA berdampingan dalam satu tab, dengan
   nama kolom yang identik di kedua blok (misal "Tanggal", "No Faktur"
   muncul dua kali pada index kolom berbeda). Karena itu, SEMUA tab
   dibaca berbasis POSISI/INDEX kolom (array), bukan nama header —
   lebih robust dan tidak tertukar walau ada nama kolom duplikat.

   - Grand Data 2026: header di baris ke-1 (index 0), blok tunggal.
   - AR 2026: header di baris ke-1. Blok kiri index 0-9 dipakai
     (data piutang mentah). Blok kanan (index 11+) diabaikan.
   - Stock GD MKS: header SEBENARNYA ada di baris ke-2 (index 1) —
     baris pertama hanya label grup/tanggal cetak.
   - PO Gudang: header di baris ke-1. Blok kiri index 0-10 dipakai.
     Blok kanan (index 12+) berisi data lain, diabaikan.
   - Delivery: header di baris ke-1, blok tunggal.

   Jika struktur sheet berubah (kolom ditambah/dipindah/tab di-rename),
   konstanta SHEET_TABS dan index di calc.js perlu disesuaikan ulang.
   ============================================================ */

const SHEET_ID = '1_uou6JDGV-Tm80oALMrduuj9ZIVWM1r9ppuQsYq7_qo';

// Nama tab persis seperti di Google Sheets, dan baris header (1-based,
// sesuai apa yang terlihat saat membuka sheet) untuk masing-masing.
const SHEET_TABS = {
  grandData: { name: 'Grand Data 2026', headerRow: 1 },
  ar: { name: 'AR 2026', headerRow: 1 },
  stock: { name: 'Stock GD MKS', headerRow: 2 },
  delivery: { name: 'Delivery', headerRow: 1 },
  poGudang: { name: 'PO Gudang', headerRow: 1 },
};

function gvizUrl(sheetName) {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`;
  return `${base}?sheet=${encodeURIComponent(sheetName)}&tqx=out:json&_=${Date.now()}`;
}

/**
 * Parse satu cell dari format gviz. Untuk tanggal, value berupa
 * string "Date(2026,0,2)" (bulan 0-indexed) yang perlu dikonversi.
 */
function parseGvizCell(cell) {
  if (!cell || cell.v === null || cell.v === undefined) return null;
  const v = cell.v;
  if (typeof v === 'string' && v.startsWith('Date(')) {
    const nums = v.slice(5, -1).split(',').map(Number);
    const d = new Date(nums[0], nums[1], nums[2] || 1, nums[3] || 0, nums[4] || 0, nums[5] || 0);
    return d;
  }
  return v;
}

/**
 * Fetch satu tab dan kembalikan { header: string[], rows: any[][] }.
 * Tiap baris adalah ARRAY berbasis posisi kolom (bukan object),
 * supaya aman walau ada nama kolom duplikat dalam satu tab.
 *
 * @param {string} sheetName - nama tab persis di Google Sheets
 * @param {number} headerRow - baris ke berapa (1-based) yang jadi header
 */
async function fetchSheetTabRaw(sheetName, headerRow = 1) {
  const url = gvizUrl(sheetName);
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    throw new Error(`Gagal menghubungi Google Sheets untuk tab "${sheetName}". Periksa koneksi internet, atau pastikan sheet sudah di-share "Anyone with link can view".`);
  }
  if (!res.ok) {
    throw new Error(`Tab "${sheetName}" tidak ditemukan atau tidak bisa diakses (HTTP ${res.status}). Periksa nama tab persis sama dengan di Google Sheets.`);
  }
  const text = await res.text();

  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) {
    throw new Error(`Format respons tidak dikenali untuk tab "${sheetName}". Sheet mungkin belum dibagikan secara publik ("Anyone with link can view").`);
  }
  let json;
  try {
    json = JSON.parse(match[1]);
  } catch (err) {
    throw new Error(`Gagal mem-parse data tab "${sheetName}".`);
  }
  if (json.status === 'error') {
    const msg = (json.errors && json.errors[0] && json.errors[0].detailed_message) || 'Error tidak diketahui';
    throw new Error(`Google Sheets menolak permintaan untuk tab "${sheetName}": ${msg}`);
  }

  const table = json.table;
  const numCols = table.cols.length;

  // Baris pertama sheet asli direpresentasikan sebagai table.cols (header
  // versi gviz). Baris ke-2 dst ada di table.rows. Kita gabungkan supaya
  // bisa mengindeks "baris ke-N sheet asli" secara konsisten.
  const colsAsRow = table.cols.map(c => (c.label !== undefined && c.label !== '') ? c.label : null);
  const dataRowsRaw = (table.rows || []).map(r => {
    const arr = new Array(numCols).fill(null);
    if (r && r.c) r.c.forEach((cell, i) => { arr[i] = parseGvizCell(cell); });
    return arr;
  });
  const allSheetRows = [colsAsRow, ...dataRowsRaw];

  const headerIdx = Math.max(0, headerRow - 1);
  const headerArrRaw = allSheetRows[headerIdx] || [];
  const header = headerArrRaw.map((v, i) => {
    const s = (v == null) ? '' : String(v).trim();
    return s || `col${i}`;
  });
  const dataRows = allSheetRows.slice(headerIdx + 1)
    .filter(arr => arr.some(v => v !== null && v !== ''));

  return { header, rows: dataRows };
}

/**
 * Buang baris yang sebenarnya echo dari header (sisa copy-paste manual
 * di tengah data — ditemukan di Grand Data 2026).
 */
function isHeaderEchoRow(rowArr, headerArr) {
  let matches = 0;
  for (let i = 0; i < headerArr.length; i++) {
    const cell = rowArr[i];
    if (cell !== null && cell !== undefined && String(cell).trim() === headerArr[i]) matches++;
  }
  return matches >= 3;
}

/**
 * Loader utama: ambil semua tab yang dibutuhkan dashboard secara paralel.
 * Partial success diizinkan — satu tab gagal tidak menjatuhkan seluruh dashboard.
 * Mengembalikan { data: { [key]: {header, rows} }, errors: [...] }
 */
async function loadAllSheetData() {
  const entries = Object.entries(SHEET_TABS);
  const results = await Promise.allSettled(
    entries.map(([key, cfg]) => fetchSheetTabRaw(cfg.name, cfg.headerRow))
  );

  const data = {};
  const errors = [];

  results.forEach((result, idx) => {
    const [key, cfg] = entries[idx];
    if (result.status === 'fulfilled') {
      let { header, rows } = result.value;
      rows = rows.filter(r => !isHeaderEchoRow(r, header));
      data[key] = { header, rows };
    } else {
      errors.push({ sheetName: cfg.name, message: result.reason ? result.reason.message : 'Gagal memuat' });
      data[key] = { header: [], rows: [] };
    }
  });

  return { data, errors };
}
