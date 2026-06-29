/* ============================================================
   RENDER — Membangun HTML tiap section dari metrik yang sudah
   dihitung, dan menginisialisasi semua chart Chart.js
   ============================================================ */

const PALETTE = {
  slate: '#5B7B8C', slateSoft: 'rgba(91,123,140,0.15)',
  sage: '#7E9A78', sageSoft: 'rgba(126,154,120,0.15)',
  amber: '#C2944F', amberSoft: 'rgba(194,148,79,0.15)',
  terra: '#B16456', terraSoft: 'rgba(177,100,86,0.15)',
  gold: '#A98A4A', ink: '#2B2D2E', inkSoft: '#5C5F61', line: '#DEDAD0',
};

const charts = {};
function makeChart(canvasId, config) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  if (charts[canvasId]) charts[canvasId].destroy();
  const ctx = el.getContext('2d');
  charts[canvasId] = new Chart(ctx, config);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function zonePillHtml(zone) {
  const label = zone === 'hijau' ? 'Kontributor Utama' : zone === 'kuning' ? 'Menengah' : 'Perlu Perhatian';
  return `<span class="zone-pill ${zone}"><span class="zone-dot ${zone}"></span>${label}</span>`;
}

/* ============================================================
   SECTION 1 — Tren Penjualan (Sales)
   ============================================================ */
function renderSalesSection(m) {
  const t = m.salesTrend;
  const totalAmount = sum(t, x => x.totalAmount);
  const totalQty = sum(t, x => x.totalQty);
  const totalTx = sum(t, x => x.totalTransaksi);
  const last = t[t.length - 1];
  const prev = t[t.length - 2];
  const momChange = prev && prev.totalAmount > 0 ? ((last.totalAmount - prev.totalAmount) / prev.totalAmount) * 100 : null;

  return `
  <section class="section" id="s1">
    <div class="section-head">
      <div class="eyebrow">Bagian 01</div>
      <h2>Analisis Tren Penjualan (Sales)</h2>
      <p class="lede">Akumulasi nilai dan volume penjualan dari seluruh transaksi tercatat pada tab Grand Data 2026, diperbarui otomatis setiap kali sheet berubah.</p>
    </div>
    <div class="ledger">
      <div class="ledger-item"><div class="lk">Total Nilai Sales</div><div class="lv">${fmtRupiah(totalAmount)}</div></div>
      <div class="ledger-item"><div class="lk">Total Quantity</div><div class="lv">${fmtNum(totalQty)} unit</div></div>
      <div class="ledger-item"><div class="lk">Total Transaksi</div><div class="lv">${fmtNum(totalTx)}</div></div>
      <div class="ledger-item"><div class="lk">Bulan Terakhir vs Sebelumnya</div><div class="lv">${momChange === null ? '—' : (momChange >= 0 ? '+' : '') + momChange.toFixed(1) + '%'} ${momChange === null ? '' : `<span class="tag ${momChange >= 0 ? 'up' : 'down'}">${momChange >= 0 ? 'Naik' : 'Turun'}</span>`}</div></div>
    </div>
    <div class="chart-box">
      <div class="chart-head">
        <div><h4>Tren Nilai Sales per Bulan</h4><div class="card-sub">Total amount transaksi, dikelompokkan per bulan order date</div></div>
      </div>
      <div class="chart-canvas-wrap" style="height:320px;"><canvas id="chart-sales-trend"></canvas></div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Bulan</th><th class="num-col">Total Sales</th><th class="num-col">Quantity</th><th class="num-col">Jumlah Transaksi</th></tr></thead>
        <tbody>
          ${t.map(x => `<tr><td>${x.label}</td><td class="num-col">${fmtRupiah(x.totalAmount)}</td><td class="num-col">${fmtNum(x.totalQty)}</td><td class="num-col">${fmtNum(x.totalTransaksi)}</td></tr>`).join('')}
          <tr class="total-row"><td>Total</td><td class="num-col">${fmtRupiah(totalAmount)}</td><td class="num-col">${fmtNum(totalQty)}</td><td class="num-col">${fmtNum(totalTx)}</td></tr>
        </tbody>
      </table>
    </div>
  </section>`;
}

function chartSalesTrend(m) {
  const t = m.salesTrend;
  makeChart('chart-sales-trend', {
    type: 'line',
    data: {
      labels: t.map(x => x.label),
      datasets: [{
        label: 'Total Sales', data: t.map(x => x.totalAmount),
        borderColor: PALETTE.slate, backgroundColor: PALETTE.slateSoft, fill: true, tension: 0.3, pointRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtRupiah(v, { compact: true }) } } },
    },
  });
}

/* ============================================================
   SECTION 2 — Tren Pendapatan (Revenue)
   ============================================================ */
function renderRevenueSection(m) {
  const t = m.revenueTrend;
  const totalAmount = sum(t, x => x.totalAmount);
  return `
  <section class="section" id="s2">
    <div class="section-head">
      <div class="eyebrow">Bagian 02</div>
      <h2>Analisis Tren Pendapatan (Revenue)</h2>
      <p class="lede">Pendapatan didekati dari transaksi dengan stage "Complete" pada Grand Data 2026 sebagai proxy realisasi. Jika definisi revenue cabang berbeda (mis. mengikuti tanggal pelunasan di tab Rev SUM), beri tahu agar perhitungan disesuaikan.</p>
    </div>
    <div class="note">
      <strong>Catatan Metodologi</strong>
      Nilai revenue di bagian ini dihitung otomatis dari transaksi yang sudah berstatus selesai pengantarannya (Stage = Complete), bukan dari tanggal pelunasan piutang. Untuk piutang yang belum lunas, lihat Bagian 08.
    </div>
    <div class="ledger">
      <div class="ledger-item"><div class="lk">Total Revenue (Realisasi)</div><div class="lv">${fmtRupiah(totalAmount)}</div></div>
      <div class="ledger-item"><div class="lk">Jumlah Bulan Tercatat</div><div class="lv">${t.length}</div></div>
    </div>
    <div class="chart-box">
      <div class="chart-head"><div><h4>Tren Revenue per Bulan</h4></div></div>
      <div class="chart-canvas-wrap" style="height:320px;"><canvas id="chart-rev-trend"></canvas></div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Bulan</th><th class="num-col">Total Revenue</th><th class="num-col">Jumlah Transaksi</th></tr></thead>
        <tbody>${t.map(x => `<tr><td>${x.label}</td><td class="num-col">${fmtRupiah(x.totalAmount)}</td><td class="num-col">${fmtNum(x.totalTransaksi)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function chartRevTrend(m) {
  const t = m.revenueTrend;
  makeChart('chart-rev-trend', {
    type: 'bar',
    data: { labels: t.map(x => x.label), datasets: [{ label: 'Revenue', data: t.map(x => x.totalAmount), backgroundColor: PALETTE.sage }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtRupiah(v, { compact: true }) } } },
    },
  });
}

/* ============================================================
   SECTION 3 — Rasio Sales thd Revenue
   ============================================================ */
function renderRatioSection(m) {
  const t = m.ratio;
  return `
  <section class="section" id="s3">
    <div class="section-head">
      <div class="eyebrow">Bagian 03</div>
      <h2>Rasio Sales terhadap Revenue</h2>
      <p class="lede">Persentase nilai sales yang telah terealisasi sebagai revenue per bulan.</p>
    </div>
    <div class="chart-box">
      <div class="chart-head"><div><h4>Rasio Bulanan</h4></div></div>
      <div class="chart-canvas-wrap" style="height:300px;"><canvas id="chart-ratio"></canvas></div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Bulan</th><th class="num-col">Sales</th><th class="num-col">Revenue</th><th class="num-col">Rasio</th></tr></thead>
        <tbody>${t.map(x => `<tr><td>${x.label}</td><td class="num-col">${fmtRupiah(x.totalAmount)}</td><td class="num-col">${fmtRupiah(x.revenue)}</td><td class="num-col">${fmtPct(x.ratio)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function chartRatio(m) {
  const t = m.ratio;
  makeChart('chart-ratio', {
    type: 'line',
    data: { labels: t.map(x => x.label), datasets: [{ label: 'Rasio (%)', data: t.map(x => x.ratio), borderColor: PALETTE.amber, backgroundColor: PALETTE.amberSoft, fill: true, tension: 0.3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtPct(ctx.parsed.y) } } }, scales: { y: { ticks: { callback: v => v + '%' } } } },
  });
}

/* ============================================================
   SECTION 4 — Performa & Zona Wilayah
   ============================================================ */
function renderZonaSection(m) {
  const z = m.zonaWilayah;
  const top15 = z.slice(0, 15);
  return `
  <section class="section" id="s4">
    <div class="section-head">
      <div class="eyebrow">Bagian 04</div>
      <h2>Performa &amp; Zona Wilayah</h2>
      <p class="lede">Pembagian wilayah berdasarkan kontribusi kumulatif terhadap total sales (prinsip Pareto): <strong>Hijau</strong> = berkontribusi pada 70% pertama, <strong>Kuning</strong> = 70–90%, <strong>Merah</strong> = sisanya / perlu perhatian khusus.</p>
    </div>
    <div class="legend-row">
      <div class="li"><span class="sw" style="background:var(--sage)"></span>Kontributor Utama</div>
      <div class="li"><span class="sw" style="background:var(--amber)"></span>Menengah</div>
      <div class="li"><span class="sw" style="background:var(--terra)"></span>Perlu Perhatian</div>
    </div>
    <div class="chart-box">
      <div class="chart-head"><div><h4>Top 15 Wilayah by Sales</h4></div></div>
      <div class="chart-canvas-wrap" style="height:380px;"><canvas id="chart-zona"></canvas></div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Wilayah</th><th class="num-col">Total Sales</th><th class="num-col">Qty</th><th class="num-col">Transaksi</th><th class="num-col">Share</th><th>Zona</th></tr></thead>
        <tbody>${z.map(x => `<tr class="row-zone-${x.zone}"><td>${escapeHtml(x.lokasi)}</td><td class="num-col">${fmtRupiah(x.totalAmount)}</td><td class="num-col">${fmtNum(x.totalQty)}</td><td class="num-col">${fmtNum(x.totalTransaksi)}</td><td class="num-col">${fmtPct(x.share)}</td><td>${zonePillHtml(x.zone)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function chartZona(m) {
  const top = m.zonaWilayah.slice(0, 15);
  const colorOf = z => z === 'hijau' ? PALETTE.sage : z === 'kuning' ? PALETTE.amber : PALETTE.terra;
  makeChart('chart-zona', {
    type: 'bar',
    data: { labels: top.map(x => x.lokasi), datasets: [{ label: 'Total Sales', data: top.map(x => x.totalAmount), backgroundColor: top.map(x => colorOf(x.zone)) }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.x) } } }, scales: { x: { ticks: { callback: v => fmtRupiah(v, { compact: true }) } } } },
  });
}

/* ============================================================
   SECTION 5 — Kode Barang Terlaris
   ============================================================ */
function renderTopProductsSection(m) {
  const { byAmount, byQty } = m.topProducts;
  return `
  <section class="section" id="s5">
    <div class="section-head">
      <div class="eyebrow">Bagian 05</div>
      <h2>Kode Barang Terlaris</h2>
      <p class="lede">15 kode barang dengan nilai dan volume penjualan tertinggi sepanjang periode data.</p>
    </div>
    <div class="grid-2">
      <div>
        <h3 class="subhead">Top 15 by Nilai (Amount)</h3>
        <div class="chart-box">
          <div class="chart-canvas-wrap" style="height:340px;"><canvas id="chart-top-products-amount"></canvas></div>
        </div>
      </div>
      <div>
        <h3 class="subhead">Top 15 by Quantity</h3>
        <div class="chart-box">
          <div class="chart-canvas-wrap" style="height:340px;"><canvas id="chart-top-products-qty"></canvas></div>
        </div>
      </div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Kode Barang</th><th class="num-col">Total Amount</th><th class="num-col">Total Qty</th><th class="num-col">Jumlah Transaksi</th></tr></thead>
        <tbody>${byAmount.map(x => `<tr><td class="num-col" style="text-align:left">${escapeHtml(x.kodeBarang)}</td><td class="num-col">${fmtRupiah(x.totalAmount)}</td><td class="num-col">${fmtNum(x.totalQty)}</td><td class="num-col">${fmtNum(x.totalTransaksi)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function chartTopProducts(m) {
  const { byAmount, byQty } = m.topProducts;
  makeChart('chart-top-products-amount', {
    type: 'bar',
    data: { labels: byAmount.map(x => x.kodeBarang), datasets: [{ label: 'Amount', data: byAmount.map(x => x.totalAmount), backgroundColor: PALETTE.slate }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.x) } } }, scales: { x: { ticks: { callback: v => fmtRupiah(v, { compact: true }) } } } },
  });
  makeChart('chart-top-products-qty', {
    type: 'bar',
    data: { labels: byQty.map(x => x.kodeBarang), datasets: [{ label: 'Qty', data: byQty.map(x => x.totalQty), backgroundColor: PALETTE.gold }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
}

/* ============================================================
   SECTION 6 — Stock & PO Gudang
   ============================================================ */
function renderStockSection(m) {
  const stock = m.stock;
  const po = m.poGudang;
  const totalMki = sum(stock, s => s.mkiStock);
  const totalCfn = sum(stock, s => s.cfnStock);
  const poOnProgress = po.filter(p => p.stage.toLowerCase() !== 'complete');
  const byJenis = groupBy(stock, s => s.jenis || 'Lainnya');
  const jenisRows = Array.from(byJenis.entries()).map(([jenis, items]) => ({ jenis, mki: sum(items, i => i.mkiStock), cfn: sum(items, i => i.cfnStock) }));

  return `
  <section class="section" id="s6">
    <div class="section-head">
      <div class="eyebrow">Bagian 06</div>
      <h2>Laporan Stock Gudang dan Pembelian Gudang (PO Gudang)</h2>
      <p class="lede">Posisi stok terkini per jenis barang dan status purchase order gudang.</p>
    </div>
    <div class="ledger">
      <div class="ledger-item"><div class="lk">Total Stock MKI</div><div class="lv">${fmtNum(totalMki)} unit</div></div>
      <div class="ledger-item"><div class="lk">Total Stock CFN</div><div class="lv">${fmtNum(totalCfn)} unit</div></div>
      <div class="ledger-item"><div class="lk">Total PO Tercatat</div><div class="lv">${fmtNum(po.length)}</div></div>
      <div class="ledger-item"><div class="lk">PO Belum Complete</div><div class="lv">${fmtNum(poOnProgress.length)}</div></div>
    </div>
    <div class="chart-box">
      <div class="chart-head"><div><h4>Stock per Jenis Barang</h4></div></div>
      <div class="chart-canvas-wrap" style="height:320px;"><canvas id="chart-stock-jenis"></canvas></div>
    </div>
    <h3 class="subhead">Detail Purchase Order Gudang (20 PO Terbaru)</h3>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Order Date</th><th>No PO</th><th>Company</th><th>Kode Barang</th><th class="num-col">Qty</th><th>Stage</th></tr></thead>
        <tbody>${po.slice(-20).reverse().map(x => `<tr><td>${x.orderDate ? x.orderDate.toLocaleDateString('id-ID') : '—'}</td><td>${escapeHtml(x.noPo)}</td><td>${escapeHtml(x.company)}</td><td>${escapeHtml(x.kodeBarang)}</td><td class="num-col">${fmtNum(x.quantity)}</td><td>${escapeHtml(x.stage)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function chartStock(m) {
  const byJenis = groupBy(m.stock, s => s.jenis || 'Lainnya');
  const rows = Array.from(byJenis.entries()).map(([jenis, items]) => ({ jenis, mki: sum(items, i => i.mkiStock), cfn: sum(items, i => i.cfnStock) }));
  makeChart('chart-stock-jenis', {
    type: 'bar',
    data: { labels: rows.map(r => r.jenis), datasets: [
      { label: 'MKI', data: rows.map(r => r.mki), backgroundColor: PALETTE.slate },
      { label: 'CFN', data: rows.map(r => r.cfn), backgroundColor: PALETTE.amber },
    ] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: false } } },
  });
}

/* ============================================================
   SECTION 7 — Delivery & Ekspedisi
   ============================================================ */
function renderDeliverySection(m) {
  const d = m.delivery;
  return `
  <section class="section" id="s7">
    <div class="section-head">
      <div class="eyebrow">Bagian 07</div>
      <h2>Laporan Delivery dan Ekspedisi</h2>
      <p class="lede">Rekap pengiriman berdasarkan jenis ekspedisi yang digunakan.</p>
    </div>
    <div class="ledger">
      <div class="ledger-item"><div class="lk">Total Surat Jalan</div><div class="lv">${fmtNum(new Set(d.rows.map(r => r.noSJ)).size)}</div></div>
      <div class="ledger-item"><div class="lk">Hand Carry</div><div class="lv">${fmtNum(d.handCarryCount)}</div></div>
      <div class="ledger-item"><div class="lk">Non Hand Carry (via Ekspedisi)</div><div class="lv">${fmtNum(d.nonHandCarryCount)}</div></div>
    </div>
    <div class="chart-box">
      <div class="chart-head"><div><h4>Distribusi Ekspedisi</h4></div></div>
      <div class="chart-canvas-wrap" style="height:320px;"><canvas id="chart-ekspedisi-pie"></canvas></div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Ekspedisi</th><th class="num-col">Jumlah Pengiriman</th><th class="num-col">Total Qty</th></tr></thead>
        <tbody>${d.ekspedisiBreakdown.map(x => `<tr><td>${escapeHtml(x.nama)}</td><td class="num-col">${fmtNum(x.totalKirim)}</td><td class="num-col">${fmtNum(x.totalQty)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function chartDelivery(m) {
  const d = m.delivery.ekspedisiBreakdown.slice(0, 10);
  const colors = [PALETTE.slate, PALETTE.sage, PALETTE.amber, PALETTE.terra, PALETTE.gold, '#8FA6B0', '#A3B89C', '#D4B27E', '#C58579', '#BFA876'];
  makeChart('chart-ekspedisi-pie', {
    type: 'doughnut',
    data: { labels: d.map(x => x.nama), datasets: [{ data: d.map(x => x.totalKirim), backgroundColor: colors }] },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

/* ============================================================
   SECTION 8 — Piutang (AR)
   ============================================================ */
function renderARSection(m) {
  const ar = m.ar;
  return `
  <section class="section" id="s8">
    <div class="section-head">
      <div class="eyebrow">Bagian 08</div>
      <h2>Laporan Piutang (AR) dan Sisa Saldo Piutang</h2>
      <p class="lede">Aging piutang dihitung otomatis dari tanggal faktur hingga tanggal akses dashboard (bukan dibaca dari kolom formula di sheet, karena kolom tersebut error saat sinkronisasi). Kategori "Diatas 60 Hari" menandai piutang yang perlu ditindaklanjuti segera.</p>
    </div>
    <div class="ledger">
      <div class="ledger-item"><div class="lk">Total Piutang Outstanding</div><div class="lv">${fmtRupiah(ar.totalOutstanding)}</div></div>
      <div class="ledger-item"><div class="lk">Jumlah Faktur Belum Lunas</div><div class="lv">${fmtNum(ar.outstanding.length)}</div></div>
      <div class="ledger-item"><div class="lk">Piutang Diatas 60 Hari</div><div class="lv">${fmtRupiah((ar.agingBreakdown.find(a => a.kategori === 'Diatas 60 Hari') || {}).total || 0)}</div></div>
    </div>
    <div class="chart-box">
      <div class="chart-head"><div><h4>Komposisi Aging Piutang</h4></div></div>
      <div class="chart-canvas-wrap" style="height:300px;"><canvas id="chart-ar-aging"></canvas></div>
    </div>
    <h3 class="subhead">Top 15 Customer dengan Piutang Terbesar</h3>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Customer</th><th class="num-col">Total Piutang</th><th class="num-col">Jumlah Faktur</th></tr></thead>
        <tbody>${ar.topDebtors.map(x => `<tr><td>${escapeHtml(x.customer)}</td><td class="num-col">${fmtRupiah(x.total)}</td><td class="num-col">${fmtNum(x.jumlahFaktur)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function chartAR(m) {
  const a = m.ar.agingBreakdown;
  makeChart('chart-ar-aging', {
    type: 'bar',
    data: { labels: a.map(x => x.kategori), datasets: [{ label: 'Total Piutang', data: a.map(x => x.total), backgroundColor: [PALETTE.sage, PALETTE.amber, PALETTE.terra] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtRupiah(ctx.parsed.y) } } }, scales: { y: { ticks: { callback: v => fmtRupiah(v, { compact: true }) } } } },
  });
}

/* ============================================================
   SECTION 9 — Frekuensi Customer
   ============================================================ */
function renderCustFreqSection(m) {
  const c = m.custFreq;
  return `
  <section class="section" id="s9">
    <div class="section-head">
      <div class="eyebrow">Bagian 09</div>
      <h2>Laporan Frekuensi Pembelanjaan Customer</h2>
      <p class="lede">Kategori: Loyal (≥10 transaksi), Reguler (3–9 transaksi), Baru (&lt;3 transaksi), Dorman (tidak order &gt;90 hari).</p>
    </div>
    <div class="chart-box">
      <div class="chart-head"><div><h4>Distribusi Kategori Customer</h4></div></div>
      <div class="chart-canvas-wrap" style="height:300px;"><canvas id="chart-freq-dist"></canvas></div>
    </div>
    <h3 class="subhead">Top 15 Customer by Total Belanja</h3>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Customer</th><th class="num-col">Total Belanja</th><th class="num-col">Jumlah Transaksi</th><th>Order Terakhir</th><th class="num-col">Gap (Hari)</th><th>Kategori</th></tr></thead>
        <tbody>${c.rows.slice(0, 15).map(x => `<tr><td>${escapeHtml(x.customer)}</td><td class="num-col">${fmtRupiah(x.totalBelanja)}</td><td class="num-col">${fmtNum(x.jumlahTransaksi)}</td><td>${x.lastOrder ? x.lastOrder.toLocaleDateString('id-ID') : '—'}</td><td class="num-col">${x.gapDays ?? '—'}</td><td>${escapeHtml(x.kategori)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function chartCustFreq(m) {
  const d = m.custFreq.distribution;
  makeChart('chart-freq-dist', {
    type: 'doughnut',
    data: { labels: d.map(x => x.kategori), datasets: [{ data: d.map(x => x.jumlahCustomer), backgroundColor: [PALETTE.sage, PALETTE.slate, PALETTE.amber, PALETTE.terra] }] },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

/* ============================================================
   ORKESTRATOR — render semua section + chart
   ============================================================ */
function renderDashboard(metrics) {
  const root = document.getElementById('app-root');
  root.innerHTML = [
    renderSalesSection(metrics),
    renderRevenueSection(metrics),
    renderRatioSection(metrics),
    renderZonaSection(metrics),
    renderTopProductsSection(metrics),
    renderStockSection(metrics),
    renderDeliverySection(metrics),
    renderARSection(metrics),
    renderCustFreqSection(metrics),
  ].join('\n');

  // Inisialisasi semua chart setelah DOM siap
  chartSalesTrend(metrics);
  chartRevTrend(metrics);
  chartRatio(metrics);
  chartZona(metrics);
  chartTopProducts(metrics);
  chartStock(metrics);
  chartDelivery(metrics);
  chartAR(metrics);
  chartCustFreq(metrics);

  document.getElementById('meta-period').textContent = metrics.meta.periodLabel;
  document.getElementById('meta-rowcount').textContent = fmtNum(metrics.meta.totalRows);
}

function renderErrorPanel(errors) {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <section class="section">
      <div class="error-box">
        <strong>Sebagian data gagal dimuat</strong>
        <p>Dashboard tetap menampilkan data yang berhasil dimuat, namun bagian berikut tidak lengkap:</p>
        <ul>${errors.map(e => `<li><strong>${escapeHtml(e.sheetName)}</strong>: ${escapeHtml(e.message)}</li>`).join('')}</ul>
        <p style="margin-top:10px;">Pastikan nama tab di Google Sheets persis sama, dan sheet sudah dibagikan dengan akses "Anyone with link can view".</p>
      </div>
    </section>`;
}
