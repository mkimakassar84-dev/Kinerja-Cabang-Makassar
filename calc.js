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
  })).filter(t => t.orderDate && t.amount >= 0);
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

  const months = [];
  for (let m = 0; m < 12; m++) {
    const row = salesSumRows[m];
    if (!row || !row.__row) continue;
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

  return {
    wilayahData, wilayahAktif, wilayahTanpaPembelanjaan, zoneCounts,
    coveragePerBulan, coveragePerKuartal, salesByWilayah,
    totalWilayah: wilayahData.length,
  };
}

/* ==========================================================================
   POIN 5 — KODE BARANG TERLARIS 2026 (by sales & quantity), by company
   ========================================================================== */
function buildTopProducts(transactions, topN = 15) {
  const tx2026 = filterYear(transactions, CURRENT_YEAR);

  const byProduct = Array.from(groupBy(tx2026, t => t.kodeBarang).entries())
    .filter(([kode]) => kode)
    .map(([kode, items]) => ({
      kode,
      sales: sum(items, i => i.amount),
      qty: sum(items, i => i.qty),
      invoiceUnik: uniqueCount(items, i => i.noInvoice),
    }));

  const topBySales = [...byProduct].sort((a, b) => b.sales - a.sales).slice(0, topN);
  const topByQty = [...byProduct].sort((a, b) => b.qty - a.qty).slice(0, topN);

  const byCompany = {};
  ['MKI', 'CFN'].forEach(co => {
    const txCo = tx2026.filter(t => t.company === co);
    const prodCo = Array.from(groupBy(txCo, t => t.kodeBarang).entries())
      .filter(([kode]) => kode)
      .map(([kode, items]) => ({ kode, sales: sum(items, i => i.amount), qty: sum(items, i => i.qty) }));
    byCompany[co] = {
      topBySales: [...prodCo].sort((a, b) => b.sales - a.sales).slice(0, topN),
      topByQty: [...prodCo].sort((a, b) => b.qty - a.qty).slice(0, topN),
    };
  });

  return { topBySales, topByQty, byCompany, totalProductCount: byProduct.length };
}

/* ==========================================================================
   POIN 6 — STOCK GUDANG & PO GUDANG
   ========================================================================== */
function buildStock(stockRows, transactions) {
  // Header asli sheet hanya terbaca untuk kolom A-C (Jenis Barang, Kode Barang,
  // Deskripsi) karena baris 1 berisi tanggal merged-cell sehingga label kolom
  // D ke kanan (Turnover, Total Stock by Company) tidak terbaca gviz sebagai
  // nama kolom. Maka kolom stock diakses berdasarkan index posisi (__row),
  // sesuai struktur asli: A=0 Jenis, B=1 Kode, C=2 Deskripsi, D=3 MKI Turnover,
  // E=4 CFN Turnover, F=5 MKI&CFN Turnover, G=6 Stock MKI, H=7 Stock CFN, I=8 Stock MKI&CFN.
  const items = stockRows
    .map(r => {
      const row = r.__row || [];
      return {
        jenis: toStr(row[0]),
        kode: toStr(row[1]).toUpperCase(),
        deskripsi: toStr(row[2]),
        stockMKI: toNumber(row[6]),
        stockCFN: toNumber(row[7]),
        stockTotal: toNumber(row[8]),
      };
    })
    .filter(r => r.kode);

  const totalStockMKI = sum(items, i => i.stockMKI);
  const totalStockCFN = sum(items, i => i.stockCFN);
  const totalStockAll = sum(items, i => i.stockTotal);

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
    items, totalStockMKI, totalStockCFN, totalStockAll,
    itemCount: items.length,
    stockTidakTerjual, stockTerjualDibawah5,
  };
}

function buildPoGudang(poRows) {
  const items = poRows.map(r => ({
    no: toStr(r['NO']),
    orderDate: toDate(r['Order Date']),
    noPO: toStr(r['NO PO']),
    company: toStr(r['COMPANY']).toUpperCase(),
    kodeBarang: toStr(r['Kode Barang']).toUpperCase(),
    qty: toNumber(r['Quantity']),
    noSuratJalan: toStr(r['NO Surat Jalan']),
    statusEkspedisi: toStr(r['Status (Ekspedisi)']),
    stage: toStr(r['Stage']),
    qtyDiterima: toNumber(r['Quantity Diterima (GD MKS)']),
    tglMasukGudang: toDate(r['Tanggal Masuk GD MKS']),
  })).filter(p => p.orderDate);

  const totalPO = items.length;
  const totalQtyPO = sum(items, i => i.qty);
  const totalQtyDiterima = sum(items, i => i.qtyDiterima);
  const completeCount = items.filter(i => i.stage.toLowerCase() === 'complete').length;

  const byCompany = {};
  ['MKI', 'CFN'].forEach(co => {
    const itemsCo = items.filter(i => i.company === co);
    byCompany[co] = { count: itemsCo.length, qty: sum(itemsCo, i => i.qty), qtyDiterima: sum(itemsCo, i => i.qtyDiterima) };
  });

  const monthly = {};
  items.forEach(p => {
    const key = monthKey(p.orderDate);
    if (!key) return;
    if (!monthly[key]) monthly[key] = { key, label: MONTH_NAMES_ID[p.orderDate.getMonth()], count: 0, qty: 0 };
    monthly[key].count += 1;
    monthly[key].qty += p.qty;
  });

  return { items, totalPO, totalQtyPO, totalQtyDiterima, completeCount, byCompany, monthly: Object.values(monthly).sort((a,b)=>a.key.localeCompare(b.key)) };
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

function buildRevenueByCompany(revRows) {
  const rev2026 = revRows
    .map(r => ({
      paymentDate: toDate(r['Payment Date']),
      noFaktur: toStr(r['No Faktur']),
      customer: toStr(r['Customer']).toUpperCase(),
      pelunasan: toNumber(r['Pelunasan']),
      company: toStr(r['Company']).toUpperCase(),
    }))
    .filter(r => r.paymentDate && r.paymentDate.getFullYear() === CURRENT_YEAR);

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
  const rev2026 = revRows
    .map(r => ({ paymentDate: toDate(r['Payment Date']), pelunasan: toNumber(r['Pelunasan']), noFaktur: toStr(r['No Faktur']), customer: toStr(r['Customer']).toUpperCase() }))
    .filter(r => r.paymentDate && r.paymentDate.getFullYear() === CURRENT_YEAR);

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
  const items = arRows.map(r => ({
    tanggal: toDate(r['Tanggal']),
    noFaktur: toStr(r['No Faktur']),
    customer: toStr(r['Nama Customer']).toUpperCase(),
    nilaiFaktur: toNumber(r['Nilai Faktur']),
    sisaSaldo: toNumber(r['Sisa Saldo Piutang']),
    paidAmount: toNumber(r['Paid Amount']),
    aging: toStr(r['Aging']),
    kategori: toStr(r['Kategori']),
    status: toStr(r['Status']),
    company: toStr(r['Company']).toUpperCase(),
  })).filter(a => a.noFaktur);

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

  const top10ByFrequency = [...byCustomer].sort((a, b) => b.invoiceUnik - a.invoiceUnik).slice(0, 10);
  const top10BySales = [...byCustomer].sort((a, b) => b.totalSales - a.totalSales).slice(0, 10);

  // Customer yang tidak belanja lagi >= 60 hari sejak pembelian terakhir
  const churnedCustomers = byCustomer
    .filter(c => c.daysSinceLastPurchase !== null && c.daysSinceLastPurchase >= 60)
    .sort((a, b) => b.daysSinceLastPurchase - a.daysSinceLastPurchase);

  const avgFrequency = byCustomer.length > 0 ? sum(byCustomer, c => c.invoiceUnik) / byCustomer.length : 0;
  const avgSalesPerCustomer = byCustomer.length > 0 ? sum(byCustomer, c => c.totalSales) / byCustomer.length : 0;

  return {
    byCustomer, top10ByFrequency, top10BySales, churnedCustomers,
    totalCustomer: byCustomer.length, avgFrequency, avgSalesPerCustomer,
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
  const invoiceCustomerSummary = buildInvoiceCustomerSummary(transactions);
  const yoyComparison = buildYoyComparison(salesSumRows);
  const salesByCompany = buildSalesByCompany(transactions);
  const revenueByCompany = buildRevenueByCompany(revRows);
  const salesToRevenueRatio = buildSalesToRevenueRatio(salesTrend.monthly, revTrend.monthly);
  const zonaWilayah = buildZonaWilayah(kpiRows, transactions);
  const topProducts = buildTopProducts(transactions);
  const stock = buildStock(stockRows, transactions);
  const poGudang = buildPoGudang(poRows);
  const delivery = buildDelivery(transactions);
  const ar = buildAR(arRows, invoiceCustomerSummary.totalSales);
  const customerFrequency = buildCustomerFrequency(transactions);
  const fiberOptic1Core = buildFiberOptic1Core(transactions);

  return {
    transactions, salesTrend, revTrend, invoiceCustomerSummary, yoyComparison,
    salesByCompany, revenueByCompany, salesToRevenueRatio, zonaWilayah,
    topProducts, stock, poGudang, delivery, ar, customerFrequency, fiberOptic1Core,
    generatedAt: new Date(),
  };
}
