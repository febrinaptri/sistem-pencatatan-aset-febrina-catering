const path = require('path');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = Number(process.env.PORT) || 3000;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY sebelum menjalankan backend.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const frontendPath = path.join(__dirname, '..', 'frontend');

app.use(express.json());
app.use(express.static(frontendPath));
app.get('/', (_request, response) => response.sendFile(path.join(frontendPath, 'html', 'index.html')));

function validateAsset(body) {
  const namaAset = String(body.nama_aset || '').trim();
  const kategoriId = Number(body.kategori_id);
  const lokasiId = Number(body.lokasi_id);
  const kondisiId = Number(body.kondisi_id);
  const tanggalPembelian = String(body.tanggal_pembelian || '');
  const hargaPerolehan = Number(body.harga_perolehan);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(tanggalPembelian)
    && !Number.isNaN(Date.parse(`${tanggalPembelian}T00:00:00`));

  if (!namaAset || namaAset.length > 120) return { error: 'Nama aset wajib diisi (maksimal 120 karakter).' };
  if (![kategoriId, lokasiId, kondisiId].every((id) => Number.isInteger(id) && id > 0)) {
    return { error: 'Kategori, lokasi, dan kondisi aset wajib dipilih.' };
  }
  if (!validDate) return { error: 'Tanggal pembelian tidak valid.' };
  if (!Number.isFinite(hargaPerolehan) || hargaPerolehan <= 0) return { error: 'Harga perolehan harus lebih dari 0.' };

  return {
    data: {
      nama_aset: namaAset,
      kategori_id: kategoriId,
      lokasi_id: lokasiId,
      kondisi_id: kondisiId,
      tanggal_pembelian: tanggalPembelian,
      harga_perolehan: hargaPerolehan,
    },
  };
}

function sendDatabaseError(response, error) {
  console.error('Supabase error:', error.message);
  const status = error.code === 'PGRST116' ? 404 : 400;
  response.status(status).json({ error: status === 404 ? 'Data aset tidak ditemukan.' : 'Data tidak valid atau gagal disimpan.' });
}

app.get('/api/referensi', async (_request, response) => {
  const [kategoriResult, lokasiResult, kondisiResult] = await Promise.all([
    supabase.from('kategori_aset').select('id_kategori, nama_kategori').order('nama_kategori'),
    supabase.from('lokasi').select('id_lokasi, nama_lokasi').order('nama_lokasi'),
    supabase.from('kondisi_aset').select('id_kondisi, nama_kondisi').order('id_kondisi'),
  ]);
  const error = kategoriResult.error || lokasiResult.error || kondisiResult.error;
  if (error) return sendDatabaseError(response, error);
  response.json({ kategori: kategoriResult.data, lokasi: lokasiResult.data, kondisi: kondisiResult.data });
});

app.get('/api/aset', async (_request, response) => {
  const { data, error } = await supabase
    .from('aset')
    .select('id_aset, nama_aset, kategori_id, lokasi_id, kondisi_id, tanggal_pembelian, harga_perolehan, kategori:kategori_aset(id_kategori, nama_kategori), lokasi:lokasi(id_lokasi, nama_lokasi), kondisi:kondisi_aset(id_kondisi, nama_kondisi)')
    .order('id_aset', { ascending: false });
  if (error) return sendDatabaseError(response, error);
  response.json(data);
});

app.post('/api/aset', async (request, response) => {
  const validation = validateAsset(request.body);
  if (validation.error) return response.status(400).json({ error: validation.error });
  const { data, error } = await supabase.from('aset').insert(validation.data).select().single();
  if (error) return sendDatabaseError(response, error);
  response.status(201).json(data);
});

app.patch('/api/aset/:id', async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ error: 'ID aset tidak valid.' });
  const validation = validateAsset(request.body);
  if (validation.error) return response.status(400).json({ error: validation.error });
  const { data, error } = await supabase.from('aset').update(validation.data).eq('id_aset', id).select().single();
  if (error) return sendDatabaseError(response, error);
  response.json(data);
});

app.delete('/api/aset/:id', async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ error: 'ID aset tidak valid.' });
  const { data, error } = await supabase.from('aset').delete().eq('id_aset', id).select('id_aset').maybeSingle();
  if (error) return sendDatabaseError(response, error);
  if (!data) return response.status(404).json({ error: 'Data aset tidak ditemukan.' });
  response.json({ message: 'Aset berhasil dihapus.' });
});

app.listen(port, () => console.log(`FEBRINA-ASSET berjalan di http://localhost:${port}`));
