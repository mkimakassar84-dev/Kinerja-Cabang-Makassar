/* ==========================================================================
   APP — Titik masuk utama. Memuat data, menghitung metrik, merender
   dashboard, dan memeriksa perubahan data secara berkala agar dashboard
   terasa real-time mengikuti perubahan di Google Sheets — TANPA perlu
   deploy ulang ATAU refresh manual oleh user.

   Catatan: situs statis seperti ini tidak bisa menerima "push notification"
   langsung dari Google Sheets begitu ada yang mengedit (itu perlu server/
   webhook terpisah). Solusi paling dekat yang bisa dilakukan murni dari
   browser: cek data ke Google Sheets secara berkala (tiap 20 detik), lalu
   HANYA render ulang dashboard kalau datanya benar-benar berubah — supaya
   terasa otomatis mengikuti perubahan sheet, tanpa render ulang yang
   mengganggu kalau memang tidak ada perubahan apa pun.
   ========================================================================== */

const AUTO_CHECK_INTERVAL_MS = 20 * 1000; // cek perubahan data tiap 20 detik
let lastDataSnapshot = null;

async function initDashboard() {
  try {
    const { data, errors } = await loadAllSheetData();
    lastDataSnapshot = JSON.stringify(data);
    renderErrorPanel(errors);

    const metrics = computeAllMetrics(data);
    renderDashboard(metrics);
  } catch (err) {
    showFatalError(err);
  }
}

async function checkForDataChanges() {
  try {
    const { data, errors } = await loadAllSheetData();
    const snapshot = JSON.stringify(data);
    if (snapshot === lastDataSnapshot) return; // tidak ada perubahan, tidak perlu render ulang

    lastDataSnapshot = snapshot;
    renderErrorPanel(errors);
    const metrics = computeAllMetrics(data);
    renderDashboard(metrics);
  } catch (err) {
    // Gagal cek update di background TIDAK menampilkan error fatal (dashboard
    // yang sedang tampil tetap dipertahankan) — cukup dicatat di console.
    console.error('Gagal memeriksa pembaruan data dari Google Sheets:', err);
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
  setInterval(checkForDataChanges, AUTO_CHECK_INTERVAL_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  scheduleAutoRefresh();
});
