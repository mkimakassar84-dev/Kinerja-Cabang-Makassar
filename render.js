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
  kpi:      { month: String(TODAY.getMonth()) }, // default bulan berjalan
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
      <button class="subtab-btn" data-tab="sales">Sales</button>
      <button class="subtab-btn" data-tab="revenue">Revenue</button>
      <button class="subtab-btn" data-tab="ar">Account Receivable</button>
      <button class="subtab-btn" data-tab="delivery">Delivery</button>
      <button class="subtab-btn" data-tab="po">PO Gudang</button>
    </div>

    <div class="subtab-panel active" id="dpPanel-kpi"></div>
    <div class="subtab-panel" id="dpPanel-sales"></div>
    <div class="subtab-panel" id="dpPanel-revenue"></div>
    <div class="subtab-panel" id="dpPanel-ar"></div>
    <div class="subtab-panel" id="dpPanel-delivery"></div>
    <div class="subtab-panel" id="dpPanel-po"></div>
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

  // Set default ke bulan berjalan
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

  const render = () => {
    const monthIdx = parseInt(dailyPerfState.kpi.month, 10);
    const monthLabel = MONTH_NAMES_ID[monthIdx];

    // Filter transaksi bulan terpilih (exclude Return)
    const txMonth = tx2026.filter(t =>
      t.orderDate && t.orderDate.getMonth() === monthIdx &&
      (t.stage || '').toLowerCase() !== 'return'
    );
    const revMonth = rev2026.filter(r => r.paymentDate && r.paymentDate.getMonth() === monthIdx);

    // Angka harian (TODAY) — untuk semua bulan, bukan hanya bulan ini,
    // karena user bisa lihat histori bulan lalu dan perlu tahu harian di hari ini.
    const todayStr = [TODAY.getFullYear(), String(TODAY.getMonth()+1).padStart(2,'0'), String(TODAY.getDate()).padStart(2,'0')].join('-');
    const toIsoLocal = d => d ? [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-') : '';
    const txToday  = txMonth.filter(t => toIsoLocal(t.orderDate) === todayStr);
    const revToday = revMonth.filter(r => toIsoLocal(r.paymentDate) === todayStr);

    // ── 1. TOTAL SALES ──
    const totalSales   = sum(txMonth, t => t.amount);
    const dailySales   = sum(txToday, t => t.amount);
    const monthData    = yoyMonths.find(mo => mo.monthIdx === monthIdx);
    const targetSales  = monthData ? monthData.targetSalesRevenue : 0;
    const pctSales     = targetSales > 0 ? (totalSales / targetSales) * 100 : 0;

    // ── 2. TOTAL REVENUE ──
    const totalRevenue = sum(revMonth, r => r.pelunasan);
    const dailyRevenue = sum(revToday, r => r.pelunasan);
    const pctRevenue   = targetSales > 0 ? (totalRevenue / targetSales) * 100 : 0;

    // ── 3. COLLECTION RATE (Revenue ÷ Sales) ──
    const collectionRate = totalSales > 0 ? (totalRevenue / totalSales) * 100 : 0;

    // ── 4. OTD ACCURACY ──
    const txNoHC           = txMonth.filter(t => (t.statusEkspedisi || '').toUpperCase() !== 'HAND CARRY');
    const invoiceUnikTotal = uniqueCount(txNoHC, t => t.noInvoice);
    const invoiceSameDay   = uniqueCount(txNoHC.filter(t => t.statusKirim === 'Same Day'), t => t.noInvoice);
    const otdPct    = invoiceUnikTotal > 0 ? (invoiceSameDay / invoiceUnikTotal) * 100 : 0;
    const otdTarget = 80;
    // OTD harian
    const txTodayNoHC     = txToday.filter(t => (t.statusEkspedisi || '').toUpperCase() !== 'HAND CARRY');
    const invTodayTotal   = uniqueCount(txTodayNoHC, t => t.noInvoice);
    const invTodaySameDay = uniqueCount(txTodayNoHC.filter(t => t.statusKirim === 'Same Day'), t => t.noInvoice);
    const otdPctToday     = invTodayTotal > 0 ? (invTodaySameDay / invTodayTotal) * 100 : null;

    // ── 5. TOTAL INVOICE ──
    const TARGET_INVOICE  = 280; // target tetap per bulan, berlaku semua bulan
    const invoiceUnikAll  = uniqueCount(txMonth, t => t.noInvoice);
    const dailyInvoice    = uniqueCount(txToday, t => t.noInvoice);
    const pctInvoice      = (invoiceUnikAll / TARGET_INVOICE) * 100;

    // Label tanggal hari ini (untuk sub-label harian)
    const todayLabel = TODAY.toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });

    const cardSales = `
      <div class="kpi-monitor-card">
        <div class="kmc-label">Total Sales — ${escapeHtml(monthLabel)}</div>
        <div class="kmc-value">${fmtRupiah(totalSales)}</div>
        <div class="kmc-sub">Hari ini (${escapeHtml(todayLabel)}): <strong>${fmtRupiah(dailySales)}</strong></div>
        ${targetSales > 0 ? `
          <div class="kmc-target">Target: ${fmtRupiah(targetSales)} &nbsp;&mdash;&nbsp; Capaian: <strong>${fmtPct(pctSales)}</strong></div>
          ${kpiBar(pctSales)}
          ${kpiStatus(pctSales)}
        ` : '<div class="kmc-sub" style="margin-top:8px;">Target tidak tersedia untuk bulan ini</div>'}
      </div>`;

    const cardRevenue = `
      <div class="kpi-monitor-card">
        <div class="kmc-label">Total Revenue — ${escapeHtml(monthLabel)}</div>
        <div class="kmc-value">${fmtRupiah(totalRevenue)}</div>
        <div class="kmc-sub">Hari ini (${escapeHtml(todayLabel)}): <strong>${fmtRupiah(dailyRevenue)}</strong></div>
        ${targetSales > 0 ? `
          <div class="kmc-target">Target: ${fmtRupiah(targetSales)} &nbsp;&mdash;&nbsp; Capaian: <strong>${fmtPct(pctRevenue)}</strong></div>
          ${kpiBar(pctRevenue)}
          ${kpiStatus(pctRevenue)}
        ` : '<div class="kmc-sub" style="margin-top:8px;">Target tidak tersedia untuk bulan ini</div>'}
      </div>`;

    const cardCollection = `
      <div class="kpi-monitor-card">
        <div class="kmc-label">Collection Rate (Revenue ÷ Sales)</div>
        <div class="kmc-value">${fmtPct(collectionRate)}</div>
        <div class="kmc-sub">Seberapa banyak tagihan dari penjualan yang sudah terbayar</div>
        <div class="kmc-target">Target: 100% &nbsp;&mdash;&nbsp; Capaian: <strong>${fmtPct(collectionRate)}</strong></div>
        ${kpiBar(collectionRate)}
        ${kpiStatus(collectionRate, 90, 60)}
      </div>`;

    const cardOTD = `
      <div class="kpi-monitor-card">
        <div class="kmc-label">OTD Accuracy — ${escapeHtml(monthLabel)}</div>
        <div class="kmc-value">${fmtPct(otdPct)}</div>
        <div class="kmc-sub">
          Hari ini: <strong>${otdPctToday !== null ? fmtPct(otdPctToday) : '&ndash;'}</strong>
          &nbsp;(${fmtNum(invTodaySameDay)}/${fmtNum(invTodayTotal)} invoice Same Day)
        </div>
        <div class="kmc-sub" style="margin-top:2px;">Bulan ini: ${fmtNum(invoiceSameDay)} Same Day / ${fmtNum(invoiceUnikTotal)} invoice (no HAND CARRY)</div>
        <div class="kmc-target">Target: ${otdTarget}% &nbsp;&mdash;&nbsp; Capaian: <strong>${fmtPct(otdPct)}</strong></div>
        ${kpiBar(otdPct, otdTarget, 60)}
        ${kpiStatus(otdPct, otdTarget, 60)}
      </div>`;

    const cardInvoice = `
      <div class="kpi-monitor-card">
        <div class="kmc-label">Total Invoice — ${escapeHtml(monthLabel)}</div>
        <div class="kmc-value">${fmtNum(invoiceUnikAll)}</div>
        <div class="kmc-sub">Hari ini (${escapeHtml(todayLabel)}): <strong>${fmtNum(dailyInvoice)} invoice</strong></div>
        <div class="kmc-target">Target: ${fmtNum(TARGET_INVOICE)} &nbsp;&mdash;&nbsp; Capaian: <strong>${fmtPct(pctInvoice)}</strong></div>
        ${kpiBar(pctInvoice)}
        ${kpiStatus(pctInvoice)}
      </div>`;

    document.getElementById('dpKpiContent').innerHTML = `
      <p class="panel-note" style="margin-bottom:20px;">
        KPI bulan <strong>${escapeHtml(monthLabel)} ${CURRENT_YEAR}</strong>.
        OTD = invoice Same Day ÷ total invoice (exclude HAND CARRY &amp; Return), target 80%.
        Target Sales &amp; Revenue dari Sales SUM (kolom AT). Target Invoice = 280/bulan (tetap).
      </p>
      <div class="kpi-monitor-grid">
        ${cardSales}
        ${cardRevenue}
        ${cardCollection}
        ${cardOTD}
        ${cardInvoice}
      </div>
    `;
  };

  render();
  kpiMonthEl.addEventListener('change', (e) => {
    dailyPerfState.kpi.month = e.target.value;
    render();
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

  const html = `
    <div class="panel">
      <div class="panel-head daily-perf-controls">
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
              <th>Order Date</th><th>No Invoice</th><th>Payment</th><th>Customer</th>
              <th>Kode Barang</th><th>Qty</th><th>Amount</th><th>Status</th>
              <th>Company</th><th>Koli</th><th>Status Ekspedisi</th>
              <th>Lokasi</th><th>Tgl Terkirim</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="pagination" id="dpDelPagination"></div>
    </div>
  `;
  document.getElementById('dpPanel-delivery').innerHTML = html;

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
          <td>${escapeHtml(t.payment)}</td>
          <td>${escapeHtml(t.customer)}</td>
          <td>${escapeHtml(t.kodeBarang)}</td>
          <td>${fmtNum(t.qty)}</td>
          <td>${fmtRupiah(t.amount)}</td>
          <td>${escapeHtml(t.statusKirim)}</td>
          <td>${escapeHtml(t.company)}</td>
          <td>${fmtNum(t.koli)}</td>
          <td>${escapeHtml(t.statusEkspedisi)}</td>
          <td>${escapeHtml(t.lokasi)}</td>
          <td>${fmtDateShort(t.tglTerkirim)}</td>
        </tr>
      `).join('')
      : `<tr><td colspan="13" class="empty-row">Tidak ada transaksi pengiriman yang belum selesai pada periode ini.</td></tr>`;

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

      <h4 class="sub-heading" style="margin-top:8px;">
        &#9202; Barang Ditunggu / Dalam Proses
        <span id="dpPoCountTunggu" class="panel-note" style="font-weight:400; margin-left:8px;"></span>
      </h4>
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
        <div class="kpi-value">${fmtRupiah(ic.totalSales)}</div>
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
      <h4 class="sub-heading">Produk Terlaris per Perusahaan</h4>
      <div class="two-col">
        ${byco.companies.map(c => `
          <div>
            <div class="mini-table-title">${c.company}</div>
            <table class="data-table data-table-compact">
              <thead><tr><th>Kode Barang</th><th>Sales</th><th>Qty</th></tr></thead>
              <tbody>
                ${c.topProducts.slice(0, 5).map(p => `<tr><td>${escapeHtml(p.kode)}</td><td>${fmtRupiah(p.sales)}</td><td>${fmtNum(p.qty)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}
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
      fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: PALETTE.terra, borderWidth: 2.5,
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
        <div class="kpi-value">${fmtRupiah(r.total)}</div>
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
      fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: PALETTE.sage, borderWidth: 2.5,
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
        <div class="kpi-value">${fmtRupiah(ratio.totalSales)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Revenue 2026</div>
        <div class="kpi-value">${fmtRupiah(ratio.totalRevenue)}</div>
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

function renderZonaSection(m) {
  const z = m.zonaWilayah;

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
      </div>
      <div class="kpi-card kpi-card-zone-kuning">
        <div class="kpi-label">Zona Kuning (20&ndash;50 invoice)</div>
        <div class="kpi-value">${fmtNum(z.zoneCounts.kuning)}</div>
      </div>
      <div class="kpi-card kpi-card-zone-merah">
        <div class="kpi-label">Zona Merah (0&ndash;20 invoice)</div>
        <div class="kpi-value">${fmtNum(z.zoneCounts.merah)}</div>
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
      <table class="data-table" id="tblWilayah"></table>
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
  renderWilayahTable(z, zonaFilter);

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
      renderWilayahTable(z, zonaFilter);
    });
  });
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

function renderWilayahTable(z, filter) {
  const data = filter === 'semua' ? z.wilayahData : z.wilayahData.filter(w => w.zone === filter);
  const salesMap = new Map(z.salesByWilayah.map(s => [s.lokasi, s]));
  const rows = data.map(w => {
    const salesInfo = salesMap.get(w.nama);
    return `<tr>
      <td>${escapeHtml(w.nama)}</td>
      <td>${fmtNum(w.total)}</td>
      <td>${zonePillHtml(w.zone)}</td>
      <td>${salesInfo ? fmtRupiah(salesInfo.sales) : fmtRupiah(0)}</td>
    </tr>`;
  }).join('');
  document.getElementById('tblWilayah').innerHTML = `
    <thead><tr><th>Kabupaten/Kota</th><th>Total Invoice 2026</th><th>Zona</th><th>Total Sales</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="empty-row">Tidak ada data untuk filter ini.</td></tr>'}</tbody>
  `;
}

/* ==========================================================================
   SECTION 05 — KODE BARANG TERLARIS
   ========================================================================== */
let topProductMetric = 'sales'; // sales | qty
let topProductCompanyFilter = 'semua'; // semua | MKI | CFN

function renderTopProductsSection(m) {
  const tp = m.topProducts;

  const html = `
    <div class="section-head">
      <div class="eyebrow">06 &mdash; Produk</div>
      <h2>Kode Barang Terlaris 2026</h2>
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
      <table class="data-table" id="tblTopProducts"></table>
    </div>
  `;
  document.getElementById('s5').innerHTML = html;

  renderTopProductsChart(tp, topProductMetric, topProductCompanyFilter);

  document.querySelectorAll('#topProductMetricToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#topProductMetricToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      topProductMetric = btn.dataset.metric;
      renderTopProductsChart(tp, topProductMetric, topProductCompanyFilter);
    });
  });
  document.querySelectorAll('#topProductCompanyToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#topProductCompanyToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      topProductCompanyFilter = btn.dataset.co;
      renderTopProductsChart(tp, topProductMetric, topProductCompanyFilter);
    });
  });
}

function getTopProductData(tp, metric, coFilter) {
  let source;
  if (coFilter === 'semua') source = metric === 'sales' ? tp.topBySales : tp.topByQty;
  else source = metric === 'sales' ? tp.byCompany[coFilter].topBySales : tp.byCompany[coFilter].topByQty;
  return source.slice(0, 10);
}

function renderTopProductsChart(tp, metric, coFilter) {
  const data = getTopProductData(tp, metric, coFilter);
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

  document.getElementById('tblTopProducts').innerHTML = `
    <thead><tr><th>Peringkat</th><th>Kode Barang</th><th>Sales</th><th>Quantity</th></tr></thead>
    <tbody>${data.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.kode)}</td><td>${fmtRupiah(p.sales)}</td><td>${fmtNum(p.qty)}</td></tr>`).join('')}</tbody>
  `;
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
    </div>

    <div class="panel">
      <h3>Distribusi Stock by Company</h3>
      <div class="chart-wrap chart-wrap-sm"><canvas id="chartStock"></canvas></div>
    </div>

    <div class="panel">
      <h3>Barang Tersedia di Gudang (Stock &gt; 0)</h3>
      <table class="data-table" id="tblStock"></table>
    </div>

    <div class="panel">
      <h3>Barang Ada Stock Namun Tidak Bergerak / Terjual Dibawah 5 Unit (2026)</h3>
      <div class="two-col">
        <div>
          <div class="mini-table-title">Stock Ada, Belum Pernah Terjual (${st.stockTidakTerjual.length})</div>
          <table class="data-table data-table-compact">
            <thead><tr><th>Kode</th><th>Deskripsi</th><th>Stock</th></tr></thead>
            <tbody>${st.stockTidakTerjual.slice(0, 30).map(i => `<tr><td>${escapeHtml(i.kode)}</td><td>${escapeHtml(i.deskripsi)}</td><td>${fmtNum(i.stockTotal)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-row">Tidak ada.</td></tr>'}</tbody>
          </table>
        </div>
        <div>
          <div class="mini-table-title">Terjual Dibawah 5 Unit (${st.stockTerjualDibawah5.length})</div>
          <table class="data-table data-table-compact">
            <thead><tr><th>Kode</th><th>Deskripsi</th><th>Terjual</th></tr></thead>
            <tbody>${st.stockTerjualDibawah5.slice(0, 30).map(i => `<tr><td>${escapeHtml(i.kode)}</td><td>${escapeHtml(i.deskripsi)}</td><td>${fmtNum(i.qtyTerjual)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-row">Tidak ada.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
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
              <div class="company-card-row"><span>Qty Diretur</span><strong>${fmtNum(d.qtyRetur)} unit</strong></div>
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

function renderStockTable(st) {
  const items = st.items.filter(i => i.stockTotal > 0).sort((a, b) => a.kode.localeCompare(b.kode));
  document.getElementById('tblStock').innerHTML = `
    <thead><tr><th>Kode Barang</th><th>Deskripsi</th><th>Stock MKI</th><th>Stock CFN</th><th>Total</th></tr></thead>
    <tbody>${items.map(i => `<tr><td>${escapeHtml(i.kode)}</td><td>${escapeHtml(i.deskripsi)}</td><td>${fmtNum(i.stockMKI)}</td><td>${fmtNum(i.stockCFN)}</td><td><strong>${fmtNum(i.stockTotal)}</strong></td></tr>`).join('')}</tbody>
  `;
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
        <div class="kpi-label">Total Koli Terkirim</div>
        <div class="kpi-value">${fmtNum(d.totalKoli)}</div>
        <div class="kpi-sub">${fmtNum(d.totalQty)} unit barang</div>
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
      <table class="data-table" id="tblEkspedisi"></table>
    </div>
  `;
  document.getElementById('s7').innerHTML = html;

  renderDeliveryStatusChart(d);
  renderEkspedisiChart(d);
  renderEkspedisiTable(d);
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

function renderEkspedisiTable(d) {
  document.getElementById('tblEkspedisi').innerHTML = `
    <thead><tr><th>Jalur Ekspedisi</th><th>Jumlah</th><th>Persentase</th><th>Quantity</th><th>Koli</th></tr></thead>
    <tbody>${d.byEkspedisi.map(e => `<tr><td>${escapeHtml(e.nama)}</td><td>${fmtNum(e.count)}</td><td>${fmtPct(e.pct)}</td><td>${fmtNum(e.qty)}</td><td>${fmtNum(e.koli)}</td></tr>`).join('')}</tbody>
  `;
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
      </div>
    </div>

    <div class="panel">
      <h3>Piutang dengan Aging diatas 60 Hari</h3>
      <p class="panel-note">Total <strong>${fmtNum(ar.piutangDiatas60Hari.length)}</strong> faktur dengan sisa saldo piutang diatas 60 hari, senilai <strong>${fmtRupiah(ar.totalPiutangDiatas60Hari)}</strong>.</p>
      <div class="chart-wrap"><canvas id="chartAging"></canvas></div>
    </div>

    <div class="panel">
      <h3>Piutang by Company &mdash; MKI vs CFN</h3>
      <div class="two-col">
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartARByCompany"></canvas></div>
        <div class="company-cards">
          ${Object.entries(ar.byCompany).map(([co, d]) => `
            <div class="company-card company-${co.toLowerCase()}">
              <div class="company-card-head"><span class="company-badge company-badge-${co.toLowerCase()}">${co}</span></div>
              <div class="company-card-row"><span>Nilai Faktur</span><strong>${fmtRupiah(d.nilaiFaktur)}</strong></div>
              <div class="company-card-row"><span>Sisa Saldo Piutang</span><strong>${fmtRupiah(d.sisaSaldo)}</strong></div>
              <div class="company-card-row"><span>Sudah Dibayar</span><strong>${fmtRupiah(d.paidAmount)}</strong></div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>Daftar Piutang Belum Lunas (diurutkan dari Aging tertinggi)</h3>
      <table class="data-table" id="tblAR"></table>
    </div>
  `;
  document.getElementById('s8').innerHTML = html;

  renderAgingChart(ar);
  renderARByCompanyChart(ar);
  renderARTable(ar);
}

function renderAgingChart(ar) {
  const sorted = [...ar.agingBuckets].sort((a, b) => b.sisaSaldo - a.sisaSaldo);
  makeChart('chartAging', {
    type: 'bar',
    data: { labels: sorted.map(b => b.kategori), datasets: [{ label: 'Sisa Saldo Piutang', data: sorted.map(b => b.sisaSaldo), backgroundColor: PALETTE.red, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
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

function renderARTable(ar) {
  // Urutkan berdasarkan Aging (jumlah hari) tertinggi ke terendah, sesuai
  // judul panel "diurutkan dari Aging tertinggi". Field aging berupa string
  // seperti "62 Hari", sehingga angkanya diekstrak terlebih dahulu.
  const parseAgingDays = (aging) => {
    const match = String(aging).match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };
  const belumLunas = ar.items.filter(i => i.sisaSaldo > 0).sort((a, b) => parseAgingDays(b.aging) - parseAgingDays(a.aging));
  document.getElementById('tblAR').innerHTML = `
    <thead><tr><th>No Faktur</th><th>Customer</th><th>Company</th><th>Nilai Faktur</th><th>Sisa Saldo</th><th>Aging</th><th>Kategori</th></tr></thead>
    <tbody>${belumLunas.map(i => `<tr><td>${escapeHtml(i.noFaktur)}</td><td>${escapeHtml(i.customer)}</td><td>${escapeHtml(i.company)}</td><td>${fmtRupiah(i.nilaiFaktur)}</td><td>${fmtRupiah(i.sisaSaldo)}</td><td>${escapeHtml(i.aging)}</td><td>${escapeHtml(i.kategori)}</td></tr>`).join('')}</tbody>
  `;
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
      <div class="panel-head">
        <h3>Top 10 Customer Paling Sering Berbelanja</h3>
        <div class="toggle-group" id="custFreqMetricToggle">
          <button class="toggle-btn active" data-metric="frequency">By Frekuensi</button>
          <button class="toggle-btn" data-metric="sales">By Total Sales</button>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartTop10Customer"></canvas></div>
      <table class="data-table" id="tblTop10Customer"></table>
    </div>

    <div class="panel">
      <h3>Customer Tidak Berbelanja Lagi (&ge;60 Hari sejak Transaksi Terakhir)</h3>
      <p class="panel-note">Total ${fmtNum(cf.churnedCustomers.length)} customer berpotensi tidak aktif. Diurutkan dari yang paling lama tidak bertransaksi.</p>
      <table class="data-table" id="tblChurned"></table>
    </div>
  `;
  document.getElementById('s9').innerHTML = html;

  renderTop10CustomerChart(cf, custFreqMetric);
  renderChurnedTable(cf);

  document.querySelectorAll('#custFreqMetricToggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#custFreqMetricToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      custFreqMetric = btn.dataset.metric;
      renderTop10CustomerChart(cf, custFreqMetric);
    });
  });
}

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

  document.getElementById('tblTop10Customer').innerHTML = `
    <thead><tr><th>Peringkat</th><th>Customer</th><th>Frekuensi (Invoice Unik)</th><th>Total Sales</th></tr></thead>
    <tbody>${data.map((c, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(c.customer)}</td><td>${fmtNum(c.invoiceUnik)}</td><td>${fmtRupiah(c.totalSales)}</td></tr>`).join('')}</tbody>
  `;
}

function renderChurnedTable(cf) {
  document.getElementById('tblChurned').innerHTML = `
    <thead><tr><th>Customer</th><th>Transaksi Terakhir</th><th>Hari Tidak Aktif</th><th>Total Sales 2026</th></tr></thead>
    <tbody>${cf.churnedCustomers.slice(0, 50).map(c => `<tr><td>${escapeHtml(c.customer)}</td><td>${fmtDateShort(c.lastPurchase)}</td><td>${fmtNum(c.daysSinceLastPurchase)} hari</td><td>${fmtRupiah(c.totalSales)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-row">Tidak ada customer yang tidak aktif.</td></tr>'}</tbody>
  `;
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
  renderFOSummaryTable(fo);
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
      datasets: [{ label: 'Sales FO 1-Core', data: fo.monthly.map(x => x.sales), borderColor: PALETTE.amber, backgroundColor: 'rgba(207,155,63,0.14)', fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: PALETTE.amber, borderWidth: 2.5 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.y) } } },
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
      backgroundColor: 'transparent', tension: 0.3, pointRadius: 3, borderWidth: 2,
    }));
  } else {
    const k = fo.byKode.find(x => x.kode === kodeFilter);
    datasets = [{ label: k.kode, data: k.monthly.map(m => m.sales), borderColor: PALETTE.terra, backgroundColor: 'rgba(193,122,90,0.12)', fill: true, tension: 0.35, pointRadius: 4, borderWidth: 2.5 }];
  }

  makeChart('chartFOByKode', {
    type: 'line',
    data: { labels: MONTH_NAMES_SHORT_ID, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtRupiah(ctx.parsed.y)}` } } },
      scales: { y: { ticks: { callback: v => fmtRupiahShort(v) }, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } },
    },
  });
}

function renderFOByCompanyChart(fo) {
  makeChart('chartFOByCompany', {
    type: 'doughnut',
    data: { labels: ['MKI', 'CFN'], datasets: [{ data: [fo.byCompany.MKI.sales, fo.byCompany.CFN.sales], backgroundColor: [PALETTE.terra, PALETTE.sage], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtRupiah(ctx.parsed)}` } } } },
  });
}

function renderFOSummaryTable(fo) {
  document.getElementById('tblFOByKode').innerHTML = `
    <thead><tr><th>Kode Barang</th><th>Total Sales</th><th>Total Quantity</th></tr></thead>
    <tbody>${fo.byKode.map(k => `<tr><td>${escapeHtml(k.kode)}</td><td>${fmtRupiah(k.sales)}</td><td>${fmtNum(k.qty)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td>${fmtRupiah(fo.totalSales)}</td><td>${fmtNum(fo.totalQty)}</td></tr></tfoot>
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
function renderDashboard(metrics) {
  applyChartDefaults();

  document.getElementById('lastUpdated').textContent = metrics.generatedAt.toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  renderDailyPerformanceSection(metrics);
  renderSalesSection(metrics);
  renderRevenueSection(metrics);
  renderRatioSection(metrics);
  renderZonaSection(metrics);
  renderTopProductsSection(metrics);
  renderStockSection(metrics);
  renderDeliverySection(metrics);
  renderARSection(metrics);
  renderCustFreqSection(metrics);
  renderFiberOpticSection(metrics);

  wrapTablesForMobileScroll();

  document.getElementById('loadingOverlay').classList.add('hidden');
  document.getElementById('mainContent').classList.add('visible');
}

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
