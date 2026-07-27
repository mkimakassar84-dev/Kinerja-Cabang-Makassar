# Konteks Project: Kinerja-Cabang-Makassar

## Tentang User
- MKI (A. Ridwan Rifqi Fahlefi), Branch Manager PT. Mitra Kabel Indonesia (Falcom Technology), Cabang Makassar
- Mengelola dua entitas: MKI dan CFN (Cakrawala Fiber Nusantara)
- Membawahi tim 8 orang (Marketing & Logistik), lapor ke HQ Surabaya
- Bekerja utamanya dari HP (mobile). Upload ke GitHub pakai metode "choose your files" (bukan drag-drop, karena itu laptop-only) — user sendiri yang melakukan drag-drop/commit setelah file disiapkan
- Setiap selesai menyiapkan file untuk diupload, langsung buka juga halaman upload repo terkait di Chrome di giliran yang sama, tanpa diminta: `https://github.com/mkimakassar84-dev/Kinerja-Cabang-Makassar/upload/main`
- Untuk pekerjaan UI/UX, gunakan panduan desain dari "ui-ux-pro-max-skill" (github.com/nextlevelbuilder/ui-ux-pro-max-skill) bila relevan

## Tentang Project Ini
Dashboard performa cabang (GitHub Pages) untuk Cabang Makassar.
- Repo: github.com/mkimakassar84-dev/Kinerja-Cabang-Makassar
- 11 section dengan lazy rendering, smart change-detection polling, drill-down antar section
- 9 halaman `section-full.html` khusus
- PWA support untuk dashboard utama dan `stock-full.html`
- Halaman share WhatsApp untuk metrik-metrik kunci
- Arsitektur inti: vanilla JS — `index.html`, `render.js`, `calc.js`, `app.js`, `data-loader.js`

### Sumber Data
Google Sheets ID: `1_uou6JDGV-Tm80oALMrduuj9ZIVWM1r9ppuQsYq7_qo`, diambil via endpoint CSV-per-gid (bukan gviz/tq, karena gviz/tq kena interferensi filter).

GID sheet penting:
- Grand Data 2026: `1703817529`
- Sales SUM: `1234708655`
- Rev SUM: `1062237088`
- KPI Monitoring: `64738765`
- Stock GD MKS: `507949843`
- AR 2026: `1407414424`
- PO Gudang: `2047354384`

KPI_SHEET_ID terpisah: `1WSp2VmHs2LqCD16cMc8JI1l1HHfnP0MAgK-G_kf4Rqw`
- DATA_ARCHIVE: `1890830079`
- DINAS_CUTI: `572213901`

### Section 12 "KPI Personel"
Sub-section 12.1 "KPI Cabang Makassar" di-port dari/disinkronkan dengan app terpisah KPI-Personel-Cabang-Makassar (lihat backend Apps Script & logika calc.js di sana untuk aturan skorAkhir/shift/holiday/dinas).
Kondisi per 26 Jul 2026: banner Predikat Bulan Ini (SANGAT BAIK ≥90% / BAIK ≥75% / else CUKUP) + grid 4 kartu (Persentase Kepatuhan Bulan Ini, Jumlah Hari Kerja Terhitung, Indikator Terkuat, Indikator Terlemah). Tidak ada tabel "Detail Harian" inline (user mau tampilan thumbnail/screenshot yang ringkas), tidak ada subline text di bawah banner predikat.
Tombol share WhatsApp-nya mengarah ke halaman khusus baru `kpi-makassar-share.html` (dibuat 26 Jul 2026, di repo ini, styling mengikuti Dashboard ini bukan app KPI REKAP) yang PUNYA tabel Detail Harian lengkap + day-picker "Cek Indikator per Tanggal" — pola link-in-caption sama seperti share section KPI Personel sendiri (`kpi-personel-share.html?month=...`).

### Aturan Bisnis Lain
- Invoice retur (prefix `R-`/`R/` atau nominal negatif via flag `isRetur`) dikecualikan dari hitungan Invoice dan OTD Accuracy
- Target harian dinamis (sisa target ÷ sisa hari kerja Senin–Sabtu)
- PWA service worker pakai `cache:'no-store'` untuk asset JS/HTML, dengan `cache:'reload'` di install handler untuk mencegah cache poisoning
- Sheet stok gudang "Stock GD MKS" (GID 507949843) pakai sistem anchor-date — kolom L/M snapshot fisik terkini, N/O tanggal anchor yang ter-update tiap kali L/M berubah, jadi formula hanya mengurangi turnover setelah tanggal anchor
- Formula stok pakai ARRAYFORMULA+MAP+LAMBDA+SUMPRODUCT dengan boolean multiplication (bukan SUMIFS text concatenation, karena gagal akibat mismatch format tanggal locale)

### Gotcha Deployment
- Error "Deployment failed, try again later" diatasi dengan re-upload file apa saja untuk memicu build baru
- Propagasi CDN butuh waktu ~45 detik setelah deploy sukses

### History
Dulu ada laporan performa Semester I 2026 HTML komprehensif dibangun dari data sumber ODS, 12 section dengan visualisasi Chart.js, kemudian dikonversi jadi dashboard live yang terhubung Google Sheets ini.

### Follow-up Terbaru (26 Jul 2026)
Chart "Tren Kepatuhan Harian" diubah dari line chart (filled/tension) jadi bar chart polos (satu bar per hari, warna hijau/kuning/merah sesuai nilai, tanpa fill/area/garis tren) di `render.js` (section MAKASSAR maupun per-personel), `kpi-personel-share.html`, `kpi-personel-share_1.html`, dan `kpi-makassar-share.html`; sumbu-x sekarang paksa `ticks: { autoSkip: false }` supaya semua 31 label hari selalu tampil. Chart "Tren Kepatuhan Bulanan" tetap line chart (memang tren bulan-ke-bulan, tidak termasuk perubahan ini).

## Tim (relevan untuk KPI Personel & Absensi)
- Marketing: ADI (EXTRA_FIELDS khusus: minRows:3 Call Customer, field select Piutang), ASTRID (dikecualikan dari syarat bukti foto), PUTRI, REZA
- Logistik: ASPAR, BURHAMIN, TAUFIK, ZUL (semua tercakup propagasi DELIVERY_AUTO_STAFF)
- Grup shift Sabtu (berlaku mulai 1 Agu 2026): Grup A (ASTRID, BURHAMIN, ZUL, TAUFIK), Grup B (ASPAR, ADI, REZA, PUTRI), bergantian mingguan, anchor 1 Agu 2026 = Grup B
