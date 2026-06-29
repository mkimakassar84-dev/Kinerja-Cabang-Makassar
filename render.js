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
      <div class="eyebrow">01 &mdash; Penjualan</div>
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
  makeChart('chartSalesByCompany', {
    type: 'doughnut',
    data: {
      labels: byco.companies.map(c => c.company),
      datasets: [{ data: byco.companies.map(c => c.sales), backgroundColor: [PALETTE.terra, PALETTE.sage], borderWidth: 0 }],
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
      <div class="eyebrow">02 &mdash; Pendapatan</div>
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
  makeChart('chartRevByCompany', {
    type: 'doughnut',
    data: {
      labels: byco.companies.map(c => c.company),
      datasets: [{ data: byco.companies.map(c => c.revenue), backgroundColor: [PALETTE.sage, PALETTE.terra], borderWidth: 0 }],
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
      <div class="eyebrow">03 &mdash; Rasio</div>
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
      <div class="eyebrow">04 &mdash; Wilayah</div>
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
      <div class="eyebrow">05 &mdash; Produk</div>
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
      <div class="eyebrow">06 &mdash; Gudang</div>
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
      <p class="panel-note">Data PO Gudang baru tersedia mulai Maret 2026. Total ${fmtNum(po.totalPO)} PO, ${fmtNum(po.totalQtyPO)} unit dipesan, ${fmtNum(po.totalQtyDiterima)} unit sudah diterima di gudang.</p>
      <div class="two-col">
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartPoGudang"></canvas></div>
        <div class="company-cards">
          ${Object.entries(po.byCompany).map(([co, d]) => `
            <div class="company-card company-${co.toLowerCase()}">
              <div class="company-card-head"><span class="company-badge company-badge-${co.toLowerCase()}">${co}</span></div>
              <div class="company-card-row"><span>Jumlah PO</span><strong>${fmtNum(d.count)}</strong></div>
              <div class="company-card-row"><span>Qty Dipesan</span><strong>${fmtNum(d.qty)} unit</strong></div>
              <div class="company-card-row"><span>Qty Diterima</span><strong>${fmtNum(d.qtyDiterima)} unit</strong></div>
            </div>
          `).join('')}
        </div>
      </div>
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
    data: { labels: ['MKI', 'CFN'], datasets: [{ data: [st.totalStockMKI, st.totalStockCFN], backgroundColor: [PALETTE.terra, PALETTE.sage], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtNum(ctx.parsed)} unit` } } } },
  });
}

function renderStockTable(st) {
  const items = st.items.filter(i => i.stockTotal > 0).sort((a, b) => b.stockTotal - a.stockTotal);
  document.getElementById('tblStock').innerHTML = `
    <thead><tr><th>Kode Barang</th><th>Deskripsi</th><th>Stock MKI</th><th>Stock CFN</th><th>Total</th></tr></thead>
    <tbody>${items.slice(0, 50).map(i => `<tr><td>${escapeHtml(i.kode)}</td><td>${escapeHtml(i.deskripsi)}</td><td>${fmtNum(i.stockMKI)}</td><td>${fmtNum(i.stockCFN)}</td><td><strong>${fmtNum(i.stockTotal)}</strong></td></tr>`).join('')}</tbody>
  `;
}

function renderPoGudangChart(po) {
  makeChart('chartPoGudang', {
    type: 'bar',
    data: { labels: po.monthly.map(x => x.label), datasets: [{ label: 'Qty PO', data: po.monthly.map(x => x.qty), backgroundColor: PALETTE.slate, borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#eae3d6' } }, x: { grid: { display: false } } } },
  });
}

/* ==========================================================================
   SECTION 07 — DELIVERY & EKSPEDISI
   ========================================================================== */
function renderDeliverySection(m) {
  const d = m.delivery;

  const html = `
    <div class="section-head">
      <div class="eyebrow">07 &mdash; Pengiriman</div>
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
      <div class="eyebrow">08 &mdash; Piutang</div>
      <h2>Piutang (AR) &amp; Sisa Saldo Piutang 2026</h2>
      <p class="lede">Sumber data: sheet AR 2026. Rasio AR mengukur seberapa besar nilai sales yang masih belum tertagih.</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total Nilai Faktur 2026</div>
        <div class="kpi-value">${fmtRupiah(ar.totalNilaiFaktur)}</div>
      </div>
      <div class="kpi-card kpi-card-accent">
        <div class="kpi-label">Sisa Saldo Piutang</div>
        <div class="kpi-value">${fmtRupiah(ar.totalSisaSaldo)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Sudah Dibayar</div>
        <div class="kpi-value">${fmtRupiah(ar.totalPaid)}</div>
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
  makeChart('chartARByCompany', {
    type: 'doughnut',
    data: { labels: cos, datasets: [{ data: cos.map(c => ar.byCompany[c].sisaSaldo), backgroundColor: [PALETTE.terra, PALETTE.sage], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtRupiah(ctx.parsed)}` } } } },
  });
}

function renderARTable(ar) {
  const belumLunas = ar.items.filter(i => i.sisaSaldo > 0).sort((a, b) => b.sisaSaldo - a.sisaSaldo);
  document.getElementById('tblAR').innerHTML = `
    <thead><tr><th>No Faktur</th><th>Customer</th><th>Company</th><th>Nilai Faktur</th><th>Sisa Saldo</th><th>Aging</th><th>Kategori</th></tr></thead>
    <tbody>${belumLunas.slice(0, 50).map(i => `<tr><td>${escapeHtml(i.noFaktur)}</td><td>${escapeHtml(i.customer)}</td><td>${escapeHtml(i.company)}</td><td>${fmtRupiah(i.nilaiFaktur)}</td><td>${fmtRupiah(i.sisaSaldo)}</td><td>${escapeHtml(i.aging)}</td><td>${escapeHtml(i.kategori)}</td></tr>`).join('')}</tbody>
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
      <div class="eyebrow">09 &mdash; Customer</div>
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
      <div class="eyebrow">10 &mdash; Fiber Optic</div>
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
      <h3>Pembagian by Company</h3>
      <div class="chart-wrap chart-wrap-sm"><canvas id="chartFOByCompany"></canvas></div>
    </div>
  `;
  document.getElementById('s10').innerHTML = html;

  renderFOTrendChart(fo);
  renderFOByKodeChart(fo, fo1coreKodeFilter);
  renderFOByCompanyChart(fo);
  renderFOSummaryTable(fo);

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

/* ==========================================================================
   ORKESTRASI RENDER — Memanggil seluruh render section secara berurutan
   ========================================================================== */
function renderDashboard(metrics) {
  applyChartDefaults();

  document.getElementById('lastUpdated').textContent = metrics.generatedAt.toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

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

  document.getElementById('loadingOverlay').classList.add('hidden');
  document.getElementById('mainContent').classList.add('visible');
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
