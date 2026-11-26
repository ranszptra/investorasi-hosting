/* Investorasi — Panel Pemilik (halaman terpisah, /admin.html).
   Memakai endpoint /api/admin/* yang sama seperti sebelumnya.
   Halaman ini TIDAK terhubung ke toko (tidak ada tombol/panel admin di
   toko) — pemilik membuka halaman ini langsung. */
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ADMIN_KEY = 'inv_admin_token';

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 3200); }
function getAdminToken() { return localStorage.getItem(ADMIN_KEY); }
function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  return fetch(path, opts).then(async (r) => {
    let j = null; try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j;
  });
}
function adminApi(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ Authorization: 'Bearer ' + getAdminToken() }, opts.headers || {});
  return api(path, opts);
}
function productImg(p, cls) {
  if (p && p.image) return '<img class="' + (cls || '') + '" src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy">';
  return '<div class="img-placeholder ' + (cls || '') + '">Foto menyusul</div>';
}
function fileToDataUrl(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); }); }

/* ---------- Gate PIN ---------- */
function renderAdminGate() {
  const has = !!getAdminToken();
  $('#adminPinBox').classList.toggle('hidden', has);
  $('#adminPanel').classList.toggle('hidden', !has);
  if (has) loadAdminAll();
}
$('#adminPinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ pin: $('#adminPin').value }) });
    localStorage.setItem(ADMIN_KEY, r.token); $('#adminPin').value = ''; renderAdminGate(); toast('Masuk panel pemilik');
  } catch (err) { $('#adminPinMsg').textContent = 'PIN salah: ' + err.message; }
});
$('#btnAdminLogout').addEventListener('click', () => { localStorage.removeItem(ADMIN_KEY); renderAdminGate(); });

async function loadAdminAll() { loadAdminOverview(); loadAdminOrders(); loadAdminWithdrawals(); loadAdminProducts(); loadAdminVip(); loadAdminSettings(); loadAdminEvents(); loadAdminChat(); }

async function loadAdminOverview() {
  try { const r = await adminApi('/api/admin/overview'); $('#adminOverview').innerHTML = '<p>Pengguna: <b>' + r.users + '</b> • Penarikan menunggu: <b>' + r.pendingWithdrawals + '</b></p><p class="small">Pesanan per status: ' + esc(JSON.stringify(r.ordersByStatus || {})) + '</p>'; }
  catch (e) { $('#adminOverview').innerHTML = '<p class="muted">Gagal memuat ringkasan (sesi admin mungkin habis — masukkan PIN lagi).</p>'; }
}

const NEXT_ORDER = { 'Menunggu Pembayaran': 'Dibayar', 'Dibayar': 'Dikirim', 'Dikirim': 'Selesai' };
async function loadAdminOrders() {
  const st = $('#adminOrderFilter').value;
  try {
    const r = await adminApi('/api/admin/orders' + (st ? '?status=' + encodeURIComponent(st) : ''));
    const os = r.orders || [];
    $('#adminOrders').innerHTML = os.length ? os.map((o) => {
      const next = NEXT_ORDER[o.status];
      return '<div class="admin-row"><b>#' + esc(String(o.id).slice(0, 8)) + '</b> — <span class="status ' + esc(o.status) + '">' + esc(o.status) + '</span><br><span class="small">' + esc(o.name || '') + ' • ' + esc(o.phone || '') + ' • ' + rupiah(o.totalRp) + (o.discountRp > 0 ? '<br>🎟️ Pakai voucher: −' + rupiah(o.discountRp) : '') + '<br>' + esc(o.address || '') + '</span>'
        + (next ? '<div class="row"><button class="btn btn-primary btn-small" type="button" data-adv-order="' + esc(o.id) + '" data-adv-status="' + next + '">Ubah ke ' + next + '</button></div>' : '<p class="small muted">Pesanan selesai.</p>') + '</div>';
    }).join('') : '<p class="muted">Tidak ada pesanan.</p>';
  } catch (e) { $('#adminOrders').innerHTML = '<p class="muted">Gagal memuat pesanan.</p>'; }
}

const NEXT_WD = { 'Menunggu': 'Diproses', 'Diproses': 'Selesai' };
async function loadAdminWithdrawals() {
  try {
    const r = await adminApi('/api/admin/withdrawals');
    const ws = r.withdrawals || [];
    $('#adminWithdrawals').innerHTML = ws.length ? ws.map((w) => {
      const next = NEXT_WD[w.status];
      return '<div class="admin-row"><b>' + rupiah(w.amountRp) + '</b> • ' + esc(w.method) + ' • <span class="status ' + esc(w.status) + '">' + esc(w.status) + '</span><br><span class="small">' + esc(w.accountNumber || '') + ' — ' + esc(w.accountName || '') + ' • ' + esc(w.userName || w.userId || '') + '</span>'
        + (next ? '<div class="row"><button class="btn btn-primary btn-small" type="button" data-adv-wd="' + esc(w.id) + '" data-adv-status="' + next + '">Ubah ke ' + next + '</button></div>' : '') + '</div>';
    }).join('') : '<p class="muted">Tidak ada penarikan.</p>';
  } catch (e) { $('#adminWithdrawals').innerHTML = '<p class="muted">Gagal memuat penarikan.</p>'; }
}

async function loadAdminProducts() {
  try {
    const r = await adminApi('/api/admin/products');
    $('#adminProducts').innerHTML = (r.products || []).map((p) => '<div class="admin-row"><b>' + esc(p.name) + '</b> — ' + rupiah(p.priceRp) + ' • Tier ' + p.tier + ' • ' + (p.active ? 'Aktif' : 'Nonaktif') + ' <button class="btn btn-small btn-outline" type="button" data-edit-product="' + esc(p.id) + '">Edit</button></div>').join('') || '<p class="muted">Belum ada produk.</p>';
    $('#adminProducts')._list = r.products || [];
  } catch (e) { $('#adminProducts').innerHTML = '<p class="muted">Gagal memuat produk.</p>'; }
}

async function loadAdminVip() {
  try {
    const r = await adminApi('/api/admin/vip-tiers');
    const tiers = r.vipTiers || [];
    let allProducts = ($('#adminProducts')._list || []);
    if (!allProducts.length) { try { const pr = await adminApi('/api/admin/products'); allProducts = pr.products || []; } catch (e) {} }
    $('#adminVipTiers').innerHTML = tiers.map((t) => {
      const checks = allProducts.map((p) => '<label class="checkbox-row"><input type="checkbox" class="vip-choice" data-tier="' + t.tier + '" value="' + esc(p.id) + '" ' + ((t.choices || []).includes(p.id) ? 'checked' : '') + '> ' + productImg(p, '') + '<span>' + esc(p.name) + ' — ' + rupiah(p.priceRp) + '</span></label>').join('');
      return '<div class="admin-row"><h4>VIP ' + t.tier + '</h4>'
        + '<label>Harga langganan (Rp)</label><input type="number" id="vip-price-' + t.tier + '" value="' + t.priceRp + '">'
        + '<label>Label</label><input type="text" id="vip-label-' + t.tier + '" value="' + esc(t.label || '') + '">'
        + '<label>Jumlah produk yang dipilih pembeli</label><input type="number" id="vip-pick-' + t.tier + '" value="' + t.pickCount + '" min="1">'
        + '<label>Nilai voucher check-in harian (Rp) — voucher belanja, bukan uang tunai</label><input type="number" id="vip-checkin-' + t.tier + '" value="' + t.checkinVoucherRp + '" min="0">'
        + '<label>Pilihan produk (centang yang boleh dipilih)</label>' + checks
        + '<button class="btn btn-primary btn-small" type="button" data-save-vip="' + t.tier + '">Simpan VIP ' + t.tier + '</button></div>';
    }).join('');
  } catch (e) { $('#adminVipTiers').innerHTML = '<p class="muted">Gagal memuat VIP.</p>'; }
}

async function loadAdminSettings() {
  try {
    const r = await adminApi('/api/admin/settings');
    const s = r.settings || {};
    $('#setTelegram').value = s.telegramLink || '';
    $('#bannerColorInput').value = s.bannerColor || '#16a34a'; $('#bannerColorText').value = s.bannerColor || '#16a34a';
    $('#setWindowDays').value = s.checkinWindowDays || 30; $('#setVoucherDays').value = s.checkinVoucherValidDays || 30;
    $('#setGoogleClientId').value = s.googleClientId || '';
    $('#qrisStatus').textContent = s.qrisImageKey ? 'QRIS aktif (gambar sudah diunggah).' : 'QRIS belum diunggah — checkout menampilkan "menunggu aktivasi QRIS".';
  } catch (e) { /* abaikan */ }
}

async function loadAdminEvents() {
  try {
    const r = await adminApi('/api/admin/events');
    $('#adminEvents').innerHTML = (r.events || []).map((ev) => '<div class="admin-row"><b>' + esc(ev.title) + '</b> — ' + (ev.visible ? 'Tampil' : 'Disembunyikan') + ' <button class="btn btn-small btn-outline" type="button" data-toggle-event="' + esc(ev.id) + '" data-visible="' + (ev.visible ? '0' : '1') + '">' + (ev.visible ? 'Sembunyikan' : 'Tampilkan') + '</button> <button class="btn btn-small btn-outline" type="button" data-edit-event="' + esc(ev.id) + '">Edit</button></div>').join('') || '<p class="muted">Belum ada event.</p>';
    $('#adminEvents')._list = r.events || [];
  } catch (e) { $('#adminEvents').innerHTML = '<p class="muted">Gagal memuat event.</p>'; }
}

async function loadAdminChat() {
  try {
    const r = await adminApi('/api/admin/chat');
    const ms = r.messages || [];
    const users = {};
    ms.forEach((m) => { users[m.userId] = m.userName || m.userId; });
    $('#adminChatUser').innerHTML = Object.keys(users).map((id) => '<option value="' + esc(id) + '">' + esc(users[id]) + '</option>').join('') || '<option value="">— belum ada chat —</option>';
    const byUser = {};
    ms.forEach((m) => { (byUser[m.userId] = byUser[m.userId] || []).push(m); });
    $('#adminChatThreads').innerHTML = Object.keys(byUser).map((id) => '<div class="admin-row"><b>' + esc(users[id]) + '</b>' + byUser[id].slice(-3).map((m) => '<div class="small"><b>' + (m.sender === 'owner' ? 'Pemilik' : 'Pengguna') + ':</b> ' + esc(m.message) + '</div>').join('') + '</div>').join('') || '<p class="muted">Belum ada chat.</p>';
  } catch (e) { $('#adminChatThreads').innerHTML = '<p class="muted">Gagal memuat chat.</p>'; }
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-adv-order],[data-adv-wd],[data-save-vip],[data-edit-product],[data-toggle-event],[data-edit-event]');
  if (!t) return;
  try {
    if (t.dataset.advOrder) { await adminApi('/api/admin/orders/' + encodeURIComponent(t.dataset.advOrder) + '/status', { method: 'POST', body: JSON.stringify({ status: t.dataset.advStatus }) }); toast('Status pesanan diubah ke ' + t.dataset.advStatus); loadAdminOrders(); }
    if (t.dataset.advWd) { await adminApi('/api/admin/withdrawals/' + encodeURIComponent(t.dataset.advWd) + '/status', { method: 'POST', body: JSON.stringify({ status: t.dataset.advStatus }) }); toast('Status penarikan diubah ke ' + t.dataset.advStatus); loadAdminWithdrawals(); }
    if (t.dataset.saveVip) {
      const tier = Number(t.dataset.saveVip);
      const choices = $$('.vip-choice[data-tier="' + tier + '"]:checked').map((c) => c.value);
      await adminApi('/api/admin/vip-tiers', { method: 'POST', body: JSON.stringify({ tier, priceRp: Number($('#vip-price-' + tier).value), label: $('#vip-label-' + tier).value, pickCount: Number($('#vip-pick-' + tier).value), choices, checkinVoucherRp: Number($('#vip-checkin-' + tier).value) }) });
      toast('VIP ' + tier + ' disimpan'); loadAdminVip();
    }
    if (t.dataset.editProduct) {
      const p = ($('#adminProducts')._list || []).find((x) => String(x.id) === String(t.dataset.editProduct));
      if (p) { $('#apId').value = p.id; $('#apName').value = p.name; $('#apPrice').value = p.priceRp; $('#apTier').value = p.tier; $('#apDesc').value = p.description || ''; $('#apImage').value = p.image || ''; $('#apActive').checked = !!p.active; $('#prodFormTitle').textContent = 'Edit Produk: ' + p.name; $('#apName').focus(); window.scrollTo(0, $('#adminProductForm').offsetTop); }
    }
    if (t.dataset.toggleEvent) { await adminApi('/api/admin/events/' + encodeURIComponent(t.dataset.toggleEvent) + '/visible', { method: 'POST', body: JSON.stringify({ visible: t.dataset.visible === '1' }) }); toast('Event diperbarui'); loadAdminEvents(); }
    if (t.dataset.editEvent) {
      const ev = ($('#adminEvents')._list || []).find((x) => String(x.id) === String(t.dataset.editEvent));
      if (ev) { $('#aeId').value = ev.id; $('#aeId').dataset.imageKey = ev.imageKey || ''; $('#aeTitle').value = ev.title; $('#aeText').value = ev.text || ''; $('#aeVisible').checked = !!ev.visible; $('#aeTitle').focus(); }
    }
  } catch (err) { toast('Gagal: ' + err.message); }
});

$('#adminOrderFilter').addEventListener('change', loadAdminOrders);
$('#btnAdminOrdersRefresh').addEventListener('click', loadAdminOrders);

$('#adminProductForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    let image = $('#apImage').value.trim();
    const f = $('#apImageFile').files[0];
    if (f) { const up = await adminApi('/api/admin/upload', { method: 'POST', body: JSON.stringify({ kind: 'product', dataUrl: await fileToDataUrl(f) }) }); image = up.url; }
    const body = { name: $('#apName').value.trim(), priceRp: Number($('#apPrice').value), description: $('#apDesc').value.trim(), image: image || null, tier: Number($('#apTier').value), active: $('#apActive').checked };
    if ($('#apId').value) body.id = $('#apId').value;
    await adminApi('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
    toast('Produk disimpan'); e.target.reset(); $('#apId').value = ''; $('#apActive').checked = true; loadAdminProducts();
  } catch (err) { toast('Gagal simpan produk: ' + err.message); }
});

$('#adminEventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    let imageKey = $('#aeId').dataset.imageKey || '';
    const f = $('#aeImageFile').files[0];
    if (f) { const up = await adminApi('/api/admin/upload', { method: 'POST', body: JSON.stringify({ kind: 'event', dataUrl: await fileToDataUrl(f) }) }); imageKey = up.key; }
    const body = { title: $('#aeTitle').value.trim(), text: $('#aeText').value.trim(), imageKey, visible: $('#aeVisible').checked ? 1 : 0 };
    if ($('#aeId').value) body.id = $('#aeId').value;
    await adminApi('/api/admin/events', { method: 'POST', body: JSON.stringify(body) });
    toast('Event disimpan'); e.target.reset(); $('#aeId').value = ''; $('#aeId').dataset.imageKey = ''; loadAdminEvents();
  } catch (err) { toast('Gagal simpan event: ' + err.message); }
});

$('#btnSaveCheckinSettings').addEventListener('click', async () => {
  try {
    await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'checkinWindowDays', value: String(Number($('#setWindowDays').value)) }) });
    await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'checkinVoucherValidDays', value: String(Number($('#setVoucherDays').value)) }) });
    toast('Pengaturan check-in disimpan');
  } catch (err) { toast('Gagal: ' + err.message); }
});

$('#btnSaveBannerColor').addEventListener('click', async () => {
  const v = $('#bannerColorText').value.trim();
  try { await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'bannerColor', value: v }) }); toast('Warna banner disimpan'); }
  catch (err) { toast('Gagal: ' + err.message); }
});
$('#bannerColorInput').addEventListener('input', (e) => { $('#bannerColorText').value = e.target.value; });

$('#bannerFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { await adminApi('/api/admin/upload', { method: 'POST', body: JSON.stringify({ kind: 'banner', dataUrl: await fileToDataUrl(f) }) }); toast('Gambar banner diunggah'); }
  catch (err) { toast('Gagal upload banner: ' + err.message); }
});

$('#btnResetBanner').addEventListener('click', async () => {
  try {
    await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'bannerColor', value: '#16a34a' }) });
    await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'bannerImageKey', value: '' }) });
    toast('Banner direset ke bawaan'); loadAdminSettings();
  } catch (err) { toast('Gagal: ' + err.message); }
});

$('#btnSaveTelegram').addEventListener('click', async () => {
  try { await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'telegramLink', value: $('#setTelegram').value.trim() }) }); toast('Link Telegram disimpan'); }
  catch (err) { toast('Gagal: ' + err.message); }
});

$('#qrisFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { await adminApi('/api/admin/upload', { method: 'POST', body: JSON.stringify({ kind: 'qris', dataUrl: await fileToDataUrl(f) }) }); toast('QRIS diunggah dan aktif'); loadAdminSettings(); }
  catch (err) { toast('Gagal upload QRIS: ' + err.message); }
});

$('#btnSaveGoogleClientId').addEventListener('click', async () => {
  try { await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'googleClientId', value: $('#setGoogleClientId').value.trim() }) }); toast('Google Client ID disimpan — ingat tambahkan domain Railway sebagai Authorized JavaScript origin di Google Cloud Console'); }
  catch (err) { toast('Gagal: ' + err.message); }
});

$('#btnAdminChatSend').addEventListener('click', async () => {
  const userId = $('#adminChatUser').value; const msg = $('#adminChatMsg').value.trim();
  if (!userId || !msg) { toast('Pilih pengguna dan tulis pesan balasan'); return; }
  try { await adminApi('/api/admin/chat', { method: 'POST', body: JSON.stringify({ userId, message: msg }) }); $('#adminChatMsg').value = ''; toast('Balasan terkirim'); loadAdminChat(); }
  catch (err) { toast('Gagal: ' + err.message); }
});

$('#adminChangePinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await adminApi('/api/admin/change-pin', { method: 'POST', body: JSON.stringify({ oldPin: $('#oldPin').value, newPin: $('#newPin').value }) }); toast('PIN berhasil diganti'); e.target.reset(); }
  catch (err) { toast('Gagal ganti PIN: ' + err.message); }
});

/* ---------- Init ---------- */
renderAdminGate();
