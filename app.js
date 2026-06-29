/* ============================================================
   APP — Entry point: orkestrasi load data -> hitung -> render,
   plus auto-refresh berkala dan tombol refresh manual.
   ============================================================ */

const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 menit, sesuai permintaan
let refreshTimer = null;
let isLoading = false;

function setLiveStatus(state, text) {
  const dot = document.getElementById('live-dot');
  const label = document.getElementById('live-text');
  dot.classList.remove('loading', 'error');
  if (state === 'loading') dot.classList.add('loading');
  if (state === 'error') dot.classList.add('error');
  label.textContent = text;
}

function setSkeletonLoading() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <section class="section">
      <div class="skel skel-text" style="width:30%;"></div>
      <div class="skel skel-text" style="width:60%;"></div>
      <div class="skel skel-block" style="margin-top:18px;"></div>
    </section>`;
}

async function loadAndRender({ isManual = false } = {}) {
  if (isLoading) return;
  isLoading = true;
  const btn = document.getElementById('btn-refresh');
  btn.disabled = true;

  setLiveStatus('loading', isManual ? 'Memuat ulang data dari Google Sheets…' : 'Memuat data dari Google Sheets…');
  if (isManual) {
    // jangan tampilkan skeleton penuh saat refresh manual agar tidak "berkedip" kasar,
    // tapi tetap tunjukkan indikator loading di status bar.
  } else {
    setSkeletonLoading();
  }

  try {
    const { data, errors } = await loadAllSheetData();
    const metrics = computeAllMetrics(data);

    if (metrics.meta.totalRows === 0 && errors.length > 0) {
      renderErrorPanel(errors);
      setLiveStatus('error', 'Gagal memuat data. Lihat detail di bawah.');
    } else {
      renderDashboard(metrics);
      const now = new Date();
      const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (errors.length > 0) {
        setLiveStatus('error', `Diperbarui ${timeStr} — sebagian tab gagal dimuat (${errors.map(e => e.sheetName).join(', ')})`);
      } else {
        setLiveStatus('idle', `Live — diperbarui ${timeStr}`);
      }
      document.getElementById('foot-updated').textContent = `Terakhir diperbarui: ${now.toLocaleString('id-ID')}`;
    }
  } catch (err) {
    console.error(err);
    setLiveStatus('error', 'Terjadi kesalahan saat memuat data.');
    document.getElementById('app-root').innerHTML = `
      <section class="section">
        <div class="error-box">
          <strong>Gagal memuat dashboard</strong>
          <p>${escapeHtml(err.message || String(err))}</p>
        </div>
      </section>`;
  } finally {
    isLoading = false;
    btn.disabled = false;
  }
}

function setupScrollSpy() {
  const sections = Array.from(document.querySelectorAll('.section[id]'));
  const navLinks = Array.from(document.querySelectorAll('.nav-link'));
  function onScroll() {
    let current = sections[0] && sections[0].id;
    for (const s of sections) {
      const rect = s.getBoundingClientRect();
      if (rect.top <= 120) current = s.id;
    }
    navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('data-section') === current));
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  navLinks.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const id = link.getAttribute('data-section');
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadAndRender({ isManual: false }), AUTO_REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-refresh').addEventListener('click', () => loadAndRender({ isManual: true }));
  loadAndRender({ isManual: false }).then(() => {
    setupScrollSpy();
  });
  startAutoRefresh();

  // Refresh juga saat tab kembali aktif setelah lama di background,
  // supaya data tidak basi jika dashboard dibiarkan terbuka semalaman.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadAndRender({ isManual: false });
    }
  });
});
