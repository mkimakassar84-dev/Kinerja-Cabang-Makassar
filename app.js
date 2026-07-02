/* ==========================================================================
   APP — Titik masuk utama. Memuat data, menghitung metrik, merender
   dashboard, dan menjadwalkan refresh otomatis agar dashboard selalu
   mengikuti perubahan terbaru di Google Sheets tanpa perlu deploy ulang.
   ========================================================================== */

const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 menit

async function initDashboard() {
  try {
    const { data, errors } = await loadAllSheetData();
    renderErrorPanel(errors);

    const metrics = computeAllMetrics(data);
    renderDashboard(metrics);
  } catch (err) {
    showFatalError(err);
  }
}

function showFatalError(err) {
  const overlay = document.getElementById('loadingOverlay');
  overlay.innerHTML = `
    <div class="fatal-error">
      <div class="fatal-error-icon">&#9888;</div>
      <h2>Dashboard Gagal Memuat Data</h2>
      <p>${err && err.message ? err.message : 'Terjadi kesalahan tidak terduga.'}</p>
      <p class="fatal-error-hint">Periksa koneksi internet Anda, atau pastikan Google Sheet sudah dibagikan dengan akses "Anyone with the link can view".</p>
      <button onclick="location.reload()">Muat Ulang</button>
    </div>
  `;
}

function scheduleAutoRefresh() {
  setInterval(() => {
    initDashboard();
  }, AUTO_REFRESH_INTERVAL_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  scheduleAutoRefresh();
});
