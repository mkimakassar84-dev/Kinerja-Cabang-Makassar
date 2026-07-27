/* ==========================================================================
   APP — Titik masuk utama. Memuat data, menghitung metrik, merender
   dashboard, dan memeriksa perubahan data secara berkala agar dashboard
   otomatis mengikuti perubahan di Google Sheets — TANPA perlu deploy ulang
   ATAU refresh manual oleh user.

   Catatan: situs statis seperti ini tidak bisa menerima "push notification"
   langsung dari Google Sheets begitu ada yang mengedit (itu perlu server/
   webhook terpisah). Solusi paling dekat yang bisa dilakukan murni dari
   browser: cek data ke Google Sheets secara berkala (tiap 10 menit — dibuat
   tidak terlalu sering supaya dashboard tetap ringan), lalu HANYA render
   ulang section yang sedang/pernah dibuka kalau datanya benar-benar berubah.
   Refresh halaman (hard refresh) selalu ambil data terbaru dari awal.

   PERCEPATAN MUAT AWAL (2026-07-27): sebelum fetch ke Google Sheets selesai
   (bisa beberapa detik, terutama Grand Data 2026 yang besar), dashboard
   sekarang langsung merender data TERAKHIR yang berhasil dimuat sebelumnya
   (disimpan di localStorage browser). Jadi kunjungan kedua dst. terasa
   hampir instan — data lama tampil dulu, lalu otomatis diperbarui diam-diam
   begitu data baru selesai diambil. Kunjungan PERTAMA di perangkat tertentu
   tetap menunggu fetch seperti biasa karena belum ada cache tersimpan.
   ========================================================================== */

const AUTO_CHECK_INTERVAL_MS = 10 * 60 * 1000; // cek perubahan data tiap 10 menit
const DASHBOARD_CACHE_KEY = 'kmc_dashboard_cache_v1';
let lastDataSnapshot = null;

function loadCachedDashboardData() {
  try {
    const raw = localStorage.getItem(DASHBOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data) return null;
    return parsed;
  } catch (e) {
    return null; // cache korup/format lama — abaikan, lanjut fetch normal
  }
}

function saveCachedDashboardData(data) {
  try {
    localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
  } catch (e) {
    // localStorage penuh/tidak tersedia (mis. mode privat) — cache murni
    // optimasi opsional, dashboard tetap berfungsi normal tanpanya.
    console.warn('Tidak bisa menyimpan cache dashboard:', e);
  }
}

function showCacheNotice() {
  const panel = document.getElementById('errorPanel');
  if (!panel) return;
  panel.classList.remove('hidden');
  panel.innerHTML = `<div class="info-box">Menampilkan data tersimpan sebelumnya sambil memperbarui dari Google Sheets&hellip;</div>`;
}

async function initDashboard() {
  const cached = loadCachedDashboardData();
  let renderedFromCache = false;

  if (cached) {
    try {
      lastDataSnapshot = JSON.stringify(cached.data);
      const metrics = computeAllMetrics(cached.data);
      renderDashboard(metrics);
      showCacheNotice();
      renderedFromCache = true;
    } catch (e) {
      // Bentuk cache lama/tidak cocok dengan versi kode saat ini — abaikan
      // dan lanjut ke fetch normal seperti biasa.
      console.warn('Cache dashboard tidak valid, mengambil data baru:', e);
      lastDataSnapshot = null;
    }
  }

  try {
    const { data, errors } = await loadAllSheetData();
    const snapshot = JSON.stringify(data);
    saveCachedDashboardData(data);

    if (snapshot !== lastDataSnapshot) {
      lastDataSnapshot = snapshot;
      const metrics = computeAllMetrics(data);
      renderDashboard(metrics);
    }
    renderErrorPanel(errors); // menimpa/menyembunyikan info-box cache di atas
  } catch (err) {
    if (!renderedFromCache) {
      showFatalError(err);
    }
    // Kalau sempat tampil dari cache, biarkan dashboard cache tetap terlihat
    // meski fetch data baru gagal — sama seperti perilaku checkForDataChanges.
    console.error('Gagal memuat data terbaru dari Google Sheets:', err);
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

function setForceDesktopView(enabled) {
  const meta = document.getElementById('viewportMeta');
  if (meta) meta.setAttribute('content', enabled ? 'width=1100' : 'width=device-width, initial-scale=1.0');
  document.documentElement.classList.toggle('force-desktop-view', enabled);
  document.body.classList.toggle('force-desktop-view', enabled);
  const btn = document.getElementById('btnDesktopToggle');
  if (btn) btn.classList.toggle('active', enabled);
  try { localStorage.setItem('forceDesktopView', enabled ? '1' : '0'); } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  let stored = '0';
  try { stored = localStorage.getItem('forceDesktopView') || '0'; } catch (e) {}
  setForceDesktopView(stored === '1');

  const desktopToggleBtn = document.getElementById('btnDesktopToggle');
  if (desktopToggleBtn) {
    desktopToggleBtn.addEventListener('click', () => {
      setForceDesktopView(!document.documentElement.classList.contains('force-desktop-view'));
    });
  }

  initDashboard();
  scheduleAutoRefresh();
});
