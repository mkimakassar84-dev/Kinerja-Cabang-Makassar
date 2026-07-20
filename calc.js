/* ==========================================================================
   CALC — Logika perhitungan & transformasi data menjadi metrik siap-tampil.
   Semua fungsi di sini murni (pure function): menerima data mentah,
   mengembalikan struktur metrik. Tidak ada manipulasi DOM di sini.
   ========================================================================== */

const TODAY = new Date();
const CURRENT_YEAR = 2026;
const MONTH_NAMES_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const MONTH_NAMES_SHORT_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const QUARTER_OF_MONTH = [1,1,1,2,2,2,3,3,3,4,4,4];
const FO_1CORE_CODES = ['KSFO028','KSFO108','KSFO083','KSFO113','KSFO128'];

// -------------------- Helper konversi tipe --------------------
function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/[^0-9\-,.]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function toStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function monthKey(date) {
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthIndexFromKey(key) {
  return parseInt(key.split('-')[1], 10) - 1;
}

// -------------------- Formatter tampilan --------------------
// Rupiah selalu ditulis penuh, tidak disingkat (sesuai permintaan).
function fmtRupiah(n, opts = {}) {
  const neg = n < 0;
  const abs = Math.round(Math.abs(n));
  const str = abs.toLocaleString('id-ID');
  return `${neg ? '-' : ''}Rp${str}`;
}

function fmtNum(n) {
  return Math.round(n).toLocaleString('id-ID');
}

function fmtPct(n, digits = 1) {
  if (!isFinite(n)) return '0%';
  return `${n.toFixed(digits)}%`;
}

function fmtDate(d) {
  if (!d) return '-';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtDateShort(d) {
  if (!d) return '-';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toIsoLocal(d) {
  if (!d) return '';
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function isSameLocalDay(d, ref = TODAY) {
  if (!d) return false;
  return toIsoLocal(d) === toIsoLocal(ref);
}

// -------------------- Helper agregasi --------------------
function sum(arr, fn) {
  return arr.reduce((acc, item) => acc + (fn ? fn(item) : item), 0);
}

function groupBy(arr, keyFn) {
  const map = new Map();
  arr.forEach(item => {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return map;
}

function uniqueCount(arr, keyFn) {
  const set = new Set();
  arr.forEach(item => {
    const k = keyFn(item);
    if (k !== null && k !== undefined && k !== '') set.add(k);
  });
  return set.size;
}

function growthPct(curr, prev) {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// Palet warna konsisten untuk seluruh chart
const PALETTE = {
  sage: '#8a9a82',
  sageLight: '#b7c4af',
  terra: '#c17a5a',
  terraLight: '#dba588',
  amber: '#cf9b3f',
  amberLight: '#e3c179',
  slate: '#6b7787',
  slateLight: '#a3aebb',
  ink: '#3a3530',
  cream: '#f3eee6',
  red: '#b5564a',
  yellow: '#c99a3a',
  green: '#7c9470',
};

/* ==========================================================================
   NORMALISASI DATA TRANSAKSI (Grand Data 2026)
   ========================================================================== */
function normalizeGrandData(rows) {
  return rows.map(r => ({
    orderDate: toDate(r['Order Date']),
    noInvoice: toStr(r['No Invoice']),
    payment: toStr(r['Payment']),
    customer: toStr(r['Customer']).toUpperCase(),
    kodeBarang: toStr(r['Kode Barang']).toUpperCase(),
    qty: toNumber(r['Quantity']),
    amount: toNumber(r['Amount']),
    statusKirim: toStr(r['Status']), // Same Day / Cut Off
    company: toStr(r['Company']).toUpperCase(),
    koli: toNumber(r['Koli']),
    stage: toStr(r['Stage']),
    statusEkspedisi: toStr(r['Status (Ekspedisi)']) || toStr(r['Status (Ekspedisi)  ']),
    lokasi: toStr(r['Lokasi']).toUpperCase(),
    tglTerkirim: toDate(r['Tanggal Terkirim']),
    // Baris retur (No Invoice berprefix "R-") tercatat dengan Amount/Quantity
    // negatif di sheet. Baris ini TETAP DIIKUTSERTAKAN dalam perhitungan
    // (bukan dibuang) karena retur memang harus mengurangi total sales —
    // inilah cara nilai dashboard bisa cocok dengan total di Sales SUM.
    isRetur: /^R[-\/]/i.test(toStr(r['No Invoice'])) || toNumber(r['Amount']) < 0,
  })).filter(t => t.orderDate);
}

function filterYear(transactions, year) {
  return transactions.filter(t => t.orderDate && t.orderDate.getFullYear() === year);
}

/* ==========================================================================
   POIN 1 & 2 — TREN SALES & REVENUE BULANAN/KUARTAL/SEMESTER
   ========================================================================== */
function buildPeriodTrend(transactions, valueFn) {
  const tx2026 = filterYear(transactions, CURRENT_YEAR);
  const monthly = {};
  for (let m = 0; m < 12; m++) {
    const key = `${CURRENT_YEAR}-${String(m + 1).padStart(2, '0')}`;
    monthly[key] = { key, monthIdx: m, label: MONTH_NAMES_ID[m], value: 0, qty: 0, count: 0 };
  }
  tx2026.forEach(t => {
    const key = monthKey(t.orderDate);
    if (monthly[key]) {
      monthly[key].value += valueFn(t);
      monthly[key].qty += t.qty;
      monthly[key].count += 1;
    }
  });
  const monthsArr = Object.values(monthly);

  const quarters = [1,2,3,4].map(q => {
    const ms = monthsArr.filter(m => QUARTER_OF_MONTH[m.monthIdx] === q);
    return { quarter: q, label: `Kuartal ${q}`, value: sum(ms, m => m.value), qty: sum(ms, m => m.qty), count: sum(ms, m => m.count) };
  });

  const semesters = [1,2].map(s => {
    const ms = monthsArr.filter(m => (s === 1 ? m.monthIdx < 6 : m.monthIdx >= 6));
    return { semester: s, label: `Semester ${s === 1 ? 'I' : 'II'}`, value: sum(ms, m => m.value), qty: sum(ms, m => m.qty), count: sum(ms, m => m.count) };
  });

  return { monthly: monthsArr, quarters, semesters, total: sum(monthsArr, m => m.value), totalQty: sum(monthsArr, m => m.qty) };
}

/* ==========================================================================
   POIN 1 — ANALISIS INVOICE UNIK & CUSTOMER UNIK (Grand Data 2026, s/d hari ini)
   ========================================================================== */
function buildInvoiceCustomerSummary(transactions) {
  const tx2026 = filterYear(transactions, CURRENT_YEAR);
  const totalInvoiceUnik = uniqueCount(tx2026, t => t.noInvoice);
  const totalCustomerUnik = uniqueCount(tx2026, t => t.customer);
  const totalSales = sum(tx2026, t => t.amount);
  const totalQty = sum(tx2026, t => t.qty);

  const byCompany = {};
  ['MKI', 'CFN'].forEach(co => {
    const txCo = tx2026.filter(t => t.company === co);
    byCompany[co] = {
      invoiceUnik: uniqueCount(txCo, t => t.noInvoice),
      customerUnik: uniqueCount(txCo, t => t.customer),
      sales: sum(txCo, t => t.amount),
      qty: sum(txCo, t => t.qty),
    };
  });

  return { totalInvoiceUnik, totalCustomerUnik, totalSales, totalQty, byCompany, asOf: TODAY };
}

/* ==========================================================================
   POIN 1 & 2 — KOMPARASI 2025 vs 2026 (dari sheet Sales SUM, kolom AS-BB)
   ========================================================================== */
function buildYoyComparison(salesSumRows) {
  // Index kolom 0-based: A=0 ... AS=44, AT=45, AU=46, AV=47, AW=48, AX=49,
  // AY=50, AZ=51, BA=52, BB=53
  const IDX = { AS: 44, AT: 45, AU: 46, AV: 47, AW: 48, AX: 49, AY: 50, AZ: 51, BA: 52, BB: 53 };
  const MONTH_NAMES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // PENTING: baris pertama sheet Sales SUM berisi judul section
  // ("TARGET SALES REVENUE"), bukan data bulan Januari. Mengandalkan index
  // array baris (salesSumRows[m]) secara langsung akan menggeser seluruh
  // data satu baris. Maka setiap bulan dicari berdasarkan label nama bulan
  // pada kolom AS (case-insensitive), bukan posisi array.
  const months = [];
  for (let m = 0; m < 12; m++) {
    const monthName = MONTH_NAMES_EN[m];
    const row = salesSumRows.find(r => r.__row && toStr(r.__row[IDX.AS]).toLowerCase() === monthName.toLowerCase());
    if (!row) { months.push({ monthIdx: m, label: MONTH_NAMES_ID[m], targetSalesRevenue: 0, rev2025: 0, rev2026: 0, sales2025: 0, sales2026: 0 }); continue; }
    const r = row.__row;
    months.push({
      monthIdx: m,
      label: MONTH_NAMES_ID[m],
      targetSalesRevenue: toNumber(r[IDX.AT]),
      rev2025: toNumber(r[IDX.AV]),
      rev2026: toNumber(r[IDX.AX]),
      sales2025: toNumber(r[IDX.AZ]),
      sales2026: toNumber(r[IDX.BB]),
    });
  }

  const totalSales2025 = sum(months, m => m.sales2025);
  const totalSales2026 = sum(months, m => m.sales2026);
  const totalRev2025 = sum(months, m => m.rev2025);
  const totalRev2026 = sum(months, m => m.rev2026);
  const totalTarget = sum(months, m => m.targetSalesRevenue);

  const quarters = [1,2,3,4].map(q => {
    const ms = months.filter(m => QUARTER_OF_MONTH[m.monthIdx] === q);
    return {
      quarter: q, label: `Kuartal ${q}`,
      sales2025: sum(ms, m => m.sales2025), sales2026: sum(ms, m => m.sales2026),
      rev2025: sum(ms, m => m.rev2025), rev2026: sum(ms, m => m.rev2026),
      target: sum(ms, m => m.targetSalesRevenue),
    };
  });

  const semesters = [1,2].map(s => {
    const ms = months.filter(m => (s === 1 ? m.monthIdx < 6 : m.monthIdx >= 6));
    return {
      semester: s, label: `Semester ${s === 1 ? 'I' : 'II'}`,
      sales2025: sum(ms, m => m.sales2025), sales2026: sum(ms, m => m.sales2026),
      rev2025: sum(ms, m => m.rev2025), rev2026: sum(ms, m => m.rev2026),
      target: sum(ms, m => m.targetSalesRevenue),
    };
  });

  return {
    months, quarters, semesters,
    totalSales2025, totalSales2026, totalRev2025, totalRev2026, totalTarget,
    growthSales: growthPct(totalSales2026, totalSales2025),
    growthRev: growthPct(totalRev2026, totalRev2025),
    achievementSales: totalTarget > 0 ? (totalSales2026 / totalTarget) * 100 : 0,
    achievementRev: totalTarget > 0 ? (totalRev2026 / totalTarget) * 100 : 0,
  };
}

/* ==========================================================================
   POIN 3 — RASIO SALES TO REVENUE (per bulan, kuartal, semester)
   Sales: Grand Data 2026 (Amount). Revenue: Rev SUM (Pelunasan).
   ========================================================================== */
function buildSalesToRevenueRatio(salesTrendMonthly, revTrendMonthly) {
  const monthly = salesTrendMonthly.map(s => {
    const r = revTrendMonthly.find(x => x.monthIdx === s.monthIdx) || { value: 0 };
    const ratio = s.value > 0 ? (r.value / s.value) * 100 : 0;
    return { monthIdx: s.monthIdx, label: s.label, sales: s.value, revenue: r.value, ratio };
  });

  const quarters = [1,2,3,4].map(q => {
    const ms = monthly.filter(m => QUARTER_OF_MONTH[m.monthIdx] === q);
    const sales = sum(ms, m => m.sales), revenue = sum(ms, m => m.revenue);
    return { quarter: q, label: `Kuartal ${q}`, sales, revenue, ratio: sales > 0 ? (revenue / sales) * 100 : 0 };
  });

  const semesters = [1,2].map(s => {
    const ms = monthly.filter(m => (s === 1 ? m.monthIdx < 6 : m.monthIdx >= 6));
    const sales = sum(ms, m => m.sales), revenue = sum(ms, m => m.revenue);
    return { semester: s, label: `Semester ${s === 1 ? 'I' : 'II'}`, sales, revenue, ratio: sales > 0 ? (revenue / sales) * 100 : 0 };
  });

  const totalSales = sum(monthly, m => m.sales);
  const totalRevenue = sum(monthly, m => m.revenue);

  return { monthly, quarters, semesters, totalSales, totalRevenue, totalRatio: totalSales > 0 ? (totalRevenue / totalSales) * 100 : 0 };
}

/* ==========================================================================
   POIN 4 — ZONA WILAYAH KABUPATEN/KOTA (dari KPI MONITORING kolom M-Z)
   Definisi zona berdasarkan total invoice unik 2026 (kolom Z / Total):
   Merah: 0-20 | Kuning: 20-50 | Hijau: >50
   ========================================================================== */
function zoneOf(totalInvoice) {
  if (totalInvoice > 50) return 'hijau';
  if (totalInvoice >= 20) return 'kuning';
  return 'merah';
}

/* ==========================================================================
   PETA INDONESIA — mapping nama Kabupaten/Kota (dari sheet KPI Monitoring) ke
   kode provinsi ISO 3166-2:ID (dipakai peta SVG dari simplemaps.com). Dipakai
   untuk Section 05 "Distribusi Zona Wilayah" — mewarnai tiap provinsi sesuai
   agregat zona (hijau/kuning/merah) dari kabupaten/kota di dalamnya.
   ========================================================================== */
const WILAYAH_TO_PROVINCE = {
  // Sulawesi Selatan
  'MAKASSAR':'IDSN','BONE':'IDSN','SIDRAP':'IDSN','GOWA':'IDSN','PALOPO':'IDSN','BULUKUMBA':'IDSN',
  'JENEPONTO':'IDSN','SENGKANG':'IDSN','BELOPA':'IDSN','PANGKEP':'IDSN','ENREKANG':'IDSN','PINRANG':'IDSN',
  'BARRU':'IDSN','SOPPENG':'IDSN','TAKALAR':'IDSN','MALILI':'IDSN','SINJAI':'IDSN','PARE-PARE':'IDSN',
  'LUWU TIMUR':'IDSN','MANGKUTANA':'IDSN','MASAMBA':'IDSN','LUWU':'IDSN','BANTAENG':'IDSN','SUKAMAJU':'IDSN',
  'LUWU UTARA':'IDSN','MAROS':'IDSN','SOROWAKO':'IDSN','BONE-BONE':'IDSN','WAJO':'IDSN','WAWONDULA':'IDSN',
  'SELAYAR':'IDSN','TORAJA':'IDSN','LAROMPONG':'IDSN','SIWA':'IDSN','TOMONI':'IDSN','WASUPONDA':'IDSN',
  'TANAMONI':'IDSN','WOWONDULA':'IDSN','WALENRANG':'IDSN','RANTEPAO':'IDSN','BELAWA WAJO':'IDSN',
  'BAEBUNTA':'IDSN','LAPAI':'IDSN','TOWUTI':'IDSN',
  // Sulawesi Tenggara
  'KENDARI':'IDSG','BAU-BAU':'IDSG','KOLAKA':'IDSG','KONAWE':'IDSG','MUNA':'IDSG','KOLAKA UTARA':'IDSG',
  'BOMBANA':'IDSG','RAHA':'IDSG','BUTON':'IDSG','LASUSUA':'IDSG','KOLAKA TIMUR':'IDSG','UNAHA':'IDSG',
  'BUTON TENGAH':'IDSG','WAKATOBI':'IDSG','BAU BAU':'IDSG',
  // Sulawesi Tengah
  'PALU':'IDST','BANGGAI':'IDST','TOLI-TOLI':'IDST','MOROWALI':'IDST','POSO':'IDST','BETELEME':'IDST',
  'KOLONEDALLE':'IDST','PARIGI':'IDST','LUWUK BANGGAI':'IDST','BURIKO':'IDST','MOROWALI UTARA':'IDST',
  'TENTENA':'IDST','LUMBEWE':'IDST','BUNGKU':'IDST','PARIGI MOUTONG':'IDST','DONGGALA':'IDST',
  'TOJO UNA-UNA':'IDST','SIGI':'IDST','PENDOLO':'IDST','TARAELU':'IDST','LAMBARESE':'IDST','BUOL':'IDST',
  // Sulawesi Barat
  'MAJENE':'IDSR','PASANGKAYU':'IDSR','MAMUJU':'IDSR','MAMASA':'IDSR','POLEWALI':'IDSR','POLMAN':'IDSR','TOPOYO':'IDSR',
  // Sulawesi Utara
  'MANADO':'IDSA','KOTAMOBAGU':'IDSA','MINAHASA':'IDSA','BOLAANG MONGODOW':'IDSA','KEPULAUAN SANGIHE':'IDSA',
  'SIAU TAGULANDANG BIARO':'IDSA','KEPULAUAN TALAUD':'IDSA','BITUNG':'IDSA','TOMOHON':'IDSA',
  // Gorontalo
  'GORONTALO':'IDGO','BOALEMO':'IDGO','BONE BOLANGO':'IDGO','POHUWATU':'IDGO',
  // Maluku
  'AMBON':'IDMA','MALUKU':'IDMA','SAUMLAKI':'IDMA','BANDA':'IDMA','NAMLEA':'IDMA',
  // Maluku Utara
  'TERNATE':'IDMU','HALMAHERA':'IDMU','MALUKU UTARA':'IDMU',
  // Papua & Papua Barat
  'PAPUA':'IDPA','NABIRE':'IDPA','JAYAPURA':'IDPA','WAMENA':'IDPA',
  'BINTUNI':'IDPB','MANOKWARI':'IDPB',
  // Provinsi lain (kiriman sesekali di luar wilayah utama)
  'JAKARTA':'IDJK','SURABAYA':'IDJI','SAMARINDA':'IDKI','BALIKPAPAN':'IDKI','BERAU':'IDKI','BELITUNG':'IDBB',
};

/**
 * Mengagregasi data zona per Kabupaten/Kota (wilayahData) ke tingkat provinsi
 * untuk ditampilkan di peta Indonesia. Total invoice tiap provinsi = jumlah
 * total invoice seluruh kabupaten/kota yang match, lalu diklasifikasi zona
 * pakai threshold yang SAMA dengan zoneOf() supaya konsisten.
 */
function buildProvinceZones(wilayahData) {
  const byProvince = {};
  wilayahData.forEach(w => {
    const code = WILAYAH_TO_PROVINCE[w.nama];
    if (!code) return;
    if (!byProvince[code]) byProvince[code] = { code, total: 0, wilayahCount: 0, wilayahList: [] };
    byProvince[code].total += w.total;
    byProvince[code].wilayahCount += 1;
    byProvince[code].wilayahList.push({ nama: w.nama, total: w.total });
  });
  Object.values(byProvince).forEach(p => {
    p.zone = zoneOf(p.total);
    p.wilayahList.sort((a, b) => b.total - a.total);
  });
  return byProvince;
}


function buildZonaWilayah(kpiRows, transactions) {
  // PENTING: Google gviz mendeteksi kolom N..Z (Jan..Des, Total) sebagai tipe
  // "number" sehingga label header teks ("Jan", "Feb", dst) tidak pernah
  // muncul sebagai nama kolom object — hanya kolom M (Kabupaten/Kota, tipe
  // string) yang headernya terbaca normal. Karena itu seluruh kolom M..Z
  // diakses berdasarkan index posisi pada __row, bukan nama header.
  // Index 0-based dalam __row: M=12 (nama wilayah), N..Y=13..24 (Jan..Des), Z=25 (Total).
  const NAMA_IDX = 12;
  const MONTH_START_IDX = 13;
  const TOTAL_IDX = 25;

  const wilayahData = kpiRows
    .map(r => {
      const row = r.__row || [];
      const nama = toStr(row[NAMA_IDX]).toUpperCase();
      if (!nama) return null;
      const monthly = MONTH_NAMES_ID.map((label, idx) => ({ monthIdx: idx, label, invoice: toNumber(row[MONTH_START_IDX + idx]) }));
      const total = toNumber(row[TOTAL_IDX]) || sum(monthly, m => m.invoice);
      return { nama, monthly, total, zone: zoneOf(total) };
    })
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);

  // Wilayah tanpa pembelanjaan sejak Januari = total invoice 0 sepanjang tahun
  const wilayahTanpaPembelanjaan = wilayahData.filter(w => w.total === 0);
  const wilayahAktif = wilayahData.filter(w => w.total > 0);

  const zoneCounts = {
    hijau: wilayahData.filter(w => w.zone === 'hijau').length,
    kuning: wilayahData.filter(w => w.zone === 'kuning').length,
    merah: wilayahData.filter(w => w.zone === 'merah').length,
  };

  // Coverage area by invoice per bulan: jumlah wilayah yang punya invoice > 0 di bulan tsb
  const coveragePerBulan = MONTH_NAMES_ID.map((label, idx) => ({
    monthIdx: idx, label,
    coverage: wilayahData.filter(w => w.monthly[idx].invoice > 0).length,
    totalInvoice: sum(wilayahData, w => w.monthly[idx].invoice),
  }));

  const coveragePerKuartal = [1,2,3,4].map(q => {
    const monthIdxs = [0,1,2,3,4,5,6,7,8,9,10,11].filter(m => QUARTER_OF_MONTH[m] === q);
    const coverage = wilayahData.filter(w => monthIdxs.some(mi => w.monthly[mi].invoice > 0)).length;
    return { quarter: q, label: `Kuartal ${q}`, coverage, totalInvoice: sum(coveragePerBulan.filter(c => monthIdxs.includes(c.monthIdx)), c => c.totalInvoice) };
  });

  // Sales per wilayah (dari Grand Data 2026, untuk melengkapi "performa wilayah by sales")
  const tx2026 = filterYear(transactions, CURRENT_YEAR);
  const salesByWilayah = Array.from(groupBy(tx2026, t => t.lokasi).entries())
    .map(([lokasi, items]) => ({ lokasi, sales: sum(items, i => i.amount), invoiceUnik: uniqueCount(items, i => i.noInvoice) }))
    .sort((a, b) => b.sales - a.sales);

  // Ranking customer per wilayah (untuk drill-down "Coverage Area" — customer dengan
  // pembelanjaan terbesar di suatu kabupaten/kota), di-key oleh nama wilayah (huruf besar).
  const customersByWilayah = {};
  Array.from(groupBy(tx2026, t => t.lokasi).entries()).forEach(([lokasi, items]) => {
    if (!lokasi) return;
    const byCustomer = Array.from(groupBy(items, t => t.customer).entries())
      .filter(([customer]) => customer)
      .map(([customer, custItems]) => ({
        customer,
        sales: sum(custItems, i => i.amount),
        qty: sum(custItems, i => i.qty),
        invoiceUnik: uniqueCount(custItems, i => i.noInvoice),
      }))
      .sort((a, b) => b.sales - a.sales);
    customersByWilayah[lokasi] = byCustomer;
  });

  return {
    wilayahData, wilayahAktif, wilayahTanpaPembelanjaan, zoneCounts,
    coveragePerBulan, coveragePerKuartal, salesByWilayah, customersByWilayah,
    totalWilayah: wilayahData.length,
  };
}

/* ==========================================================================
   TARGET INVOICE BULANAN (dari sheet KPI MONITORING, area "MONTHLY KPI
   MEASUREMENT" yang formatnya bukan tabel kolom biasa, melainkan layout
   custom per baris). Diambil berdasarkan POSISI BARIS ABSOLUT di sheet asli
   (bukan nama header), karena area ini adalah blok ringkasan KPI, bukan
   tabel data tabular:
   - Baris 22 kolom B = label bulan aktif (mis. "JUNI"), diisi & diganti
     MANUAL oleh user setiap pergantian bulan — bukan formula otomatis.
   - Baris 32 kolom C = Target Invoice Bulanan (TOTAL INVOICE 1 BULAN),
     nilai tetap yang juga diisi manual oleh user.
   Karena headerRow sheet ini = 1, baris ke-N pada sheet asli berada pada
   index (N - 2) di kpiRows (index 0-based, setelah baris header dibuang).
   Maka baris 22 -> kpiRows[20], baris 32 -> kpiRows[30].
   ========================================================================== */
function buildInvoiceTargetFromKpiSheet(kpiRows) {
  const ROW22_IDX = 20; // baris 22 di sheet -> index 20 di kpiRows
  const ROW32_IDX = 30; // baris 32 di sheet -> index 30 di kpiRows

  const row22 = kpiRows[ROW22_IDX] ? kpiRows[ROW22_IDX].__row || [] : [];
  const row32 = kpiRows[ROW32_IDX] ? kpiRows[ROW32_IDX].__row || [] : [];

  const activeMonthLabel = toStr(row22[1]).toUpperCase(); // kolom B, mis. "JUNI"
  const monthlyInvoiceTarget = toNumber(row32[2]); // kolom C

  return { activeMonthLabel, monthlyInvoiceTarget };
}

/* ==========================================================================
   POIN 5 — KODE BARANG TERLARIS 2026 (by sales & quantity), by company
   ========================================================================== */
function buildTopProducts(transactions) {
  const tx2026 = filterYear(transactions, CURRENT_YEAR);

  const byProduct = Array.from(groupBy(tx2026, t => t.kodeBarang).entries())
    .filter(([kode]) => kode)
    .map(([kode, items]) => ({
      kode,
      sales: sum(items, i => i.amount),
      qty: sum(items, i => i.qty),
      invoiceUnik: uniqueCount(items, i => i.noInvoice),
    }));

  const topBySales = [...byProduct].sort((a, b) => b.sales - a.sales);
  const topByQty = [...byProduct].sort((a, b) => b.qty - a.qty);

  const byCompany = {};
  ['MKI', 'CFN'].forEach(co => {
    const txCo = tx2026.filter(t => t.company === co);
    const prodCo = Array.from(groupBy(txCo, t => t.kodeBarang).entries())
      .filter(([kode]) => kode)
      .map(([kode, items]) => ({ kode, sales: sum(items, i => i.amount), qty: sum(items, i => i.qty) }));
    byCompany[co] = {
      topBySales: [...prodCo].sort((a, b) => b.sales - a.sales),
      topByQty: [...prodCo].sort((a, b) => b.qty - a.qty),
    };
  });

  return { topBySales, topByQty, byCompany, totalProductCount: byProduct.length };
}

/* ==========================================================================
   POIN 6 — STOCK GUDANG & PO GUDANG
   ========================================================================== */
function buildStock(stockRows, transactions) {
  // Header sheet Stock GD MKS direstrukturisasi 3-Jul-2026. Baris 1 berisi
  // tanggal merged-cell sehingga label kolom tidak terbaca gviz sebagai nama
  // kolom. Maka kolom stock diakses berdasarkan index posisi (__row), sesuai
  // struktur baru: A=0 Kode Barang, B=1 Deskripsi, C=2 Harga Satuan,
  // D=3 Nilai Stock GD, E=4 MKI Turnover, F=5 CFN Turnover, G=6 MKI&CFN Turnover,
  // H=7 Stock MKI, I=8 Stock CFN, J=9 Stock MKI&CFN, K=10 (kosong/spacer),
  // L=11 GD MKI (base stock), M=12 GD CFN (base stock).
  const items = stockRows
    .map(r => {
      const row = r.__row || [];
      const harga = toNumber(row[2]);
      const stockTotal = toNumber(row[9]);
      return {
        kode: toStr(row[0]).toUpperCase(),
        deskripsi: toStr(row[1]),
        harga,
        nilaiStockGD: toNumber(row[3]) || (harga * stockTotal),
        stockMKI: toNumber(row[7]),
        stockCFN: toNumber(row[8]),
        stockTotal,
      };
    })
    .filter(r => r.kode);

  const totalStockMKI = sum(items, i => i.stockMKI);
  const totalStockCFN = sum(items, i => i.stockCFN);
  const totalStockAll = sum(items, i => i.stockTotal);
  const totalNilaiStockGD = sum(items, i => i.nilaiStockGD);

  const tx2026 = filterYear(transactions, CURRENT_YEAR);
  const salesByKode = new Map();
  tx2026.forEach(t => {
    if (!t.kodeBarang) return;
    salesByKode.set(t.kodeBarang, (salesByKode.get(t.kodeBarang) || 0) + t.qty);
  });

  const stockTidakTerjual = items.filter(i => i.stockTotal > 0 && !salesByKode.has(i.kode));
  const stockTerjualDibawah5 = items.filter(i => i.stockTotal > 0 && salesByKode.has(i.kode) && salesByKode.get(i.kode) < 5)
    .map(i => ({ ...i, qtyTerjual: salesByKode.get(i.kode) }));

  return {
    items, totalStockMKI, totalStockCFN, totalStockAll, totalNilaiStockGD,
    itemCount: items.length,
    stockTidakTerjual, stockTerjualDibawah5,
  };
}

function buildPoGudang(poRows) {
  const items = poRows.map(r => {
    const stage = toStr(r['Stage']);
    const noSuratJalan = toStr(r['NO Surat Jalan']);
    const statusEkspedisi = toStr(r['Status (Ekspedisi)']);
    const qty = toNumber(r['Quantity']);
    // Kolom J ("Quantity Diterima (GD MKS)") berisi ANGKA REAL barang yang
    // benar-benar masuk ke gudang Makassar — bisa berbeda dari Quantity
    // yang dipesan (kelebihan/kekurangan kiriman). Diakses via INDEX POSISI
    // (index 9 = kolom J: A=0,B=1,...,J=9), bukan nama header, karena nama
    // kolom ini terbukti tidak stabil dari gviz (kapitalisasi "Diterima"
    // vs "DIterima" berubah-ubah antar pemanggilan terhadap sheet yang sama).
    const qtyDiterimaReal = toNumber((r.__row || [])[9]);

    // Status barang (untuk pengelompokan & narasi) ditentukan dari Stage /
    // No Surat Jalan / Status Ekspedisi:
    // - Stage "Complete"   -> barang sudah diterima di gudang Makassar
    // - Stage "Return"     -> barang TIDAK diterima (retur, stock pusat kosong)
    // - Stage/No Surat Jalan/Status Ekspedisi semua kosong -> masih ditunggu
    //   (No Surat Jalan dari kantor pusat belum diterima)
    let statusBarang;
    if (stage.toLowerCase() === 'complete') statusBarang = 'diterima';
    else if (stage.toLowerCase() === 'return') statusBarang = 'retur';
    else if (!stage && !noSuratJalan && !statusEkspedisi) statusBarang = 'ditunggu';
    else statusBarang = 'lainnya';

    return {
      no: toStr(r['NO']),
      orderDate: toDate(r['Order Date']),
      noPO: toStr(r['NO PO']),
      company: toStr(r['COMPANY']).toUpperCase(),
      kodeBarang: toStr(r['Kode Barang']).toUpperCase(),
      qty,
      qtyDiterimaReal,
      noSuratJalan,
      statusEkspedisi,
      stage,
      statusBarang,
      tglMasukGudang: toDate(r['Tanggal Masuk GD MKS']),
    };
  }).filter(p => p.orderDate);

  const totalPO = items.length;
  const totalQtyPO = sum(items, i => i.qty); // indikator pemesanan
  const itemsDiterima = items.filter(i => i.statusBarang === 'diterima');
  const itemsRetur = items.filter(i => i.statusBarang === 'retur');
  const itemsDitunggu = items.filter(i => i.statusBarang === 'ditunggu');
  const totalQtyDiterima = sum(itemsDiterima, i => i.qtyDiterimaReal); // angka real dari kolom J
  const totalQtyRetur = sum(itemsRetur, i => i.qtyDiterimaReal);
  const totalQtyDipesanRetur = sum(itemsRetur, i => i.qty); // qty yang dipesan tapi tidak sampai (diretur)
  const totalQtyDitunggu = sum(itemsDitunggu, i => i.qty); // belum ada qty diterima karena masih ditunggu
  const completeCount = itemsDiterima.length;

  const byCompany = {};
  ['MKI', 'CFN'].forEach(co => {
    const itemsCo = items.filter(i => i.company === co);
    byCompany[co] = {
      count: itemsCo.length,
      qty: sum(itemsCo, i => i.qty),
      qtyDiterima: sum(itemsCo.filter(i => i.statusBarang === 'diterima'), i => i.qtyDiterimaReal),
      qtyRetur: sum(itemsCo.filter(i => i.statusBarang === 'retur'), i => i.qtyDiterimaReal),
      qtyDitunggu: sum(itemsCo.filter(i => i.statusBarang === 'ditunggu'), i => i.qty),
    };
  });

  const monthly = {};
  items.forEach(p => {
    const key = monthKey(p.orderDate);
    if (!key) return;
    if (!monthly[key]) monthly[key] = { key, label: MONTH_NAMES_ID[p.orderDate.getMonth()], count: 0, qty: 0, items: [] };
    monthly[key].count += 1;
    monthly[key].qty += p.qty;
    monthly[key].items.push(p);
  });

  return {
    items, totalPO, totalQtyPO, totalQtyDiterima, totalQtyRetur, totalQtyDitunggu, totalQtyDipesanRetur,
    completeCount, byCompany, monthly: Object.values(monthly).sort((a,b)=>a.key.localeCompare(b.key)),
  };
}

/* ==========================================================================
   POIN 7 — DELIVERY (Same Day/Cut Off) & EKSPEDISI (dari Grand Data 2026)
   ========================================================================== */
function buildDelivery(transactions) {
  const tx2026 = filterYear(transactions, CURRENT_YEAR);
  const total = tx2026.length;

  const sameDay = tx2026.filter(t => t.statusKirim.toLowerCase().includes('same'));
  const cutOff = tx2026.filter(t => t.statusKirim.toLowerCase().includes('cut'));

  const deliveryStatus = {
    sameDay: { count: sameDay.length, pct: total > 0 ? (sameDay.length / total) * 100 : 0, qty: sum(sameDay, t => t.qty), koli: sum(sameDay, t => t.koli) },
    cutOff: { count: cutOff.length, pct: total > 0 ? (cutOff.length / total) * 100 : 0, qty: sum(cutOff, t => t.qty), koli: sum(cutOff, t => t.koli) },
  };

  const byEkspedisi = Array.from(groupBy(tx2026, t => t.statusEkspedisi || 'TIDAK TERCATAT').entries())
    .map(([nama, items]) => ({
      nama, count: items.length,
      pct: total > 0 ? (items.length / total) * 100 : 0,
      qty: sum(items, i => i.qty), koli: sum(items, i => i.koli),
    }))
    .sort((a, b) => b.count - a.count);

  const handCarryCount = tx2026.filter(t => t.statusEkspedisi.toUpperCase().includes('HAND CARRY')).length;
  const ekspedisiLuarCount = total - handCarryCount;

  return {
    total, deliveryStatus, byEkspedisi,
    handCarry: { count: handCarryCount, pct: total > 0 ? (handCarryCount / total) * 100 : 0 },
    ekspedisiLuar: { count: ekspedisiLuarCount, pct: total > 0 ? (ekspedisiLuarCount / total) * 100 : 0 },
    totalQty: sum(tx2026, t => t.qty), totalKoli: sum(tx2026, t => t.koli),
  };
}

/* ==========================================================================
   POIN 1 & 2 — SALES/REVENUE BY COMPANY (MKI vs CFN)
   ========================================================================== */
function buildSalesByCompany(transactions) {
  const tx2026 = filterYear(transactions, CURRENT_YEAR);
  const totalSales = sum(tx2026, t => t.amount);

  const companies = ['MKI', 'CFN'].map(co => {
    const txCo = tx2026.filter(t => t.company === co);
    const sales = sum(txCo, t => t.amount);
    const qty = sum(txCo, t => t.qty);

    const byProduct = Array.from(groupBy(txCo, t => t.kodeBarang).entries())
      .map(([kode, items]) => ({
        kode, sales: sum(items, i => i.amount), qty: sum(items, i => i.qty), invoiceCount: uniqueCount(items, i => i.noInvoice),
      }))
      .sort((a, b) => b.sales - a.sales);

    return {
      company: co, sales, qty,
      pct: totalSales > 0 ? (sales / totalSales) * 100 : 0,
      invoiceUnik: uniqueCount(txCo, t => t.noInvoice),
      customerUnik: uniqueCount(txCo, t => t.customer),
      topProducts: byProduct.slice(0, 10),
      productCount: byProduct.length,
    };
  });

  return { companies, totalSales };
}

// PENTING: Sheet "Rev SUM" memiliki kolom dengan NAMA yang sama persis
// berulang beberapa kali secara horizontal (Payment Date/No Faktur/
// Customer/Pelunasan/Company muncul lagi di kolom G-K sebagai blok kedua,
// lalu ada blok rekap "MKI"/"Total Revenue" dan "CFN" di kolom berikutnya).
// Karena nama header duplikat, pemetaan berbasis nama akan saling menimpa
// nilai. Maka tabel transaksi Rev SUM HARUS diakses melalui index posisi
// kolom yang sebenarnya (blok pertama, A-E / index 0-4), bukan nama header.
function normalizeRevSum(revRows) {
  return revRows.map(r => {
    const row = r.__row || [];
    return {
      paymentDate: toDate(row[0]),
      noFaktur: toStr(row[1]),
      customer: toStr(row[2]).toUpperCase(),
      pelunasan: toNumber(row[3]),
      company: toStr(row[4]).toUpperCase(),
    };
  }).filter(r => r.paymentDate);
}

function buildRevenueByCompany(revRows) {
  const revAll = normalizeRevSum(revRows);
  const rev2026 = revAll.filter(r => r.paymentDate.getFullYear() === CURRENT_YEAR);

  const totalRevenue = sum(rev2026, r => r.pelunasan);

  const companies = ['MKI', 'CFN'].map(co => {
    const items = rev2026.filter(r => r.company === co);
    const revenue = sum(items, i => i.pelunasan);
    return {
      company: co, revenue,
      pct: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      invoiceUnik: uniqueCount(items, i => i.noFaktur),
      customerUnik: uniqueCount(items, i => i.customer),
    };
  });

  return { companies, totalRevenue, rev2026 };
}

function buildRevenueTrend(revRows) {
  const revAll = normalizeRevSum(revRows);
  const rev2026 = revAll.filter(r => r.paymentDate.getFullYear() === CURRENT_YEAR);

  const monthly = {};
  for (let m = 0; m < 12; m++) {
    const key = `${CURRENT_YEAR}-${String(m + 1).padStart(2, '0')}`;
    monthly[key] = { key, monthIdx: m, label: MONTH_NAMES_ID[m], value: 0, count: 0 };
  }
  rev2026.forEach(r => {
    const key = monthKey(r.paymentDate);
    if (monthly[key]) { monthly[key].value += r.pelunasan; monthly[key].count += 1; }
  });
  const monthsArr = Object.values(monthly);

  const quarters = [1,2,3,4].map(q => {
    const ms = monthsArr.filter(m => QUARTER_OF_MONTH[m.monthIdx] === q);
    return { quarter: q, label: `Kuartal ${q}`, value: sum(ms, m => m.value) };
  });
  const semesters = [1,2].map(s => {
    const ms = monthsArr.filter(m => (s === 1 ? m.monthIdx < 6 : m.monthIdx >= 6));
    return { semester: s, label: `Semester ${s === 1 ? 'I' : 'II'}`, value: sum(ms, m => m.value) };
  });

  return {
    monthly: monthsArr, quarters, semesters,
    total: sum(monthsArr, m => m.value),
    invoiceUnik: uniqueCount(rev2026, r => r.noFaktur),
    customerUnik: uniqueCount(rev2026, r => r.customer),
  };
}

/* ==========================================================================
   POIN 8 — PIUTANG (AR) 2026, RASIO AR thd SALES, BY COMPANY
   ========================================================================== */
function buildAR(arRows, totalSales2026) {
  // Sesuai instruksi: data piutang diambil dari sheet AR 2026 KOLOM L-S saja.
  // Pada representasi gviz, kolom L-S berada di index 11-18 (0-based: A=0,
  // jadi L=11). Blok ini TIDAK menyertakan kolom "Paid Amount" maupun
  // "Status" secara eksplisit, sehingga:
  // - paidAmount diturunkan dari (Nilai Faktur - Sisa Saldo Piutang)
  // - status ditentukan dari Sisa Saldo Piutang (0 berarti Lunas)
  const items = arRows.map(r => {
    const row = r.__row || [];
    const nilaiFaktur = toNumber(row[14]);
    const sisaSaldo = toNumber(row[15]);
    return {
      tanggal: toDate(row[11]),
      noFaktur: toStr(row[12]),
      customer: toStr(row[13]).toUpperCase(),
      nilaiFaktur,
      sisaSaldo,
      paidAmount: nilaiFaktur - sisaSaldo,
      aging: toStr(row[16]),
      kategori: toStr(row[17]),
      status: sisaSaldo <= 0 ? 'Lunas' : 'Belum Lunas',
      company: toStr(row[18]).toUpperCase(),
    };
  }).filter(a => a.noFaktur);

  const totalNilaiFaktur = sum(items, i => i.nilaiFaktur);
  const totalSisaSaldo = sum(items, i => i.sisaSaldo);
  const totalPaid = sum(items, i => i.paidAmount);
  const belumLunasCount = items.filter(i => i.status.toLowerCase().includes('belum')).length;
  const lunasCount = items.filter(i => i.status.toLowerCase().includes('lunas') && !i.status.toLowerCase().includes('belum')).length;

  // Piutang diatas 60 hari (kategori biasanya "> 60 Hari")
  const piutangDiatas60Hari = items.filter(i => i.kategori.includes('60') && i.sisaSaldo > 0);
  const totalPiutangDiatas60Hari = sum(piutangDiatas60Hari, i => i.sisaSaldo);

  const byCompany = {};
  ['MKI', 'CFN'].forEach(co => {
    const itemsCo = items.filter(i => i.company === co);
    byCompany[co] = {
      nilaiFaktur: sum(itemsCo, i => i.nilaiFaktur),
      sisaSaldo: sum(itemsCo, i => i.sisaSaldo),
      paidAmount: sum(itemsCo, i => i.paidAmount),
      count: itemsCo.length,
    };
  });

  const ratioARtoSales = totalSales2026 > 0 ? (totalSisaSaldo / totalSales2026) * 100 : 0;

  // Distribusi aging untuk chart
  const agingBuckets = Array.from(groupBy(items.filter(i => i.sisaSaldo > 0), i => i.kategori || 'Lainnya').entries())
    .map(([kategori, arr]) => ({ kategori, count: arr.length, sisaSaldo: sum(arr, a => a.sisaSaldo) }));

  return {
    items, totalNilaiFaktur, totalSisaSaldo, totalPaid,
    belumLunasCount, lunasCount, byCompany, ratioARtoSales,
    piutangDiatas60Hari, totalPiutangDiatas60Hari, agingBuckets,
  };
}

/* ==========================================================================
   POIN 9 — FREKUENSI CUSTOMER, CHURN 2 BULAN, TOP 10 CUSTOMER
   ========================================================================== */
function buildCustomerFrequency(transactions, asOfDate = TODAY) {
  const tx2026 = filterYear(transactions, CURRENT_YEAR);

  const byCustomer = Array.from(groupBy(tx2026, t => t.customer).entries())
    .filter(([cust]) => cust)
    .map(([customer, items]) => {
      const invoiceUnik = uniqueCount(items, i => i.noInvoice);
      const totalSales = sum(items, i => i.amount);
      const lastPurchase = items.reduce((max, i) => (!max || (i.orderDate && i.orderDate > max)) ? i.orderDate : max, null);
      const daysSinceLastPurchase = lastPurchase ? Math.floor((asOfDate - lastPurchase) / (1000 * 60 * 60 * 24)) : null;
      return { customer, invoiceUnik, totalSales, frequency: items.length, lastPurchase, daysSinceLastPurchase };
    });

  const allByFrequency = [...byCustomer].sort((a, b) => b.invoiceUnik - a.invoiceUnik);
  const allBySales = [...byCustomer].sort((a, b) => b.totalSales - a.totalSales);
  const top10ByFrequency = allByFrequency.slice(0, 10);
  const top10BySales = allBySales.slice(0, 10);

  // Customer yang tidak belanja lagi >= 60 hari sejak pembelian terakhir
  const churnedCustomers = byCustomer
    .filter(c => c.daysSinceLastPurchase !== null && c.daysSinceLastPurchase >= 60)
    .sort((a, b) => b.daysSinceLastPurchase - a.daysSinceLastPurchase);

  const avgFrequency = byCustomer.length > 0 ? sum(byCustomer, c => c.invoiceUnik) / byCustomer.length : 0;
  const avgSalesPerCustomer = byCustomer.length > 0 ? sum(byCustomer, c => c.totalSales) / byCustomer.length : 0;

  // Distribusi customer berdasarkan frekuensi transaksi (jumlah invoice unik):
  // 1x, 2x, 3-5x, 5-10x, dan di atas 10x belanja.
  const FREQ_BUCKETS = [
    { key: 'b1',    label: '1x Belanja',        test: n => n === 1 },
    { key: 'b2',    label: '2x Belanja',        test: n => n === 2 },
    { key: 'b3_5',  label: '3-5x Belanja',      test: n => n >= 3 && n <= 5 },
    { key: 'b5_10', label: '5-10x Belanja',     test: n => n > 5 && n <= 10 },
    { key: 'b10p',  label: '>10x Belanja',      test: n => n > 10 },
  ];
  const totalCustomerForDist = byCustomer.length;
  const frequencyDistribution = FREQ_BUCKETS.map(b => {
    const custs = byCustomer.filter(c => b.test(c.invoiceUnik)).sort((a, b2) => b2.totalSales - a.totalSales);
    return {
      key: b.key,
      label: b.label,
      customerCount: custs.length,
      pct: totalCustomerForDist > 0 ? (custs.length / totalCustomerForDist) * 100 : 0,
      totalSales: sum(custs, c => c.totalSales),
      customers: custs,
    };
  });

  return {
    byCustomer, top10ByFrequency, top10BySales, allByFrequency, allBySales, churnedCustomers,
    totalCustomer: byCustomer.length, avgFrequency, avgSalesPerCustomer, frequencyDistribution,
  };
}

/* ==========================================================================
   POIN 10 — TREN KABEL FIBER OPTIC 1-CORE (5 kode tertentu), by company
   ========================================================================== */
function buildFiberOptic1Core(transactions) {
  const tx2026 = filterYear(transactions, CURRENT_YEAR).filter(t => FO_1CORE_CODES.includes(t.kodeBarang));

  const totalSales = sum(tx2026, t => t.amount);
  const totalQty = sum(tx2026, t => t.qty);

  const monthly = {};
  for (let m = 0; m < 12; m++) {
    const key = `${CURRENT_YEAR}-${String(m + 1).padStart(2, '0')}`;
    monthly[key] = { key, monthIdx: m, label: MONTH_NAMES_ID[m], sales: 0, qty: 0 };
  }
  tx2026.forEach(t => {
    const key = monthKey(t.orderDate);
    if (monthly[key]) { monthly[key].sales += t.amount; monthly[key].qty += t.qty; }
  });
  const monthsArr = Object.values(monthly);

  const byKode = FO_1CORE_CODES.map(kode => {
    const items = tx2026.filter(t => t.kodeBarang === kode);
    const monthlyKode = [];
    for (let m = 0; m < 12; m++) {
      const itemsM = items.filter(t => t.orderDate.getMonth() === m);
      monthlyKode.push({ monthIdx: m, label: MONTH_NAMES_ID[m], sales: sum(itemsM, i => i.amount), qty: sum(itemsM, i => i.qty) });
    }
    return { kode, sales: sum(items, i => i.amount), qty: sum(items, i => i.qty), monthly: monthlyKode };
  }).sort((a, b) => b.sales - a.sales);

  const byCompany = {};
  ['MKI', 'CFN'].forEach(co => {
    const items = tx2026.filter(t => t.company === co);
    byCompany[co] = { sales: sum(items, i => i.amount), qty: sum(items, i => i.qty) };
  });

  return { monthly: monthsArr, byKode, byCompany, totalSales, totalQty };
}

/* ==========================================================================
   ORKESTRASI — Menyatukan seluruh perhitungan menjadi satu objek metrics
   ========================================================================== */
/**
 * Agregasi transaksi 2026 per KEY (mis. nama wilayah / kode barang) DAN per
 * bulan sekaligus — dipakai untuk fitur drill-down "klik baris tabel, lihat
 * tren bulanan" di Section 05 (Wilayah) & Section 06 (Kode Barang).
 * Mengembalikan:
 *   byKey: { [key]: [ {sales, qty, invoiceUnik} x 12 bulan ] }
 *   totalsByMonth: [ {sales, qty, invoiceUnik} x 12 bulan ] (semua key digabung,
 *     dipakai untuk menghitung persentase kontribusi per bulan)
 */
function buildMonthlyAggByKey(transactions, keyFn) {
  const tx2026 = filterYear(transactions, CURRENT_YEAR);
  const byKeyRaw = {};
  const totalsByMonthRaw = Array.from({ length: 12 }, () => ({ sales: 0, qty: 0, invSet: new Set() }));

  tx2026.forEach(t => {
    const key = keyFn(t);
    if (!key) return;
    const mi = t.orderDate.getMonth();
    if (!byKeyRaw[key]) byKeyRaw[key] = Array.from({ length: 12 }, () => ({ sales: 0, qty: 0, invSet: new Set() }));
    const bucket = byKeyRaw[key][mi];
    bucket.sales += t.amount;
    bucket.qty += t.qty;
    bucket.invSet.add(t.noInvoice);
    const totalBucket = totalsByMonthRaw[mi];
    totalBucket.sales += t.amount;
    totalBucket.qty += t.qty;
    totalBucket.invSet.add(t.noInvoice);
  });

  const finalize = arr => arr.map(b => ({ sales: b.sales, qty: b.qty, invoiceUnik: b.invSet.size }));
  const byKey = {};
  Object.keys(byKeyRaw).forEach(key => { byKey[key] = finalize(byKeyRaw[key]); });
  const totalsByMonth = finalize(totalsByMonthRaw);

  return { byKey, totalsByMonth };
}

/* ==========================================================================
   KPI PERSONEL — Kepatuhan absensi & kinerja harian staf cabang.
   Sumber: sheet DATA_ARCHIVE milik sistem KPI Personel (spreadsheet
   terpisah). Setiap baris = 1 orang x 1 bulan, berisi 31 hari data
   dipisahkan koma per kolom indikator (Row13..Row22 = 10 indikator,
   sudah berupa flag '1'/'0' yang DIHITUNG oleh sistem KPI Personel saat
   data disimpan — termasuk aturan khusus hari Sabtu — jadi di sini kita
   tinggal menjumlahkan, tidak perlu menghitung ulang aturan jam kerja.
   ========================================================================== */
const KPI_PERSONEL_LIST = ['ASTRID','ADI','REZA','PUTRI','BURHAMIN','ZUL','ASPAR','TAUFIK'];
const KPI_PERSONEL_INDICATOR_KEYS = ['Row13','Row14','Row15','Row16','Row17','Row18','Row19','Row20','Row21','Row22'];
const KPI_PERSONEL_EVID_KEYS = ['Evid13','Evid14','Evid15','Evid16','Evid17','Evid18','Evid19','Evid20','Evid21','Evid22'];
const KPI_PERSONEL_SEP = '\u001F'; // pemisah antar-hari di kolom Evid — sama seperti yang dipakai sistem input KPI Personel

// Label 10 indikator per personel (persis seperti di aplikasi input masing-masing) —
// disimpan di sini supaya detail per personel bisa dibangun instan dari data yang
// sudah dimuat, tanpa perlu memanggil server lagi setiap kali modal dibuka.
const KPI_PERSONEL_LABELS = {
  ASTRID: ['Absen Datang dibawah 08.15','Absen Pulang Diatas 16.45','Monitoring Sales Harian','Monitoring Revenue Harian','Monitoring Invoice harian','Monitoring Piutang (Dibawah 3 Bulan)','Verifikasi Diskon dan Plafon Customer','Evaluasi Kelengkapan Administrasi Penjualan','Evaluasi Kinerja dan Membimbing Sales','Pelaporan Kegiatan Operasional Harian'],
  ADI: ['Absen Datang dibawah 08.15','Absen Pulang Diatas 16.45','Call Customer Non-Aktif <30 Hari (Min 3 Customer)','Melayani Customer Offline/SPD','Melayani Customer online (WA/Telepon)','Pembuatan Faktur (Surat Jalan & Invoice)','Monitoring Piutang Customer Yang Dihandle','Monitoring Pergerakan Barang Customer','Handling Complaint Customer','Menjaga Kebersihan Space dan Ruang kerja'],
  REZA: ['Absen Datang dibawah 08.15','Absen Pulang Diatas 16.45','Call Customer Non-Aktif <60 Hari (Min 3 Customer)','Melayani Customer Offline/SPD','Melayani Customer online (WA/Telepon)','Mengarsip Dokumen Sales Harian','Menginput Data Sales Harian di Sistem Cabang','Final Check Surat Jalan Delivery','Handling Complaint Customer','Menjaga Kebersihan Space dan Ruang kerja'],
  PUTRI: ['Absen Datang dibawah 08.15','Absen Pulang Diatas 16.45','Mengelola administrasi dan Inventaris Kantor (Dokumen dan ATK Kantor)','Melakukan Pengecekan Server','Evaluasi Kas Operasional','Pengecekan Penunjang Operasional (PC, CCTV, Jaringan)','Menginput Laporan Revenue & AR','Report Harian Kinerja Cabang','Pelaporan Kegiatan Operasional Harian','Input dan Evaluasi Absensi Cabang'],
  BURHAMIN: ['Absen Datang dibawah 08.15','Absen Pulang Diatas 16.45','Delivery Harian Diatas 80%','Follow Up Piutang Customer (Min 3 Customer)','Mengawasi Proses Bongkar Muat','Mengarsip Dokumen Logistik Harian','Membuat Laporan Piutang','Membuat Laporan Turnover, Delivery & Return','Menyiapkan Barang Handcarry','Memberi laporan kegiatan harian Logistik'],
  ZUL: ['Absen Datang dibawah 08.15','Absen Pulang Diatas 16.45','Delivery Harian diatas 80%','Menyiapkan Barang Untuk Loading','Membuat Dokumentasi Barang di Ekspedisi','Membagi Surat Jalan Untuk Ritase Harian','Mengarsipkan Tanda Terima Ekspedisi','Menjaga Kebersihan dan Kerapian Gudang','Menginput Surat Jalan di Sistem Cabang','Melaporkan Evaluasi Ritase Harian'],
  ASPAR: ['Absen Datang dibawah 08.15','Absen Pulang Diatas 16.45','Delivery Harian diatas 80%','Mengemas Barang Yang Akan Dikirim','Final Check Barang Loading','Final Check Surat Jalan','Menjaga Alat Penunjang Logistik','Menjaga Kebersihan dan Kerapian Gudang','Memastikan Keamanan Buka/Tutup Kantor','Melaporkan Evaluasi Ritase Harian'],
  TAUFIK: ['Absen Datang dibawah 08.15','Absen Pulang Diatas 16.45','Delivery Harian diatas 80%','Memeriksa Kesiapan Kondisi Kendaraan Harian','Konfirmasi dan Navigasi Rute Harian','Mengatur Kubikasi Box Muatan','Menyiapkan Barang Untuk Loading','Menjaga Kebersihan dan Kerapian Gudang','Memastikan Keamanan Buka/Tutup Kantor','Melaporkan Evaluasi Ritase Harian'],
};

// Uraikan 1 baris DATA_ARCHIVE (1 orang x 1 bulan) menjadi data per-hari (1..31):
// status submit, 10 nilai indikator (boolean), bukti/evidence per indikator,
// persentase harian, jam datang/pulang.
function buildKpiDailyDetail(row) {
  const splitArr = v => toStr(v).split(',');
  const submittedArr = splitArr(row['Submitted']);
  const jamDatangArr = splitArr(row['JamDatang']);
  const jamPulangArr = splitArr(row['JamPulang']);
  const indicatorArrs = KPI_PERSONEL_INDICATOR_KEYS.map(key => splitArr(row[key]));
  const evidenceArrs = KPI_PERSONEL_EVID_KEYS.map(key => toStr(row[key]).split(KPI_PERSONEL_SEP));

  const days = [];
  for (let day = 0; day < 31; day++) {
    const submitted = submittedArr[day] === '1';
    const values = indicatorArrs.map(arr => arr[day] === '1');
    const evidence = evidenceArrs.map(arr => arr[day] || '');
    const possibleCount = indicatorArrs.filter(arr => arr[day] === '1' || arr[day] === '0').length;
    const onCount = indicatorArrs.filter(arr => arr[day] === '1').length;
    days.push({
      day: day + 1,
      submitted,
      values,
      evidence,
      dailyPercent: submitted && possibleCount > 0 ? (onCount / possibleCount) * 100 : null,
      jamDatang: jamDatangArr[day] || '',
      jamPulang: jamPulangArr[day] || '',
    });
  }
  return days;
}

function computeKpiPersonelMetrics(rows) {
  const splitArr = v => toStr(v).split(',');

  function computeOneRow(name, r) {
    const submittedArr = splitArr(r['Submitted']);
    const jamDatangArr = splitArr(r['JamDatang']);
    const jamPulangArr = splitArr(r['JamPulang']);

    let totalOn = 0, totalPossible = 0, hariSubmit = 0, totalMenitKerja = 0;
    for (let day = 0; day < 31; day++) {
      if (submittedArr[day] !== '1') continue;
      hariSubmit += 1;
      KPI_PERSONEL_INDICATOR_KEYS.forEach(key => {
        const arr = splitArr(r[key]);
        const v = arr[day];
        if (v === '1' || v === '0') {
          totalPossible += 1;
          if (v === '1') totalOn += 1;
        }
      });
      const jd = jamDatangArr[day], jp = jamPulangArr[day];
      if (/^\d{1,2}:\d{2}$/.test(jd) && /^\d{1,2}:\d{2}$/.test(jp)) {
        const [jdH, jdM] = jd.split(':').map(Number);
        const [jpH, jpM] = jp.split(':').map(Number);
        const diff = (jpH * 60 + jpM) - (jdH * 60 + jdM);
        if (diff > 0) totalMenitKerja += diff;
      }
    }

    return {
      name,
      hasData: hariSubmit > 0,
      percent: totalPossible > 0 ? (totalOn / totalPossible) * 100 : 0,
      totalJamKerja: totalMenitKerja / 60,
      hariSubmit,
      totalOn, totalPossible, totalMenitKerja,
    };
  }

  // Gabungkan beberapa baris bulan (dipakai untuk opsi "Semua Bulan") — dijumlahkan
  // per hari-indikator (bukan rata-rata per bulan begitu saja) supaya bulan dengan
  // lebih banyak hari kerja tercatat memang lebih berpengaruh ke persentase akhir.
  function computeOneRowMulti(name, rowsArr) {
    if (!rowsArr.length) return { name, hasData: false, percent: 0, totalJamKerja: 0, hariSubmit: 0 };
    const parts = rowsArr.map(r => computeOneRow(name, r));
    const totalOn = parts.reduce((s, p) => s + p.totalOn, 0);
    const totalPossible = parts.reduce((s, p) => s + p.totalPossible, 0);
    const totalMenitKerja = parts.reduce((s, p) => s + p.totalMenitKerja, 0);
    const hariSubmit = parts.reduce((s, p) => s + p.hariSubmit, 0);
    return {
      name,
      hasData: hariSubmit > 0,
      percent: totalPossible > 0 ? (totalOn / totalPossible) * 100 : 0,
      totalJamKerja: totalMenitKerja / 60,
      hariSubmit,
    };
  }

  // Kumpulkan baris per (orang, bulan) supaya bisa pindah-pindah bulan tanpa fetch ulang.
  const byPersonMonth = {};
  const monthsSet = new Set();
  rows.forEach(r => {
    const person = toStr(r['PersonSheet']);
    const ym = toStr(r['YearMonth']);
    if (KPI_PERSONEL_LIST.indexOf(person) === -1 || !ym) return;
    if (!byPersonMonth[person]) byPersonMonth[person] = {};
    byPersonMonth[person][ym] = r;
    monthsSet.add(ym);
  });
  const dataMonths = Array.from(monthsSet).sort(); // "K2026-07" dst — bulan yang SUDAH ada datanya
  const latestMonth = dataMonths.length ? dataMonths[dataMonths.length - 1] : null;

  // Filter bulan menampilkan SEMUA 12 bulan tahun yang bersangkutan (bukan cuma
  // yang sudah ada datanya), supaya bisa langsung dicek begitu datanya mulai
  // terisi di bulan-bulan berikutnya tanpa perlu update kode lagi — plus 1 opsi
  // "Semua Bulan" (ALL) di paling atas untuk lihat akumulasi seluruh bulan yang
  // sudah ada datanya sekaligus.
  const yearsPresent = new Set(dataMonths.map(m => (m.match(/^K(\d{4})/) || [])[1]).filter(Boolean));
  if (yearsPresent.size === 0) yearsPresent.add(String(new Date().getFullYear()));
  const months = ['ALL'];
  Array.from(yearsPresent).sort().forEach(y => {
    for (let mm = 1; mm <= 12; mm++) months.push('K' + y + '-' + String(mm).padStart(2, '0'));
  });

  function computeForMonth(ym) {
    const people = KPI_PERSONEL_LIST.map(name => {
      if (ym === 'ALL') {
        const rowsArr = dataMonths.map(m => byPersonMonth[name] && byPersonMonth[name][m]).filter(Boolean);
        return computeOneRowMulti(name, rowsArr);
      }
      const r = byPersonMonth[name] && byPersonMonth[name][ym];
      return r ? computeOneRow(name, r) : { name, hasData: false, percent: 0, totalJamKerja: 0, hariSubmit: 0 };
    });
    const withData = people.filter(p => p.hasData);
    const avgPercent = withData.length ? withData.reduce((s, p) => s + p.percent, 0) / withData.length : 0;
    const totalJamTeam = people.reduce((s, p) => s + p.totalJamKerja, 0);
    const ranking = people.slice().sort((a, b) => b.percent - a.percent);
    const best = withData.slice().sort((a, b) => b.percent - a.percent)[0] || null;
    const mostHours = withData.slice().sort((a, b) => b.totalJamKerja - a.totalJamKerja)[0] || null;
    return { people: ranking, avgPercent, totalJamTeam, best, mostHours, yearMonth: ym };
  }

  const byMonth = {};
  months.forEach(ym => { byMonth[ym] = computeForMonth(ym); });

  const current = latestMonth ? byMonth[latestMonth] : { people: [], avgPercent: 0, totalJamTeam: 0, best: null, yearMonth: null };

  return {
    months,
    byMonth,
    byPersonMonth,
    currentMonthLabel: latestMonth,
    people: current.people,
    avgPercent: current.avgPercent,
    totalJamTeam: current.totalJamTeam,
    best: current.best,
    mostHours: current.mostHours,
  };
}

// Bangun detail lengkap 1 personel x 1 bulan dari data yang SUDAH dimuat (tanpa fetch
// baru): tren harian, tren bulanan (semua bulan yang ada), indikator terkuat/terlemah,
// dan rincian per-tanggal untuk ditampilkan di modal detail.
function buildKpiPersonDetail(name, ym, byPersonMonth, months) {
  const labels = KPI_PERSONEL_LABELS[name] || [];
  const row = byPersonMonth[name] && byPersonMonth[name][ym];
  const days = row ? buildKpiDailyDetail(row) : [];

  const submittedDays = days.filter(d => d.submitted);
  const countedDays = submittedDays.length;
  const monthPercent = countedDays > 0
    ? submittedDays.reduce((s, d) => s + d.dailyPercent, 0) / countedDays
    : 0;

  const indicatorStats = labels.map((label, idx) => {
    const checked = submittedDays.filter(d => d.values[idx]).length;
    const possible = submittedDays.length;
    return { label, checked, possible, percent: possible > 0 ? Math.round((checked / possible) * 100) : 0 };
  });

  // Tie-break persis seperti aplikasi KPI REKAP: kalau persentase sama, bandingkan
  // akumulasi hari patuh (trueCount), lalu untuk indikator Absen Datang/Pulang
  // secara khusus, bandingkan seberapa lebar margin waktunya (bukan sekadar YA/TIDAK).
  const DATANG_CUTOFF = 8 * 60 + 15;
  const PULANG_CUTOFF = 16 * 60 + 45;
  const parseTimeToMinutes = (str) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(toStr(str));
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  };
  const datangMargins = [], pulangMargins = [];
  submittedDays.forEach(d => {
    const jd = parseTimeToMinutes(d.jamDatang);
    if (jd !== null) datangMargins.push(DATANG_CUTOFF - jd);
    const jp = parseTimeToMinutes(d.jamPulang);
    if (jp !== null) pulangMargins.push(jp - PULANG_CUTOFF);
  });
  const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  const datangAvg = avg(datangMargins), pulangAvg = avg(pulangMargins);

  const enriched = indicatorStats.map(s => {
    let marginScore = null;
    if (/absen datang/i.test(s.label)) marginScore = datangAvg;
    else if (/absen pulang/i.test(s.label)) marginScore = pulangAvg;
    return Object.assign({}, s, { marginScore });
  });

  let strongest = null, weakest = null;
  if (enriched.length) {
    const weakSorted = enriched.slice().sort((a, b) => {
      if (a.percent !== b.percent) return a.percent - b.percent;
      if (a.checked !== b.checked) return a.checked - b.checked;
      if (a.marginScore != null && b.marginScore != null && a.marginScore !== b.marginScore) return a.marginScore - b.marginScore;
      return 0;
    });
    const strongSorted = enriched.slice().sort((a, b) => {
      if (a.percent !== b.percent) return b.percent - a.percent;
      if (a.checked !== b.checked) return b.checked - a.checked;
      if (a.marginScore != null && b.marginScore != null && a.marginScore !== b.marginScore) return b.marginScore - a.marginScore;
      return 0;
    });
    weakest = weakSorted[0];
    strongest = strongSorted[0];
  }

  // Tren bulanan: hitung ulang persentase untuk SEMUA bulan yang ada datanya orang ini.
  const trend = months
    .filter(m => byPersonMonth[name] && byPersonMonth[name][m])
    .map(m => {
      const mDays = buildKpiDailyDetail(byPersonMonth[name][m]).filter(d => d.submitted);
      const pct = mDays.length ? mDays.reduce((s, d) => s + d.dailyPercent, 0) / mDays.length : 0;
      return { month: m, percent: Math.round(pct * 10) / 10 };
    });

  return { name, yearMonth: ym, days, countedDays, monthPercent, indicatorStats, strongest, weakest, trend };
}


function computeAllMetrics(sheetData) {

  const transactions = normalizeGrandData(sheetData.grandData.rows);
  const revRows = sheetData.revSum.rows;
  const salesSumRows = sheetData.salesSum.rows;
  const kpiRows = sheetData.kpiMonitor.rows;
  const stockRows = sheetData.stock.rows;
  const poRows = sheetData.poGudang.rows;
  const arRows = sheetData.ar.rows;

  const salesTrend = buildPeriodTrend(transactions, t => t.amount);
  const revTrend = buildRevenueTrend(revRows);
  // Disimpan terpisah agar render.js (sub-section Revenue di Daily
  // Performance) bisa menampilkan baris detail per transaksi tanpa
  // perlu mengulang proses normalisasi dari sheetData mentah.
  const revAllNormalized = normalizeRevSum(revRows);
  const invoiceCustomerSummary = buildInvoiceCustomerSummary(transactions);
  const yoyComparison = buildYoyComparison(salesSumRows);
  const salesByCompany = buildSalesByCompany(transactions);
  const revenueByCompany = buildRevenueByCompany(revRows);
  const salesToRevenueRatio = buildSalesToRevenueRatio(salesTrend.monthly, revTrend.monthly);
  const zonaWilayah = buildZonaWilayah(kpiRows, transactions);
  zonaWilayah.provinceZones = buildProvinceZones(zonaWilayah.wilayahData);
  const topProducts = buildTopProducts(transactions);
  const stock = buildStock(stockRows, transactions);
  const poGudang = buildPoGudang(poRows);
  const delivery = buildDelivery(transactions);
  const ar = buildAR(arRows, invoiceCustomerSummary.totalSales);
  const customerFrequency = buildCustomerFrequency(transactions);
  const fiberOptic1Core = buildFiberOptic1Core(transactions);
  const invoiceTargetKpi = buildInvoiceTargetFromKpiSheet(kpiRows);
  const kpiPersonel = computeKpiPersonelMetrics(sheetData.kpiPersonel ? sheetData.kpiPersonel.rows : []);

  return {
    transactions, salesTrend, revTrend, revAllNormalized, invoiceCustomerSummary, yoyComparison,
    salesByCompany, revenueByCompany, salesToRevenueRatio, zonaWilayah,
    topProducts, stock, poGudang, delivery, ar, customerFrequency, fiberOptic1Core, invoiceTargetKpi,
    kpiPersonel,
    generatedAt: new Date(),
  };
}
