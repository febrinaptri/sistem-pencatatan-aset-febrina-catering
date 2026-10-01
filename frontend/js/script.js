const assetTableBody = document.querySelector('#asset-table-body');
const assetForm = document.querySelector('#asset-form');
const assetDialog = document.querySelector('#asset-dialog');
const assetDetailDialog = document.querySelector('#asset-detail-dialog');
const formError = document.querySelector('#form-error');
const toast = document.querySelector('#toast');
const searchInput = document.querySelector('#asset-search');
const conditionFilter = document.querySelector('#condition-filter');
const reportPeriodInput = document.querySelector('#report-period');
const journalPeriodInput = document.querySelector('#journal-period');
const SUPABASE_URL = 'https://xbvashcoltppogofrscm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Dq10cBfxlN1Z-cQWYOybzg_sKcvqw_i';
const SUPABASE_REST_URL = `${SUPABASE_URL}/rest/v1`;

let assets = [];
let references = { kategori: [], lokasi: [], kondisi: [] };
let editingId = null;
let toastTimer;
let referenceLoadError = '';

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});
const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function api(path, options = {}) {
  if (SUPABASE_URL.includes('YOUR-PROJECT-REF') || SUPABASE_PUBLISHABLE_KEY.includes('YOUR_')) {
    throw new Error('Isi Project URL dan Publishable key pada frontend/js/script.js.');
  }
  let response;
  try {
    response = await fetch(`${SUPABASE_REST_URL}${path}`, {
      ...options,
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Supabase tidak terhubung. Periksa Project URL dan Publishable key di frontend/js/script.js.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || result.error_description || result.error || 'Permintaan ke Supabase gagal. Periksa konfigurasi key dan policy RLS.');
  return result;
}

function friendlyError(error) {
  if (/umur_manfaat_tahun|nilai_residu/.test(error.message || '')) {
    return 'Database perlu diperbarui. Jalankan backend/sql/database.sql di Supabase SQL Editor, lalu muat ulang halaman.';
  }
  return error.message || 'Terjadi kesalahan saat memproses data.';
}

function fillReferenceSelect(name, rows, idKey, labelKey, emptyLabel) {
  const select = assetForm.elements[name];
  const placeholder = rows.length ? select.options[0].textContent : emptyLabel;
  select.innerHTML = `<option value="">${placeholder}</option>${rows.map((row) =>
    `<option value="${row[idKey]}">${escapeHtml(row[labelKey])}</option>`
  ).join('')}`;
  select.disabled = rows.length === 0;
}

async function loadReferences() {
  try {
    const [kategori, lokasi, kondisi] = await Promise.all([
      api('/kategori_aset?select=id_kategori,nama_kategori&order=nama_kategori.asc'),
      api('/lokasi?select=id_lokasi,nama_lokasi&order=nama_lokasi.asc'),
      api('/kondisi_aset?select=id_kondisi,nama_kondisi&order=id_kondisi.asc'),
    ]);
    references = { kategori, lokasi, kondisi };
  } catch (error) {
    referenceLoadError = `${error.message} Pastikan database.sql sudah dijalankan di Supabase.`;
    throw new Error(referenceLoadError);
  }
  fillReferenceSelect('kategori_id', references.kategori, 'id_kategori', 'nama_kategori', 'Kategori belum tersedia');
  fillReferenceSelect('lokasi_id', references.lokasi, 'id_lokasi', 'nama_lokasi', 'Lokasi belum tersedia');
  fillReferenceSelect('kondisi_id', references.kondisi, 'id_kondisi', 'nama_kondisi', 'Kondisi belum tersedia');
  conditionFilter.innerHTML = '<option value="">Semua kondisi</option>' + references.kondisi.map((condition) =>
    `<option value="${condition.id_kondisi}">${escapeHtml(condition.nama_kondisi)}</option>`
  ).join('');

  const missingReferences = [
    ['kategori', references.kategori],
    ['lokasi', references.lokasi],
    ['kondisi aset', references.kondisi],
  ].filter(([, rows]) => !rows.length).map(([label]) => label);
  if (missingReferences.length) {
    referenceLoadError = `Data ${missingReferences.join(', ')} belum tersedia. Jalankan backend/sql/database.sql di Supabase.`;
    throw new Error(referenceLoadError);
  }
  referenceLoadError = '';
}

async function loadAssets() {
  assetTableBody.innerHTML = '<tr><td class="table-message" colspan="10"><span class="loading-mark"></span>Memuat data aset...</td></tr>';
  try {
    assets = await api('/aset?select=id_aset,nama_aset,kategori_id,lokasi_id,kondisi_id,tanggal_pembelian,harga_perolehan,umur_manfaat_tahun,nilai_residu,kategori:kategori_aset(id_kategori,nama_kategori),lokasi:lokasi(id_lokasi,nama_lokasi),kondisi:kondisi_aset(id_kondisi,nama_kondisi)&order=id_aset.desc');
    renderAssets();
    renderDashboard();
    renderReports();
  } catch (error) {
    const message = friendlyError(error);
    assetTableBody.innerHTML = `<tr><td class="table-message" colspan="10">${escapeHtml(message)}</td></tr>`;
    document.querySelector('#result-count').textContent = 'Data gagal dimuat';
    showToast(message, true);
  }
}

function calculateDepreciation(asset, asOf = new Date()) {
  const usefulLifeMonths = Number(asset.umur_manfaat_tahun) * 12;
  const purchasePrice = Number(asset.harga_perolehan);
  const residualValue = Number(asset.nilai_residu || 0);
  if (!Number.isFinite(usefulLifeMonths) || usefulLifeMonths < 12) return null;

  const purchaseDate = new Date(`${asset.tanggal_pembelian}T00:00:00`);
  if (Number.isNaN(purchaseDate.getTime())) return null;
  let elapsedMonths = (asOf.getFullYear() - purchaseDate.getFullYear()) * 12
    + asOf.getMonth() - purchaseDate.getMonth();
  if (asOf.getDate() < purchaseDate.getDate()) elapsedMonths -= 1;
  elapsedMonths = Math.max(0, Math.min(elapsedMonths, usefulLifeMonths));

  const depreciableAmount = Math.max(0, purchasePrice - residualValue);
  const monthlyDepreciation = depreciableAmount / usefulLifeMonths;
  const accumulatedDepreciation = Math.min(depreciableAmount, monthlyDepreciation * elapsedMonths);
  return {
    monthlyDepreciation,
    accumulatedDepreciation,
    bookValue: Math.max(residualValue, purchasePrice - accumulatedDepreciation),
  };
}

function renderDashboard() {
  const totalValue = assets.reduce((sum, asset) => sum + Number(asset.harga_perolehan || 0), 0);
  const attentionAssets = assets.filter((asset) => /rusak|perbaikan/i.test(asset.kondisi?.nama_kondisi || ''));
  const depreciableAssets = assets.map((asset) => ({ asset, depreciation: calculateDepreciation(asset) }))
    .filter((item) => item.depreciation);
  const totalDepreciation = depreciableAssets.reduce((sum, item) => sum + item.depreciation.accumulatedDepreciation, 0);
  document.querySelector('#total-assets').textContent = new Intl.NumberFormat('id-ID').format(assets.length);
  document.querySelector('#total-value').textContent = rupiah.format(totalValue);
  document.querySelector('#attention-assets').textContent = new Intl.NumberFormat('id-ID').format(attentionAssets.length);
  document.querySelector('#total-depreciation').textContent = rupiah.format(totalDepreciation);
  const chart = document.querySelector('#depreciation-chart');
  if (!depreciableAssets.length) {
    chart.innerHTML = assets.length
      ? '<div class="depreciation-empty">Lengkapi umur manfaat aset melalui tombol Edit di Data aset untuk melihat grafik.</div>'
      : '<div class="depreciation-empty">Belum ada data aset untuk dihitung.</div>';
  } else {
    const maxBookValue = Math.max(...depreciableAssets.map((item) => item.depreciation.bookValue), 1);
    chart.innerHTML = depreciableAssets.map(({ asset, depreciation }) => {
      const percentage = Math.max(2, (depreciation.bookValue / maxBookValue) * 100);
      return `<div class="depreciation-row">
        <div class="depreciation-asset"><span class="asset-name">${escapeHtml(asset.nama_aset)}</span><span class="asset-id">${asset.umur_manfaat_tahun} th · ${escapeHtml(asset.kondisi?.nama_kondisi || '-')}</span></div>
        <div class="depreciation-track" role="img" aria-label="Nilai buku ${escapeHtml(asset.nama_aset)} ${rupiah.format(depreciation.bookValue)}"><span class="depreciation-bar" style="width:${percentage}%"></span></div>
        <strong class="depreciation-value">${escapeHtml(rupiah.format(depreciation.bookValue))}</strong>
      </div>`;
    }).join('');
  }
  const attentionList = document.querySelector('#attention-list');
  if (!attentionAssets.length) {
    attentionList.innerHTML = '<div class="attention-empty">Semua aset dalam kondisi baik.</div>';
    return;
  }
  attentionList.innerHTML = attentionAssets.map((asset) => {
    const condition = asset.kondisi?.nama_kondisi || '-';
    return `<article class="attention-row">
      <div class="attention-asset">
        <span class="attention-mark" aria-hidden="true">!</span>
        <div><div class="asset-name">${escapeHtml(asset.nama_aset)}</div><div class="asset-id">AST-${String(asset.id_aset).padStart(4, '0')} · ${escapeHtml(asset.lokasi?.nama_lokasi || '-')}</div></div>
      </div>
      <span class="condition-badge ${conditionClass(condition)}">${escapeHtml(condition)}</span>
    </article>`;
  }).join('');
}

function renderReports() {
  if (!reportPeriodInput.value) return;
  const [year, month] = reportPeriodInput.value.split('-').map(Number);
  const periodEnd = new Date(year, month, 0);
  const periodEndDate = `${year}-${String(month).padStart(2, '0')}-${String(periodEnd.getDate()).padStart(2, '0')}`;
  const periodAssets = assets.filter((asset) => asset.tanggal_pembelian <= periodEndDate);
  const reportRows = periodAssets.map((asset) => ({ asset, depreciation: calculateDepreciation(asset, periodEnd) }));
  const depreciableRows = reportRows.filter((row) => row.depreciation);
  const priorPeriodEnd = new Date(year, month - 1, 0);
  const journalRows = periodAssets.map((asset) => {
    const currentDepreciation = calculateDepreciation(asset, periodEnd);
    const priorDepreciation = calculateDepreciation(asset, priorPeriodEnd);
    const amount = currentDepreciation
      ? Math.max(0, Math.round(currentDepreciation.accumulatedDepreciation) - Math.round(priorDepreciation?.accumulatedDepreciation || 0))
      : 0;
    return { asset, amount };
  }).filter((row) => row.amount > 0);
  const totalAcquisition = periodAssets.reduce((sum, asset) => sum + Number(asset.harga_perolehan || 0), 0);
  const totalDepreciation = depreciableRows.reduce((sum, row) => sum + row.depreciation.accumulatedDepreciation, 0);
  const totalBookValue = depreciableRows.reduce((sum, row) => sum + row.depreciation.bookValue, 0);
  const journalDebitTotal = journalRows.reduce((sum, row) => sum + row.amount, 0);
  const journalCreditTotal = journalRows.reduce((sum, row) => sum + row.amount, 0);
  const isJournalBalanced = journalDebitTotal === journalCreditTotal;
  const reportMonth = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(periodEnd);

  document.querySelector('#report-as-of').textContent = `Periode: ${reportMonth}`;
  document.querySelector('#journal-as-of').textContent = `Periode: ${reportMonth}`;
  document.querySelector('#report-asset-count').textContent = new Intl.NumberFormat('id-ID').format(periodAssets.length);
  document.querySelector('#report-acquisition-total').textContent = rupiah.format(totalAcquisition);
  document.querySelector('#report-depreciation-total').textContent = rupiah.format(totalDepreciation);
  document.querySelector('#report-book-value-total').textContent = rupiah.format(totalBookValue);
  document.querySelector('#report-monthly-total').textContent = rupiah.format(depreciableRows.reduce((sum, row) => sum + row.depreciation.monthlyDepreciation, 0));
  document.querySelector('#journal-debit-total').textContent = rupiah.format(journalDebitTotal);
  document.querySelector('#journal-credit-total').textContent = rupiah.format(journalCreditTotal);
  const journalBalance = document.querySelector('#journal-balance');
  journalBalance.textContent = isJournalBalanced ? 'Seimbang' : 'Tidak seimbang';
  journalBalance.classList.toggle('is-balanced', isJournalBalanced);
  journalBalance.classList.toggle('is-unbalanced', !isJournalBalanced);

  const assetReportBody = document.querySelector('#asset-report-body');
  const depreciationReportBody = document.querySelector('#depreciation-report-body');
  const depreciationJournalBody = document.querySelector('#depreciation-journal-body');
  if (!reportRows.length) {
    assetReportBody.innerHTML = '<tr><td class="table-message" colspan="7">Belum ada aset pada periode ini.</td></tr>';
  } else {
    assetReportBody.innerHTML = reportRows.map(({ asset, depreciation }) => `<tr>
      <td>${escapeHtml(`AST-${String(asset.id_aset).padStart(4, '0')}`)}</td>
      <td><div class="asset-name">${escapeHtml(asset.nama_aset)}</div></td>
      <td>${escapeHtml(asset.kategori?.nama_kategori || '-')}</td>
      <td>${escapeHtml(asset.lokasi?.nama_lokasi || '-')}</td>
      <td class="price-cell">${escapeHtml(rupiah.format(Number(asset.harga_perolehan)))}</td>
      <td class="price-cell">${depreciation ? escapeHtml(rupiah.format(depreciation.accumulatedDepreciation)) : '<span class="unset-value">Belum diatur</span>'}</td>
      <td class="price-cell">${depreciation ? escapeHtml(rupiah.format(depreciation.bookValue)) : '—'}</td>
    </tr>`).join('');
  }
  if (!depreciableRows.length) {
    depreciationReportBody.innerHTML = '<tr><td class="table-message" colspan="6">Belum ada aset dengan umur manfaat pada periode ini.</td></tr>';
  } else {
    depreciationReportBody.innerHTML = depreciableRows.map(({ asset, depreciation }) => `<tr>
      <td>${escapeHtml(`AST-${String(asset.id_aset).padStart(4, '0')}`)}</td>
      <td><div class="asset-name">${escapeHtml(asset.nama_aset)}</div></td>
      <td>${escapeHtml(asset.umur_manfaat_tahun)} tahun</td>
      <td class="price-cell">${escapeHtml(rupiah.format(depreciation.monthlyDepreciation))}</td>
      <td class="price-cell">${escapeHtml(rupiah.format(depreciation.accumulatedDepreciation))}</td>
      <td class="price-cell">${escapeHtml(rupiah.format(depreciation.bookValue))}</td>
    </tr>`).join('');
  }
  if (!journalRows.length) {
    depreciationJournalBody.innerHTML = '<tr><td class="table-message" colspan="6">Tidak ada beban penyusutan untuk periode ini.</td></tr>';
  } else {
    const journalDate = escapeHtml(dateFormatter.format(periodEnd));
    depreciationJournalBody.innerHTML = journalRows.map(({ asset, amount }) => {
      const assetCode = escapeHtml(`AST-${String(asset.id_aset).padStart(4, '0')}`);
      const assetName = escapeHtml(asset.nama_aset);
      const formattedAmount = escapeHtml(rupiah.format(amount));
      return `<tr class="journal-entry-row">
        <td>${journalDate}</td>
        <td>${assetCode}</td>
        <td>${assetName}</td>
        <td>Beban Penyusutan</td>
        <td class="price-cell">${formattedAmount}</td>
        <td class="price-cell">—</td>
      </tr><tr class="journal-entry-row journal-credit-row">
        <td>${journalDate}</td>
        <td>${assetCode}</td>
        <td>${assetName}</td>
        <td>Akumulasi Penyusutan</td>
        <td class="price-cell">—</td>
        <td class="price-cell">${formattedAmount}</td>
      </tr>`;
    }).join('');
  }
}

function conditionClass(name) {
  if (/rusak/i.test(name)) return 'is-danger';
  if (/perbaikan/i.test(name)) return 'is-warning';
  return '';
}

function getFilteredAssets() {
  const query = searchInput.value.trim().toLocaleLowerCase('id-ID');
  const selectedCondition = conditionFilter.value;
  return assets.filter((asset) => (!selectedCondition || String(asset.kondisi_id) === selectedCondition) && [
    asset.nama_aset,
    asset.kategori?.nama_kategori,
    asset.lokasi?.nama_lokasi,
    asset.kondisi?.nama_kondisi,
    String(asset.id_aset),
  ].some((value) => String(value || '').toLocaleLowerCase('id-ID').includes(query)));
}

function openAssetDetail(id) {
  const asset = assets.find((item) => String(item.id_aset) === String(id));
  if (!asset) return;

  const [year, month] = reportPeriodInput.value.split('-').map(Number);
  const asOf = new Date(year, month, 0);
  const depreciation = calculateDepreciation(asset, asOf);
  const purchaseDate = new Date(`${asset.tanggal_pembelian}T00:00:00`);
  const hasValidPurchaseDate = !Number.isNaN(purchaseDate.getTime());
  const depreciationStart = hasValidPurchaseDate
    ? new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' })
      .format(new Date(purchaseDate.getFullYear(), purchaseDate.getMonth() + 1, 1))
    : '—';
  const condition = asset.kondisi?.nama_kondisi || '-';
  const setDetail = (selector, value) => {
    document.querySelector(selector).textContent = value;
  };

  setDetail('#asset-detail-title', asset.nama_aset);
  setDetail('#detail-asset-code', `AST-${String(asset.id_aset).padStart(4, '0')}`);
  setDetail('#detail-asset-id', `${asset.id_aset}`);
  setDetail('#detail-asset-name', asset.nama_aset);
  setDetail('#detail-category', asset.kategori?.nama_kategori || '-');
  setDetail('#detail-location', asset.lokasi?.nama_lokasi || '-');
  const conditionBadge = document.querySelector('#detail-condition');
  conditionBadge.className = `condition-badge ${conditionClass(condition)}`;
  conditionBadge.textContent = condition;
  setDetail('#detail-purchase-date', hasValidPurchaseDate ? dateFormatter.format(purchaseDate) : '—');
  setDetail('#detail-acquisition-cost', rupiah.format(Number(asset.harga_perolehan)));
  setDetail('#detail-useful-life', asset.umur_manfaat_tahun ? `${asset.umur_manfaat_tahun} tahun` : 'Belum diatur');
  setDetail('#detail-residual-value', rupiah.format(Number(asset.nilai_residu || 0)));
  setDetail('#detail-depreciation-start', depreciationStart);
  setDetail('#detail-monthly-depreciation', depreciation ? rupiah.format(depreciation.monthlyDepreciation) : 'Belum tersedia');
  setDetail('#detail-accumulated-depreciation', depreciation ? rupiah.format(depreciation.accumulatedDepreciation) : 'Belum tersedia');
  setDetail('#detail-book-value', depreciation ? rupiah.format(depreciation.bookValue) : 'Belum tersedia');
  setDetail('#detail-as-of', dateFormatter.format(asOf));
  assetDetailDialog.showModal();
}

function renderAssets() {
  const filteredAssets = getFilteredAssets();

  if (!filteredAssets.length) {
    const message = assets.length ? 'Coba kata kunci lain.' : 'Tambahkan aset pertama untuk memulai pencatatan.';
    assetTableBody.innerHTML = `<tr><td class="table-message" colspan="10"><span class="empty-state"><strong>${assets.length ? 'Aset tidak ditemukan' : 'Belum ada data aset'}</strong>${message}</span></td></tr>`;
  } else {
    assetTableBody.innerHTML = filteredAssets.map((asset) => {
      const assetCode = `AST-${String(asset.id_aset).padStart(4, '0')}`;
      const purchaseDate = dateFormatter.format(new Date(`${asset.tanggal_pembelian}T00:00:00`));
      const condition = asset.kondisi?.nama_kondisi || '-';
      const depreciation = calculateDepreciation(asset);
      return `<tr>
        <td><button class="asset-name asset-detail-link" type="button" data-action="detail" data-id="${asset.id_aset}" aria-label="Lihat detail ${escapeHtml(asset.nama_aset)}">${escapeHtml(asset.nama_aset)}</button><div class="asset-id">${escapeHtml(assetCode)}</div></td>
        <td class="category-name">${escapeHtml(asset.kategori?.nama_kategori || '-')}</td>
        <td>${escapeHtml(asset.lokasi?.nama_lokasi || '-')}</td>
        <td><span class="condition-badge ${conditionClass(condition)}">${escapeHtml(condition)}</span></td>
        <td class="date-cell">${escapeHtml(purchaseDate)}</td>
        <td class="price-cell">${escapeHtml(rupiah.format(Number(asset.harga_perolehan)))}</td>
        <td>${asset.umur_manfaat_tahun ? `${escapeHtml(asset.umur_manfaat_tahun)} tahun` : '<span class="unset-value">Belum diatur</span>'}</td>
        <td class="price-cell">${depreciation ? escapeHtml(rupiah.format(depreciation.monthlyDepreciation)) : '—'}</td>
        <td class="price-cell">${depreciation ? escapeHtml(rupiah.format(depreciation.bookValue)) : '—'}</td>
        <td><div class="row-actions"><button class="row-detail-button" type="button" data-action="detail" data-id="${asset.id_aset}" aria-label="Detail ${escapeHtml(asset.nama_aset)}">Detail</button><button class="row-button" type="button" data-action="edit" data-id="${asset.id_aset}" aria-label="Edit ${escapeHtml(asset.nama_aset)}" title="Edit">✎</button><button class="row-button delete" type="button" data-action="delete" data-id="${asset.id_aset}" aria-label="Hapus ${escapeHtml(asset.nama_aset)}" title="Hapus">⌫</button></div></td>
      </tr>`;
    }).join('');
  }
  document.querySelector('#result-count').textContent = `${filteredAssets.length} dari ${assets.length} aset`;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportAssetsCsv() {
  const filteredAssets = getFilteredAssets();
  if (!filteredAssets.length) {
    showToast('Tidak ada data untuk diekspor.', true);
    return;
  }

  const rows = [
    ['ID Aset', 'Nama Aset', 'Kategori Aset', 'Lokasi', 'Kondisi Aset', 'Tanggal Pembelian', 'Harga Perolehan (Rp)', 'Umur Manfaat (Tahun)', 'Nilai Residu (Rp)', 'Penyusutan per Bulan (Rp)', 'Akumulasi Penyusutan (Rp)', 'Nilai Buku (Rp)'],
    ...filteredAssets.map((asset) => {
      const depreciation = calculateDepreciation(asset);
      return [
        `AST-${String(asset.id_aset).padStart(4, '0')}`,
        asset.nama_aset,
        asset.kategori?.nama_kategori || '',
        asset.lokasi?.nama_lokasi || '',
        asset.kondisi?.nama_kondisi || '',
        asset.tanggal_pembelian,
        Number(asset.harga_perolehan),
        asset.umur_manfaat_tahun || '',
        Number(asset.nilai_residu || 0),
        depreciation ? Math.round(depreciation.monthlyDepreciation) : '',
        depreciation ? Math.round(depreciation.accumulatedDepreciation) : '',
        depreciation ? Math.round(depreciation.bookValue) : '',
      ];
    }),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
  const downloadUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const downloadLink = document.createElement('a');
  downloadLink.href = downloadUrl;
  downloadLink.download = `aset-catering-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadLink.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  showToast(`${filteredAssets.length} aset diekspor ke CSV.`);
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3200);
}

function openDialog(asset = null) {
  editingId = asset?.id_aset ?? null;
  assetForm.reset();
  formError.hidden = true;
  formError.textContent = '';
  document.querySelector('#dialog-kicker').textContent = asset ? 'UBAH DATA ASET' : 'ASET BARU';
  document.querySelector('#dialog-title').textContent = asset ? 'Edit aset' : 'Tambah aset';
  document.querySelector('.save-label').textContent = asset ? 'Simpan perubahan' : 'Simpan aset';
  document.querySelector('#save-button').disabled = Boolean(referenceLoadError);
  if (referenceLoadError) {
    formError.textContent = referenceLoadError;
    formError.hidden = false;
  }
  if (asset) {
    for (const field of ['nama_aset', 'kategori_id', 'lokasi_id', 'kondisi_id', 'tanggal_pembelian', 'harga_perolehan', 'umur_manfaat_tahun', 'nilai_residu']) {
      assetForm.elements[field].value = asset[field] ?? asset[{
        kategori_id: 'kategori_id', lokasi_id: 'lokasi_id', kondisi_id: 'kondisi_id',
      }[field]] ?? '';
    }
  }
  assetDialog.showModal();
  assetForm.elements.nama_aset.focus();
}

async function submitAsset(event) {
  event.preventDefault();
  if (referenceLoadError) {
    formError.textContent = referenceLoadError;
    formError.hidden = false;
    return;
  }
  const formData = new FormData(assetForm);
  const payload = Object.fromEntries(formData.entries());
  payload.harga_perolehan = Number(payload.harga_perolehan);
  payload.umur_manfaat_tahun = Number(payload.umur_manfaat_tahun);
  payload.nilai_residu = Number(payload.nilai_residu);
  if (!Number.isInteger(payload.umur_manfaat_tahun) || payload.umur_manfaat_tahun < 1 || payload.umur_manfaat_tahun > 100) {
    formError.textContent = 'Umur manfaat harus antara 1 sampai 100 tahun.';
    formError.hidden = false;
    return;
  }
  if (!Number.isFinite(payload.nilai_residu) || payload.nilai_residu < 0 || payload.nilai_residu > payload.harga_perolehan) {
    formError.textContent = 'Nilai residu harus antara 0 dan harga perolehan.';
    formError.hidden = false;
    return;
  }
  const saveButton = document.querySelector('#save-button');
  saveButton.disabled = true;
  formError.hidden = true;
  try {
    await api(editingId ? `/aset?id_aset=eq.${editingId}` : '/aset', {
      method: editingId ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    assetDialog.close();
    showToast(editingId ? 'Perubahan aset berhasil disimpan.' : 'Aset baru berhasil ditambahkan.');
    await loadAssets();
  } catch (error) {
    formError.textContent = friendlyError(error);
    formError.hidden = false;
  } finally {
    saveButton.disabled = false;
  }
}

async function deleteAsset(id) {
  const asset = assets.find((item) => String(item.id_aset) === String(id));
  if (!asset || !window.confirm(`Hapus aset "${asset.nama_aset}"? Tindakan ini tidak dapat dibatalkan.`)) return;
  try {
    await api(`/aset?id_aset=eq.${id}`, { method: 'DELETE' });
    showToast('Aset berhasil dihapus.');
    await loadAssets();
  } catch (error) {
    showToast(friendlyError(error), true);
  }
}

document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date());
function activateView() {
  const requestedView = location.hash.slice(1);
  const activeView = ['dashboard', 'data-aset', 'laporan', 'jurnal-penyusutan'].includes(requestedView) ? requestedView : 'dashboard';
  document.querySelectorAll('.page-view').forEach((view) => {
    view.hidden = view.id !== activeView;
  });
  document.querySelectorAll('.primary-nav .nav-link').forEach((link) => {
    link.classList.toggle('active', link.hash === `#${activeView}`);
  });
}
window.addEventListener('hashchange', activateView);
activateView();
const currentDate = new Date();
reportPeriodInput.value = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
journalPeriodInput.value = reportPeriodInput.value;
document.querySelector('#add-asset-button').addEventListener('click', () => openDialog());
document.querySelector('#add-asset-from-list').addEventListener('click', () => openDialog());
document.querySelector('#close-dialog-button').addEventListener('click', () => assetDialog.close());
document.querySelector('#cancel-dialog-button').addEventListener('click', () => assetDialog.close());
document.querySelector('#close-asset-detail-button').addEventListener('click', () => assetDetailDialog.close());
document.querySelector('#close-asset-detail-action').addEventListener('click', () => assetDetailDialog.close());
document.querySelector('#refresh-button').addEventListener('click', loadAssets);
document.querySelector('#export-button').addEventListener('click', exportAssetsCsv);
searchInput.addEventListener('input', renderAssets);
conditionFilter.addEventListener('change', renderAssets);
journalPeriodInput.addEventListener('change', () => {
  reportPeriodInput.value = journalPeriodInput.value;
  renderReports();
});
reportPeriodInput.addEventListener('change', () => {
  journalPeriodInput.value = reportPeriodInput.value;
  renderReports();
});
document.querySelector('#print-report-button').addEventListener('click', () => window.print());
document.querySelector('#print-journal-button').addEventListener('click', () => window.print());
assetForm.addEventListener('submit', submitAsset);
assetTableBody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'detail') {
    openAssetDetail(button.dataset.id);
  } else if (button.dataset.action === 'edit') {
    const asset = assets.find((item) => String(item.id_aset) === button.dataset.id);
    if (asset) openDialog(asset);
  } else if (button.dataset.action === 'delete') {
    deleteAsset(button.dataset.id);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
});

(async function initialize() {
  try {
    await loadReferences();
    await loadAssets();
  } catch (error) {
    assetTableBody.innerHTML = `<tr><td class="table-message" colspan="10">${escapeHtml(error.message)}</td></tr>`;
    document.querySelector('#result-count').textContent = 'Referensi gagal dimuat';
    showToast(error.message, true);
  }
})();
