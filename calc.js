/* ============================================================
   CALC — Mengubah data mentah dari sheet jadi metrik siap pakai
   ============================================================
   Semua kolom diakses berbasis INDEX (posisi), bukan nama header,
   karena beberapa tab sumber punya nama kolom duplikat di blok
   yang berbeda (lihat catatan di data-loader.js). Index di bawah
   sudah diverifikasi terhadap struktur sheet aktual — jika sheet
   ditambah/dikurangi kolom di sisi kiri, index ini perlu disesuaikan.
   ============================================================ */

const MONTH_NAMES_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

// Index kolom (0-based) untuk tiap tab, sesuai urutan kolom asli di sheet.
const COL = {
  grandData: {
    orderDate: 0, noInvoice: 1, payment: 2, customer: 3, kodeBarang: 4,
    quantity: 5, amount: 6, status: 7, company: 8, koli: 9, stage: 10,
    statusEkspedisi: 11, lokasi: 12, tanggalTerkirim: 13,
  },
  ar: {
    tanggal: 0, noFaktur: 1, namaCustomer: 2, nilaiFaktur: 3, sisaSaldo: 4,
    paidAmount: 5, aging: 6, kategori: 7, status: 8, company: 9,
  },
  stock: {
    jenisBarang: 0, kodeBarang: 1, deskripsi: 2, mkiTurnover: 3, cfnTurnover: 4,
    mkiCfnTurnover: 5, mki: 6, cfn: 7, mkiCfn: 8,
  },
  delivery: {
    tglCetak: 0, tglKirim: 1, noSJ: 2, customer: 3, kodeProduk: 4,
    qty: 5, koli: 6, ekspedisi: 7, lokasi: 8, companies: 9,
  },
  poGudang: {
    no: 0, orderDate: 1, noPo: 2, company: 3, kodeBarang: 4, quantity: 5,
    noSuratJalan: 6, statusEkspedisi: 7, stage: 8, qtyDiterima: 9, tglMasukGdMks: 10,
  },
};

function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function toDate(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function toStr(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function fmtRupiah(n, opts = {}) {
  const { compact = false } = opts;
  if (compact) {
    const abs = Math.abs(n);
    if (abs >= 1e9) return `Rp${(n / 1e9).toFixed(2).replace(/\.00$/, '')} M`;
    if (abs >= 1e6) return `Rp${(n / 1e6).toFixed(1).replace(/\.0$/, '')} Jt`;
  }
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

function fmtNum(n) {
  return Math.round(n).toLocaleString('id-ID');
}

function fmtPct(n, digits = 1) {
  return `${n.toFixed(digits)}%`;
}

function sum(arr, fn) {
  return arr.reduce((acc, x) => acc + (fn ? fn(x) : x), 0);
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  }
  return m;
}

/* ---------- Normalisasi baris transaksi (Grand Data 2026) ---------- */
function normalizeTransactions(rows) {
  const c = COL.grandData;
  return rows
    .map(r => ({
      orderDate: toDate(r[c.orderDate]),
      noInvoice: toStr(r[c.noInvoice]),
      payment: toStr(r[c.payment]),
      customer: toStr(r[c.customer]),
      kodeBarang: toStr(r[c.kodeBarang]),
      quantity: toNumber(r[c.quantity]),
      amount: toNumber(r[c.amount]),
      status: toStr(r[c.status]),
      company: toStr(r[c.company]),
      koli: toNumber(r[c.koli]),
      stage: toStr(r[c.stage]),
      statusEkspedisi: toStr(r[c.statusEkspedisi]),
      lokasi: toStr(r[c.lokasi]).toUpperCase(),
      tanggalTerkirim: toDate(r[c.tanggalTerkirim]),
    }))
    .filter(r => r.orderDate && r.kodeBarang);
}

/* ---------- Section 1 & 2: Tren Sales & Revenue per bulan ---------- */
function buildMonthlyTrend(transactions) {
  const byMonth = groupBy(transactions, t => monthKey(t.orderDate));
  const months = Array.from(byMonth.keys()).sort();
  return months.map(mk => {
    const items = byMonth.get(mk);
    const [y, mo] = mk.split('-').map(Number);
    return {
      key: mk,
      label: `${MONTH_NAMES_ID[mo - 1]} ${y}`,
      totalAmount: sum(items, i => i.amount),
      totalQty: sum(items, i => i.quantity),
      totalTransaksi: new Set(items.map(i => i.noInvoice)).size,
    };
  });
}

/* ---------- Section 3: Rasio sales vs revenue realisasi ---------- */
function buildRatio(salesTrend, revenueTrend) {
  const revByKey = new Map(revenueTrend.map(r => [r.key, r.totalAmount]));
  return salesTrend.map(s => {
    const rev = revByKey.get(s.key) || 0;
    const ratio = s.totalAmount > 0 ? (rev / s.totalAmount) * 100 : 0;
    return { ...s, revenue: rev, ratio };
  });
}

/* ---------- Section 4: Performa & Zona Wilayah ---------- */
function buildZonaWilayah(transactions) {
  const byLokasi = groupBy(transactions.filter(t => t.lokasi), t => t.lokasi);
  const rows = Array.from(byLokasi.entries()).map(([lokasi, items]) => ({
    lokasi,
    totalAmount: sum(items, i => i.amount),
    totalQty: sum(items, i => i.quantity),
    totalTransaksi: new Set(items.map(i => i.noInvoice)).size,
  }));
  rows.sort((a, b) => b.totalAmount - a.totalAmount);

  const grandTotal = sum(rows, r => r.totalAmount) || 1;
  let cum = 0;
  rows.forEach(r => {
    cum += r.totalAmount;
    const cumPct = cum / grandTotal;
    r.share = (r.totalAmount / grandTotal) * 100;
    if (cumPct <= 0.7) r.zone = 'hijau';
    else if (cumPct <= 0.9) r.zone = 'kuning';
    else r.zone = 'merah';
  });
  return rows;
}

/* ---------- Section 5: Kode Barang Terlaris ---------- */
function buildTopProducts(transactions, topN = 15) {
  const byKode = groupBy(transactions.filter(t => t.kodeBarang), t => t.kodeBarang);
  const rows = Array.from(byKode.entries()).map(([kode, items]) => ({
    kodeBarang: kode,
    totalAmount: sum(items, i => i.amount),
    totalQty: sum(items, i => i.quantity),
    totalTransaksi: items.length,
  }));
  const byAmount = [...rows].sort((a, b) => b.totalAmount - a.totalAmount).slice(0, topN);
  const byQty = [...rows].sort((a, b) => b.totalQty - a.totalQty).slice(0, topN);
  return { byAmount, byQty };
}

/* ---------- Section 6: Stock & PO Gudang ---------- */
function buildStock(stockRows) {
  const c = COL.stock;
  return stockRows
    .map(r => ({
      jenis: toStr(r[c.jenisBarang]),
      kode: toStr(r[c.kodeBarang]),
      deskripsi: toStr(r[c.deskripsi]),
      mkiStock: toNumber(r[c.mki]),
      cfnStock: toNumber(r[c.cfn]),
    }))
    .filter(r => r.kode);
}

function buildPoGudang(poRows) {
  const c = COL.poGudang;
  return poRows
    .map(r => ({
      orderDate: toDate(r[c.orderDate]),
      noPo: toStr(r[c.noPo]),
      company: toStr(r[c.company]),
      kodeBarang: toStr(r[c.kodeBarang]),
      quantity: toNumber(r[c.quantity]),
      stage: toStr(r[c.stage]),
      qtyDiterima: toNumber(r[c.qtyDiterima]),
      tglMasuk: toDate(r[c.tglMasukGdMks]),
    }))
    .filter(r => r.noPo);
}

/* ---------- Section 7: Delivery & Ekspedisi ---------- */
function buildDelivery(deliveryRows) {
  const c = COL.delivery;
  const rows = deliveryRows
    .map(r => ({
      tglCetak: toDate(r[c.tglCetak]),
      tglKirim: toDate(r[c.tglKirim]),
      noSJ: toStr(r[c.noSJ]),
      customer: toStr(r[c.customer]),
      kodeProduk: toStr(r[c.kodeProduk]),
      qty: toNumber(r[c.qty]),
      koli: toNumber(r[c.koli]),
      ekspedisi: toStr(r[c.ekspedisi]),
      lokasi: toStr(r[c.lokasi]).toUpperCase(),
      company: toStr(r[c.companies]),
    }))
    .filter(r => r.noSJ);

  const byEkspedisi = groupBy(rows.filter(r => r.ekspedisi), r => r.ekspedisi);
  const ekspedisiBreakdown = Array.from(byEkspedisi.entries())
    .map(([nama, items]) => ({ nama, totalKirim: new Set(items.map(i => i.noSJ)).size, totalQty: sum(items, i => i.qty) }))
    .sort((a, b) => b.totalKirim - a.totalKirim);

  const handCarry = rows.filter(r => r.ekspedisi.toUpperCase().includes('HAND CARRY'));
  const nonHandCarry = rows.filter(r => !r.ekspedisi.toUpperCase().includes('HAND CARRY'));

  return {
    rows, ekspedisiBreakdown,
    handCarryCount: new Set(handCarry.map(r => r.noSJ)).size,
    nonHandCarryCount: new Set(nonHandCarry.map(r => r.noSJ)).size,
  };
}

/* ---------- Section 8: Piutang (AR) — dihitung ulang dari data mentah ---------- */
function buildAR(arRows, asOfDate = new Date()) {
  const c = COL.ar;
  const rows = arRows
    .map(r => {
      const tanggal = toDate(r[c.tanggal]);
      const nilaiFaktur = toNumber(r[c.nilaiFaktur]);
      const sisaSaldo = toNumber(r[c.sisaSaldo]);
      let agingDays = null;
      if (tanggal) agingDays = Math.floor((asOfDate.getTime() - tanggal.getTime()) / (1000 * 60 * 60 * 24));
      const statusLunas = sisaSaldo <= 0 ? 'Lunas' : 'Belum Lunas';
      let kategori = 'N/A';
      if (statusLunas === 'Lunas') kategori = 'Lunas';
      else if (agingDays !== null) {
        if (agingDays <= 30) kategori = '0–30 Hari';
        else if (agingDays <= 60) kategori = '31–60 Hari';
        else kategori = 'Diatas 60 Hari';
      }
      return {
        tanggal,
        noFaktur: toStr(r[c.noFaktur]),
        customer: toStr(r[c.namaCustomer]),
        nilaiFaktur, sisaSaldo, agingDays, kategori, statusLunas,
        company: toStr(r[c.company]),
      };
    })
    .filter(r => r.noFaktur && r.tanggal);

  const outstanding = rows.filter(r => r.statusLunas === 'Belum Lunas');
  const totalOutstanding = sum(outstanding, r => r.sisaSaldo);
  const byKategori = groupBy(outstanding, r => r.kategori);
  const agingBreakdown = ['0–30 Hari', '31–60 Hari', 'Diatas 60 Hari'].map(k => ({
    kategori: k,
    total: sum(byKategori.get(k) || [], r => r.sisaSaldo),
    jumlahFaktur: (byKategori.get(k) || []).length,
  }));

  const byCustomer = groupBy(outstanding, r => r.customer);
  const topDebtors = Array.from(byCustomer.entries())
    .map(([customer, items]) => ({ customer, total: sum(items, i => i.sisaSaldo), jumlahFaktur: items.length }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  return { rows, outstanding, totalOutstanding, agingBreakdown, topDebtors };
}

/* ---------- Section 9: Frekuensi Customer (dari Grand Data 2026) ---------- */
function buildCustomerFrequency(transactions, asOfDate = new Date()) {
  const byCustomer = groupBy(transactions.filter(t => t.customer), t => t.customer);
  const rows = Array.from(byCustomer.entries()).map(([customer, items]) => {
    const dates = items.map(i => i.orderDate).filter(Boolean).sort((a, b) => b - a);
    const lastOrder = dates[0] || null;
    const gapDays = lastOrder ? Math.floor((asOfDate.getTime() - lastOrder.getTime()) / (1000 * 60 * 60 * 24)) : null;
    const totalBelanja = sum(items, i => i.amount);
    const jumlahTransaksi = new Set(items.map(i => i.noInvoice)).size;
    let kategori = 'Baru';
    if (jumlahTransaksi >= 10) kategori = 'Loyal';
    else if (jumlahTransaksi >= 3) kategori = 'Reguler';
    if (gapDays !== null && gapDays > 90) kategori = 'Dorman';
    return { customer, lastOrder, gapDays, totalBelanja, jumlahTransaksi, kategori };
  });
  rows.sort((a, b) => b.totalBelanja - a.totalBelanja);

  const distKategori = groupBy(rows, r => r.kategori);
  const distribution = ['Loyal', 'Reguler', 'Baru', 'Dorman'].map(k => ({
    kategori: k,
    jumlahCustomer: (distKategori.get(k) || []).length,
  }));

  return { rows, distribution };
}

/* ---------- Master calc: jalankan semua kalkulasi dari data mentah ---------- */
function computeAllMetrics(sheetData) {
  const transactions = normalizeTransactions(sheetData.grandData.rows);
  const salesTrend = buildMonthlyTrend(transactions);
  // Revenue didekati dari transaksi yang sudah berstatus selesai (Stage = Complete).
  const completedTx = transactions.filter(t => t.stage.toLowerCase() === 'complete');
  const revenueTrend = buildMonthlyTrend(completedTx);
  const ratio = buildRatio(salesTrend, revenueTrend);
  const zonaWilayah = buildZonaWilayah(transactions);
  const topProducts = buildTopProducts(transactions);
  const stock = buildStock(sheetData.stock.rows);
  const poGudang = buildPoGudang(sheetData.poGudang.rows);
  const delivery = buildDelivery(sheetData.delivery.rows);
  const ar = buildAR(sheetData.ar.rows);
  const custFreq = buildCustomerFrequency(transactions);

  const allDates = transactions.map(t => t.orderDate).filter(Boolean);
  const minDate = allDates.length ? new Date(Math.min(...allDates)) : null;
  const maxDate = allDates.length ? new Date(Math.max(...allDates)) : null;

  return {
    transactions, salesTrend, revenueTrend, ratio, zonaWilayah, topProducts,
    stock, poGudang, delivery, ar, custFreq,
    meta: {
      totalRows: transactions.length,
      periodLabel: minDate && maxDate
        ? `${minDate.toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' })} – ${maxDate.toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' })}`
        : '—',
    },
  };
}
