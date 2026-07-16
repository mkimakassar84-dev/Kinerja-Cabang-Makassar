/* ==========================================================================
   RENDER — Membangun DOM untuk setiap section dashboard dari objek metrics.
   Chart dibuat dengan Chart.js. Setiap section punya kontrol interaktif
   (toggle bulan/kuartal/semester, filter produk/perusahaan) yang re-render
   chart secara dinamis tanpa reload data.
   ========================================================================== */

const CHART_REGISTRY = {}; // simpan instance Chart.js per canvasId agar bisa di-destroy sebelum re-render

function makeChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (CHART_REGISTRY[canvasId]) {
    CHART_REGISTRY[canvasId].destroy();
  }
  const chart = new Chart(canvas.getContext('2d'), config);
  CHART_REGISTRY[canvasId] = chart;
  return chart;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str === null || str === undefined ? '' : String(str);
  return div.innerHTML;
}

function zonePillHtml(zone) {
  const map = { hijau: ['Hijau', 'zone-hijau'], kuning: ['Kuning', 'zone-kuning'], merah: ['Merah', 'zone-merah'] };
  const [label, cls] = map[zone] || ['-', ''];
  return `<span class="zone-pill ${cls}">${label}</span>`;
}

function deltaHtml(pct) {
  const cls = pct >= 0 ? 'delta-up' : 'delta-down';
  const sign = pct >= 0 ? '+' : '';
  const arrow = pct >= 0 ? '&#8593;' : '&#8595;';
  return `<span class="delta ${cls}">${arrow} ${sign}${fmtPct(pct)}</span>`;
}

function achievementPillHtml(actual, target) {
  if (!target || target <= 0) return '<span class="achv-pill achv-na">&ndash;</span>';
  const pct = (actual / target) * 100;
  const cls = pct >= 100 ? 'achv-hit' : (pct >= 80 ? 'achv-near' : 'achv-miss');
  return `<span class="achv-pill ${cls}">${fmtPct(pct)}</span>`;
}

// Chart.js default font & color agar konsisten dengan tema dashboard
function applyChartDefaults() {
  Chart.defaults.font.family = "'IBM Plex Sans', sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#5c574f';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;

  // Mobile-friendly tap targets: tooltip muncul begitu jari menyentuh dekat
  // batang/titik data (tidak perlu presisi tap tepat di atasnya), teks tooltip
  // dan legend diperbesar sedikit, serta titik line-chart diperbesar area sentuhnya.
  Chart.defaults.interaction.mode = 'nearest';
  Chart.defaults.interaction.intersect = false;
  Chart.defaults.interaction.axis = 'xy';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.titleFont = { size: 13, weight: '600' };
  Chart.defaults.plugins.tooltip.bodyFont = { size: 12.5 };
  Chart.defaults.plugins.tooltip.displayColors = true;
  Chart.defaults.plugins.legend.labels.font = { size: 12.5 };
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.elements.point.radius = 3.5;
  Chart.defaults.elements.point.hoverRadius = 6;
  Chart.defaults.elements.point.hitRadius = 12; // area sentuh lebih lebar dari titik yang terlihat
  Chart.defaults.elements.bar.hoverBackgroundColor = undefined; // biarkan warna asli, cuma andalkan tooltip
  Chart.defaults.onHover = (event, elements, chart) => {
    if (event.native) event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
  };
}

// Plugin custom untuk menampilkan label nominal Rupiah di atas bar chart
const rpDataLabels = {
  id: 'rpDataLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, dsIndex) => {
      if (!dataset.showLabel) return;
      const meta = chart.getDatasetMeta(dsIndex);
      meta.data.forEach((bar, idx) => {
        const value = dataset.data[idx];
        if (!value) return;
        ctx.save();
        ctx.font = '600 10px IBM Plex Mono, monospace';
        ctx.fillStyle = '#5c574f';
        ctx.textAlign = 'center';
        const label = dataset.labelFormat === 'rupiah' ? fmtRupiahShort(value) : fmtNum(value);
        ctx.fillText(label, bar.x, bar.y - 6);
        ctx.restore();
      });
    });
  }
};
if (typeof Chart !== 'undefined') Chart.register(rpDataLabels);

// Versi singkat khusus untuk label di atas chart (supaya tidak menumpuk),
// catatan: tabel & ringkasan tetap pakai fmtRupiah penuh sesuai permintaan.
function fmtRupiahShort(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + ' M';
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' Jt';
  return fmtNum(n);
}

/* ==========================================================================
   HELPER — PAGINATION STATIS
   Untuk tabel-tabel non-reaktif (bukan state-driven), makePagBtns menghasilkan
   HTML tombol pagination, attachPagBtns mengikat event listener-nya.
   ========================================================================== */
function makePagBtns(id, currentPage, totalPages, onPage) {
  if (totalPages <= 1) return '';
  const pages = [];
  if (totalPages <= 7) { for (let i=1; i<=totalPages; i++) pages.push(i); }
  else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    for (let i=Math.max(2,currentPage-1); i<=Math.min(totalPages-1,currentPage+1); i++) pages.push(i);
    if (currentPage < totalPages-2) pages.push('...');
    pages.push(totalPages);
  }
  return `
    <button class="page-btn page-nav" data-dir="prev" ${currentPage===1?'disabled':''} aria-label="Sebelumnya">&larr;</button>
    ${pages.map(p => p==='...'
      ? `<span class="page-ellipsis">&hellip;</span>`
      : `<button class="page-btn ${p===currentPage?'active':''}" data-page="${p}">${p}</button>`
    ).join('')}
    <button class="page-btn page-nav" data-dir="next" ${currentPage===totalPages?'disabled':''} aria-label="Berikutnya">&rarr;</button>
  `;
}
function attachPagBtns(elId, onPage) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.querySelectorAll('.page-btn[data-page]').forEach(btn =>
    btn.addEventListener('click', () => onPage(parseInt(btn.dataset.page, 10)))
  );
  el.querySelectorAll('.page-btn[data-dir]').forEach(btn =>
    btn.addEventListener('click', () => {
      const cur = parseInt(el.querySelector('.page-btn.active')?.textContent || '1', 10);
      const total = Math.max(...[...el.querySelectorAll('.page-btn[data-page]')].map(b => parseInt(b.dataset.page,10)).filter(n=>!isNaN(n)));
      if (btn.dataset.dir==='prev' && cur>1) onPage(cur-1);
      if (btn.dataset.dir==='next' && cur<total) onPage(cur+1);
    })
  );
}

/* ==========================================================================
   SECTION 00 — DAILY PERFORMANCE (Lampiran Harian, 4 Sub-Section)
   Sub-section: Sales (Grand Data 2026), Revenue (Rev SUM kolom A-E),
   Account Receivable (AR 2026 kolom L-S), Delivery (Grand Data 2026,
   fokus status pengiriman). Setiap sub-section punya filter bulan +
   search sendiri, diurutkan ascending berdasarkan tanggal, dipaginasi
   20 baris per halaman, navigasi via tab horizontal (bukan scroll).
   ========================================================================== */
const DAILY_PERF_PAGE_SIZE = 20;

// State per sub-tab, terpisah supaya filter/halaman tidak saling timpa
// ketika berpindah tab.
const dailyPerfState = {
  kpi:      { month: 'all' }, // default Semua Bulan
  sales:    { month: 'all', search: '', page: 1 },
  revenue:  { month: 'all', search: '', page: 1 },
  ar:       { month: 'all', search: '', page: 1 },
  delivery: { month: 'all', search: '', page: 1 },
  po:       { month: 'all', search: '', page: 1 },
};
let dailyPerfActiveTab = 'kpi';

function renderDailyPerformanceSection(m) {
  const tx2026 = filterYear(m.transactions, CURRENT_YEAR);
  const rev2026 = m.revAllNormalized.filter(r => r.paymentDate.getFullYear() === CURRENT_YEAR);

  const html = `
    <div class="section-head">
      <div class="eyebrow">01 &mdash; Lampiran Harian</div>
      <h2>Daily Performance Cabang Makassar</h2>
      <p class="lede">Ringkasan KPI dan rincian transaksi harian untuk Cabang Makassar tahun 2026. Pilih tab di bawah untuk berpindah antar panel.</p>
    </div>

    <div class="subtab-bar" id="dailyPerfTabBar">
      <button class="subtab-btn active" data-tab="kpi">KPI Monitoring</button>
      <button class="subtab-btn" data-tab="delivery">Delivery</button>
      <button class="subtab-btn" data-tab="logistik">Turnover Gudang</button>
      <button class="subtab-btn" data-tab="sales">Sales</button>
      <button class="subtab-btn" data-tab="revenue">Revenue</button>
      <button class="subtab-btn" data-tab="ar">Account Receivable</button>
      <button class="subtab-btn" data-tab="po">PO Gudang</button>
      <button class="subtab-btn" data-tab="coverage">Coverage Area</button>
    </div>

    <div class="subtab-panel active" id="dpPanel-kpi"></div>
    <div class="subtab-panel" id="dpPanel-delivery"></div>
    <div class="subtab-panel" id="dpPanel-logistik"></div>
    <div class="subtab-panel" id="dpPanel-sales"></div>
    <div class="subtab-panel" id="dpPanel-revenue"></div>
    <div class="subtab-panel" id="dpPanel-ar"></div>
    <div class="subtab-panel" id="dpPanel-po"></div>
    <div class="subtab-panel" id="dpPanel-coverage"></div>
  `;
  document.getElementById('s0').innerHTML = html;

  document.getElementById('dailyPerfTabBar').addEventListener('click', (e) => {
    const btn = e.target.closest('.subtab-btn');
    if (!btn) return;
    dailyPerfActiveTab = btn.dataset.tab;
    document.querySelectorAll('#dailyPerfTabBar .subtab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('#s0 .subtab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`dpPanel-${dailyPerfActiveTab}`).classList.add('active');
  });

  renderDpKpiPanel(tx2026, rev2026, m.yoyComparison.months);
  renderDpSalesPanel(tx2026);
  renderDpRevenuePanel(rev2026);
  renderDpArPanel(m.ar.items);
  renderDpDeliveryPanel(tx2026);
  renderDpPoGudangPanel(m.poGudang.items);
  renderDpLogistikPanel(tx2026, m.stock);
  renderDpCoverageAreaPanel(m.zonaWilayah);
}

/* ----- Helper generik: kerangka panel filter bulan + search + tabel + pagination ----- */
function dpMonthSelectHtml(id) {
  const monthOptions = MONTH_NAMES_ID.map((label, idx) => `<option value="${idx}">${label}</option>`).join('');
  return `
    <select id="${id}" class="select-input">
      <option value="all">Semua Bulan</option>
      ${monthOptions}
    </select>
  `;
}

function dpPeriodLabel(monthVal) {
  return monthVal === 'all' ? 'seluruh tahun 2026' : `bulan <strong>${MONTH_NAMES_ID[parseInt(monthVal, 10)]}</strong>`;
}

function dpRangeLabel(totalRows, startIdx, shownLen) {
  return totalRows
    ? `${fmtNum(startIdx + 1)}&ndash;${fmtNum(startIdx + shownLen)} dari ${fmtNum(totalRows)}`
    : '0';
}

function renderDpPagination(elId, state, totalPages, onRender) {
  const el = document.getElementById(elId);
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const pages = [];
  const windowSize = 7;
  if (totalPages <= windowSize) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    let start = Math.max(2, state.page - 2);
    let end = Math.min(totalPages - 1, state.page + 2);
    if (start > 2) pages.push('...');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
  }

  el.innerHTML = `
    <button class="page-btn page-nav" id="${elId}-prev" ${state.page === 1 ? 'disabled' : ''} aria-label="Halaman sebelumnya">&larr;</button>
    ${pages.map(p => p === '...'
      ? `<span class="page-ellipsis">&hellip;</span>`
      : `<button class="page-btn ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`
    ).join('')}
    <button class="page-btn page-nav" id="${elId}-next" ${state.page === totalPages ? 'disabled' : ''} aria-label="Halaman berikutnya">&rarr;</button>
  `;

  el.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.page = parseInt(btn.dataset.page, 10);
      onRender();
      document.getElementById('s0').scrollTop = 0;
    });
  });
  const prevBtn = document.getElementById(`${elId}-prev`);
  const nextBtn = document.getElementById(`${elId}-next`);
  if (prevBtn) prevBtn.addEventListener('click', () => {
    if (state.page > 1) { state.page -= 1; onRender(); document.getElementById('s0').scrollTop = 0; }
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    if (state.page < totalPages) { state.page += 1; onRender(); document.getElementById('s0').scrollTop = 0; }
  });
}

/* ----- Pagination generik ringan (tanpa efek scroll khusus Daily Performance),
   dipakai untuk tabel mini di luar section Daily Performance, mis. Section 06. ----- */
function renderMiniPagination(elId, state, totalPages, onRender) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const pages = [];
  const windowSize = 7;
  if (totalPages <= windowSize) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    let start = Math.max(2, state.page - 2);
    let end = Math.min(totalPages - 1, state.page + 2);
    if (start > 2) pages.push('...');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
  }

  el.innerHTML = `
    <button class="page-btn page-nav" id="${elId}-prev" ${state.page === 1 ? 'disabled' : ''} aria-label="Halaman sebelumnya">&larr;</button>
    ${pages.map(p => p === '...'
      ? `<span class="page-ellipsis">&hellip;</span>`
      : `<button class="page-btn ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`
    ).join('')}
    <button class="page-btn page-nav" id="${elId}-next" ${state.page === totalPages ? 'disabled' : ''} aria-label="Halaman berikutnya">&rarr;</button>
  `;

  el.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => { state.page = parseInt(btn.dataset.page, 10); onRender(); });
  });
  const prevBtn = document.getElementById(`${elId}-prev`);
  const nextBtn = document.getElementById(`${elId}-next`);
  if (prevBtn) prevBtn.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; onRender(); } });
  if (nextBtn) nextBtn.addEventListener('click', () => { if (state.page < totalPages) { state.page += 1; onRender(); } });
}

/* ----- Sub-section: KPI MONITORING ----- */
function renderDpKpiPanel(tx2026, rev2026, yoyMonths) {
  const html = `
    <div class="panel">
      <div class="panel-head daily-perf-controls">
        <div class="filter-field">
          <label for="dpKpiMonth">Periode</label>
          ${dpMonthSelectHtml('dpKpiMonth')}
        </div>
      </div>
      <div id="dpKpiContent"></div>
    </div>
  `;
  document.getElementById('dpPanel-kpi').innerHTML = html;

  // Set default ke bulan berjalan; 'all' = semua bulan
  const kpiMonthEl = document.getElementById('dpKpiMonth');
  kpiMonthEl.value = dailyPerfState.kpi.month;

  const kpiBar = (pct, thresholdHit = 100, thresholdWarn = 60) => {
    const capped = Math.min(pct, 100);
    const cls = pct >= thresholdHit ? 'kmc-bar-hit' : pct >= thresholdWarn ? 'kmc-bar-warn' : 'kmc-bar-miss';
    return `<div class="kmc-bar-wrap"><div class="kmc-bar ${cls}" style="width:${capped.toFixed(1)}%"></div></div>`;
  };

  const kpiStatus = (pct, thresholdHit = 100, thresholdWarn = 60) => {
    if (pct >= thresholdHit) return `<span class="kmc-status kmc-status-hit">&#10003; TARGET HIT</span>`;
    if (pct >= thresholdWarn) return `<span class="kmc-status kmc-status-warn">&#9650; ON PROGRESS</span>`;
    return `<span class="kmc-status kmc-status-miss">&#9888; BELUM ACHIEVE</span>`;
  };

  // Indikator target harian DINAMIS: bukan lagi rata-rata flat (target
  // bulanan ÷ jumlah hari sebulan), melainkan (sisa target yang belum
  // tercapai) ÷ (sisa hari termasuk hari ini). Jadi kalau hari-hari
  // sebelumnya kurang dari target, target hari ini otomatis naik; kalau
  // sudah lebih dari target, target hari ini otomatis turun.
  // Hanya relevan saat bulan yang dipilih adalah bulan berjalan.
  const dailyTargetHtml = (metricTarget, monthActualSoFar, actualToday, todayMKI, todayCFN, isCurrentMonthCtx, daysInMonthCtx, fmtFn, todayLabelCtx, suffix = '') => {
    if (!isCurrentMonthCtx || !(metricTarget > 0)) return '';
    const actualBeforeToday = monthActualSoFar - actualToday;
    const dayOfMonth = TODAY.getDate();
    const daysRemaining = Math.max(daysInMonthCtx - dayOfMonth + 1, 1);
    const remainingTarget = Math.max(metricTarget - actualBeforeToday, 0);
    const dailyTarget = remainingTarget / daysRemaining;
    const achieved = actualToday >= dailyTarget;
    return `
      <div class="kmc-daily">
        <div class="kmc-pace-label">TARGET HARIAN</div>
        <div class="kmc-sub">Hari ini (${todayLabelCtx}): <strong class="kmc-today-value">${fmtFn(actualToday)}${suffix}</strong></div>
        <div class="kmc-sub">Target/hari: <strong>${fmtFn(dailyTarget)}${suffix}</strong></div>
        <span class="kmc-status ${achieved ? 'kmc-status-hit' : 'kmc-status-miss'}">${achieved ? '&#10003; DAILY ACHIEVED' : '&#10005; DAILY NOT ACHIEVED'}</span>
        <div class="kmc-daily-breakdown">
          <span class="kmc-daily-breakdown-label">Breakdown Hari Ini</span>
          <span class="kmc-daily-breakdown-vals"><span class="kmc-daily-mki">MKI ${fmtFn(todayMKI)}</span>&nbsp;&nbsp;<span class="kmc-daily-cfn">CFN ${fmtFn(todayCFN)}</span></span>
        </div>
      </div>`;
  };

  const render = () => {
    const isAll = dailyPerfState.kpi.month === 'all';
    const monthIdx = isAll ? -1 : parseInt(dailyPerfState.kpi.month, 10);
    const monthLabel = isAll ? 'Semua Bulan' : MONTH_NAMES_ID[monthIdx];

    // txMonth TIDAK mengecualikan invoice retur — disamakan dengan metodologi
    // Section 02 (Tren Penjualan), di mana invoice retur (nomor invoice
    // berawalan "R-" atau Amount negatif) tetap masuk hitungan sehingga
    // otomatis berfungsi sebagai nilai pengurang terhadap Sales/Qty/Invoice.
    const txMonth = tx2026.filter(t =>
      t.orderDate &&
      (isAll || t.orderDate.getMonth() === monthIdx)
    );
    const revMonth = rev2026.filter(r =>
      r.paymentDate && (isAll || r.paymentDate.getMonth() === monthIdx)
    );

    const todayStr   = [TODAY.getFullYear(), String(TODAY.getMonth()+1).padStart(2,'0'), String(TODAY.getDate()).padStart(2,'0')].join('-');
    const toIsoLocal = d => d ? [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-') : '';
    const txToday    = txMonth.filter(t => toIsoLocal(t.orderDate) === todayStr);
    const revToday   = revMonth.filter(r => toIsoLocal(r.paymentDate) === todayStr);
    const todayLabel = TODAY.toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });

    // Konteks pace harian: hanya berlaku kalau bulan yang dipilih adalah bulan berjalan.
    const isCurrentMonth = !isAll && monthIdx === TODAY.getMonth();
    const daysInMonth    = new Date(TODAY.getFullYear(), monthIdx + 1, 0).getDate();

    // 1. SALES
    const totalSales  = sum(txMonth, t => t.amount);
    const dailySales  = sum(txToday, t => t.amount);
    const dailySalesMKI = sum(txToday.filter(t => t.company === 'MKI'), t => t.amount);
    const dailySalesCFN = sum(txToday.filter(t => t.company === 'CFN'), t => t.amount);
    const salesMKI    = sum(txMonth.filter(t => t.company === 'MKI'), t => t.amount);
    const salesCFN    = sum(txMonth.filter(t => t.company === 'CFN'), t => t.amount);
    const monthData   = isAll ? null : yoyMonths.find(mo => mo.monthIdx === monthIdx);
    const targetSales = monthData ? monthData.targetSalesRevenue : 0;
    const pctSales    = targetSales > 0 ? (totalSales / targetSales) * 100 : 0;

    // 2. REVENUE
    const totalRevenue = sum(revMonth, r => r.pelunasan);
    const dailyRevenue = sum(revToday, r => r.pelunasan);
    const dailyRevenueMKI = sum(revToday.filter(r => r.company === 'MKI'), r => r.pelunasan);
    const dailyRevenueCFN = sum(revToday.filter(r => r.company === 'CFN'), r => r.pelunasan);
    const revMKI       = sum(revMonth.filter(r => r.company === 'MKI'), r => r.pelunasan);
    const revCFN       = sum(revMonth.filter(r => r.company === 'CFN'), r => r.pelunasan);
    const pctRevenue   = targetSales > 0 ? (totalRevenue / targetSales) * 100 : 0;

    // 3. SALES TO REVENUE RATIO
    const collectionRate = totalSales > 0 ? (totalRevenue / totalSales) * 100 : 0;

    // 4. OTD — dihitung dari SEMUA invoice, termasuk Hand Carry.
    const invoiceUnikTotal = uniqueCount(txMonth, t => t.noInvoice);
    const invoiceOTD       = uniqueCount(txMonth.filter(t => (t.stage || '').toLowerCase() === 'complete' && t.statusKirim === 'Same Day'), t => t.noInvoice);
    const otdPct           = invoiceUnikTotal > 0 ? (invoiceOTD / invoiceUnikTotal) * 100 : 0;
    const otdTarget        = 80;
    const invTodayTotal    = uniqueCount(txToday, t => t.noInvoice);
    const invTodayOTD      = uniqueCount(txToday.filter(t => (t.stage || '').toLowerCase() === 'complete' && t.statusKirim === 'Same Day'), t => t.noInvoice);
    const otdPctToday      = invTodayTotal > 0 ? (invTodayOTD / invTodayTotal) * 100 : null;
    const totalQtyNoHC     = sum(txMonth, t => t.qty);
    const totalKoliNoHC    = sum(txMonth, t => t.koli);

    // 5. INVOICE — invoice retur (kode "R-.../R/..." atau amount negatif, lihat
    // t.isRetur) TIDAK dihitung sebagai invoice unik, karena bukan invoice
    // penjualan baru melainkan pembatalan/pengembalian barang.
    const TARGET_INVOICE = 280;
    const txMonthNonRetur = txMonth.filter(t => !t.isRetur);
    const txTodayNonRetur = txToday.filter(t => !t.isRetur);
    const invoiceUnikAll = uniqueCount(txMonthNonRetur, t => t.noInvoice);
    const invoiceMKI     = uniqueCount(txMonthNonRetur.filter(t => t.company === 'MKI'), t => t.noInvoice);
    const invoiceCFN     = uniqueCount(txMonthNonRetur.filter(t => t.company === 'CFN'), t => t.noInvoice);
    const dailyInvoice   = uniqueCount(txTodayNonRetur, t => t.noInvoice);
    const dailyInvoiceMKI = uniqueCount(txTodayNonRetur.filter(t => t.company === 'MKI'), t => t.noInvoice);
    const dailyInvoiceCFN = uniqueCount(txTodayNonRetur.filter(t => t.company === 'CFN'), t => t.noInvoice);
    const pctInvoice     = isAll ? null : (invoiceUnikAll / TARGET_INVOICE) * 100;

    // 6. WILAYAH
    const lokasiMap = {};
    txMonth.forEach(t => {
      const lok = (t.lokasi || '').trim();
      if (!lok) return;
      if (!lokasiMap[lok]) lokasiMap[lok] = new Set();
      lokasiMap[lok].add(t.noInvoice);
    });
    const totalLokasiAktif = Object.keys(lokasiMap).length;
    const top5Wilayah = Object.entries(lokasiMap)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 5)
      .map(([lok, invSet]) => ({ lokasi: lok, invoiceUnik: invSet.size }));

    const companyRow = (label, valMki, valCfn, fmtFn) => `
      <div class="kmc-company-row">
        <span class="kmc-company-row-label">${escapeHtml(label)}</span>
        <span class="kmc-company-row-vals">
          <span style="color:var(--terra); font-weight:600;">MKI ${fmtFn(valMki)}</span>
          &nbsp;&nbsp;
          <span style="color:var(--sage); font-weight:600;">CFN ${fmtFn(valCfn)}</span>
        </span>
      </div>`;

    const noTargetNote = '<div class="kmc-sub" style="margin-top:8px;">Target tersedia per bulan &mdash; pilih bulan spesifik</div>';

    const cardSales = `
      <div class="kpi-monitor-card">
        <div class="kmc-label">Total Sales &mdash; ${escapeHtml(monthLabel)}</div>
        <div class="kmc-value">${fmtRupiah(totalSales)}</div>
        ${companyRow('Breakdown', salesMKI, salesCFN, fmtRupiah)}
        ${targetSales > 0 ? `
          <div class="kmc-target" style="margin-top:10px;">Target: ${fmtRupiah(targetSales)} &nbsp;&mdash;&nbsp; Capaian: <strong>${fmtPct(pctSales)}</strong></div>
          ${kpiBar(pctSales)}${kpiStatus(pctSales)}
          ${dailyTargetHtml(targetSales, totalSales, dailySales, dailySalesMKI, dailySalesCFN, isCurrentMonth, daysInMonth, fmtRupiah, escapeHtml(todayLabel))}
        ` : noTargetNote}
      </div>`;

    const cardRevenue = `
      <div class="kpi-monitor-card">
        <div class="kmc-label">Total Revenue &mdash; ${escapeHtml(monthLabel)}</div>
        <div class="kmc-value">${fmtRupiah(totalRevenue)}</div>
        ${companyRow('Breakdown', revMKI, revCFN, fmtRupiah)}
        ${targetSales > 0 ? `
          <div class="kmc-target" style="margin-top:10px;">Target: ${fmtRupiah(targetSales)} &nbsp;&mdash;&nbsp; Capaian: <strong>${fmtPct(pctRevenue)}</strong></div>
          ${kpiBar(pctRevenue)}${kpiStatus(pctRevenue)}
          ${dailyTargetHtml(targetSales, totalRevenue, dailyRevenue, dailyRevenueMKI, dailyRevenueCFN, isCurrentMonth, daysInMonth, fmtRupiah, escapeHtml(todayLabel))}
        ` : noTargetNote}
      </div>`;

    const cardInvoice = `
      <div class="kpi-monitor-card">
        <div class="kmc-label">Total Invoice &mdash; ${escapeHtml(monthLabel)}</div>
        <div class="kmc-value">${fmtNum(invoiceUnikAll)}</div>
        ${companyRow('Breakdown', invoiceMKI, invoiceCFN, fmtNum)}
        ${pctInvoice !== null ? `
          <div class="kmc-target" style="margin-top:10px;">Target: ${fmtNum(TARGET_INVOICE)} &nbsp;&mdash;&nbsp; Capaian: <strong>${fmtPct(pctInvoice)}</strong></div>
          ${kpiBar(pctInvoice)}${kpiStatus(pctInvoice)}
          ${dailyTargetHtml(TARGET_INVOICE, invoiceUnikAll, dailyInvoice, dailyInvoiceMKI, dailyInvoiceCFN, isCurrentMonth, daysInMonth, fmtNum, escapeHtml(todayLabel), ' invoice')}
        ` : noTargetNote}
      </div>`;

    const cardOTD = `
      <div class="kpi-monitor-card">
        <div class="kmc-label">OTD Accuracy &mdash; ${escapeHtml(monthLabel)}</div>
        <div class="kmc-value">${fmtPct(otdPct)}</div>
        <div class="kmc-sub" style="margin-top:8px;">${fmtNum(invoiceOTD)} Same Day Complete / ${fmtNum(invoiceUnikTotal)} total invoice (termasuk Hand Carry)</div>
        <div class="kmc-sub" style="margin-top:2px;">Total Qty: <strong>${fmtNum(totalQtyNoHC)}</strong> &nbsp;|&nbsp; Total Koli: <strong>${fmtNum(totalKoliNoHC)}</strong></div>
        <div class="kmc-target">Target: ${otdTarget}% &nbsp;&mdash;&nbsp; Capaian: <strong>${fmtPct(otdPct)}</strong></div>
        ${kpiBar(otdPct, otdTarget, 60)}${kpiStatus(otdPct, otdTarget, 60)}
        ${!isAll ? `
        <div class="kmc-daily">
          <div class="kmc-pace-label">TARGET HARIAN</div>
          <div class="kmc-sub">Hari ini: <strong class="kmc-today-value">${invTodayTotal > 0 ? fmtPct(otdPctToday) : '&ndash;'}</strong> &nbsp;(${fmtNum(invTodayOTD)}/${fmtNum(invTodayTotal)} invoice)</div>
          ${invTodayTotal >= 1
            ? `<span class="kmc-status ${otdPctToday >= otdTarget ? 'kmc-status-hit' : 'kmc-status-miss'}">${otdPctToday >= otdTarget ? '&#10003;' : '&#10005;'} ${otdPctToday >= otdTarget ? 'DAILY ACHIEVED' : 'DAILY NOT ACHIEVED'} (target ${otdTarget}%)</span>`
            : `<div class="kmc-sub" style="font-style:italic; margin-top:4px;">Belum ada invoice hari ini</div>`
          }
        </div>
        ` : ''}
      </div>`;

    // Sales to Revenue Ratio HARI INI (tanpa target, murni angka)
    const dailyCollectionRate = dailySales > 0 ? (dailyRevenue / dailySales) * 100 : null;

    const cardCollection = `
      <div class="kpi-monitor-card">
        <div class="kmc-label">Sales to Revenue Ratio</div>
        <div class="kmc-value">${fmtPct(collectionRate)}</div>
        <div class="kmc-sub">Sales: ${fmtRupiah(totalSales)} &nbsp;|&nbsp; Revenue: ${fmtRupiah(totalRevenue)}</div>
        <div class="kmc-daily-ratio">
          <div class="kmc-pace-label">HARI INI (${escapeHtml(todayLabel)})</div>
          <div class="kmc-daily-ratio-value">${dailyCollectionRate !== null ? fmtPct(dailyCollectionRate) : '&ndash;'}</div>
          <div class="kmc-sub">Sales: ${fmtRupiah(dailySales)} &nbsp;|&nbsp; Revenue: ${fmtRupiah(dailyRevenue)}</div>
        </div>
      </div>`;

    const cardWilayah = `
      <div class="kpi-monitor-card">
        <div class="kmc-label">Performa Wilayah &mdash; ${escapeHtml(monthLabel)}</div>
        <div class="kmc-value">${fmtNum(totalLokasiAktif)} <span style="font-size:16px; font-weight:400; color:var(--ink-soft);">area aktif</span></div>
        <div class="kmc-sub">Coverage wilayah dengan minimal 1 invoice pada periode ini</div>
        <div class="mini-table-title" style="margin-top:14px;">Top 5 Wilayah</div>
        <table style="width:100%; font-size:12.5px; border-collapse:collapse; margin-top:4px;">
          ${top5Wilayah.map((w, i) => `
            <tr>
              <td style="padding:3px 0; color:var(--ink-soft);">${i+1}. ${escapeHtml(w.lokasi)}</td>
              <td style="padding:3px 0; text-align:right; font-weight:600;">${fmtNum(w.invoiceUnik)} invoice</td>
            </tr>`).join('')}
        </table>
      </div>`;

    document.getElementById('dpKpiContent').innerHTML = `
      <div class="wa-share-wrap"><button class="wa-share-btn" id="btnWaShare">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.374 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.83L.057 23.997l6.334-1.648A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-4.976-1.352l-.357-.211-3.68.957.984-3.57-.232-.368A9.818 9.818 0 012.182 12C2.182 6.566 6.566 2.182 12 2.182S21.818 6.566 21.818 12 17.434 21.818 12 21.818z"/></svg>
        Bagikan via WhatsApp
      </button></div>
      <div class="kpi-monitor-grid">
        ${cardSales}${cardRevenue}${cardInvoice}${cardOTD}${cardCollection}${cardWilayah}
      </div>`;
  };

  render();

  const attachWaBtn = () => {
    const btn = document.getElementById('btnWaShare');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // Buka halaman kpi-share.html yang generate gambar KPI real-time via Canvas.
      // User simpan gambar → kirim ke grup WA sebagai foto (bukan link).
      // Kirim juga filter bulan yang sedang aktif di halaman (termasuk "all" /
      // Semua Bulan) supaya gambar yang di-share konsisten dengan tampilan layar,
      // bukan selalu berdasarkan tanggal berjalan.
      window.open('kpi-share.html?month=' + encodeURIComponent(dailyPerfState.kpi.month) + '&_=' + Date.now(), '_blank');
    });
  };
  attachWaBtn();

  kpiMonthEl.addEventListener('change', (e) => {
    dailyPerfState.kpi.month = e.target.value;
    render();
    attachWaBtn();
  });
}


/* ----- Sub-section: SALES (Grand Data 2026, header lengkap) ----- */
function renderDpSalesPanel(tx2026) {
  const html = `
    <div class="panel">
      <div class="panel-head daily-perf-controls">
        <div class="filter-field">
          <label for="dpSalesMonth">Filter Bulan</label>
          ${dpMonthSelectHtml('dpSalesMonth')}
        </div>
        <div class="filter-field filter-field-grow">
          <label for="dpSalesSearch">Cari Customer / No Invoice</label>
          <input type="text" id="dpSalesSearch" class="text-input" placeholder="Ketik nama customer atau no invoice&hellip;" />
        </div>
      </div>
      <p class="panel-note" id="dpSalesCount"></p>
      <div class="table-scroll">
        <table class="data-table data-table-compact" id="dpSalesTable">
          <thead>
            <tr>
              <th>Order Date</th><th>No Invoice</th><th>Payment</th><th>Customer</th>
              <th>Kode Barang</th><th>Qty</th><th>Amount</th><th>Status</th>
              <th>Company</th><th>Koli</th><th>Stage</th><th>Status Ekspedisi</th>
              <th>Lokasi</th><th>Tgl Terkirim</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="pagination" id="dpSalesPagination"></div>
    </div>
  `;
  document.getElementById('dpPanel-sales').innerHTML = html;

  const renderTable = () => {
    const state = dailyPerfState.sales;
    let rows = tx2026;
    if (state.month !== 'all') {
      const monthIdx = parseInt(state.month, 10);
      rows = rows.filter(t => t.orderDate && t.orderDate.getMonth() === monthIdx);
    }
    const q = state.search.trim().toUpperCase();
    if (q) rows = rows.filter(t => t.customer.includes(q) || t.noInvoice.toUpperCase().includes(q));
    rows = [...rows].sort((a, b) => (a.orderDate?.getTime() || 0) - (b.orderDate?.getTime() || 0));

    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / DAILY_PERF_PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;
    const startIdx = (state.page - 1) * DAILY_PERF_PAGE_SIZE;
    const shown = rows.slice(startIdx, startIdx + DAILY_PERF_PAGE_SIZE);

    document.getElementById('dpSalesCount').innerHTML =
      `Menampilkan <strong>${dpRangeLabel(totalRows, startIdx, shown.length)}</strong> transaksi pada ${dpPeriodLabel(state.month)}.`;

    document.querySelector('#dpSalesTable tbody').innerHTML = shown.length
      ? shown.map(t => `
        <tr>
          <td>${fmtDateShort(t.orderDate)}</td>
          <td>${escapeHtml(t.noInvoice)}</td>
          <td>${escapeHtml(t.payment)}</td>
          <td>${escapeHtml(t.customer)}</td>
          <td>${escapeHtml(t.kodeBarang)}</td>
          <td>${fmtNum(t.qty)}</td>
          <td>${fmtRupiah(t.amount)}</td>
          <td>${escapeHtml(t.statusKirim)}</td>
          <td>${escapeHtml(t.company)}</td>
          <td>${fmtNum(t.koli)}</td>
          <td>${escapeHtml(t.stage)}</td>
          <td>${escapeHtml(t.statusEkspedisi)}</td>
          <td>${escapeHtml(t.lokasi)}</td>
          <td>${fmtDateShort(t.tglTerkirim)}</td>
        </tr>
      `).join('')
      : `<tr><td colspan="14" class="empty-row">Tidak ada transaksi yang cocok dengan filter ini.</td></tr>`;

    renderDpPagination('dpSalesPagination', state, totalPages, renderTable);
  };

  renderTable();
  document.getElementById('dpSalesMonth').addEventListener('change', (e) => {
    dailyPerfState.sales.month = e.target.value; dailyPerfState.sales.page = 1; renderTable();
  });
  document.getElementById('dpSalesSearch').addEventListener('input', (e) => {
    dailyPerfState.sales.search = e.target.value; dailyPerfState.sales.page = 1; renderTable();
  });
}

/* ----- Sub-section: REVENUE (Rev SUM, kolom A-E) ----- */
function renderDpRevenuePanel(rev2026) {
  const html = `
    <div class="panel">
      <div class="panel-head daily-perf-controls">
        <div class="filter-field">
          <label for="dpRevMonth">Filter Bulan</label>
          ${dpMonthSelectHtml('dpRevMonth')}
        </div>
        <div class="filter-field filter-field-grow">
          <label for="dpRevSearch">Cari Customer / No Faktur</label>
          <input type="text" id="dpRevSearch" class="text-input" placeholder="Ketik nama customer atau no faktur&hellip;" />
        </div>
      </div>
      <p class="panel-note" id="dpRevCount"></p>
      <div class="table-scroll">
        <table class="data-table data-table-compact" id="dpRevTable">
          <thead>
            <tr>
              <th>Payment Date</th><th>No Faktur</th><th>Customer</th><th>Pelunasan</th><th>Company</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="pagination" id="dpRevPagination"></div>
    </div>
  `;
  document.getElementById('dpPanel-revenue').innerHTML = html;

  const renderTable = () => {
    const state = dailyPerfState.revenue;
    let rows = rev2026;
    if (state.month !== 'all') {
      const monthIdx = parseInt(state.month, 10);
      rows = rows.filter(r => r.paymentDate && r.paymentDate.getMonth() === monthIdx);
    }
    const q = state.search.trim().toUpperCase();
    if (q) rows = rows.filter(r => r.customer.includes(q) || r.noFaktur.toUpperCase().includes(q));
    rows = [...rows].sort((a, b) => (a.paymentDate?.getTime() || 0) - (b.paymentDate?.getTime() || 0));

    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / DAILY_PERF_PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;
    const startIdx = (state.page - 1) * DAILY_PERF_PAGE_SIZE;
    const shown = rows.slice(startIdx, startIdx + DAILY_PERF_PAGE_SIZE);

    document.getElementById('dpRevCount').innerHTML =
      `Menampilkan <strong>${dpRangeLabel(totalRows, startIdx, shown.length)}</strong> transaksi pada ${dpPeriodLabel(state.month)}.`;

    document.querySelector('#dpRevTable tbody').innerHTML = shown.length
      ? shown.map(r => `
        <tr>
          <td>${fmtDateShort(r.paymentDate)}</td>
          <td>${escapeHtml(r.noFaktur)}</td>
          <td>${escapeHtml(r.customer)}</td>
          <td>${fmtRupiah(r.pelunasan)}</td>
          <td>${escapeHtml(r.company)}</td>
        </tr>
      `).join('')
      : `<tr><td colspan="5" class="empty-row">Tidak ada data yang cocok dengan filter ini.</td></tr>`;

    renderDpPagination('dpRevPagination', state, totalPages, renderTable);
  };

  renderTable();
  document.getElementById('dpRevMonth').addEventListener('change', (e) => {
    dailyPerfState.revenue.month = e.target.value; dailyPerfState.revenue.page = 1; renderTable();
  });
  document.getElementById('dpRevSearch').addEventListener('input', (e) => {
    dailyPerfState.revenue.search = e.target.value; dailyPerfState.revenue.page = 1; renderTable();
  });
}

/* ----- Sub-section: ACCOUNT RECEIVABLE (AR 2026, kolom L-S) ----- */
function renderDpArPanel(arItems) {
  const ar2026 = arItems.filter(a => a.tanggal && a.tanggal.getFullYear() === CURRENT_YEAR);

  const html = `
    <div class="panel">
      <div class="panel-head daily-perf-controls">
        <div class="filter-field">
          <label for="dpArMonth">Filter Bulan</label>
          ${dpMonthSelectHtml('dpArMonth')}
        </div>
        <div class="filter-field filter-field-grow">
          <label for="dpArSearch">Cari Customer / No Faktur</label>
          <input type="text" id="dpArSearch" class="text-input" placeholder="Ketik nama customer atau no faktur&hellip;" />
        </div>
      </div>
      <p class="panel-note" id="dpArCount"></p>
      <div class="table-scroll">
        <table class="data-table data-table-compact" id="dpArTable">
          <thead>
            <tr>
              <th>Tanggal</th><th>No Faktur</th><th>Customer</th><th>Nilai Faktur</th>
              <th>Sisa Saldo</th><th>Aging</th><th>Kategori</th><th>Company</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="pagination" id="dpArPagination"></div>
    </div>
  `;
  document.getElementById('dpPanel-ar').innerHTML = html;

  const renderTable = () => {
    const state = dailyPerfState.ar;
    let rows = ar2026;
    if (state.month !== 'all') {
      const monthIdx = parseInt(state.month, 10);
      rows = rows.filter(a => a.tanggal && a.tanggal.getMonth() === monthIdx);
    }
    const q = state.search.trim().toUpperCase();
    if (q) rows = rows.filter(a => a.customer.includes(q) || a.noFaktur.toUpperCase().includes(q));
    rows = [...rows].sort((a, b) => (a.tanggal?.getTime() || 0) - (b.tanggal?.getTime() || 0));

    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / DAILY_PERF_PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;
    const startIdx = (state.page - 1) * DAILY_PERF_PAGE_SIZE;
    const shown = rows.slice(startIdx, startIdx + DAILY_PERF_PAGE_SIZE);

    document.getElementById('dpArCount').innerHTML =
      `Menampilkan <strong>${dpRangeLabel(totalRows, startIdx, shown.length)}</strong> data piutang pada ${dpPeriodLabel(state.month)}.`;

    document.querySelector('#dpArTable tbody').innerHTML = shown.length
      ? shown.map(a => `
        <tr>
          <td>${fmtDateShort(a.tanggal)}</td>
          <td>${escapeHtml(a.noFaktur)}</td>
          <td>${escapeHtml(a.customer)}</td>
          <td>${fmtRupiah(a.nilaiFaktur)}</td>
          <td>${fmtRupiah(a.sisaSaldo)}</td>
          <td>${escapeHtml(a.aging)}</td>
          <td>${escapeHtml(a.kategori)}</td>
          <td>${escapeHtml(a.company)}</td>
        </tr>
      `).join('')
      : `<tr><td colspan="8" class="empty-row">Tidak ada data yang cocok dengan filter ini.</td></tr>`;

    renderDpPagination('dpArPagination', state, totalPages, renderTable);
  };

  renderTable();
  document.getElementById('dpArMonth').addEventListener('change', (e) => {
    dailyPerfState.ar.month = e.target.value; dailyPerfState.ar.page = 1; renderTable();
  });
  document.getElementById('dpArSearch').addEventListener('input', (e) => {
    dailyPerfState.ar.search = e.target.value; dailyPerfState.ar.page = 1; renderTable();
  });
}

/* ----- Sub-section: DELIVERY (Grand Data 2026, fokus status pengiriman) ----- */
function renderDpDeliveryPanel(tx2026) {
  // Filter otomatis: hanya transaksi yang Stage-nya bukan "Complete" dan
  // bukan "Return" — yaitu yang masih dalam proses pengiriman atau belum
  // diterima customer. Angka (1-25) dan nilai seperti "Cut Off"/"Same Day"
  // yang belum "Complete" tetap ditampilkan.
  const EXCLUDED_STAGES = ['complete', 'return'];
  const txPending = tx2026.filter(t => !EXCLUDED_STAGES.includes((t.stage || '').toLowerCase()));

  // Delivery Harian: transaksi dengan Stage "Complete" yang TANGGAL TERKIRIM-nya
  // hari ini (bukan tanggal input/order invoice) — supaya invoice yang diinput
  // hari sebelumnya tapi baru terkirim hari ini tetap terhitung.
  const txDeliveredToday = tx2026
    .filter(t => (t.stage || '').toLowerCase() === 'complete' && isSameLocalDay(t.tglTerkirim))
    .sort((a, b) => (a.noInvoice || '').localeCompare(b.noInvoice || '', undefined, { numeric: true }));
  const todayLabel = TODAY.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = `
    <div class="panel">
      <div class="panel-head">
        <h3>Delivery Harian &mdash; Terkirim Hari Ini (${escapeHtml(todayLabel)})</h3>
        <button class="wa-share-btn" id="btnWaShareDelivery">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.374 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.83L.057 23.997l6.334-1.648A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-4.976-1.352l-.357-.211-3.68.957.984-3.57-.232-.368A9.818 9.818 0 012.182 12C2.182 6.566 6.566 2.182 12 2.182S21.818 6.566 21.818 12 17.434 21.818 12 21.818z"/></svg>
          Bagikan via WhatsApp
        </button>
      </div>
      <p class="panel-note">${fmtNum(txDeliveredToday.length)} baris transaksi dengan Stage <strong>Complete</strong> dan Tanggal Terkirim hari ini, diurutkan berdasarkan No Invoice.</p>
      <div class="table-scroll">
        <table class="data-table data-table-compact">
          <thead>
            <tr>
              <th>Order Date</th><th>Tgl Terkirim</th><th>No Invoice</th><th>Customer</th>
              <th>Kode Barang</th><th>Qty</th><th>Amount</th><th>Status</th>
              <th>Company</th><th>Koli</th><th>Status Ekspedisi</th><th>Lokasi</th>
            </tr>
          </thead>
          <tbody>
            ${txDeliveredToday.length ? txDeliveredToday.map(t => `
              <tr>
                <td>${fmtDateShort(t.orderDate)}</td>
                <td>${fmtDateShort(t.tglTerkirim)}</td>
                <td>${escapeHtml(t.noInvoice)}</td>
                <td>${escapeHtml(t.customer)}</td>
                <td>${escapeHtml(t.kodeBarang)}</td>
                <td>${fmtNum(t.qty)}</td>
                <td>${fmtRupiah(t.amount)}</td>
                <td>${escapeHtml(t.statusKirim)}</td>
                <td>${escapeHtml(t.company)}</td>
                <td>${fmtNum(t.koli)}</td>
                <td>${escapeHtml(t.statusEkspedisi)}</td>
                <td>${escapeHtml(t.lokasi)}</td>
              </tr>
            `).join('') : `<tr><td colspan="12" class="empty-row">Belum ada transaksi terkirim (Stage Complete) hari ini.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head daily-perf-controls">
        <h3 style="width:100%;">Transaksi Belum Dikirim</h3>
        <div class="filter-field">
          <label for="dpDelMonth">Filter Bulan</label>
          ${dpMonthSelectHtml('dpDelMonth')}
        </div>
        <div class="filter-field filter-field-grow">
          <label for="dpDelSearch">Cari Customer / No Invoice</label>
          <input type="text" id="dpDelSearch" class="text-input" placeholder="Ketik nama customer atau no invoice&hellip;" />
        </div>
      </div>
      <p class="panel-note" id="dpDelCount"></p>
      <div class="table-scroll">
        <table class="data-table data-table-compact" id="dpDelTable">
          <thead>
            <tr>
              <th>Order Date</th><th>No Invoice</th><th>Customer</th>
              <th>Kode Barang</th><th>Qty</th><th>Amount</th><th>Status</th>
              <th>Company</th><th>Koli</th><th>Status Ekspedisi</th>
              <th>Lokasi</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="pagination" id="dpDelPagination"></div>
    </div>
  `;
  document.getElementById('dpPanel-delivery').innerHTML = html;

  const waBtn = document.getElementById('btnWaShareDelivery');
  if (waBtn) waBtn.addEventListener('click', () => window.open('delivery-share.html?_=' + Date.now(), '_blank'));

  const renderTable = () => {
    const state = dailyPerfState.delivery;
    let rows = txPending;
    if (state.month !== 'all') {
      const monthIdx = parseInt(state.month, 10);
      rows = rows.filter(t => t.orderDate && t.orderDate.getMonth() === monthIdx);
    }
    const q = state.search.trim().toUpperCase();
    if (q) rows = rows.filter(t => t.customer.includes(q) || t.noInvoice.toUpperCase().includes(q));
    rows = [...rows].sort((a, b) => (a.orderDate?.getTime() || 0) - (b.orderDate?.getTime() || 0));

    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / DAILY_PERF_PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;
    const startIdx = (state.page - 1) * DAILY_PERF_PAGE_SIZE;
    const shown = rows.slice(startIdx, startIdx + DAILY_PERF_PAGE_SIZE);

    document.getElementById('dpDelCount').innerHTML =
      `Menampilkan <strong>${dpRangeLabel(totalRows, startIdx, shown.length)}</strong> transaksi pengiriman belum selesai pada ${dpPeriodLabel(state.month)}.`;

    document.querySelector('#dpDelTable tbody').innerHTML = shown.length
      ? shown.map(t => `
        <tr>
          <td>${fmtDateShort(t.orderDate)}</td>
          <td>${escapeHtml(t.noInvoice)}</td>
          <td>${escapeHtml(t.customer)}</td>
          <td>${escapeHtml(t.kodeBarang)}</td>
          <td>${fmtNum(t.qty)}</td>
          <td>${fmtRupiah(t.amount)}</td>
          <td>${escapeHtml(t.statusKirim)}</td>
          <td>${escapeHtml(t.company)}</td>
          <td>${fmtNum(t.koli)}</td>
          <td>${escapeHtml(t.statusEkspedisi)}</td>
          <td>${escapeHtml(t.lokasi)}</td>
        </tr>
      `).join('')
      : `<tr><td colspan="11" class="empty-row">Tidak ada transaksi pengiriman yang belum selesai pada periode ini.</td></tr>`;

    renderDpPagination('dpDelPagination', state, totalPages, renderTable);
  };

  renderTable();
  document.getElementById('dpDelMonth').addEventListener('change', (e) => {
    dailyPerfState.delivery.month = e.target.value; dailyPerfState.delivery.page = 1; renderTable();
  });
  document.getElementById('dpDelSearch').addEventListener('input', (e) => {
    dailyPerfState.delivery.search = e.target.value; dailyPerfState.delivery.page = 1; renderTable();
  });
}

/* ----- Sub-section: PO GUDANG ----- */
function renderDpPoGudangPanel(poItems) {
  const PO_PAGE_SIZE = 15;

  const poTunggu = poItems.filter(p => p.stage.toLowerCase() !== 'return' && p.statusBarang !== 'diterima');
  const poReturn = poItems.filter(p => p.stage.toLowerCase() === 'return');

  // State pagination per tabel — terpisah supaya pindah halaman satu tabel
  // tidak mereset halaman tabel yang lain.
  let pageTunggu = 1;
  let pageReturn = 1;

  const rowHtml = (p, isTunggu) => `
    <tr>
      <td>${fmtDateShort(p.orderDate)}</td>
      <td>${escapeHtml(p.noPO)}</td>
      <td>${escapeHtml(p.company)}</td>
      <td>${escapeHtml(p.kodeBarang)}</td>
      <td>${fmtNum(p.qty)}</td>
      <td>${isTunggu && !p.noSuratJalan
        ? '<span style="color:var(--amber);font-weight:600;">BARANG DITUNGGU</span>'
        : (p.noSuratJalan ? escapeHtml(p.noSuratJalan) : '&ndash;')}</td>
      <td>${p.statusEkspedisi ? escapeHtml(p.statusEkspedisi) : '&ndash;'}</td>
    </tr>
  `;

  const html = `
    <div class="panel">
      <div class="panel-head daily-perf-controls">
        <div class="filter-field">
          <label for="dpPoMonth">Filter Bulan</label>
          ${dpMonthSelectHtml('dpPoMonth')}
        </div>
        <div class="filter-field filter-field-grow">
          <label for="dpPoSearch">Cari NO PO / Kode Barang</label>
          <input type="text" id="dpPoSearch" class="text-input" placeholder="Ketik no PO atau kode barang&hellip;" />
        </div>
      </div>

      <div class="panel-head" style="margin-top:8px; align-items:baseline;">
        <h4 class="sub-heading" style="margin:0;">
          &#9202; Barang Ditunggu / Dalam Proses
          <span id="dpPoCountTunggu" class="panel-note" style="font-weight:400; margin-left:8px;"></span>
        </h4>
        <button class="wa-share-btn" id="btnWaSharePoTunggu">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.374 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.83L.057 23.997l6.334-1.648A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-4.976-1.352l-.357-.211-3.68.957.984-3.57-.232-.368A9.818 9.818 0 012.182 12C2.182 6.566 6.566 2.182 12 2.182S21.818 6.566 21.818 12 17.434 21.818 12 21.818z"/></svg>
          Bagikan via WhatsApp
        </button>
      </div>
      <div class="table-scroll">
        <table class="data-table data-table-compact" id="dpPoTableTunggu">
          <thead>
            <tr><th>Order Date</th><th>NO PO</th><th>Company</th><th>Kode Barang</th>
            <th>Quantity</th><th>NO Surat Jalan</th><th>Status Ekspedisi</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="pagination" id="dpPoPaginationTunggu"></div>

      <h4 class="sub-heading" style="margin-top:28px;">
        &#9888; Return / Barang Tidak Tersedia di Pusat
        <span id="dpPoCountReturn" class="panel-note" style="font-weight:400; margin-left:8px;"></span>
      </h4>
      <div class="table-scroll">
        <table class="data-table data-table-compact" id="dpPoTableReturn">
          <thead>
            <tr><th>Order Date</th><th>NO PO</th><th>Company</th><th>Kode Barang</th>
            <th>Quantity</th><th>NO Surat Jalan</th><th>Status Ekspedisi</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="pagination" id="dpPoPaginationReturn"></div>
    </div>
  `;
  document.getElementById('dpPanel-po').innerHTML = html;

  const applyFilters = (rows) => {
    const state = dailyPerfState.po;
    const q = state.search.trim().toUpperCase();
    let r = rows;
    if (state.month !== 'all') {
      const monthIdx = parseInt(state.month, 10);
      r = r.filter(p => p.orderDate && p.orderDate.getMonth() === monthIdx);
    }
    if (q) r = r.filter(p => p.noPO.toUpperCase().includes(q) || p.kodeBarang.includes(q));
    return [...r].sort((a, b) => (a.orderDate?.getTime() || 0) - (b.orderDate?.getTime() || 0));
  };

  // Helper render pagination lokal — tidak pakai renderDpPagination karena
  // state page disimpan sebagai variabel lokal (bukan object.page), sehingga
  // lebih mudah dikelola per tabel secara independen.
  const renderPagBtns = (elId, currentPage, totalPages, onPage) => {
    const el = document.getElementById(elId);
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    const pages = [];
    if (totalPages <= 7) { for (let i=1; i<=totalPages; i++) pages.push(i); }
    else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      for (let i=Math.max(2,currentPage-1); i<=Math.min(totalPages-1,currentPage+1); i++) pages.push(i);
      if (currentPage < totalPages-2) pages.push('...');
      pages.push(totalPages);
    }
    el.innerHTML = `
      <button class="page-btn page-nav" data-dir="prev" ${currentPage===1?'disabled':''} aria-label="Sebelumnya">&larr;</button>
      ${pages.map(p => p==='...'
        ? `<span class="page-ellipsis">&hellip;</span>`
        : `<button class="page-btn ${p===currentPage?'active':''}" data-page="${p}">${p}</button>`
      ).join('')}
      <button class="page-btn page-nav" data-dir="next" ${currentPage===totalPages?'disabled':''} aria-label="Berikutnya">&rarr;</button>
    `;
    el.querySelectorAll('.page-btn[data-page]').forEach(btn =>
      btn.addEventListener('click', () => onPage(parseInt(btn.dataset.page, 10)))
    );
    el.querySelectorAll('.page-btn[data-dir]').forEach(btn =>
      btn.addEventListener('click', () => {
        const dir = btn.dataset.dir;
        if (dir==='prev' && currentPage>1) onPage(currentPage-1);
        if (dir==='next' && currentPage<totalPages) onPage(currentPage+1);
      })
    );
  };

  const renderTunggu = () => {
    const rows = applyFilters(poTunggu);
    const totalPages = Math.max(1, Math.ceil(rows.length / PO_PAGE_SIZE));
    if (pageTunggu > totalPages) pageTunggu = totalPages;
    const shown = rows.slice((pageTunggu-1)*PO_PAGE_SIZE, pageTunggu*PO_PAGE_SIZE);
    document.getElementById('dpPoCountTunggu').textContent =
      `(${rows.length} PO${rows.length > PO_PAGE_SIZE ? `, hal. ${pageTunggu}/${totalPages}` : ''})`;
    document.querySelector('#dpPoTableTunggu tbody').innerHTML = shown.length
      ? shown.map(p => rowHtml(p, true)).join('')
      : `<tr><td colspan="7" class="empty-row">Tidak ada PO yang dalam proses pada periode ini.</td></tr>`;
    renderPagBtns('dpPoPaginationTunggu', pageTunggu, totalPages, (p) => { pageTunggu = p; renderTunggu(); });
  };

  const renderReturn = () => {
    const rows = applyFilters(poReturn);
    const totalPages = Math.max(1, Math.ceil(rows.length / PO_PAGE_SIZE));
    if (pageReturn > totalPages) pageReturn = totalPages;
    const shown = rows.slice((pageReturn-1)*PO_PAGE_SIZE, pageReturn*PO_PAGE_SIZE);
    document.getElementById('dpPoCountReturn').textContent =
      `(${rows.length} PO${rows.length > PO_PAGE_SIZE ? `, hal. ${pageReturn}/${totalPages}` : ''})`;
    document.querySelector('#dpPoTableReturn tbody').innerHTML = shown.length
      ? shown.map(p => rowHtml(p, false)).join('')
      : `<tr><td colspan="7" class="empty-row">Tidak ada PO yang return pada periode ini.</td></tr>`;
    renderPagBtns('dpPoPaginationReturn', pageReturn, totalPages, (p) => { pageReturn = p; renderReturn(); });
  };

  const render = () => { pageTunggu = 1; pageReturn = 1; renderTunggu(); renderReturn(); };

  render();
  document.getElementById('dpPoMonth').addEventListener('change', (e) => {
    dailyPerfState.po.month = e.target.value; render();
  });
  document.getElementById('dpPoSearch').addEventListener('input', (e) => {
    dailyPerfState.po.search = e.target.value; render();
  });

  const waBtn = document.getElementById('btnWaSharePoTunggu');
  if (waBtn) {
    waBtn.addEventListener('click', () => {
      const state = dailyPerfState.po;
      const params = new URLSearchParams();
      if (state.month !== 'all') params.set('month', state.month);
      if (state.search.trim()) params.set('q', state.search.trim());
      params.set('_', Date.now());
      window.open('po-gudang-share.html?' + params.toString(), '_blank');
    });
  }
}

/* ----- Sub-section: LOGISTIK (kode barang keluar hari ini + sisa stock) ----- */
function renderDpLogistikPanel(tx2026, stock) {
  const stockByKode = {};
  (stock.items || []).forEach(i => { stockByKode[i.kode] = i; });

  const rows = tx2026
    .filter(t => isSameLocalDay(t.orderDate) && !t.isRetur)
    .sort((a, b) => (a.noInvoice || '').localeCompare(b.noInvoice || '', undefined, { numeric: true }));

  const todayLabel = TODAY.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = `
    <div class="panel">
      <div class="panel-head">
        <h3>Turnover Gudang &mdash; Kode Barang Keluar Hari Ini (${escapeHtml(todayLabel)})</h3>
        <button class="wa-share-btn" id="btnWaShareLogistik">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.374 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.83L.057 23.997l6.334-1.648A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-4.976-1.352l-.357-.211-3.68.957.984-3.57-.232-.368A9.818 9.818 0 012.182 12C2.182 6.566 6.566 2.182 12 2.182S21.818 6.566 21.818 12 17.434 21.818 12 21.818z"/></svg>
          Bagikan via WhatsApp
        </button>
      </div>
      <p class="panel-note">${fmtNum(rows.length)} baris kode barang keluar pada tanggal berjalan. MKI/CFN Turnover dalam quantity unit; Sisa Stock adalah stock gudang terkini (sudah otomatis bersih dari turnover hari ini sesuai sheet Stock GD MKS).</p>
      <div class="table-scroll">
        <table class="data-table data-table-compact">
          <thead>
            <tr>
              <th>No Invoice</th><th>Nama Customer</th><th>Kode Barang</th>
              <th>MKI Turnover</th><th>CFN Turnover</th>
              <th>Sisa Stock MKI</th><th>Sisa Stock CFN</th><th>Sisa Stock All Company</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(t => {
              const st = stockByKode[t.kodeBarang];
              const sisaMKI = st ? st.stockMKI : null;
              const sisaCFN = st ? st.stockCFN : null;
              const sisaAll = st ? st.stockTotal : null;
              return `
              <tr>
                <td>${escapeHtml(t.noInvoice)}</td>
                <td>${escapeHtml(t.customer)}</td>
                <td>${escapeHtml(t.kodeBarang)}</td>
                <td>${t.company === 'MKI' ? fmtNum(t.qty) : '&ndash;'}</td>
                <td>${t.company === 'CFN' ? fmtNum(t.qty) : '&ndash;'}</td>
                <td>${st ? fmtNum(sisaMKI) : '&ndash;'}</td>
                <td>${st ? fmtNum(sisaCFN) : '&ndash;'}</td>
                <td>${st ? fmtNum(sisaAll) : '&ndash;'}</td>
              </tr>`;
            }).join('') : `<tr><td colspan="8" class="empty-row">Belum ada kode barang keluar hari ini.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById('dpPanel-logistik').innerHTML = html;

  const waBtn = document.getElementById('btnWaShareLogistik');
  if (waBtn) waBtn.addEventListener('click', () => window.open('logistik-share.html?_=' + Date.now(), '_blank'));
}

/* ----- Sub-tab: COVERAGE AREA (Daily Performance) -----
   Lampiran seluruh wilayah cakupan dengan paginasi 10/halaman + pencarian.
   Saat wilayah dicari, muncul daftar customer dengan pembelanjaan terbesar
   (by total sales) di wilayah yang cocok dengan pencarian tsb, juga
   dipaginasi 10/halaman. ----- */
const COVERAGE_AREA_PAGE_SIZE = 10;
let coverageAreaSearch = '';
let coverageAreaPage = 1;
let coverageAreaCustomerPage = 1;
let coverageAreaSelectedWilayah = null;

function renderDpCoverageAreaPanel(z) {
  const html = `
    <div class="panel">
      <div class="panel-head">
        <h3>Coverage Area</h3>
      </div>
      <p class="panel-note">Lampiran seluruh wilayah cakupan (${fmtNum(z.wilayahData.length)} kabupaten/kota). Cari nama wilayah, lalu klik salah satu baris untuk melihat customer dengan pembelanjaan terbesar (by total sales) di wilayah tersebut.</p>
      <div class="panel-head daily-perf-controls" style="margin-bottom:12px;">
        <div class="filter-field filter-field-grow">
          <label for="coverageAreaSearch">Cari Wilayah</label>
          <input type="text" id="coverageAreaSearch" class="text-input" placeholder="Ketik nama kabupaten/kota&hellip;" />
        </div>
      </div>
      <table class="data-table" id="tblCoverageArea"></table>
      <div class="pagination" id="pagCoverageArea"></div>
      <p class="panel-note hidden" id="coverageAreaCustomerHint" style="margin-top:14px;">Ada beberapa wilayah yang cocok &mdash; klik salah satu baris di atas untuk melihat customer di wilayah tersebut.</p>

      <div id="coverageAreaCustomerWrap" class="hidden" style="margin-top:24px;">
        <h4 class="sub-heading" id="coverageAreaCustomerTitle"></h4>
        <table class="data-table" id="tblCoverageAreaCustomer"></table>
        <div class="pagination" id="pagCoverageAreaCustomer"></div>
      </div>
    </div>
  `;
  document.getElementById('dpPanel-coverage').innerHTML = html;

  renderCoverageAreaTable(z);

  const searchEl = document.getElementById('coverageAreaSearch');
  if (searchEl) {
    searchEl.value = coverageAreaSearch;
    searchEl.addEventListener('input', (e) => {
      coverageAreaSearch = e.target.value;
      coverageAreaPage = 1;
      coverageAreaCustomerPage = 1;
      coverageAreaSelectedWilayah = null;
      renderCoverageAreaTable(z);
    });
  }
}

function renderCoverageAreaTable(z) {
  const PAGE = COVERAGE_AREA_PAGE_SIZE;
  const q = coverageAreaSearch.trim().toUpperCase();
  const data = q ? z.wilayahData.filter(w => w.nama.toUpperCase().includes(q)) : z.wilayahData;
  const salesMap = new Map(z.salesByWilayah.map(s => [s.lokasi, s]));

  // Kalau pencarian cocok persis 1 wilayah, langsung pilih otomatis. Kalau
  // cocok lebih dari 1 (mis. "bone" -> BONE, BONE-BONE, BONE BOLANGO), user
  // harus klik salah satu baris supaya data customer tidak tercampur.
  if (q && data.length === 1) coverageAreaSelectedWilayah = data[0].nama;

  const totalPages = Math.max(1, Math.ceil(data.length / PAGE));
  if (coverageAreaPage > totalPages) coverageAreaPage = totalPages;
  const shown = data.slice((coverageAreaPage - 1) * PAGE, coverageAreaPage * PAGE);

  const rows = shown.map(w => {
    const salesInfo = salesMap.get(w.nama);
    const isSelected = coverageAreaSelectedWilayah === w.nama;
    return `<tr class="clickable-row${isSelected ? ' row-selected' : ''}" data-wilayah="${escapeHtml(w.nama)}">
      <td>${escapeHtml(w.nama)}</td>
      <td>${fmtNum(w.total)}</td>
      <td>${salesInfo ? fmtRupiah(salesInfo.sales) : fmtRupiah(0)}</td>
      <td>${zonePillHtml(w.zone)}</td>
    </tr>`;
  }).join('');
  document.getElementById('tblCoverageArea').outerHTML = `<table class="data-table" id="tblCoverageArea">
    <thead><tr><th>Kabupaten/Kota</th><th>Total Invoice 2026</th><th>Total Sales</th><th>Zona</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="empty-row">Tidak ada wilayah yang cocok.</td></tr>'}</tbody>
  </table>`;

  document.getElementById('tblCoverageArea').querySelectorAll('tr[data-wilayah]').forEach(tr => {
    tr.addEventListener('click', () => {
      coverageAreaSelectedWilayah = tr.dataset.wilayah;
      coverageAreaCustomerPage = 1;
      renderCoverageAreaTable(z);
    });
  });

  const pagHtml = makePagBtns('pagCoverageArea', coverageAreaPage, totalPages, p => { coverageAreaPage = p; renderCoverageAreaTable(z); });
  const pagEl = document.getElementById('pagCoverageArea');
  if (pagEl) { pagEl.innerHTML = pagHtml; attachPagBtns('pagCoverageArea', p => { coverageAreaPage = p; renderCoverageAreaTable(z); }); }

  const custWrap = document.getElementById('coverageAreaCustomerWrap');
  const custHint = document.getElementById('coverageAreaCustomerHint');

  // Wilayah terpilih sudah tidak ada di daftar hasil filter saat ini -> reset.
  if (coverageAreaSelectedWilayah && !data.some(w => w.nama === coverageAreaSelectedWilayah)) {
    coverageAreaSelectedWilayah = null;
  }

  if (!coverageAreaSelectedWilayah) {
    custWrap.classList.add('hidden');
    if (custHint) custHint.classList.toggle('hidden', !(q && data.length > 1));
    return;
  }
  if (custHint) custHint.classList.add('hidden');
  custWrap.classList.remove('hidden');

  const customers = (z.customersByWilayah[coverageAreaSelectedWilayah] || [])
    .map(c => ({ customer: c.customer, sales: c.sales, invoiceUnik: c.invoiceUnik }))
    .sort((a, b) => b.sales - a.sales);

  document.getElementById('coverageAreaCustomerTitle').textContent =
    `Customer Pembelanjaan Terbesar — ${coverageAreaSelectedWilayah}`;

  renderCoverageAreaCustomerTable(customers);
}

function renderCoverageAreaCustomerTable(customers) {
  const PAGE = COVERAGE_AREA_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(customers.length / PAGE));
  if (coverageAreaCustomerPage > totalPages) coverageAreaCustomerPage = totalPages;
  const shown = customers.slice((coverageAreaCustomerPage - 1) * PAGE, coverageAreaCustomerPage * PAGE);

  document.getElementById('tblCoverageAreaCustomer').outerHTML = `<table class="data-table" id="tblCoverageAreaCustomer">
    <thead><tr><th>Nama Customer</th><th>Total Sales 2026</th><th>Invoice Unik</th></tr></thead>
    <tbody>${shown.length ? shown.map(c => `<tr><td>${escapeHtml(c.customer)}</td><td>${fmtRupiah(c.sales)}</td><td>${fmtNum(c.invoiceUnik)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty-row">Belum ada transaksi customer di wilayah ini.</td></tr>'}</tbody>
  </table>`;

  const pagHtml = makePagBtns('pagCoverageAreaCustomer', coverageAreaCustomerPage, totalPages, p => { coverageAreaCustomerPage = p; renderCoverageAreaCustomerTable(customers); });
  const pagEl = document.getElementById('pagCoverageAreaCustomer');
  if (pagEl) { pagEl.innerHTML = pagHtml; attachPagBtns('pagCoverageAreaCustomer', p => { coverageAreaCustomerPage = p; renderCoverageAreaCustomerTable(customers); }); }
}

/* ==========================================================================
   SECTION 01 — TREN SALES
   ========================================================================== */
let salesViewMode = 'bulanan'; // bulanan | kuartal | semester

function renderSalesSection(m) {
  const s = m.salesTrend;
  const ic = m.invoiceCustomerSummary;
  const yoy = m.yoyComparison;
  const byco = m.salesByCompany;

  const html = `
    <div class="section-head">
      <div class="eyebrow">02 &mdash; Penjualan</div>
      <h2>Tren Penjualan (Sales) Tahun 2026</h2>
      <p class="lede">Analisis pergerakan nilai penjualan dari sheet Grand Data 2026, mencakup ringkasan invoice dan customer unik, komparasi terhadap tahun 2025, serta pembagian kontribusi antar perusahaan.</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total Sales 2026 (s.d. hari ini)</div>
        <div class="kpi-value kpi-value-rupiah">${fmtRupiah(ic.totalSales)}</div>
        <div class="kpi-sub">${fmtNum(ic.totalQty)} unit terjual</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Invoice Unik 2026</div>
        <div class="kpi-value">${fmtNum(ic.totalInvoiceUnik)}</div>
        <div class="kpi-sub">Per ${fmtDate(ic.asOf)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Customer Unik 2026</div>
        <div class="kpi-value">${fmtNum(ic.totalCustomerUnik)}</div>
        <div class="kpi-sub">Pelanggan aktif bertransaksi</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Pertumbuhan Sales vs 2025</div>
        <div class="kpi-value">${deltaHtml(yoy.growthSales)}</div>
        <div class="kpi-sub">${fmtRupiah(yoy.totalSales2025)} &rarr; ${fmtRupiah(yoy.totalSales2026)}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Tren Penjualan per Periode</h3>
        <div class="toggle-group" id="salesViewToggle">
          <button class="toggle-btn active" data-mode="bulanan">Per Bulan</button>
          <button class="toggle-btn" data-mode="kuartal">Per Kuartal</button>
          <button class="toggle-btn" data-mode="semester">Per Semester</button>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartSalesTrend"></canvas></div>
    </div>

    <div class="panel">
      <h3>Komparasi Sales 2025 vs 2026 &amp; Target Tahunan</h3>
      <p class="panel-note">Sumber: sheet Sales SUM. Target Sales 2026: <strong>${fmtRupiah(yoy.totalTarget)}</strong> &mdash; tercapai <strong>${fmtPct(yoy.achievementSales)}</strong> dari target.</p>
      <div class="chart-wrap"><canvas id="chartYoySales"></canvas></div>
      <table class="data-table" id="tblYoySales"></table>
    </div>

    <div class="panel">
      <h3>Sales by Company &mdash; MKI vs CFN</h3>
      <div class="two-col">
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartSalesByCompany"></canvas></div>
        <div class="company-cards">
          ${byco.companies.map(c => `
            <div class="company-card company-${c.company.toLowerCase()}">
              <div class="company-card-head">
                <span class="company-badge company-badge-${c.company.toLowerCase()}">${c.company}</span>
                <span class="company-pct">${fmtPct(c.pct)}</span>
              </div>
              <div class="company-card-value">${fmtRupiah(c.sales)}</div>
              <div class="company-card-row"><span>Quantity</span><strong>${fmtNum(c.qty)} unit</strong></div>
              <div class="company-card-row"><span>Invoice Unik</span><strong>${fmtNum(c.invoiceUnik)}</strong></div>
              <div class="company-card-row"><span>Customer Unik</span><strong>${fmtNum(c.customerUnik)}</strong></div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.getElementById('s1').innerHTML = html;

  renderSalesTrendChart(s, salesViewMode);
  renderYoySalesChart(yoy);
  renderYoySalesTable(yoy);
  renderSalesByCompanyChart(byco);

  document.querySelectorAll('#salesViewToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#salesViewToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      salesViewMode = btn.dataset.mode;
      renderSalesTrendChart(s, salesViewMode);
    });
  });
}

function renderSalesTrendChart(s, mode) {
  let labels, data;
  if (mode === 'bulanan') { labels = s.monthly.map(x => MONTH_NAMES_SHORT_ID[x.monthIdx]); data = s.monthly.map(x => x.value); }
  else if (mode === 'kuartal') { labels = s.quarters.map(x => x.label); data = s.quarters.map(x => x.value); }
  else { labels = s.semesters.map(x => x.label); data = s.semesters.map(x => x.value); }

  makeChart('chartSalesTrend', {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Sales', data,
      borderColor: PALETTE.terra, backgroundColor: 'rgba(193,122,90,0.12)',
      fill: true, tension: 0.35, pointRadius: 6, pointHoverRadius: 9,
      pointBackgroundColor: PALETTE.terra, borderWidth: 2.5, pointHitRadius: 20,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });
}

function renderYoySalesChart(yoy) {
  makeChart('chartYoySales', {
    type: 'bar',
    data: {
      labels: yoy.months.map(m => MONTH_NAMES_SHORT_ID[m.monthIdx]),
      datasets: [
        { label: 'Sales 2025', data: yoy.months.map(m => m.sales2025), backgroundColor: PALETTE.slateLight, borderRadius: 4 },
        { label: 'Sales 2026', data: yoy.months.map(m => m.sales2026), backgroundColor: PALETTE.terra, borderRadius: 4 },
        { label: 'Target', data: yoy.months.map(m => m.targetSalesRevenue), type: 'line', borderColor: PALETTE.amber, borderDash: [6,4], borderWidth: 2, pointRadius: 0, fill: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtRupiah(ctx.parsed.y)}` } } },
      scales: { y: { ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });
}

function renderYoySalesTable(yoy) {
  const rows = yoy.months.map(m => `
    <tr>
      <td>${m.label}</td>
      <td>${fmtRupiah(m.sales2025)}</td>
      <td>${fmtRupiah(m.sales2026)}</td>
      <td>${deltaHtml(growthPct(m.sales2026, m.sales2025))}</td>
      <td>${fmtRupiah(m.targetSalesRevenue)}</td>
      <td>${achievementPillHtml(m.sales2026, m.targetSalesRevenue)}</td>
    </tr>
  `).join('');
  document.getElementById('tblYoySales').innerHTML = `
    <thead><tr><th>Bulan</th><th>Sales 2025</th><th>Sales 2026</th><th>Pertumbuhan</th><th>Target</th><th>Capaian vs Target</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td>Total</td><td>${fmtRupiah(yoy.totalSales2025)}</td><td>${fmtRupiah(yoy.totalSales2026)}</td>
      <td>${deltaHtml(yoy.growthSales)}</td><td>${fmtRupiah(yoy.totalTarget)}</td>
      <td>${achievementPillHtml(yoy.totalSales2026, yoy.totalTarget)}</td>
    </tr></tfoot>
  `;
}

function renderSalesByCompanyChart(byco) {
  const colorMapSales = { MKI: PALETTE.terra, CFN: PALETTE.sage };
  makeChart('chartSalesByCompany', {
    type: 'doughnut',
    data: {
      labels: byco.companies.map(c => c.company),
      datasets: [{ data: byco.companies.map(c => c.sales), backgroundColor: byco.companies.map(c => colorMapSales[c.company] || PALETTE.slate), borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtRupiah(ctx.parsed)} (${fmtPct(byco.companies[ctx.dataIndex].pct)})` } } },
    },
  });
}

/* ==========================================================================
   SECTION 02 — TREN REVENUE
   ========================================================================== */
let revViewMode = 'bulanan';

function renderRevenueSection(m) {
  const r = m.revTrend;
  const yoy = m.yoyComparison;
  const byco = m.revenueByCompany;

  const html = `
    <div class="section-head">
      <div class="eyebrow">03 &mdash; Pendapatan</div>
      <h2>Tren Pendapatan (Revenue) Tahun 2026</h2>
      <p class="lede">Revenue dihitung dari pelunasan yang benar-benar diterima (sheet Rev SUM), berbeda dengan Sales yang mencatat nilai transaksi saat invoice terbit.</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total Revenue 2026 (s.d. hari ini)</div>
        <div class="kpi-value kpi-value-rupiah">${fmtRupiah(r.total)}</div>
        <div class="kpi-sub">Pelunasan diterima</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Invoice Unik Terbayar</div>
        <div class="kpi-value">${fmtNum(r.invoiceUnik)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Customer Unik Membayar</div>
        <div class="kpi-value">${fmtNum(r.customerUnik)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Pertumbuhan Revenue vs 2025</div>
        <div class="kpi-value">${deltaHtml(yoy.growthRev)}</div>
        <div class="kpi-sub">${fmtRupiah(yoy.totalRev2025)} &rarr; ${fmtRupiah(yoy.totalRev2026)}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Tren Pendapatan per Periode</h3>
        <div class="toggle-group" id="revViewToggle">
          <button class="toggle-btn active" data-mode="bulanan">Per Bulan</button>
          <button class="toggle-btn" data-mode="kuartal">Per Kuartal</button>
          <button class="toggle-btn" data-mode="semester">Per Semester</button>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartRevTrend"></canvas></div>
    </div>

    <div class="panel">
      <h3>Komparasi Revenue 2025 vs 2026 &amp; Target Tahunan</h3>
      <p class="panel-note">Sumber: sheet Sales SUM. Target Revenue 2026: <strong>${fmtRupiah(yoy.totalTarget)}</strong> &mdash; tercapai <strong>${fmtPct(yoy.achievementRev)}</strong> dari target.</p>
      <div class="chart-wrap"><canvas id="chartYoyRev"></canvas></div>
      <table class="data-table" id="tblYoyRev"></table>
    </div>

    <div class="panel">
      <h3>Revenue by Company &mdash; MKI vs CFN</h3>
      <div class="two-col">
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartRevByCompany"></canvas></div>
        <div class="company-cards">
          ${byco.companies.map(c => `
            <div class="company-card company-${c.company.toLowerCase()}">
              <div class="company-card-head">
                <span class="company-badge company-badge-${c.company.toLowerCase()}">${c.company}</span>
                <span class="company-pct">${fmtPct(c.pct)}</span>
              </div>
              <div class="company-card-value">${fmtRupiah(c.revenue)}</div>
              <div class="company-card-row"><span>Invoice Unik Terbayar</span><strong>${fmtNum(c.invoiceUnik)}</strong></div>
              <div class="company-card-row"><span>Customer Unik</span><strong>${fmtNum(c.customerUnik)}</strong></div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.getElementById('s2').innerHTML = html;

  renderRevTrendChart(r, revViewMode);
  renderYoyRevChart(yoy);
  renderYoyRevTable(yoy);
  renderRevByCompanyChart(byco);

  document.querySelectorAll('#revViewToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#revViewToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      revViewMode = btn.dataset.mode;
      renderRevTrendChart(r, revViewMode);
    });
  });
}

function renderRevTrendChart(r, mode) {
  let labels, data;
  if (mode === 'bulanan') { labels = r.monthly.map(x => MONTH_NAMES_SHORT_ID[x.monthIdx]); data = r.monthly.map(x => x.value); }
  else if (mode === 'kuartal') { labels = r.quarters.map(x => x.label); data = r.quarters.map(x => x.value); }
  else { labels = r.semesters.map(x => x.label); data = r.semesters.map(x => x.value); }

  makeChart('chartRevTrend', {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Revenue', data,
      borderColor: PALETTE.sage, backgroundColor: 'rgba(138,154,130,0.14)',
      fill: true, tension: 0.35, pointRadius: 6, pointHoverRadius: 9,
      pointBackgroundColor: PALETTE.sage, borderWidth: 2.5, pointHitRadius: 20,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });
}

function renderYoyRevChart(yoy) {
  makeChart('chartYoyRev', {
    type: 'bar',
    data: {
      labels: yoy.months.map(m => MONTH_NAMES_SHORT_ID[m.monthIdx]),
      datasets: [
        { label: 'Revenue 2025', data: yoy.months.map(m => m.rev2025), backgroundColor: PALETTE.slateLight, borderRadius: 4 },
        { label: 'Revenue 2026', data: yoy.months.map(m => m.rev2026), backgroundColor: PALETTE.sage, borderRadius: 4 },
        { label: 'Target', data: yoy.months.map(m => m.targetSalesRevenue), type: 'line', borderColor: PALETTE.amber, borderDash: [6,4], borderWidth: 2, pointRadius: 0, fill: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtRupiah(ctx.parsed.y)}` } } },
      scales: { y: { ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });
}

function renderYoyRevTable(yoy) {
  const rows = yoy.months.map(m => `
    <tr>
      <td>${m.label}</td>
      <td>${fmtRupiah(m.rev2025)}</td>
      <td>${fmtRupiah(m.rev2026)}</td>
      <td>${deltaHtml(growthPct(m.rev2026, m.rev2025))}</td>
      <td>${fmtRupiah(m.targetSalesRevenue)}</td>
      <td>${achievementPillHtml(m.rev2026, m.targetSalesRevenue)}</td>
    </tr>
  `).join('');
  document.getElementById('tblYoyRev').innerHTML = `
    <thead><tr><th>Bulan</th><th>Revenue 2025</th><th>Revenue 2026</th><th>Pertumbuhan</th><th>Target</th><th>Capaian vs Target</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td>Total</td><td>${fmtRupiah(yoy.totalRev2025)}</td><td>${fmtRupiah(yoy.totalRev2026)}</td>
      <td>${deltaHtml(yoy.growthRev)}</td><td>${fmtRupiah(yoy.totalTarget)}</td>
      <td>${achievementPillHtml(yoy.totalRev2026, yoy.totalTarget)}</td>
    </tr></tfoot>
  `;
}

function renderRevByCompanyChart(byco) {
  const colorMap = { MKI: PALETTE.terra, CFN: PALETTE.sage };
  makeChart('chartRevByCompany', {
    type: 'doughnut',
    data: {
      labels: byco.companies.map(c => c.company),
      datasets: [{ data: byco.companies.map(c => c.revenue), backgroundColor: byco.companies.map(c => colorMap[c.company] || PALETTE.slate), borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtRupiah(ctx.parsed)} (${fmtPct(byco.companies[ctx.dataIndex].pct)})` } } },
    },
  });
}

/* ==========================================================================
   SECTION 03 — RASIO SALES TO REVENUE
   ========================================================================== */
let ratioViewMode = 'bulanan';

function renderRatioSection(m) {
  const ratio = m.salesToRevenueRatio;

  const html = `
    <div class="section-head">
      <div class="eyebrow">04 &mdash; Rasio</div>
      <h2>Rasio Sales terhadap Revenue 2026</h2>
      <p class="lede">Mengukur seberapa besar nilai penjualan yang sudah benar-benar terkonversi menjadi pendapatan (lunas dibayar). Sales bersumber dari Grand Data 2026, Revenue dari Rev SUM.</p>
    </div>

    <div class="kpi-grid kpi-grid-3">
      <div class="kpi-card">
        <div class="kpi-label">Total Sales 2026</div>
        <div class="kpi-value kpi-value-rupiah">${fmtRupiah(ratio.totalSales)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Revenue 2026</div>
        <div class="kpi-value kpi-value-rupiah">${fmtRupiah(ratio.totalRevenue)}</div>
      </div>
      <div class="kpi-card kpi-card-accent">
        <div class="kpi-label">Rasio Revenue / Sales</div>
        <div class="kpi-value">${fmtPct(ratio.totalRatio)}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Rasio Sales to Revenue per Periode</h3>
        <div class="toggle-group" id="ratioViewToggle">
          <button class="toggle-btn active" data-mode="bulanan">Per Bulan</button>
          <button class="toggle-btn" data-mode="kuartal">Per Kuartal</button>
          <button class="toggle-btn" data-mode="semester">Per Semester</button>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartRatio"></canvas></div>
      <table class="data-table" id="tblRatio"></table>
    </div>
  `;
  document.getElementById('s3').innerHTML = html;

  renderRatioChart(ratio, ratioViewMode);
  renderRatioTable(ratio, ratioViewMode);

  document.querySelectorAll('#ratioViewToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#ratioViewToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ratioViewMode = btn.dataset.mode;
      renderRatioChart(ratio, ratioViewMode);
      renderRatioTable(ratio, ratioViewMode);
    });
  });
}

function getRatioData(ratio, mode) {
  if (mode === 'bulanan') return ratio.monthly.map(x => ({ label: MONTH_NAMES_SHORT_ID[x.monthIdx], ...x }));
  if (mode === 'kuartal') return ratio.quarters;
  return ratio.semesters;
}

function renderRatioChart(ratio, mode) {
  const data = getRatioData(ratio, mode);
  makeChart('chartRatio', {
    data: {
      labels: data.map(x => x.label),
      datasets: [
        { type: 'bar', label: 'Sales', data: data.map(x => x.sales), backgroundColor: PALETTE.terraLight, borderRadius: 4, yAxisID: 'y' },
        { type: 'bar', label: 'Revenue', data: data.map(x => x.revenue), backgroundColor: PALETTE.sageLight, borderRadius: 4, yAxisID: 'y' },
        { type: 'line', label: 'Rasio (%)', data: data.map(x => x.ratio), borderColor: PALETTE.amber, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: PALETTE.amber, yAxisID: 'y1', tension: 0.3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: ctx => ctx.dataset.yAxisID === 'y1' ? `Rasio: ${fmtPct(ctx.parsed.y)}` : `${ctx.dataset.label}: ${fmtRupiah(ctx.parsed.y)}` } } },
      scales: {
        y: { position: 'left', ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } },
        y1: { position: 'right', ticks: { callback: v => v + '%' }, grid: { display: false }, min: 0 },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderRatioTable(ratio, mode) {
  const data = getRatioData(ratio, mode);
  const rows = data.map(x => `<tr><td>${x.label}</td><td>${fmtRupiah(x.sales)}</td><td>${fmtRupiah(x.revenue)}</td><td>${fmtPct(x.ratio)}</td></tr>`).join('');
  document.getElementById('tblRatio').innerHTML = `
    <thead><tr><th>Periode</th><th>Sales</th><th>Revenue</th><th>Rasio</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td><td>${fmtRupiah(ratio.totalSales)}</td><td>${fmtRupiah(ratio.totalRevenue)}</td><td>${fmtPct(ratio.totalRatio)}</td></tr></tfoot>
  `;
}

/* ==========================================================================
   SECTION 04 — PERFORMA & ZONA WILAYAH KABUPATEN/KOTA
   ========================================================================== */
let zonaCoverageMode = 'bulanan';
let zonaFilter = 'semua'; // semua | hijau | kuning | merah
let wilayahSearch = '';
let wilayahTablePage = 1;
const WILAYAH_PAGE_SIZE = 15;

function renderZonaSection(m) {
  const z = m.zonaWilayah;
  const grandTotalSales = m.invoiceCustomerSummary.totalSales;
  const wilayahMonthlyAgg = buildMonthlyAggByKey(m.transactions, t => t.lokasi);

  const html = `
    <div class="section-head">
      <div class="eyebrow">05 &mdash; Wilayah</div>
      <h2>Performa &amp; Zona Wilayah Kabupaten/Kota</h2>
      <p class="lede">Pembagian zona berdasarkan total invoice unik tahun 2026 (sheet KPI Monitoring). Zona <strong>Merah</strong>: 0&ndash;20 invoice, <strong>Kuning</strong>: 20&ndash;50 invoice, <strong>Hijau</strong>: lebih dari 50 invoice.</p>
    </div>

    <div class="kpi-grid kpi-grid-4">
      <div class="kpi-card">
        <div class="kpi-label">Total Wilayah Tercatat</div>
        <div class="kpi-value">${fmtNum(z.totalWilayah)}</div>
      </div>
      <div class="kpi-card kpi-card-zone-hijau">
        <div class="kpi-label">Zona Hijau (&gt;50 invoice)</div>
        <div class="kpi-value">${fmtNum(z.zoneCounts.hijau)}</div>
        <div class="kpi-sub">${fmtPct(z.totalWilayah > 0 ? (z.zoneCounts.hijau / z.totalWilayah) * 100 : 0)} dari total wilayah</div>
      </div>
      <div class="kpi-card kpi-card-zone-kuning">
        <div class="kpi-label">Zona Kuning (20&ndash;50 invoice)</div>
        <div class="kpi-value">${fmtNum(z.zoneCounts.kuning)}</div>
        <div class="kpi-sub">${fmtPct(z.totalWilayah > 0 ? (z.zoneCounts.kuning / z.totalWilayah) * 100 : 0)} dari total wilayah</div>
      </div>
      <div class="kpi-card kpi-card-zone-merah">
        <div class="kpi-label">Zona Merah (0&ndash;20 invoice)</div>
        <div class="kpi-value">${fmtNum(z.zoneCounts.merah)}</div>
        <div class="kpi-sub">${fmtPct(z.totalWilayah > 0 ? (z.zoneCounts.merah / z.totalWilayah) * 100 : 0)} dari total wilayah</div>
      </div>
    </div>

    <div class="panel">
      <h3>Coverage Area by Invoice</h3>
      <div class="panel-head">
        <p class="panel-note">Jumlah wilayah yang memiliki transaksi (invoice &gt; 0) pada periode tersebut.</p>
        <div class="toggle-group" id="zonaCoverageToggle">
          <button class="toggle-btn active" data-mode="bulanan">Per Bulan</button>
          <button class="toggle-btn" data-mode="kuartal">Per Kuartal</button>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartCoverage"></canvas></div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Distribusi Zona Wilayah</h3>
      </div>
      <div class="two-col">
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartZonaDist"></canvas></div>
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartTop10Wilayah"></canvas></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Detail Performa per Wilayah</h3>
        <div class="toggle-group" id="zonaFilterToggle">
          <button class="toggle-btn active" data-zone="semua">Semua</button>
          <button class="toggle-btn" data-zone="hijau">Hijau</button>
          <button class="toggle-btn" data-zone="kuning">Kuning</button>
          <button class="toggle-btn" data-zone="merah">Merah</button>
        </div>
      </div>
      <div class="panel-head daily-perf-controls" style="margin-bottom:12px;">
        <div class="filter-field filter-field-grow">
          <label for="wilayahSearch">Cari Kabupaten/Kota</label>
          <input type="text" id="wilayahSearch" class="text-input" placeholder="Ketik nama kabupaten/kota&hellip;" />
        </div>
      </div>
      <p class="panel-note">Klik nama kabupaten/kota untuk melihat tren penjualan bulanannya.</p>
      <table class="data-table" id="tblWilayah"></table>
      <div class="pagination" id="pagWilayah"></div>
      <div id="wilayahDrillPanel" class="drill-panel hidden">
        <h4 class="sub-heading" id="wilayahDrillTitle"></h4>
        <p class="panel-note" id="wilayahDrillNote"></p>
        <div class="two-col">
          <div class="chart-wrap chart-wrap-sm"><canvas id="chartWilayahDrillSales"></canvas></div>
          <div class="chart-wrap chart-wrap-sm"><canvas id="chartWilayahDrillInvoice"></canvas></div>
        </div>
        <div class="drill-contribution hidden" id="wilayahDrillContribution">
          <div class="kpi-label" id="wilayahDrillContribLabel"></div>
          <div class="kpi-value" id="wilayahDrillContribValue"></div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>Wilayah Tanpa Pembelanjaan sejak Januari 2026</h3>
      <p class="panel-note">${z.wilayahTanpaPembelanjaan.length} wilayah belum tercatat transaksi sama sekali sepanjang tahun 2026.</p>
      <div class="chip-list">
        ${z.wilayahTanpaPembelanjaan.length > 0
          ? z.wilayahTanpaPembelanjaan.map(w => `<span class="chip chip-muted">${escapeHtml(w.nama)}</span>`).join('')
          : '<span class="chip-empty">Seluruh wilayah tercatat memiliki transaksi pada tahun 2026.</span>'}
      </div>
    </div>
  `;
  document.getElementById('s4').innerHTML = html;

  renderCoverageChart(z, zonaCoverageMode);
  renderZonaDistChart(z);
  renderTop10WilayahChart(z);
  renderWilayahTable(z, zonaFilter, grandTotalSales, wilayahMonthlyAgg);

  document.querySelectorAll('#zonaCoverageToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#zonaCoverageToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      zonaCoverageMode = btn.dataset.mode;
      renderCoverageChart(z, zonaCoverageMode);
    });
  });

  document.querySelectorAll('#zonaFilterToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#zonaFilterToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      zonaFilter = btn.dataset.zone;
      wilayahTablePage = 1;
      renderWilayahTable(z, zonaFilter, grandTotalSales, wilayahMonthlyAgg);
    });
  });

  const wilayahSearchEl = document.getElementById('wilayahSearch');
  if (wilayahSearchEl) {
    wilayahSearchEl.value = wilayahSearch;
    wilayahSearchEl.addEventListener('input', (e) => {
      wilayahSearch = e.target.value;
      wilayahTablePage = 1;
      renderWilayahTable(z, zonaFilter, grandTotalSales, wilayahMonthlyAgg);
    });
  }
}

function renderCoverageChart(z, mode) {
  const data = mode === 'bulanan' ? z.coveragePerBulan.map(x => ({ label: MONTH_NAMES_SHORT_ID[x.monthIdx], ...x })) : z.coveragePerKuartal;
  makeChart('chartCoverage', {
    type: 'bar',
    data: { labels: data.map(x => x.label), datasets: [{ label: 'Jumlah Wilayah Aktif', data: data.map(x => x.coverage), backgroundColor: PALETTE.sage, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });
}

function renderZonaDistChart(z) {
  makeChart('chartZonaDist', {
    type: 'doughnut',
    data: {
      labels: ['Hijau (>50)', 'Kuning (20-50)', 'Merah (0-20)'],
      datasets: [{ data: [z.zoneCounts.hijau, z.zoneCounts.kuning, z.zoneCounts.merah], backgroundColor: [PALETTE.green, PALETTE.yellow, PALETTE.red], borderWidth: 0 }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom' } } },
  });
}

function renderTop10WilayahChart(z) {
  const top10 = z.wilayahData.slice(0, 10);
  makeChart('chartTop10Wilayah', {
    type: 'bar',
    data: {
      labels: top10.map(w => w.nama),
      datasets: [{ label: 'Total Invoice 2026', data: top10.map(w => w.total), backgroundColor: top10.map(w => w.zone === 'hijau' ? PALETTE.green : w.zone === 'kuning' ? PALETTE.yellow : PALETTE.red), borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, grid: { color: '#eae3d6' } }, y: { grid: { display: false } } },
    },
  });
}

let wilayahDrillSelected = null; // nama wilayah yang sedang dibuka drill-down-nya

function renderWilayahTable(z, filter, grandTotalSales, wilayahMonthlyAgg) {
  const PAGE = WILAYAH_PAGE_SIZE;
  let data = filter === 'semua' ? z.wilayahData : z.wilayahData.filter(w => w.zone === filter);
  const q = wilayahSearch.trim().toUpperCase();
  if (q) data = data.filter(w => w.nama.toUpperCase().includes(q));
  const salesMap = new Map(z.salesByWilayah.map(s => [s.lokasi, s]));

  const totalPages = Math.max(1, Math.ceil(data.length / PAGE));
  if (wilayahTablePage > totalPages) wilayahTablePage = totalPages;
  const shown = data.slice((wilayahTablePage-1)*PAGE, wilayahTablePage*PAGE);

  const rows = shown.map(w => {
    const salesInfo = salesMap.get(w.nama);
    const salesVal = salesInfo ? salesInfo.sales : 0;
    const contribPct = grandTotalSales > 0 ? (salesVal / grandTotalSales) * 100 : 0;
    return `<tr class="clickable-row" data-wilayah="${escapeHtml(w.nama)}">
      <td>${escapeHtml(w.nama)}</td>
      <td>${fmtNum(w.total)}</td>
      <td>${zonePillHtml(w.zone)}</td>
      <td>${fmtRupiah(salesVal)}</td>
      <td>${fmtPct(contribPct)}</td>
    </tr>`;
  }).join('');
  document.getElementById('tblWilayah').outerHTML = `<table class="data-table" id="tblWilayah">
    <thead><tr><th>Kabupaten/Kota</th><th>Total Invoice 2026</th><th>Zona</th><th>Total Sales</th><th>Kontribusi by Total Sales</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="empty-row">Tidak ada data untuk filter ini.</td></tr>'}</tbody>
  </table>`;

  const pagHtml = makePagBtns('pagWilayah', wilayahTablePage, totalPages, p => { wilayahTablePage = p; renderWilayahTable(z, zonaFilter, grandTotalSales, wilayahMonthlyAgg); });
  document.getElementById('pagWilayah').innerHTML = pagHtml;
  attachPagBtns('pagWilayah', p => { wilayahTablePage = p; renderWilayahTable(z, zonaFilter, grandTotalSales, wilayahMonthlyAgg); });

  document.querySelectorAll('#tblWilayah tbody tr[data-wilayah]').forEach(tr => {
    tr.addEventListener('click', () => showWilayahDrilldown(tr.dataset.wilayah, wilayahMonthlyAgg));
  });

  // Kalau wilayah yang lagi dibuka drill-down-nya masih ada di daftar yang
  // ditampilkan sekarang, refresh drill-down-nya juga (mis. setelah pindah halaman).
  if (wilayahDrillSelected && data.some(w => w.nama === wilayahDrillSelected)) {
    showWilayahDrilldown(wilayahDrillSelected, wilayahMonthlyAgg);
  } else if (wilayahDrillSelected) {
    document.getElementById('wilayahDrillPanel').classList.add('hidden');
    wilayahDrillSelected = null;
  }
}

function showWilayahDrilldown(nama, wilayahMonthlyAgg) {
  wilayahDrillSelected = nama;
  const monthly = wilayahMonthlyAgg.byKey[nama] || Array.from({ length: 12 }, () => ({ sales: 0, qty: 0, invoiceUnik: 0 }));

  document.querySelectorAll('#tblWilayah tbody tr[data-wilayah]').forEach(tr => {
    tr.classList.toggle('row-selected', tr.dataset.wilayah === nama);
  });

  const panel = document.getElementById('wilayahDrillPanel');
  panel.classList.remove('hidden');
  document.getElementById('wilayahDrillTitle').textContent = `Tren Penjualan Bulanan — ${nama}`;
  document.getElementById('wilayahDrillNote').textContent = 'Klik salah satu titik/batang grafik untuk melihat persentase kontribusi wilayah ini pada bulan tersebut.';
  document.getElementById('wilayahDrillContribution').classList.add('hidden');

  makeChart('chartWilayahDrillSales', {
    type: 'bar',
    data: {
      labels: MONTH_NAMES_SHORT_ID,
      datasets: [{ label: 'Sales', data: monthly.map(mo => mo.sales), backgroundColor: PALETTE.terra, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, els) => { if (els.length) showWilayahMonthContribution(nama, els[0].index, wilayahMonthlyAgg); },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.y) } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });

  makeChart('chartWilayahDrillInvoice', {
    type: 'line',
    data: {
      labels: MONTH_NAMES_SHORT_ID,
      datasets: [{ label: 'Invoice Unik', data: monthly.map(mo => mo.invoiceUnik), borderColor: PALETTE.sage, backgroundColor: PALETTE.sage, tension: 0.3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, els) => { if (els.length) showWilayahMonthContribution(nama, els[0].index, wilayahMonthlyAgg); },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtNum(ctx.parsed.y) + ' invoice' } } },
      scales: { y: { beginAtZero: true, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });

  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showWilayahMonthContribution(nama, monthIdx, wilayahMonthlyAgg) {
  const monthly = wilayahMonthlyAgg.byKey[nama];
  const salesInMonth = monthly ? monthly[monthIdx].sales : 0;
  const totalInMonth = wilayahMonthlyAgg.totalsByMonth[monthIdx].sales;
  const pct = totalInMonth > 0 ? (salesInMonth / totalInMonth) * 100 : 0;
  document.getElementById('wilayahDrillContribLabel').textContent = `Kontribusi ${nama} — ${MONTH_NAMES_ID[monthIdx]} 2026`;
  document.getElementById('wilayahDrillContribValue').textContent = `${fmtPct(pct)}  (${fmtRupiah(salesInMonth)} dari ${fmtRupiah(totalInMonth)} total sales seluruh wilayah)`;
  document.getElementById('wilayahDrillContribution').classList.remove('hidden');
}

/* ==========================================================================
   SECTION 05 — KODE BARANG TERLARIS
   ========================================================================== */
let topProductMetric = 'sales'; // sales | qty
let topProductCompanyFilter = 'semua'; // semua | MKI | CFN

let stockMovementState = { tidak: { page: 1 }, dibawah5: { page: 1 } };
const STOCK_MOVEMENT_PAGE_SIZE = 10;

function renderTopProductsSection(m) {
  const tp = m.topProducts;
  const st = m.stock;
  const kodeBarangMonthlyAgg = buildMonthlyAggByKey(m.transactions, t => t.kodeBarang);

  const html = `
    <div class="section-head">
      <div class="eyebrow">06 &mdash; Produk</div>
      <h2>Turnover Gudang</h2>
      <p class="lede">Peringkat kode barang berdasarkan nilai penjualan dan quantity terjual sepanjang tahun 2026, dari sheet Grand Data 2026, lengkap dengan pembagian per perusahaan.</p>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Peringkat Kode Barang Terlaris</h3>
        <div class="toggle-group-wrap">
          <div class="toggle-group" id="topProductMetricToggle">
            <button class="toggle-btn active" data-metric="sales">By Sales</button>
            <button class="toggle-btn" data-metric="qty">By Quantity</button>
          </div>
          <div class="toggle-group" id="topProductCompanyToggle">
            <button class="toggle-btn active" data-co="semua">Semua</button>
            <button class="toggle-btn" data-co="MKI">MKI</button>
            <button class="toggle-btn" data-co="CFN">CFN</button>
          </div>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartTopProducts"></canvas></div>
      <div class="panel-head daily-perf-controls" style="margin:12px 0;">
        <div class="filter-field filter-field-grow">
          <label for="topProductsSearch">Cari Kode Barang</label>
          <input type="text" id="topProductsSearch" class="text-input" placeholder="Ketik kode barang&hellip;" />
        </div>
      </div>
      <p class="panel-note">Klik kode barang untuk melihat tren penjualan bulanannya.</p>
      <table class="data-table" id="tblTopProducts"></table>
      <div class="pagination" id="pagTopProducts"></div>
      <div id="kodeBarangDrillPanel" class="drill-panel hidden">
        <h4 class="sub-heading" id="kodeBarangDrillTitle"></h4>
        <p class="panel-note" id="kodeBarangDrillNote"></p>
        <div class="two-col">
          <div class="chart-wrap chart-wrap-sm"><canvas id="chartKodeBarangDrillSales"></canvas></div>
          <div class="chart-wrap chart-wrap-sm"><canvas id="chartKodeBarangDrillQty"></canvas></div>
        </div>
        <div class="drill-contribution hidden" id="kodeBarangDrillContribution">
          <div class="kpi-label" id="kodeBarangDrillContribLabel"></div>
          <div class="kpi-value" id="kodeBarangDrillContribValue"></div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>Barang Ada Stock Namun Tidak Bergerak / Terjual Dibawah 5 Unit (2026)</h3>
      <div class="two-col">
        <div>
          <div class="mini-table-title">Stock Ada, Belum Pernah Terjual (${fmtNum(st.stockTidakTerjual.length)})</div>
          <table class="data-table data-table-compact">
            <thead><tr><th>Kode</th><th>Deskripsi</th><th>Stock</th></tr></thead>
            <tbody id="tblStockTidakTerjual"></tbody>
          </table>
          <div class="pagination" id="pgStockTidakTerjual"></div>
        </div>
        <div>
          <div class="mini-table-title">Terjual Dibawah 5 Unit (${fmtNum(st.stockTerjualDibawah5.length)})</div>
          <table class="data-table data-table-compact">
            <thead><tr><th>Kode</th><th>Deskripsi</th><th>Terjual</th></tr></thead>
            <tbody id="tblStockDibawah5"></tbody>
          </table>
          <div class="pagination" id="pgStockDibawah5"></div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Peringkat Kode Barang per Bulan</h3>
        <div class="filter-field">
          <label for="kodeBarangMonthFilter">Bulan</label>
          <select id="kodeBarangMonthFilter" class="select-input">
            <option value="semua" ${kodeBarangMonthFilter === 'semua' ? 'selected' : ''}>Semua Bulan</option>
            ${MONTH_NAMES_ID.map((mo, i) => `<option value="${i}" ${String(i) === String(kodeBarangMonthFilter) ? 'selected' : ''}>${mo}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="panel-note">Peringkat kode barang berdasarkan total penjualan pada bulan yang dipilih.</p>
      <table class="data-table" id="tblKodeBarangMonthRank"></table>
      <div class="pagination" id="pagKodeBarangMonthRank"></div>
    </div>
  `;
  document.getElementById('s5').innerHTML = html;

  const grandTotalSales = m.invoiceCustomerSummary.totalSales;
  renderTopProductsChart(tp, topProductMetric, topProductCompanyFilter, grandTotalSales, kodeBarangMonthlyAgg);
  renderStockMovementTables(st);
  renderKodeBarangMonthRankTable(kodeBarangMonthlyAgg, kodeBarangMonthFilter);

  document.getElementById('kodeBarangMonthFilter').addEventListener('change', (e) => {
    kodeBarangMonthFilter = e.target.value;
    kodeBarangMonthRankPage = 1;
    renderKodeBarangMonthRankTable(kodeBarangMonthlyAgg, kodeBarangMonthFilter);
  });

  document.querySelectorAll('#topProductMetricToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#topProductMetricToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      topProductMetric = btn.dataset.metric;
      topProductsTablePage = 1;
      renderTopProductsChart(tp, topProductMetric, topProductCompanyFilter, grandTotalSales, kodeBarangMonthlyAgg);
    });
  });
  document.querySelectorAll('#topProductCompanyToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#topProductCompanyToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      topProductCompanyFilter = btn.dataset.co;
      topProductsTablePage = 1;
      renderTopProductsChart(tp, topProductMetric, topProductCompanyFilter, grandTotalSales, kodeBarangMonthlyAgg);
    });
  });

  const topProductsSearchEl = document.getElementById('topProductsSearch');
  if (topProductsSearchEl) {
    topProductsSearchEl.value = topProductsSearch;
    topProductsSearchEl.addEventListener('input', (e) => {
      topProductsSearch = e.target.value;
      topProductsTablePage = 1;
      renderTopProductsTable(getTopProductData(tp, topProductMetric, topProductCompanyFilter), grandTotalSales, kodeBarangMonthlyAgg);
    });
  }
}

function renderStockMovementTables(st) {
  const renderTidak = () => {
    const state = stockMovementState.tidak;
    const totalPages = Math.max(1, Math.ceil(st.stockTidakTerjual.length / STOCK_MOVEMENT_PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * STOCK_MOVEMENT_PAGE_SIZE;
    const shown = st.stockTidakTerjual.slice(start, start + STOCK_MOVEMENT_PAGE_SIZE);
    document.getElementById('tblStockTidakTerjual').innerHTML = shown.length
      ? shown.map(i => `<tr><td>${escapeHtml(i.kode)}</td><td>${escapeHtml(i.deskripsi)}</td><td>${fmtNum(i.stockTotal)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="empty-row">Tidak ada.</td></tr>';
    renderMiniPagination('pgStockTidakTerjual', state, totalPages, renderTidak);
  };
  const renderDibawah5 = () => {
    const state = stockMovementState.dibawah5;
    const totalPages = Math.max(1, Math.ceil(st.stockTerjualDibawah5.length / STOCK_MOVEMENT_PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * STOCK_MOVEMENT_PAGE_SIZE;
    const shown = st.stockTerjualDibawah5.slice(start, start + STOCK_MOVEMENT_PAGE_SIZE);
    document.getElementById('tblStockDibawah5').innerHTML = shown.length
      ? shown.map(i => `<tr><td>${escapeHtml(i.kode)}</td><td>${escapeHtml(i.deskripsi)}</td><td>${fmtNum(i.qtyTerjual)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="empty-row">Tidak ada.</td></tr>';
    renderMiniPagination('pgStockDibawah5', state, totalPages, renderDibawah5);
  };
  renderTidak();
  renderDibawah5();
}

let topProductsTablePage = 1;
let topProductsSearch = '';

function getTopProductData(tp, metric, coFilter) {
  let source;
  if (coFilter === 'semua') source = metric === 'sales' ? tp.topBySales : tp.topByQty;
  else source = metric === 'sales' ? tp.byCompany[coFilter].topBySales : tp.byCompany[coFilter].topByQty;
  return source;
}

let kodeBarangDrillSelected = null; // kode barang yang sedang dibuka drill-down-nya
let kodeBarangMonthFilter = 'semua'; // 'semua' atau index bulan 0-11
let kodeBarangMonthRankPage = 1;
const KODE_BARANG_MONTH_RANK_PAGE_SIZE = 10;

function renderKodeBarangMonthRankTable(kodeBarangMonthlyAgg, monthFilter) {
  const PAGE = KODE_BARANG_MONTH_RANK_PAGE_SIZE;

  // Susun {kode, sales, qty} untuk bulan terpilih (atau total tahunan kalau "Semua Bulan").
  const list = Object.keys(kodeBarangMonthlyAgg.byKey).map(kode => {
    const monthly = kodeBarangMonthlyAgg.byKey[kode];
    if (monthFilter === 'semua') {
      const sales = sum(monthly, mo => mo.sales);
      const qty = sum(monthly, mo => mo.qty);
      return { kode, sales, qty };
    }
    const mo = monthly[parseInt(monthFilter, 10)];
    return { kode, sales: mo.sales, qty: mo.qty };
  }).filter(p => p.sales !== 0 || p.qty !== 0).sort((a, b) => b.sales - a.sales);

  const grandTotalForScope = monthFilter === 'semua'
    ? sum(kodeBarangMonthlyAgg.totalsByMonth, mo => mo.sales)
    : kodeBarangMonthlyAgg.totalsByMonth[parseInt(monthFilter, 10)].sales;

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE));
  if (kodeBarangMonthRankPage > totalPages) kodeBarangMonthRankPage = totalPages;
  const shown = list.slice((kodeBarangMonthRankPage - 1) * PAGE, kodeBarangMonthRankPage * PAGE);

  const rows = shown.map((p, i) => {
    const rank = (kodeBarangMonthRankPage - 1) * PAGE + i + 1;
    const contribPct = grandTotalForScope > 0 ? (p.sales / grandTotalForScope) * 100 : 0;
    return `<tr><td>${rank}</td><td>${escapeHtml(p.kode)}</td><td>${fmtRupiah(p.sales)}</td><td>${fmtNum(p.qty)}</td><td>${fmtPct(contribPct)}</td></tr>`;
  }).join('');

  document.getElementById('tblKodeBarangMonthRank').innerHTML = `
    <thead><tr><th>Peringkat</th><th>Kode Barang</th><th>Sales</th><th>Quantity</th><th>Kontribusi by Total Sales</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="empty-row">Belum ada transaksi pada bulan ini.</td></tr>'}</tbody>
  `;

  const pagHtml = makePagBtns('pagKodeBarangMonthRank', kodeBarangMonthRankPage, totalPages, p => { kodeBarangMonthRankPage = p; renderKodeBarangMonthRankTable(kodeBarangMonthlyAgg, monthFilter); });
  document.getElementById('pagKodeBarangMonthRank').innerHTML = pagHtml;
  attachPagBtns('pagKodeBarangMonthRank', p => { kodeBarangMonthRankPage = p; renderKodeBarangMonthRankTable(kodeBarangMonthlyAgg, monthFilter); });
}

function renderTopProductsChart(tp, metric, coFilter, grandTotalSales, kodeBarangMonthlyAgg) {
  const full = getTopProductData(tp, metric, coFilter);
  const data = full.slice(0, 10);
  makeChart('chartTopProducts', {
    type: 'bar',
    data: {
      labels: data.map(p => p.kode),
      datasets: [{
        label: metric === 'sales' ? 'Sales' : 'Quantity',
        data: data.map(p => metric === 'sales' ? p.sales : p.qty),
        backgroundColor: PALETTE.amber, borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => metric === 'sales' ? fmtRupiah(ctx.parsed.x) : `${fmtNum(ctx.parsed.x)} unit` } } },
      scales: { x: { beginAtZero: true, ticks: { callback: v => metric === 'sales' ? fmtRupiahShort(v) : fmtNum(v) }, grid: { color: '#eae3d6' } }, y: { grid: { display: false } } },
    },
  });

  renderTopProductsTable(full, grandTotalSales, kodeBarangMonthlyAgg);
}

function renderTopProductsTable(fullData, grandTotalSales, kodeBarangMonthlyAgg) {
  const PAGE = 10;
  const render = () => {
    const q = topProductsSearch.trim().toUpperCase();
    const data = q ? fullData.filter(p => p.kode.toUpperCase().includes(q)) : fullData;
    const total = data.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE));
    if (topProductsTablePage > totalPages) topProductsTablePage = totalPages;
    const shown = data.slice((topProductsTablePage - 1) * PAGE, topProductsTablePage * PAGE);
    document.getElementById('tblTopProducts').outerHTML = `<table class="data-table" id="tblTopProducts">
      <thead><tr><th>Peringkat</th><th>Kode Barang</th><th>Sales</th><th>Quantity</th><th>Kontribusi by Total Sales</th></tr></thead>
      <tbody>${shown.length ? shown.map((p, i) => `<tr class="clickable-row" data-kode="${escapeHtml(p.kode)}"><td>${(topProductsTablePage - 1) * PAGE + i + 1}</td><td>${escapeHtml(p.kode)}</td><td>${fmtRupiah(p.sales)}</td><td>${fmtNum(p.qty)}</td><td>${fmtPct(grandTotalSales > 0 ? (p.sales / grandTotalSales) * 100 : 0)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-row">Tidak ada kode barang yang cocok.</td></tr>'}</tbody>
    </table>`;
    const pagHtml = makePagBtns('pagTopProducts', topProductsTablePage, totalPages, p => { topProductsTablePage = p; render(); });
    const pagEl = document.getElementById('pagTopProducts');
    if (pagEl) { pagEl.innerHTML = pagHtml; attachPagBtns('pagTopProducts', p => { topProductsTablePage = p; render(); }); }

    document.querySelectorAll('#tblTopProducts tbody tr[data-kode]').forEach(tr => {
      tr.addEventListener('click', () => showKodeBarangDrilldown(tr.dataset.kode, kodeBarangMonthlyAgg));
    });

    if (kodeBarangDrillSelected && shown.some(p => p.kode === kodeBarangDrillSelected)) {
      showKodeBarangDrilldown(kodeBarangDrillSelected, kodeBarangMonthlyAgg);
    } else if (kodeBarangDrillSelected) {
      document.getElementById('kodeBarangDrillPanel').classList.add('hidden');
      kodeBarangDrillSelected = null;
    }
  };
  render();
}

function showKodeBarangDrilldown(kode, kodeBarangMonthlyAgg) {
  kodeBarangDrillSelected = kode;
  const monthly = kodeBarangMonthlyAgg.byKey[kode] || Array.from({ length: 12 }, () => ({ sales: 0, qty: 0, invoiceUnik: 0 }));

  document.querySelectorAll('#tblTopProducts tbody tr[data-kode]').forEach(tr => {
    tr.classList.toggle('row-selected', tr.dataset.kode === kode);
  });

  const panel = document.getElementById('kodeBarangDrillPanel');
  panel.classList.remove('hidden');
  document.getElementById('kodeBarangDrillTitle').textContent = `Tren Penjualan Bulanan — ${kode}`;
  document.getElementById('kodeBarangDrillNote').textContent = 'Klik salah satu titik/batang grafik untuk melihat persentase kontribusi kode barang ini pada bulan tersebut.';
  document.getElementById('kodeBarangDrillContribution').classList.add('hidden');

  makeChart('chartKodeBarangDrillSales', {
    type: 'bar',
    data: {
      labels: MONTH_NAMES_SHORT_ID,
      datasets: [{ label: 'Sales', data: monthly.map(mo => mo.sales), backgroundColor: PALETTE.amber, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, els) => { if (els.length) showKodeBarangMonthContribution(kode, els[0].index, kodeBarangMonthlyAgg); },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.y) } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });

  makeChart('chartKodeBarangDrillQty', {
    type: 'line',
    data: {
      labels: MONTH_NAMES_SHORT_ID,
      datasets: [{ label: 'Quantity', data: monthly.map(mo => mo.qty), borderColor: PALETTE.sage, backgroundColor: PALETTE.sage, tension: 0.3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, els) => { if (els.length) showKodeBarangMonthContribution(kode, els[0].index, kodeBarangMonthlyAgg); },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtNum(ctx.parsed.y) + ' unit' } } },
      scales: { y: { beginAtZero: true, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });

  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showKodeBarangMonthContribution(kode, monthIdx, kodeBarangMonthlyAgg) {
  const monthly = kodeBarangMonthlyAgg.byKey[kode];
  const salesInMonth = monthly ? monthly[monthIdx].sales : 0;
  const totalInMonth = kodeBarangMonthlyAgg.totalsByMonth[monthIdx].sales;
  const pct = totalInMonth > 0 ? (salesInMonth / totalInMonth) * 100 : 0;
  document.getElementById('kodeBarangDrillContribLabel').textContent = `Kontribusi ${kode} — ${MONTH_NAMES_ID[monthIdx]} 2026`;
  document.getElementById('kodeBarangDrillContribValue').textContent = `${fmtPct(pct)}  (${fmtRupiah(salesInMonth)} dari ${fmtRupiah(totalInMonth)} total sales seluruh kode barang)`;
  document.getElementById('kodeBarangDrillContribution').classList.remove('hidden');
}

/* ==========================================================================
   SECTION 06 — STOCK GUDANG & PO GUDANG
   ========================================================================== */
function renderStockSection(m) {
  const st = m.stock;
  const po = m.poGudang;

  const html = `
    <div class="section-head">
      <div class="eyebrow">07 &mdash; Gudang</div>
      <h2>Stock Barang &amp; PO Gudang</h2>
      <p class="lede">Stock tersedia hari ini dari sheet Stock GD MKS (kolom Total Stock by Company), serta analisis PO Gudang yang datanya mulai tersedia sejak Maret 2026.</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total Stock Gudang Hari Ini</div>
        <div class="kpi-value">${fmtNum(st.totalStockAll)} unit</div>
        <div class="kpi-sub">${fmtNum(st.itemCount)} jenis barang</div>
      </div>
      <div class="kpi-card company-mki">
        <div class="kpi-label">Stock MKI</div>
        <div class="kpi-value">${fmtNum(st.totalStockMKI)} unit</div>
      </div>
      <div class="kpi-card company-cfn">
        <div class="kpi-label">Stock CFN</div>
        <div class="kpi-value">${fmtNum(st.totalStockCFN)} unit</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Barang Stock Tidak Bergerak</div>
        <div class="kpi-value">${fmtNum(st.stockTidakTerjual.length)}</div>
        <div class="kpi-sub">Ada stock, belum pernah terjual 2026</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Nilai Stock Gudang</div>
        <div class="kpi-value">${fmtRupiah(st.totalNilaiStockGD)}</div>
        <div class="kpi-sub">Harga satuan &times; total stock MKI &amp; CFN</div>
      </div>
    </div>

    <div class="panel">
      <h3>Distribusi Stock by Company</h3>
      <div class="chart-wrap chart-wrap-sm"><canvas id="chartStock"></canvas></div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Barang Tersedia di Gudang (Stock &gt; 0)</h3>
        <button class="wa-share-btn" id="btnWaShareStock">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.374 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.83L.057 23.997l6.334-1.648A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-4.976-1.352l-.357-.211-3.68.957.984-3.57-.232-.368A9.818 9.818 0 012.182 12C2.182 6.566 6.566 2.182 12 2.182S21.818 6.566 21.818 12 17.434 21.818 12 21.818z"/></svg>
          Bagikan via WhatsApp
        </button>
      </div>
      <div class="panel-head daily-perf-controls" style="margin-bottom:12px;">
        <div class="filter-field">
          <label for="stockCompanyToggle">Filter Company</label>
          <div class="toggle-group" id="stockCompanyToggle">
            <button class="toggle-btn active" data-company="all">Semua</button>
            <button class="toggle-btn" data-company="MKI">MKI</button>
            <button class="toggle-btn" data-company="CFN">CFN</button>
          </div>
        </div>
        <div class="filter-field filter-field-grow">
          <label for="stockSearch">Cari Kode / Deskripsi Barang</label>
          <input type="text" id="stockSearch" class="text-input" placeholder="Ketik kode atau deskripsi barang&hellip;" />
        </div>
      </div>
      <table class="data-table" id="tblStock"></table>
    </div>

    <div class="panel">
      <h3>Analisis PO Gudang</h3>
      <p class="panel-note">Data PO Gudang baru tersedia mulai Maret 2026. Total ${fmtNum(po.totalPO)} PO, ${fmtNum(po.totalQtyPO)} unit dipesan &mdash; ${fmtNum(po.totalQtyDiterima)} unit sudah diterima di gudang Makassar, ${fmtNum(po.totalQtyDipesanRetur)} unit diretur (dipesan namun stock pusat kosong sehingga 0 unit sampai di gudang), ${fmtNum(po.totalQtyDitunggu)} unit masih ditunggu (No Surat Jalan dari pusat belum diterima). Qty Diterima dihitung dari kolom Quantity Diterima (GD MKS) sehingga dapat berbeda dari Qty Dipesan apabila terjadi kelebihan atau kekurangan kiriman.</p>
      <div class="two-col">
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartPoGudang"></canvas></div>
        <div class="company-cards">
          ${Object.entries(po.byCompany).map(([co, d]) => `
            <div class="company-card company-${co.toLowerCase()}">
              <div class="company-card-head"><span class="company-badge company-badge-${co.toLowerCase()}">${co}</span></div>
              <div class="company-card-row"><span>Jumlah PO</span><strong>${fmtNum(d.count)}</strong></div>
              <div class="company-card-row"><span>Qty Dipesan</span><strong>${fmtNum(d.qty)} unit</strong></div>
              <div class="company-card-row"><span>Qty Diterima di Gudang</span><strong>${fmtNum(d.qtyDiterima)} unit</strong></div>
              <div class="company-card-row"><span>Qty Masih Ditunggu</span><strong>${fmtNum(d.qtyDitunggu)} unit</strong></div>
            </div>
          `).join('')}
        </div>
      </div>
      <p class="panel-note panel-note-hint">Klik salah satu batang grafik untuk melihat daftar PO yang dipesan pada bulan tersebut.</p>
      <div id="poGudangMonthDetail" class="po-month-detail hidden"></div>
    </div>
  `;
  document.getElementById('s6').innerHTML = html;

  renderStockChart(st);
  renderStockTable(st);
  renderPoGudangChart(po);
}

function renderStockChart(st) {
  makeChart('chartStock', {
    type: 'doughnut',
    data: { labels: ['MKI', 'CFN'], datasets: [{ data: [st.totalStockMKI, st.totalStockCFN], backgroundColor: [PALETTE.terra, PALETTE.sage], borderWidth: 0 }] }, // label & data sudah manual sinkron MKI lalu CFN
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtNum(ctx.parsed)} unit` } } } },
  });
}

// Pencarian multi-kata: setiap kata di query harus muncul di suatu tempat pada
// teks (kode+deskripsi digabung), tidak harus berurutan/bersambungan. Kasus
// khusus: pasangan "<angka> core" (mis. "12 core") dicocokkan sebagai satu
// kesatuan jumlah core yang SPESIFIK — tidak boleh ke-substring oleh jumlah
// core lain (12 vs 1/6/4/24) atau oleh kode barang yang kebetulan mengandung
// angka yang sama.
function matchesSearchTokens(haystack, query) {
  const tokens = query.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const text = haystack.toUpperCase();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^\d+$/.test(tok) && tokens[i + 1] === 'CORE') {
      const re = new RegExp('(?<!\\d)' + tok + '(?!\\d)\\s*CORE');
      if (!re.test(text)) return false;
      i++; // token 'CORE' sudah diproses bersama pasangannya, lewati
      continue;
    }
    if (!text.includes(tok)) return false;
  }
  return true;
}

function renderStockTable(st) {
  const PAGE = 15;
  let page = 1;
  let search = '';
  let company = 'all';
  const allItems = st.items.filter(i => i.stockTotal > 0).sort((a, b) => a.kode.localeCompare(b.kode));

  const render = () => {
    const q = search.trim();
    let items = allItems;
    if (company === 'MKI') items = items.filter(i => i.stockMKI > 0);
    else if (company === 'CFN') items = items.filter(i => i.stockCFN > 0);
    if (q) items = items.filter(i => matchesSearchTokens(`${i.kode} ${i.deskripsi || ''}`, q));
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE));
    if (page > totalPages) page = totalPages;
    const shown = items.slice((page-1)*PAGE, page*PAGE);
    const pagHtml = makePagBtns('pagStock', page, totalPages, p => { page = p; render(); });
    document.getElementById('tblStock').outerHTML = `<table class="data-table" id="tblStock">
      <thead><tr><th>Kode Barang</th><th>Deskripsi</th><th>Harga Satuan</th><th>Stock MKI</th><th>Stock CFN</th><th>Total</th><th>Nilai Stock</th></tr></thead>
      <tbody>${shown.length ? shown.map(i => `<tr><td>${escapeHtml(i.kode)}</td><td>${escapeHtml(i.deskripsi)}</td><td>${fmtRupiah(i.harga)}</td><td>${fmtNum(i.stockMKI)}</td><td>${fmtNum(i.stockCFN)}</td><td><strong>${fmtNum(i.stockTotal)}</strong></td><td>${fmtRupiah(i.nilaiStockGD)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty-row">Tidak ada barang yang cocok.</td></tr>'}</tbody>
    </table>`;
    const pagEl = document.getElementById('pagStock');
    if (pagEl) { pagEl.innerHTML = pagHtml; attachPagBtns('pagStock', p => { page = p; render(); }); }
    else {
      const wrap = document.createElement('div');
      wrap.id = 'pagStock';
      wrap.className = 'pagination';
      wrap.innerHTML = pagHtml;
      document.getElementById('tblStock').insertAdjacentElement('afterend', wrap);
      attachPagBtns('pagStock', p => { page = p; render(); });
    }
  };
  render();

  const searchEl = document.getElementById('stockSearch');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => {
      search = e.target.value;
      page = 1;
      render();
    });
  }

  const companyToggle = document.getElementById('stockCompanyToggle');
  if (companyToggle) {
    companyToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      company = btn.dataset.company;
      page = 1;
      companyToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
      render();
    });
  }

  const waBtn = document.getElementById('btnWaShareStock');
  if (waBtn) {
    waBtn.addEventListener('click', () => {
      const params = new URLSearchParams();
      if (company !== 'all') params.set('company', company);
      if (search.trim()) params.set('q', search.trim());
      params.set('_', Date.now());
      const qs = params.toString();
      window.open('stock-share.html?' + qs, '_blank');
    });
  }
}

function renderPoGudangChart(po) {
  makeChart('chartPoGudang', {
    type: 'bar',
    data: { labels: po.monthly.map(x => x.label), datasets: [{ label: 'Qty PO', data: po.monthly.map(x => x.qty), backgroundColor: PALETTE.slate, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
      onClick: (evt, elements) => {
        if (!elements || elements.length === 0) return;
        const idx = elements[0].index;
        renderPoMonthDetail(po.monthly[idx]);
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements && elements.length > 0 ? 'pointer' : 'default';
      },
    },
  });
}

function renderPoMonthDetail(monthData) {
  const panel = document.getElementById('poGudangMonthDetail');
  if (!monthData || !monthData.items || monthData.items.length === 0) {
    panel.classList.remove('hidden');
    panel.innerHTML = `<p class="empty-row">Tidak ada PO pada bulan ini.</p>`;
    return;
  }
  const rows = monthData.items
    .sort((a, b) => (a.orderDate && b.orderDate) ? a.orderDate - b.orderDate : 0)
    .map(p => `
      <tr>
        <td>${fmtDateShort(p.orderDate)}</td>
        <td>${escapeHtml(p.noPO)}</td>
        <td>${escapeHtml(p.company)}</td>
        <td>${escapeHtml(p.kodeBarang)}</td>
        <td>${fmtNum(p.qty)}</td>
        <td>${fmtNum(p.qtyDiterimaReal)}</td>
        <td>${escapeHtml(p.noSuratJalan) || '&ndash;'}</td>
        <td>${zonePillHtml(p.statusBarang === 'diterima' ? 'hijau' : p.statusBarang === 'retur' ? 'merah' : 'kuning')} ${escapeHtml(p.statusBarang === 'diterima' ? 'Diterima' : p.statusBarang === 'retur' ? 'Retur' : 'Ditunggu')}</td>
      </tr>
    `).join('');
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="po-month-detail-head">
      <h4>Daftar PO &mdash; ${monthData.label} 2026</h4>
      <span class="po-month-detail-count">${fmtNum(monthData.items.length)} PO, total ${fmtNum(monthData.qty)} unit dipesan</span>
    </div>
    <div class="table-scroll">
      <table class="data-table data-table-compact">
        <thead><tr><th>Tanggal</th><th>No PO</th><th>Company</th><th>Kode Barang</th><th>Qty Dipesan</th><th>Qty Diterima</th><th>No Surat Jalan</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

/* ==========================================================================
   SECTION 07 — DELIVERY & EKSPEDISI
   ========================================================================== */
function renderDeliverySection(m) {
  const d = m.delivery;

  const html = `
    <div class="section-head">
      <div class="eyebrow">08 &mdash; Pengiriman</div>
      <h2>Delivery Same Day &amp; Cut Off, serta Ekspedisi</h2>
      <p class="lede">Seluruh data pengiriman bersumber dari sheet Grand Data 2026: status pengiriman (Same Day/Cut Off) dan jalur ekspedisi yang digunakan.</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total Transaksi 2026</div>
        <div class="kpi-value">${fmtNum(d.total)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Same Day</div>
        <div class="kpi-value">${fmtPct(d.deliveryStatus.sameDay.pct)}</div>
        <div class="kpi-sub">${fmtNum(d.deliveryStatus.sameDay.count)} transaksi</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Cut Off</div>
        <div class="kpi-value">${fmtPct(d.deliveryStatus.cutOff.pct)}</div>
        <div class="kpi-sub">${fmtNum(d.deliveryStatus.cutOff.count)} transaksi</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Unit Terkirim</div>
        <div class="kpi-value">${fmtNum(d.totalQty)}</div>
        <div class="kpi-sub">${fmtNum(d.totalKoli)} koli</div>
      </div>
    </div>

    <div class="panel">
      <h3>Status Pengiriman: Same Day vs Cut Off</h3>
      <div class="two-col">
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartDeliveryStatus"></canvas></div>
        <table class="data-table">
          <thead><tr><th>Status</th><th>Persentase</th><th>Quantity</th><th>Koli</th></tr></thead>
          <tbody>
            <tr><td>Same Day</td><td>${fmtPct(d.deliveryStatus.sameDay.pct)}</td><td>${fmtNum(d.deliveryStatus.sameDay.qty)}</td><td>${fmtNum(d.deliveryStatus.sameDay.koli)}</td></tr>
            <tr><td>Cut Off</td><td>${fmtPct(d.deliveryStatus.cutOff.pct)}</td><td>${fmtNum(d.deliveryStatus.cutOff.qty)}</td><td>${fmtNum(d.deliveryStatus.cutOff.koli)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>Penggunaan Jalur Ekspedisi</h3>
      <p class="panel-note">Hand Carry: <strong>${fmtPct(d.handCarry.pct)}</strong> (${fmtNum(d.handCarry.count)} transaksi) &mdash; Ekspedisi Pihak Ketiga: <strong>${fmtPct(d.ekspedisiLuar.pct)}</strong> (${fmtNum(d.ekspedisiLuar.count)} transaksi)</p>
      <div class="chart-wrap"><canvas id="chartEkspedisi"></canvas></div>
      <div class="panel-head daily-perf-controls" style="margin-bottom:12px;">
        <div class="filter-field filter-field-grow">
          <label for="ekspedisiSearch">Cari Jalur Ekspedisi</label>
          <input type="text" id="ekspedisiSearch" class="text-input" placeholder="Ketik nama jalur ekspedisi&hellip;" />
        </div>
      </div>
      <table class="data-table" id="tblEkspedisi"></table>
    </div>
  `;
  document.getElementById('s7').innerHTML = html;

  renderDeliveryStatusChart(d);
  renderEkspedisiChart(d);
  renderEkspedisiTable(d);

  const ekspedisiSearchEl = document.getElementById('ekspedisiSearch');
  if (ekspedisiSearchEl) {
    ekspedisiSearchEl.value = ekspedisiSearch;
    ekspedisiSearchEl.addEventListener('input', (e) => {
      ekspedisiSearch = e.target.value;
      renderEkspedisiTable(d);
    });
  }
}

function renderDeliveryStatusChart(d) {
  makeChart('chartDeliveryStatus', {
    type: 'doughnut',
    data: { labels: ['Same Day', 'Cut Off'], datasets: [{ data: [d.deliveryStatus.sameDay.count, d.deliveryStatus.cutOff.count], backgroundColor: [PALETTE.sage, PALETTE.terra], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom' } } },
  });
}

function renderEkspedisiChart(d) {
  const top = d.byEkspedisi.slice(0, 10);
  makeChart('chartEkspedisi', {
    type: 'bar',
    data: { labels: top.map(e => e.nama), datasets: [{ label: 'Jumlah Transaksi', data: top.map(e => e.count), backgroundColor: PALETTE.slate, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, grid: { color: '#eae3d6' } }, y: { grid: { display: false } } },
    },
  });
}

let ekspedisiSearch = '';

function renderEkspedisiTable(d) {
  const PAGE = 15;
  let page = 1;
  const items = ekspedisiSearch.trim()
    ? d.byEkspedisi.filter(e => e.nama.toUpperCase().includes(ekspedisiSearch.trim().toUpperCase()))
    : d.byEkspedisi;

  const render = () => {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE));
    if (page > totalPages) page = totalPages;
    const shown = items.slice((page-1)*PAGE, page*PAGE);
    const pagHtml = makePagBtns('pagEkspedisi', page, totalPages, p => { page = p; render(); });
    document.getElementById('tblEkspedisi').outerHTML = `<table class="data-table" id="tblEkspedisi">
      <thead><tr><th>Jalur Ekspedisi</th><th>Jumlah</th><th>Persentase</th><th>Quantity</th><th>Koli</th></tr></thead>
      <tbody>${shown.length ? shown.map(e => `<tr><td>${escapeHtml(e.nama)}</td><td>${fmtNum(e.count)}</td><td>${fmtPct(e.pct)}</td><td>${fmtNum(e.qty)}</td><td>${fmtNum(e.koli)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-row">Tidak ada jalur ekspedisi yang cocok.</td></tr>'}</tbody>
    </table>`;
    const pagEl = document.getElementById('pagEkspedisi');
    if (pagEl) { pagEl.innerHTML = pagHtml; attachPagBtns('pagEkspedisi', p => { page = p; render(); }); }
    else {
      const wrap = document.createElement('div');
      wrap.id = 'pagEkspedisi';
      wrap.className = 'pagination';
      wrap.innerHTML = pagHtml;
      document.getElementById('tblEkspedisi').insertAdjacentElement('afterend', wrap);
      attachPagBtns('pagEkspedisi', p => { page = p; render(); });
    }
  };
  render();
}

/* ==========================================================================
   SECTION 08 — PIUTANG (AR) 2026
   ========================================================================== */
function renderARSection(m) {
  const ar = m.ar;

  const html = `
    <div class="section-head">
      <div class="eyebrow">09 &mdash; Piutang</div>
      <h2>Piutang (AR) &amp; Sisa Saldo Piutang 2026</h2>
      <p class="lede">Sumber data: sheet AR 2026. Rasio AR mengukur seberapa besar nilai sales yang masih belum tertagih.</p>
    </div>

    <div class="kpi-grid kpi-grid-3">
      <div class="kpi-card">
        <div class="kpi-label">Total Nilai Faktur 2026</div>
        <div class="kpi-value">${fmtRupiah(ar.totalNilaiFaktur)}</div>
      </div>
      <div class="kpi-card kpi-card-accent">
        <div class="kpi-label">Sisa Saldo Piutang <span class="kpi-label-note">(per tanggal berjalan)</span></div>
        <div class="kpi-value">${fmtRupiah(ar.totalSisaSaldo)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Rasio AR terhadap Sales</div>
        <div class="kpi-value">${fmtPct(ar.ratioARtoSales)}</div>
        <div class="kpi-sub" style="font-size:12px; color:var(--ink-soft); margin-top:4px;">Sisa Saldo Piutang ÷ Total Sales 2026</div>
      </div>
    </div>

    <div class="panel">
      <h3>Piutang dengan Aging diatas 60 Hari</h3>
      <p class="panel-note">Total <strong>${fmtNum(ar.piutangDiatas60Hari.length)}</strong> faktur dengan sisa saldo piutang diatas 60 hari, senilai <strong>${fmtRupiah(ar.totalPiutangDiatas60Hari)}</strong>.</p>
      <div class="chart-wrap"><canvas id="chartAging"></canvas></div>
    </div>

    <div class="panel">
      <h3>Piutang by Company &mdash; MKI vs CFN</h3>
      <p class="panel-note">Klik salah satu cardbox untuk melihat rincian piutang company tersebut.</p>
      <div class="two-col">
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartARByCompany"></canvas></div>
        <div class="company-cards">
          ${(() => {
            const totalSisaSaldo = Object.values(ar.byCompany).reduce((s, d) => s + d.sisaSaldo, 0);
            const belumLunas = ar.items.filter(i => i.sisaSaldo > 0);
            return Object.entries(ar.byCompany).map(([co, d]) => {
              const pct = totalSisaSaldo > 0 ? (d.sisaSaldo / totalSisaSaldo) * 100 : 0;
              const invUnikCo = new Set(belumLunas.filter(i => i.company === co).map(i => i.noFaktur)).size;
              return `
                <div class="company-card company-${co.toLowerCase()} clickable-row" data-company="${co}">
                  <div class="company-card-head">
                    <span class="company-badge company-badge-${co.toLowerCase()}">${co}</span>
                    <span style="font-size:12px; font-weight:600; color:var(--ink-soft); margin-left:auto;">${fmtPct(pct)} dari total piutang</span>
                  </div>
                  <div class="company-card-row"><span>Nilai Faktur</span><strong>${fmtRupiah(d.nilaiFaktur)}</strong></div>
                  <div class="company-card-row"><span>Sisa Saldo Piutang</span><strong>${fmtRupiah(d.sisaSaldo)}</strong></div>
                  <div class="company-card-row"><span>Invoice Unik Belum Lunas</span><strong>${fmtNum(invUnikCo)} invoice</strong></div>
                </div>
              `;
            }).join('');
          })()}
        </div>
      </div>
      <div id="arCompanyDrillPanel" class="drill-panel hidden">
        <h4 class="sub-heading" id="arCompanyDrillTitle"></h4>
        <table class="data-table" id="tblARCompanyDrill"></table>
        <div class="pagination" id="pagARCompanyDrill"></div>
      </div>
    </div>

    <div class="panel">
      <h3>Daftar Piutang Belum Lunas (diurutkan dari Aging tertinggi)</h3>
      <p class="panel-note" id="arTableNote"></p>
      <div class="panel-head daily-perf-controls" style="margin-bottom:12px;">
        <div class="filter-field filter-field-grow">
          <label for="arSearch">Cari Customer / No Invoice</label>
          <input type="text" id="arSearch" class="text-input" placeholder="Ketik nama customer atau no invoice&hellip;" />
        </div>
      </div>
      <table class="data-table" id="tblAR"></table>
    </div>
  `;
  document.getElementById('s8').innerHTML = html;

  renderAgingChart(ar);
  renderARByCompanyChart(ar);
  renderARTable(ar);

  document.querySelectorAll('.company-card[data-company]').forEach(card => {
    card.addEventListener('click', () => showARCompanyDrilldown(ar, card.dataset.company));
  });

  if (arCompanyDrillSelected) {
    showARCompanyDrilldown(ar, arCompanyDrillSelected);
  }

  const arSearchEl = document.getElementById('arSearch');
  if (arSearchEl) {
    arSearchEl.value = arSearch;
    arSearchEl.addEventListener('input', (e) => {
      arSearch = e.target.value;
      renderARTable(ar);
    });
  }
}

function renderAgingChart(ar) {
  const sorted = [...ar.agingBuckets].sort((a, b) => b.sisaSaldo - a.sisaSaldo);
  const totalAging = sum(sorted, b => b.sisaSaldo);
  const pctOf = v => totalAging > 0 ? (v / totalAging) * 100 : 0;
  makeChart('chartAging', {
    type: 'bar',
    data: { labels: sorted.map(b => b.kategori), datasets: [{ label: 'Sisa Saldo Piutang', data: sorted.map(b => b.sisaSaldo), backgroundColor: PALETTE.red, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 24 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${fmtRupiah(ctx.parsed.y)} (${fmtPct(pctOf(ctx.parsed.y))})` } } },
      scales: { y: { ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
    plugins: [{
      id: 'agingPctLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.fillStyle = '#3a3530';
        ctx.font = '600 12px "IBM Plex Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        chart.data.datasets[0].data.forEach((val, i) => {
          const bar = meta.data[i];
          if (!bar) return;
          ctx.fillText(fmtPct(pctOf(val)), bar.x, bar.y - 6);
        });
        ctx.restore();
      },
    }],
  });
}

function renderARByCompanyChart(ar) {
  const cos = Object.keys(ar.byCompany);
  const colorMap = { MKI: PALETTE.terra, CFN: PALETTE.sage };
  makeChart('chartARByCompany', {
    type: 'doughnut',
    data: { labels: cos, datasets: [{ data: cos.map(c => ar.byCompany[c].sisaSaldo), backgroundColor: cos.map(c => colorMap[c] || PALETTE.slate), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtRupiah(ctx.parsed)}` } } } },
  });
}

let arSearch = '';

let arCompanyDrillSelected = null;
let arCompanyDrillPage = 1;
const AR_COMPANY_DRILL_PAGE_SIZE = 15;

function showARCompanyDrilldown(ar, company) {
  arCompanyDrillSelected = company;
  arCompanyDrillPage = 1;

  document.querySelectorAll('.company-card[data-company]').forEach(card => {
    card.classList.toggle('row-selected', card.dataset.company === company);
  });

  document.getElementById('arCompanyDrillPanel').classList.remove('hidden');
  renderARCompanyDrillTable(ar);
  document.getElementById('arCompanyDrillPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderARCompanyDrillTable(ar) {
  const PAGE = AR_COMPANY_DRILL_PAGE_SIZE;
  const items = ar.items.filter(i => i.company === arCompanyDrillSelected)
    .sort((a, b) => (b.tanggal && a.tanggal ? b.tanggal - a.tanggal : 0));

  document.getElementById('arCompanyDrillTitle').textContent = `Rincian Piutang — ${arCompanyDrillSelected} (${fmtNum(items.length)} faktur)`;

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE));
  if (arCompanyDrillPage > totalPages) arCompanyDrillPage = totalPages;
  const shown = items.slice((arCompanyDrillPage - 1) * PAGE, arCompanyDrillPage * PAGE);

  const rows = shown.map(i => `<tr>
    <td>${i.tanggal ? fmtDateShort(i.tanggal) : '-'}</td>
    <td>${escapeHtml(i.noFaktur)}</td>
    <td>${escapeHtml(i.customer)}</td>
    <td>${fmtRupiah(i.nilaiFaktur)}</td>
    <td>${fmtRupiah(i.sisaSaldo)}</td>
    <td>${escapeHtml(i.aging)}</td>
  </tr>`).join('');

  document.getElementById('tblARCompanyDrill').innerHTML = `
    <thead><tr><th>Tanggal Faktur</th><th>No Faktur</th><th>Nama Customer</th><th>Nilai Faktur</th><th>Sisa Saldo Piutang</th><th>Aging</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="empty-row">Tidak ada data faktur.</td></tr>'}</tbody>
  `;

  const pagHtml = makePagBtns('pagARCompanyDrill', arCompanyDrillPage, totalPages, p => { arCompanyDrillPage = p; renderARCompanyDrillTable(ar); });
  document.getElementById('pagARCompanyDrill').innerHTML = pagHtml;
  attachPagBtns('pagARCompanyDrill', p => { arCompanyDrillPage = p; renderARCompanyDrillTable(ar); });
}

function renderARTable(ar) {
  const PAGE = 15;
  let page = 1;
  const parseAgingDays = (aging) => { const m = String(aging).match(/\d+/); return m ? parseInt(m[0], 10) : 0; };
  let belumLunas = ar.items.filter(i => i.sisaSaldo > 0).sort((a, b) => parseAgingDays(b.aging) - parseAgingDays(a.aging));
  const invoiceUnikBelumLunas = new Set(belumLunas.map(i => i.noFaktur)).size;

  const q = arSearch.trim().toUpperCase();
  if (q) belumLunas = belumLunas.filter(i => (i.customer || '').toUpperCase().includes(q) || (i.noFaktur || '').toUpperCase().includes(q));

  // Tampilkan ringkasan invoice unik di panel note
  const noteEl = document.getElementById('arTableNote');
  if (noteEl) noteEl.innerHTML = `Total <strong>${fmtNum(belumLunas.length)}</strong> baris dari <strong>${fmtNum(invoiceUnikBelumLunas)}</strong> invoice unik belum lunas.`;

  const render = () => {
    const total = belumLunas.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE));
    if (page > totalPages) page = totalPages;
    const shown = belumLunas.slice((page-1)*PAGE, page*PAGE);
    const pagHtml = makePagBtns('pagAR', page, totalPages, p => { page = p; render(); });
    document.getElementById('tblAR').outerHTML = `<table class="data-table" id="tblAR">
      <thead><tr><th>No Faktur</th><th>Customer</th><th>Company</th><th>Nilai Faktur</th><th>Sisa Saldo</th><th>Aging</th><th>Kategori</th></tr></thead>
      <tbody>${shown.length ? shown.map(i => `<tr><td>${escapeHtml(i.noFaktur)}</td><td>${escapeHtml(i.customer)}</td><td>${escapeHtml(i.company)}</td><td>${fmtRupiah(i.nilaiFaktur)}</td><td>${fmtRupiah(i.sisaSaldo)}</td><td>${escapeHtml(i.aging)}</td><td>${escapeHtml(i.kategori)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty-row">Tidak ada piutang yang cocok.</td></tr>'}</tbody>
    </table>`;
    const pagEl = document.getElementById('pagAR');
    if (pagEl) { pagEl.innerHTML = pagHtml; attachPagBtns('pagAR', p => { page = p; render(); }); }
    else {
      const wrap = document.createElement('div');
      wrap.id = 'pagAR';
      wrap.className = 'pagination';
      wrap.innerHTML = pagHtml;
      document.getElementById('tblAR').insertAdjacentElement('afterend', wrap);
      attachPagBtns('pagAR', p => { page = p; render(); });
    }
  };
  render();
}

/* ==========================================================================
   SECTION 09 — FREKUENSI CUSTOMER
   ========================================================================== */
let custFreqMetric = 'frequency'; // frequency | sales

function renderCustFreqSection(m) {
  const cf = m.customerFrequency;

  const html = `
    <div class="section-head">
      <div class="eyebrow">10 &mdash; Customer</div>
      <h2>Frekuensi Pembelanjaan Customer</h2>
      <p class="lede">Analisis frekuensi transaksi (jumlah invoice unik) dan nominal pembelanjaan per customer sepanjang tahun 2026, termasuk identifikasi customer yang sudah tidak aktif.</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total Customer Unik 2026</div>
        <div class="kpi-value">${fmtNum(cf.totalCustomer)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Rata-rata Frekuensi Transaksi</div>
        <div class="kpi-value">${cf.avgFrequency.toFixed(1)}x</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Rata-rata Sales per Customer</div>
        <div class="kpi-value">${fmtRupiah(cf.avgSalesPerCustomer)}</div>
      </div>
      <div class="kpi-card kpi-card-accent">
        <div class="kpi-label">Customer Tidak Aktif &ge;2 Bulan</div>
        <div class="kpi-value">${fmtNum(cf.churnedCustomers.length)}</div>
        <div class="kpi-sub">Sejak pembelian terakhir</div>
      </div>
    </div>

    <div class="panel">
      <h3>Distribusi Customer berdasarkan Frekuensi Transaksi</h3>
      <p class="panel-note">Pembagian jumlah customer unik dan total nominal pembelanjaan berdasarkan seberapa sering mereka bertransaksi sepanjang 2026. Klik salah satu baris frekuensi untuk melihat daftar customernya.</p>
      <div class="two-col">
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartFreqDist"></canvas></div>
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartFreqDistSales"></canvas></div>
      </div>
      <table class="data-table" id="tblFreqDist"></table>
      <div id="freqDistDrillPanel" class="drill-panel hidden">
        <h4 class="sub-heading" id="freqDistDrillTitle"></h4>
        <p class="panel-note" id="freqDistDrillNote"></p>
        <table class="data-table" id="tblFreqDistCustomers"></table>
        <div class="pagination" id="pagFreqDistCustomers"></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Top 10 Customer Paling Sering Berbelanja</h3>
        <div class="toggle-group" id="custFreqMetricToggle">
          <button class="toggle-btn active" data-metric="frequency">By Frekuensi</button>
          <button class="toggle-btn" data-metric="sales">By Total Sales</button>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartTop10Customer"></canvas></div>
      <div class="panel-head daily-perf-controls" style="margin:12px 0;">
        <div class="filter-field filter-field-grow">
          <label for="top10CustomerSearch">Cari Customer</label>
          <input type="text" id="top10CustomerSearch" class="text-input" placeholder="Ketik nama customer&hellip;" />
        </div>
      </div>
      <table class="data-table" id="tblTop10Customer"></table>
      <div class="pagination" id="pagTop10Customer"></div>
    </div>

    <div class="panel">
      <h3>Customer Tidak Berbelanja Lagi (&ge;60 Hari sejak Transaksi Terakhir)</h3>
      <p class="panel-note">Total ${fmtNum(cf.churnedCustomers.length)} customer berpotensi tidak aktif. Diurutkan dari yang paling lama tidak bertransaksi.</p>
      <div class="panel-head daily-perf-controls" style="margin-bottom:12px;">
        <div class="filter-field filter-field-grow">
          <label for="churnedSearch">Cari Customer</label>
          <input type="text" id="churnedSearch" class="text-input" placeholder="Ketik nama customer&hellip;" />
        </div>
      </div>
      <table class="data-table" id="tblChurned"></table>
    </div>
  `;
  document.getElementById('s9').innerHTML = html;

  renderFreqDistCharts(cf.frequencyDistribution);
  renderTop10CustomerChart(cf, custFreqMetric);
  renderChurnedTable(cf);

  document.querySelectorAll('#custFreqMetricToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#custFreqMetricToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      custFreqMetric = btn.dataset.metric;
      top10CustomerTablePage = 1;
      renderTop10CustomerChart(cf, custFreqMetric);
    });
  });

  const top10CustomerSearchEl = document.getElementById('top10CustomerSearch');
  if (top10CustomerSearchEl) {
    top10CustomerSearchEl.value = top10CustomerSearch;
    top10CustomerSearchEl.addEventListener('input', (e) => {
      top10CustomerSearch = e.target.value;
      top10CustomerTablePage = 1;
      renderTop10CustomerTable(custFreqMetric === 'frequency' ? cf.allByFrequency : cf.allBySales);
    });
  }

  const churnedSearchEl = document.getElementById('churnedSearch');
  if (churnedSearchEl) {
    churnedSearchEl.value = churnedSearch;
    churnedSearchEl.addEventListener('input', (e) => {
      churnedSearch = e.target.value;
      renderChurnedTable(cf);
    });
  }
}

function renderFreqDistCharts(dist) {
  makeChart('chartFreqDist', {
    type: 'doughnut',
    data: {
      labels: dist.map(d => d.label),
      datasets: [{
        data: dist.map(d => d.customerCount),
        backgroundColor: [PALETTE.terra, PALETTE.amber, PALETTE.sage, PALETTE.slate, PALETTE.red],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '58%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtNum(ctx.parsed)} customer (${fmtPct(dist[ctx.dataIndex].pct)})` } },
        title: { display: true, text: 'Jumlah Customer Unik', font: { size: 12.5, weight: '600' }, color: '#6a5a4a', padding: { bottom: 8 } },
      },
    },
  });

  makeChart('chartFreqDistSales', {
    type: 'bar',
    data: {
      labels: dist.map(d => d.label),
      datasets: [{ label: 'Total Sales', data: dist.map(d => d.totalSales), backgroundColor: PALETTE.terra, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.y) } },
        title: { display: true, text: 'Total Nominal Pembelanjaan', font: { size: 12.5, weight: '600' }, color: '#6a5a4a', padding: { bottom: 8 } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } },
        x: { grid: { display: false }, ticks: { font: { size: 10.5 } } },
      },
    },
  });

  document.getElementById('tblFreqDist').innerHTML = `
    <thead><tr><th>Frekuensi Belanja</th><th>Jumlah Customer</th><th>Persentase</th><th>Total Nominal</th></tr></thead>
    <tbody>${dist.map(d => `<tr class="clickable-row" data-bucket="${escapeHtml(d.key)}"><td>${escapeHtml(d.label)}</td><td>${fmtNum(d.customerCount)}</td><td>${fmtPct(d.pct)}</td><td>${fmtRupiah(d.totalSales)}</td></tr>`).join('')}</tbody>
  `;

  document.querySelectorAll('#tblFreqDist tbody tr[data-bucket]').forEach(tr => {
    tr.addEventListener('click', () => {
      freqDistDrillPage = 1;
      showFreqDistDrilldown(dist, tr.dataset.bucket);
    });
  });

  if (freqDistDrillSelected && dist.some(d => d.key === freqDistDrillSelected)) {
    showFreqDistDrilldown(dist, freqDistDrillSelected);
  }
}

let freqDistDrillSelected = null;
let freqDistDrillPage = 1;
const FREQ_DIST_DRILL_PAGE_SIZE = 15;

function showFreqDistDrilldown(dist, bucketKey) {
  freqDistDrillSelected = bucketKey;
  const bucket = dist.find(d => d.key === bucketKey);
  if (!bucket) return;

  document.querySelectorAll('#tblFreqDist tbody tr[data-bucket]').forEach(tr => {
    tr.classList.toggle('row-selected', tr.dataset.bucket === bucketKey);
  });

  const panel = document.getElementById('freqDistDrillPanel');
  panel.classList.remove('hidden');
  document.getElementById('freqDistDrillTitle').textContent = `Daftar Customer — ${bucket.label}`;
  document.getElementById('freqDistDrillNote').textContent = `${fmtNum(bucket.customerCount)} customer dalam kategori ini.`;

  const isSingle = bucketKey === 'b1';
  const PAGE = FREQ_DIST_DRILL_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(bucket.customers.length / PAGE));
  if (freqDistDrillPage > totalPages) freqDistDrillPage = totalPages;
  const shown = bucket.customers.slice((freqDistDrillPage - 1) * PAGE, freqDistDrillPage * PAGE);

  const headCols = isSingle
    ? '<th>Nama Customer</th><th>Total Sales</th><th>Tanggal Terakhir Berbelanja</th>'
    : '<th>Nama Customer</th><th>Total Invoice Unik</th><th>Total Nilai Sales</th>';
  const rowsHtml = shown.length ? shown.map(c => isSingle
    ? `<tr><td>${escapeHtml(c.customer)}</td><td>${fmtRupiah(c.totalSales)}</td><td>${c.lastPurchase ? fmtDateShort(c.lastPurchase) : '-'}</td></tr>`
    : `<tr><td>${escapeHtml(c.customer)}</td><td>${fmtNum(c.invoiceUnik)}</td><td>${fmtRupiah(c.totalSales)}</td></tr>`
  ).join('') : `<tr><td colspan="3" class="empty-row">Tidak ada customer.</td></tr>`;

  document.getElementById('tblFreqDistCustomers').innerHTML = `<thead><tr>${headCols}</tr></thead><tbody>${rowsHtml}</tbody>`;

  const pagHtml = makePagBtns('pagFreqDistCustomers', freqDistDrillPage, totalPages, p => { freqDistDrillPage = p; showFreqDistDrilldown(dist, bucketKey); });
  document.getElementById('pagFreqDistCustomers').innerHTML = pagHtml;
  attachPagBtns('pagFreqDistCustomers', p => { freqDistDrillPage = p; showFreqDistDrilldown(dist, bucketKey); });

  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

let top10CustomerTablePage = 1;
let top10CustomerSearch = '';

function renderTop10CustomerChart(cf, metric) {
  const data = metric === 'frequency' ? cf.top10ByFrequency : cf.top10BySales;
  makeChart('chartTop10Customer', {
    type: 'bar',
    data: {
      labels: data.map(c => c.customer),
      datasets: [{
        label: metric === 'frequency' ? 'Invoice Unik' : 'Total Sales',
        data: data.map(c => metric === 'frequency' ? c.invoiceUnik : c.totalSales),
        backgroundColor: PALETTE.terra, borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => metric === 'frequency' ? `${fmtNum(ctx.parsed.x)} invoice` : fmtRupiah(ctx.parsed.x) } } },
      scales: { x: { beginAtZero: true, ticks: { callback: v => metric === 'sales' ? fmtRupiahShort(v) : fmtNum(v) }, grid: { color: '#eae3d6' } }, y: { grid: { display: false } } },
    },
  });

  const fullData = metric === 'frequency' ? cf.allByFrequency : cf.allBySales;
  renderTop10CustomerTable(fullData);
}

function renderTop10CustomerTable(fullData) {
  const PAGE = 10;
  const render = () => {
    const q = top10CustomerSearch.trim().toUpperCase();
    const data = q ? fullData.filter(c => (c.customer || '').toUpperCase().includes(q)) : fullData;
    const total = data.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE));
    if (top10CustomerTablePage > totalPages) top10CustomerTablePage = totalPages;
    const shown = data.slice((top10CustomerTablePage - 1) * PAGE, top10CustomerTablePage * PAGE);
    document.getElementById('tblTop10Customer').outerHTML = `<table class="data-table" id="tblTop10Customer">
      <thead><tr><th>Peringkat</th><th>Customer</th><th>Frekuensi (Invoice Unik)</th><th>Total Sales</th></tr></thead>
      <tbody>${shown.length ? shown.map((c, i) => `<tr><td>${(top10CustomerTablePage - 1) * PAGE + i + 1}</td><td>${escapeHtml(c.customer)}</td><td>${fmtNum(c.invoiceUnik)}</td><td>${fmtRupiah(c.totalSales)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-row">Tidak ada customer yang cocok.</td></tr>'}</tbody>
    </table>`;
    const pagHtml = makePagBtns('pagTop10Customer', top10CustomerTablePage, totalPages, p => { top10CustomerTablePage = p; render(); });
    const pagEl = document.getElementById('pagTop10Customer');
    if (pagEl) { pagEl.innerHTML = pagHtml; attachPagBtns('pagTop10Customer', p => { top10CustomerTablePage = p; render(); }); }
  };
  render();
}

let churnedSearch = '';

function renderChurnedTable(cf) {
  const PAGE = 10;
  let page = 1;
  const q = churnedSearch.trim().toUpperCase();
  const items = q ? cf.churnedCustomers.filter(c => (c.customer || '').toUpperCase().includes(q)) : cf.churnedCustomers;

  const render = () => {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE));
    if (page > totalPages) page = totalPages;
    const shown = items.slice((page-1)*PAGE, page*PAGE);
    const pagHtml = makePagBtns('pagChurned', page, totalPages, p => { page = p; render(); });
    document.getElementById('tblChurned').outerHTML = `<table class="data-table" id="tblChurned">
      <thead><tr><th>Customer</th><th>Transaksi Terakhir</th><th>Hari Tidak Aktif</th><th>Total Sales 2026</th></tr></thead>
      <tbody>${shown.length ? shown.map(c => `<tr><td>${escapeHtml(c.customer)}</td><td>${fmtDateShort(c.lastPurchase)}</td><td>${fmtNum(c.daysSinceLastPurchase)} hari</td><td>${fmtRupiah(c.totalSales)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-row">Tidak ada customer yang cocok.</td></tr>'}</tbody>
    </table>`;
    const pagEl = document.getElementById('pagChurned');
    if (pagEl) { pagEl.innerHTML = pagHtml; attachPagBtns('pagChurned', p => { page = p; render(); }); }
    else {
      const wrap = document.createElement('div');
      wrap.id = 'pagChurned';
      wrap.className = 'pagination';
      wrap.innerHTML = pagHtml;
      document.getElementById('tblChurned').insertAdjacentElement('afterend', wrap);
      attachPagBtns('pagChurned', p => { page = p; render(); });
    }
  };
  render();
}

/* ==========================================================================
   SECTION 10 — TREN KABEL FIBER OPTIC 1-CORE
   ========================================================================== */
let fo1coreKodeFilter = 'semua';

function renderFiberOpticSection(m) {
  const fo = m.fiberOptic1Core;

  const html = `
    <div class="section-head">
      <div class="eyebrow">11 &mdash; Fiber Optic</div>
      <h2>Tren Kabel Fiber Optic 1-Core</h2>
      <p class="lede">Khusus 5 kode barang: KSFO028, KSFO108, KSFO083, KSFO113, dan KSFO128, dari sheet Grand Data 2026.</p>
    </div>

    <div class="kpi-grid kpi-grid-3">
      <div class="kpi-card">
        <div class="kpi-label">Total Sales FO 1-Core 2026</div>
        <div class="kpi-value">${fmtRupiah(fo.totalSales)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Quantity Terjual</div>
        <div class="kpi-value">${fmtNum(fo.totalQty)} unit</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Kontribusi by Company</div>
        <div class="kpi-value-split">
          <span>MKI: ${fmtRupiah(fo.byCompany.MKI.sales)}</span>
          <span>CFN: ${fmtRupiah(fo.byCompany.CFN.sales)}</span>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>Tren Bulanan Total Kelima Kode Barang</h3>
      <div class="chart-wrap"><canvas id="chartFOTrend"></canvas></div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Detail per Kode Barang</h3>
        <div class="toggle-group" id="fo1coreToggle">
          <button class="toggle-btn active" data-kode="semua">Semua Kode</button>
          ${FO_1CORE_CODES.map(k => `<button class="toggle-btn" data-kode="${k}">${k}</button>`).join('')}
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartFOByKode"></canvas></div>
      <table class="data-table" id="tblFOByKode"></table>
    </div>

    <div class="panel">
      <h3>Total Sales per Bulan per Kode Barang</h3>
      <p class="panel-note">Rincian nilai penjualan setiap bulan untuk masing-masing kode barang FO 1-Core sepanjang tahun 2026.</p>
      <div class="table-scroll"><table class="data-table data-table-compact" id="tblFOSalesMatrix"></table></div>
    </div>

    <div class="panel">
      <h3>Total Quantity per Bulan per Kode Barang</h3>
      <p class="panel-note">Rincian unit terjual setiap bulan untuk masing-masing kode barang FO 1-Core sepanjang tahun 2026.</p>
      <div class="table-scroll"><table class="data-table data-table-compact" id="tblFOQtyMatrix"></table></div>
    </div>

    <div class="panel">
      <h3>Pembagian by Company</h3>
      <div class="chart-wrap chart-wrap-sm"><canvas id="chartFOByCompany"></canvas></div>
    </div>
  `;
  document.getElementById('s10').innerHTML = html;

  renderFOTrendChart(fo);
  renderFOByKodeChart(fo, fo1coreKodeFilter);
  renderFOByCompanyChart(fo);
  renderFOSummaryTable(fo, m.invoiceCustomerSummary.totalSales);
  renderFOSalesMatrixTable(fo);
  renderFOQtyMatrixTable(fo);

  document.querySelectorAll('#fo1coreToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#fo1coreToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fo1coreKodeFilter = btn.dataset.kode;
      renderFOByKodeChart(fo, fo1coreKodeFilter);
    });
  });
}

function renderFOTrendChart(fo) {
  makeChart('chartFOTrend', {
    type: 'line',
    data: {
      labels: fo.monthly.map(x => MONTH_NAMES_SHORT_ID[x.monthIdx]),
      datasets: [{ label: 'Sales FO 1-Core', data: fo.monthly.map(x => x.sales), borderColor: PALETTE.amber, backgroundColor: 'rgba(207,155,63,0.14)', fill: true, tension: 0.35, pointRadius: 5, pointHoverRadius: 8, pointHitRadius: 22, pointBackgroundColor: PALETTE.amber, borderWidth: 2.5 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => fmtRupiah(ctx.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });
}

function renderFOByKodeChart(fo, kodeFilter) {
  let datasets;
  if (kodeFilter === 'semua') {
    datasets = fo.byKode.map((k, idx) => ({
      label: k.kode, data: k.monthly.map(m => m.sales),
      borderColor: [PALETTE.terra, PALETTE.sage, PALETTE.amber, PALETTE.slate, PALETTE.red][idx % 5],
      backgroundColor: 'transparent', tension: 0.3, pointRadius: 4, pointHoverRadius: 7, pointHitRadius: 18, borderWidth: 2,
    }));
  } else {
    const k = fo.byKode.find(x => x.kode === kodeFilter);
    datasets = [{ label: k.kode, data: k.monthly.map(m => m.sales), borderColor: PALETTE.terra, backgroundColor: 'rgba(193,122,90,0.12)', fill: true, tension: 0.35, pointRadius: 5, pointHoverRadius: 8, pointHitRadius: 22, borderWidth: 2.5 }];
  }

  makeChart('chartFOByKode', {
    type: 'line',
    data: { labels: MONTH_NAMES_SHORT_ID, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtRupiah(ctx.parsed.y)}` } },
      },
      scales: { y: { ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });
}

function renderFOByCompanyChart(fo) {
  const coTotal = fo.byCompany.MKI.sales + fo.byCompany.CFN.sales;
  const coPct = {
    MKI: coTotal > 0 ? (fo.byCompany.MKI.sales / coTotal) * 100 : 0,
    CFN: coTotal > 0 ? (fo.byCompany.CFN.sales / coTotal) * 100 : 0,
  };
  makeChart('chartFOByCompany', {
    type: 'doughnut',
    data: { labels: ['MKI', 'CFN'], datasets: [{ data: [fo.byCompany.MKI.sales, fo.byCompany.CFN.sales], backgroundColor: [PALETTE.terra, PALETTE.sage], borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            generateLabels: chart => chart.data.labels.map((label, i) => ({
              text: `${label}: ${fmtPct(coPct[label])}`,
              fillStyle: chart.data.datasets[0].backgroundColor[i],
              strokeStyle: chart.data.datasets[0].backgroundColor[i],
              index: i,
            })),
          },
        },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtRupiah(ctx.parsed)} (${fmtPct(coPct[ctx.label])})` } },
      },
    },
  });
}

function renderFOSummaryTable(fo, grandTotalSales) {
  document.getElementById('tblFOByKode').innerHTML = `
    <thead><tr><th>Kode Barang</th><th>Total Sales</th><th>Total Quantity</th><th>Kontribusi by Total Sales</th></tr></thead>
    <tbody>${fo.byKode.map(k => `<tr><td>${escapeHtml(k.kode)}</td><td>${fmtRupiah(k.sales)}</td><td>${fmtNum(k.qty)}</td><td>${fmtPct(grandTotalSales > 0 ? (k.sales / grandTotalSales) * 100 : 0)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td>${fmtRupiah(fo.totalSales)}</td><td>${fmtNum(fo.totalQty)}</td><td>${fmtPct(grandTotalSales > 0 ? (fo.totalSales / grandTotalSales) * 100 : 0)}</td></tr></tfoot>
  `;
}

function renderFOSalesMatrixTable(fo) {
  // Sama seperti renderFOQtyMatrixTable, tapi sel-nya nilai Sales (Rupiah)
  // bukan Quantity. Baris = kode barang, kolom = bulan.
  const monthHeaders = MONTH_NAMES_SHORT_ID.map(m => `<th>${m}</th>`).join('');
  const rows = fo.byKode.map(k => {
    const cells = k.monthly.map(mo => `<td>${mo.sales > 0 ? fmtRupiah(mo.sales) : '&ndash;'}</td>`).join('');
    return `<tr><td>${escapeHtml(k.kode)}</td>${cells}<td><strong>${fmtRupiah(k.sales)}</strong></td></tr>`;
  }).join('');

  const totalPerBulan = MONTH_NAMES_ID.map((_, idx) => sum(fo.byKode, k => k.monthly[idx].sales));
  const totalCells = totalPerBulan.map(s => `<td>${s > 0 ? fmtRupiah(s) : '&ndash;'}</td>`).join('');

  document.getElementById('tblFOSalesMatrix').innerHTML = `
    <thead><tr><th>Kode Barang</th>${monthHeaders}<th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td>${totalCells}<td><strong>${fmtRupiah(fo.totalSales)}</strong></td></tr></tfoot>
  `;
}

function renderFOQtyMatrixTable(fo) {
  // fo.byKode[].monthly sudah terurut monthIdx 0-11 (Jan-Des). Tabel ini
  // menampilkan matriks: baris = kode barang, kolom = bulan, sel = quantity.
  const monthHeaders = MONTH_NAMES_SHORT_ID.map(m => `<th>${m}</th>`).join('');
  const rows = fo.byKode.map(k => {
    const cells = k.monthly.map(mo => `<td>${mo.qty > 0 ? fmtNum(mo.qty) : '&ndash;'}</td>`).join('');
    return `<tr><td>${escapeHtml(k.kode)}</td>${cells}<td><strong>${fmtNum(k.qty)}</strong></td></tr>`;
  }).join('');

  // Baris total per bulan (jumlah seluruh kode barang untuk bulan tersebut)
  const totalPerBulan = MONTH_NAMES_ID.map((_, idx) => sum(fo.byKode, k => k.monthly[idx].qty));
  const totalCells = totalPerBulan.map(q => `<td>${q > 0 ? fmtNum(q) : '&ndash;'}</td>`).join('');

  document.getElementById('tblFOQtyMatrix').innerHTML = `
    <thead><tr><th>Kode Barang</th>${monthHeaders}<th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td>${totalCells}<td><strong>${fmtNum(fo.totalQty)}</strong></td></tr></tfoot>
  `;
}

/* ==========================================================================
   ORKESTRASI RENDER — Memanggil seluruh render section secara berurutan
   ========================================================================== */
// Peta section id -> fungsi render-nya. Dipakai untuk render "malas" (lazy):
// section HANYA benar-benar dirender (bangun HTML + bikin chart) begitu
// pertama kali dibuka usernya, bukan semua sekaligus saat load — supaya buka
// dashboard, refresh, dan pindah-pindah section terasa jauh lebih ringan.
const SECTION_RENDER_MAP = {
  s0: renderDailyPerformanceSection,
  s1: renderSalesSection,
  s2: renderRevenueSection,
  s3: renderRatioSection,
  s4: renderZonaSection,
  s5: renderTopProductsSection,
  s6: renderStockSection,
  s7: renderDeliverySection,
  s8: renderARSection,
  s9: renderCustFreqSection,
  s10: renderFiberOpticSection,
};
let renderedSectionIds = new Set(); // section yang sudah pernah benar-benar dirender
let latestMetrics = null;

function renderDashboard(metrics) {
  applyChartDefaults();
  latestMetrics = metrics;

  document.getElementById('lastUpdated').textContent = metrics.generatedAt.toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  if (renderedSectionIds.size === 0) {
    // Load pertama kali: cukup render Section 01 (Daily Performance, tampilan
    // default setelah cover) supaya dashboard langsung terasa siap. Section
    // lainnya baru dirender saat pertama kali dibuka (lihat ensureSectionRendered).
    SECTION_RENDER_MAP.s0(metrics);
    renderedSectionIds.add('s0');
  } else {
    // Update data (auto-refresh): render ulang HANYA section yang memang
    // sudah pernah dibuka user, supaya datanya tetap ter-update — section
    // yang belum pernah dibuka akan otomatis dapat data terbaru saat nanti
    // pertama kali dibuka (ensureSectionRendered selalu pakai latestMetrics).
    renderedSectionIds.forEach(id => { SECTION_RENDER_MAP[id](metrics); });
  }

  wrapTablesForMobileScroll();

  document.getElementById('loadingOverlay').classList.add('hidden');
  document.getElementById('mainContent').classList.add('visible');
}

// Dipanggil dari index.html setiap kali user pindah ke section tertentu.
// Kalau section itu belum pernah dirender, render sekarang (pakai data
// terbaru yang sudah ada); kalau sudah pernah, tidak melakukan apa-apa
// (hindari kerja render ulang yang tidak perlu).
function ensureSectionRendered(sectionId) {
  if (!sectionId || renderedSectionIds.has(sectionId) || !SECTION_RENDER_MAP[sectionId] || !latestMetrics) return;
  SECTION_RENDER_MAP[sectionId](latestMetrics);
  renderedSectionIds.add(sectionId);
  wrapTablesForMobileScroll();
}
window.ensureSectionRendered = ensureSectionRendered;

// Membungkus setiap <table class="data-table"> yang belum punya wrapper
// scroll (.table-scroll) dengan div pembungkus baru, agar di layar mobile
// tabel bisa digeser horizontal tanpa kolomnya menyempit/wrap. Dipanggil
// sekali setelah seluruh section selesai dirender.
function wrapTablesForMobileScroll() {
  document.querySelectorAll('table.data-table').forEach(table => {
    if (table.closest('.table-scroll') || table.closest('.data-table-scroll-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'data-table-scroll-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });
}

function renderErrorPanel(errors) {
  const panel = document.getElementById('errorPanel');
  if (!errors || errors.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="error-box">
      <strong>Beberapa data gagal dimuat dari Google Sheets:</strong>
      <ul>${errors.map(e => `<li>${escapeHtml(e.sheetName)}: ${escapeHtml(e.message)}</li>`).join('')}</ul>
      <p>Dashboard tetap menampilkan data yang berhasil dimuat. Coba muat ulang halaman, atau periksa apakah sheet sudah dibagikan secara publik.</p>
    </div>
  `;
}
