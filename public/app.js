/* Investorasi — frontend SPA (mobile-first). API sesuai API.md. */
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TOKEN_KEY = 'inv_token', ADMIN_KEY = 'inv_admin_token', CART_KEY = 'inv_cart';
let catalog = null, profile = null, wallet = null, orders = [], authConfig = null;
let googleInitDone = false;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 3200); }
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getAdminToken() { return localStorage.getItem(ADMIN_KEY); }
function isLoggedIn() { return !!getToken(); }
function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  return fetch(path, opts).then(async (r) => {
    let j = null; try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j;
  });
}
function authApi(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ Authorization: 'Bearer ' + getToken() }, opts.headers || {});
  return api(path, opts);
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

/* ---------- Keranjang (localStorage) ---------- */
function getCart() { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (e) { return []; } }
function saveCart(c) { localStorage.setItem(CART_KEY, JSON.stringify(c)); updateCartCount(); }
function updateCartCount() { const n = getCart().reduce((a, i) => a + (i.qty || 0), 0); $('#cartCount').textContent = n; }
function addToCart(id, qty) {
  const c = getCart(); const it = c.find((x) => x.productId === id);
  if (it) it.qty += (qty || 1); else c.push({ productId: id, qty: qty || 1 });
  saveCart(c); toast('Ditambahkan ke keranjang');
}

/* ---------- Routing ---------- */
const TABS = ['beranda', 'produk', 'undang', 'dompet', 'saya'];
function currentHash() { return (location.hash || '#beranda').replace('#', '') || 'beranda'; }
function go(hash) { location.hash = '#' + hash; }
function showView(name) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  const el = $('#view-' + name);
  if (el) el.classList.remove('hidden');
  $$('.tab-nav button').forEach((b) => b.classList.toggle('aktif', b.dataset.tab === name));
  window.scrollTo(0, 0);
  if (name === 'login') initGoogleButton();
  if (name === 'admin') renderAdminGate();
}
function route() {
  let h = currentHash();
  if (h === 'admin') { showView('admin'); return; }
  if (h === 'login') { showView('login'); return; }
  if (!TABS.includes(h)) h = 'beranda';
  if ((h === 'dompet' || h === 'undang' || h === 'saya') && !isLoggedIn()) { showView('login'); toast('Masuk dulu untuk membuka halaman ini'); return; }
  showView(h);
  if (h === 'dompet') loadWallet();
  if (h === 'undang') renderInvite();
  if (h === 'saya') loadProfile();
}
window.addEventListener('hashchange', route);

/* ---------- Katalog ---------- */
async function loadCatalog() {
  try {
    catalog = await api('/api/catalog');
    renderBanner(); renderEvents(); renderVipLists(); renderProducts();
    if (catalog.telegramLink) { $('#telegramWrap').classList.remove('hidden'); $('#telegramLink').href = catalog.telegramLink; }
  } catch (e) { $('#eventsList').innerHTML = '<p class="muted">Gagal memuat katalog: ' + esc(e.message) + '</p>'; }
}
function renderBanner() {
  const b = $('#banner');
  if (catalog.banner && catalog.banner.imageUrl) {
    b.style.background = catalog.banner.color || '#16a34a';
    b.innerHTML = '<img src="' + esc(catalog.banner.imageUrl) + '" alt="Banner Investorasi">';
  } else {
    b.style.background = catalog.banner ? (catalog.banner.color || '#16a34a') : '#16a34a';
    b.innerHTML = '<div class="banner-inner"><h2>Investorasi</h2><p>Toko online barang nyata — komisi 20% dari penjualan yang benar-benar terjadi.</p></div>';
  }
}
function renderEvents() {
  const el = $('#eventsList');
  const ev = catalog.events || [];
  if (!ev.length) { el.innerHTML = '<p class="muted">Belum ada event saat ini.</p>'; return; }
  el.innerHTML = ev.map((e) => '<div class="event-item"><h3>' + esc(e.title) + '</h3>' + (e.imageUrl ? '<img src="' + esc(e.imageUrl) + '" alt="">' : '') + '<p>' + esc(e.text || '') + '</p></div>').join('');
}
function vipCardHtml(t, compact) {
  const isMember = profile && profile.membership && profile.membership.tier === t.tier;
  const ci = profile ? profile.checkin : null;
  let checkinHtml = '';
  if (!isMember) {
    checkinHtml = '<button class="btn btn-outline btn-small" type="button" disabled>📅 Check-in — langganan dulu</button>';
  } else if (ci && ci.claimedToday) {
    checkinHtml = '<button class="btn btn-outline btn-small" type="button" disabled>✅ Check-in hari ini sudah diklaim (Hari ke-' + (ci.dayNumber || 1) + ')</button>';
  } else {
    checkinHtml = '<button class="btn btn-primary btn-small" type="button" data-checkin="1">📅 Klaim check-in hari ini — voucher ' + rupiah(t.checkinVoucherRp) + '</button>';
  }
  const memberInfo = isMember && profile.membership
    ? '<p class="small">👑 Kamu member VIP ' + t.tier + ' — Hari ke-' + profile.membership.dayNumber + ' • sisa ' + profile.membership.daysLeft + ' hari</p>' : '';
  const choices = (t.choiceProducts || []).map((p) => '<div title="' + esc(p.name) + '">' + productImg(p, '') + '<div class="small" style="max-width:72px">' + esc(p.name) + '</div></div>').join('');
  return '<div class="vip-card"><h3>VIP ' + t.tier + ' — ' + esc(t.label || '') + '</h3>'
    + '<div class="vip-price">' + rupiah(t.priceRp) + '</div>'
    + '<p class="muted small">Pilih ' + t.pickCount + ' produk gratis dari pilihan di bawah. Check-in harian: voucher belanja ' + rupiah(t.checkinVoucherRp) + '/hari (bukan uang tunai).</p>'
    + '<div class="vip-choices">' + (choices || '<p class="muted small">Belum ada pilihan produk.</p>') + '</div>'
    + memberInfo + '<div class="row"><button class="btn btn-primary" type="button" data-vip-sub="' + t.tier + '">Pilih produk</button>' + checkinHtml + '</div></div>';
}
function renderVipLists() {
  const tiers = (catalog && catalog.vipTiers) || [];
  $('#vipListBeranda').innerHTML = tiers.length ? tiers.map((t) => vipCardHtml(t)).join('') : '<p class="muted">Langganan VIP belum tersedia.</p>';
  $('#vipListProduk').innerHTML = tiers.length ? tiers.map((t) => vipCardHtml(t, true)).join('') : '<p class="muted">Langganan VIP belum tersedia.</p>';
}
function renderProducts() {
  const grid = $('#productGrid');
  const ps = (catalog && catalog.products) || [];
  if (!ps.length) { grid.innerHTML = '<p class="muted">Belum ada produk.</p>'; return; }
  grid.innerHTML = ps.map((p) => '<button type="button" class="product-card" data-product="' + esc(p.id) + '">' + productImg(p)
    + '<span class="pc-body"><h3>' + esc(p.name) + '</h3><span class="price">' + rupiah(p.priceRp) + '</span><br><span class="commission">Komisi penjual 20% • ' + rupiah(Math.round(p.priceRp * 0.2)) + '</span></span></button>').join('');
}

/* ---------- Profil / Dompet / Pesanan / Undang ---------- */
async function loadProfile() {
  if (!isLoggedIn()) return;
  try {
    profile = await api('/api/profile', { headers: { Authorization: 'Bearer ' + getToken() } });
    renderProfile(); renderVipLists(); renderInvite(); loadOrders();
  } catch (e) { if (/401|403|token/i.test(e.message)) { localStorage.removeItem(TOKEN_KEY); profile = null; go('login'); } }
}
function renderProfile() {
  if (!profile) return;
  const u = profile.user;
  $('#profileBox').innerHTML = '<p><b>' + esc(u.name) + '</b><br>' + esc(u.email) + '<br>Kode undangan: <b>' + esc(u.inviteCode || '—') + '</b><br>Saldo komisi: <b>' + rupiah(u.balanceRp) + '</b></p>'
    + (profile.membership ? '<p class="small">👑 Member VIP ' + profile.membership.tier + ' — Hari ke-' + profile.membership.dayNumber + ', sisa ' + profile.membership.daysLeft + ' hari</p>' : '<p class="small muted">Belum berlangganan VIP.</p>');
  $('#vipBadge').classList.toggle('hidden', !profile.membership);
}
async function loadOrders() {
  try { const r = await authApi('/api/orders'); orders = r.orders || []; renderOrders(); } catch (e) { $('#myOrders').innerHTML = '<p class="muted">Gagal memuat pesanan.</p>'; }
}
function renderOrders() {
  const el = $('#myOrders');
  if (!orders.length) { el.innerHTML = '<p class="muted">Belum ada pesanan.</p>'; return; }
  el.innerHTML = orders.map((o) => {
    let items = '';
    if (Array.isArray(o.items)) items = o.items.map((i) => esc(i.name || i.productId) + ' × ' + i.qty).join(', ');
    else if (o.items && typeof o.items === 'object') items = 'Langganan VIP ' + esc(o.items.tier) + ' — produk: ' + esc((o.items.productIds || []).join(', '));
    const payBtn = o.status === 'Menunggu Pembayaran' ? '<button class="btn btn-primary btn-small" type="button" data-confirm-pay="' + esc(o.id) + '">Saya sudah bayar</button>' : '';
    return '<div class="order-item"><b>Pesanan #' + esc(String(o.id).slice(0, 8)) + '</b> — <span class="status ' + esc(o.status) + '">' + esc(o.status) + '</span><br><span class="small">' + items + '</span><br>Total: <b>' + rupiah(o.totalRp) + '</b> • ' + esc(o.createdAt || '') + '<div class="row">' + payBtn + '</div></div>';
  }).join('');
}
async function loadWallet() {
  if (!isLoggedIn()) return;
  try {
    wallet = await authApi('/api/wallet');
    $('#walletBalance').textContent = rupiah(wallet.balanceRp);
    const vs = wallet.vouchers || [];
    $('#voucherList').innerHTML = vs.length ? vs.map((v) => '<div class="voucher-row">🎟️ Voucher <b>' + rupiah(v.amountRp) + '</b> — ' + esc(v.status) + ' • berlaku s/d ' + esc((v.expiresAt || '').slice(0, 10)) + '<br><span class="small muted">Potongan belanja saja, bukan uang tunai, tidak bisa ditarik.</span></div>').join('') : '<p class="muted">Belum ada voucher.</p>';
    const ws = wallet.withdrawals || [];
    $('#withdrawHistory').innerHTML = ws.length ? ws.map((w) => '<div class="wallet-row"><b>' + rupiah(w.amountRp) + '</b> • ' + esc(w.method) + ' • <span class="status ' + esc(w.status) + '">' + esc(w.status) + '</span><br><span class="small">' + esc(w.accountNumber || '') + ' — ' + esc(w.accountName || '') + '</span></div>').join('') : '<p class="muted">Belum ada penarikan.</p>';
    const en = wallet.entries || [];
    const KIND_LABEL = { commission: 'Komisi penjualan 20%', invite_bonus: 'Bonus undang teman', withdrawal: 'Penarikan' };
    $('#walletEntries').innerHTML = en.length ? en.map((e) => '<div class="wallet-row">' + esc(KIND_LABEL[e.kind] || e.kind || 'Transaksi') + ' — <b>' + rupiah(e.amountRp) + '</b><br><span class="small">' + esc(e.createdAt || '') + '</span></div>').join('') : '<p class="muted">Belum ada riwayat.</p>';
  } catch (e) { toast('Gagal memuat dompet: ' + e.message); }
}
function renderInvite() {
  if (!profile) return;
  const inv = profile.invite;
  $('#myInviteCode').textContent = inv.code || '—';
  const link = location.origin + '/?ref=' + encodeURIComponent(inv.code || '');
  $('#inviteLinkInput').value = inv.code ? link : '';
  $('#btnWaInvite').href = inv.code ? 'https://wa.me/?text=' + encodeURIComponent('Yuk belanja di Investorasi pakai kode undanganku ' + inv.code + ' ' + link) : '#';
  $('#inviteStats').textContent = 'Teman terdaftar: ' + inv.referredTotal + ' • Teman terkualifikasi: ' + inv.qualified + ' (terkualifikasi = daftar lewat linkmu dan sudah melakukan minimal 1 pembelian).';
  $('#inviteLadder').innerHTML = (inv.tiers || []).map((t) => {
    const btn = t.claimed ? '<button class="btn btn-outline btn-small" type="button" disabled>✅ Sudah diklaim</button>'
      : t.canClaim ? '<button class="btn btn-primary btn-small" type="button" data-claim-tier="' + t.tier + '">Klaim ' + rupiah(t.rp) + '</button>'
      : '<button class="btn btn-outline btn-small" type="button" disabled>Butuh ' + t.tier + ' teman terkualifikasi</button>';
    return '<div class="order-item"><b>' + t.tier + ' teman</b> — hadiah <b>' + rupiah(t.rp) + '</b> ' + btn + '</div>';
  }).join('');
}

/* ---------- Auth ---------- */
async function loadAuthConfig() {
  try { authConfig = await api('/api/auth/config'); } catch (e) { authConfig = { googleConfigured: false, googleClientId: null }; }
  renderGoogleNote();
}
function renderGoogleNote() {
  const note = $('#googleNote');
  if (!authConfig) return;
  if (authConfig.googleConfigured) { note.textContent = 'Masuk sekali ketuk dengan akun Google kamu.'; }
  else { note.textContent = 'Login Google belum diaktifkan pemilik. Silakan daftar/masuk dengan email di bawah.'; $('#googleBtn').innerHTML = ''; }
}
function initGoogleButton() {
  if (!authConfig || !authConfig.googleConfigured || !authConfig.googleClientId) { renderGoogleNote(); return; }
  if (typeof google === 'undefined' || !google.accounts) { setTimeout(initGoogleButton, 800); return; }
  try {
    google.accounts.id.initialize({ client_id: authConfig.googleClientId, callback: handleGoogleCredential });
    google.accounts.id.renderButton($('#googleBtn'), { theme: 'outline', size: 'large', width: 320, text: 'signin_with' });
    googleInitDone = true;
  } catch (e) { $('#googleNote').textContent = 'Tombol Google gagal dimuat: ' + e.message; }
}
async function handleGoogleCredential(resp) {
  try {
    const invite = new URLSearchParams(location.search).get('ref') || $('#regInvite').value || undefined;
    const r = await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ idToken: resp.credential, inviteCode: invite }) });
    saveLogin(r);
  } catch (e) { $('#loginMsg').textContent = 'Login Google gagal: ' + e.message; toast('Login Google gagal: ' + e.message); }
}
function saveLogin(r) {
  localStorage.setItem(TOKEN_KEY, r.token);
  toast('Selamat datang, ' + (r.user && r.user.name ? r.user.name : ''));
  loadProfile(); go('beranda');
}

/* ---------- Modal: produk, keranjang, checkout, VIP ---------- */
function openModal(html) { $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBox').innerHTML = ''; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function checkoutFormHtml(prefill) {
  prefill = prefill || {};
  return '<label for="coName">Nama penerima</label><input id="coName" required value="' + esc(prefill.name || '') + '">'
    + '<label for="coAddress">Alamat lengkap</label><textarea id="coAddress" rows="2" required>' + esc(prefill.address || '') + '</textarea>'
    + '<label for="coPhone">Nomor HP</label><input id="coPhone" type="tel" required value="' + esc(prefill.phone || '') + '">'
    + '<label for="coEmail">Email</label><input id="coEmail" type="email" required value="' + esc(prefill.email || '') + '">';
}
function qrisHtml() {
  if (catalog && catalog.qrisActive && catalog.qrisImageUrl) return '<p>Bayar via QRIS:</p><img class="qris-img" src="' + esc(catalog.qrisImageUrl) + '" alt="QRIS Investorasi">';
  return '<p class="muted">Pembayaran QRIS: menunggu aktivasi QRIS.</p>';
}
function voucherSelectHtml() {
  const vs = (wallet && wallet.vouchers) || (profile && profile.vouchers) || [];
  const active = vs.filter((v) => v.status === 'active');
  if (!active.length) return '<p class="small muted">Tidak ada voucher aktif.</p>';
  return '<label for="coVoucher">Pakai voucher (opsional)</label><select id="coVoucher"><option value="">— Tanpa voucher —</option>' + active.map((v) => '<option value="' + esc(v.id) + '">Voucher ' + rupiah(v.amountRp) + ' (s/d ' + esc((v.expiresAt || '').slice(0, 10)) + ')</option>').join('') + '</select>';
}
function openProductDetail(id) {
  const p = (catalog.products || []).find((x) => x.id === id);
  if (!p) return;
  openModal('<button class="btn btn-outline btn-small" type="button" onclick="document.getElementById(\'modal\').classList.add(\'hidden\')">✕ Tutup</button>'
    + '<h2>' + esc(p.name) + '</h2>' + productImg(p, 'detail-img')
    + '<p class="price" style="font-size:20px">' + rupiah(p.priceRp) + '</p>'
    + '<p class="commission">Komisi penjual 20% • ' + rupiah(Math.round(p.priceRp * 0.2)) + ' (dibayar saat pesanan Dibayar)</p>'
    + '<p>' + esc(p.description || '') + '</p>'
    + '<div class="row"><button class="btn btn-primary" type="button" data-add-cart="' + esc(p.id) + '" style="flex:1">+ Keranjang</button><button class="btn btn-outline" type="button" data-buy-now="' + esc(p.id) + '" style="flex:1">Beli Sekarang</button></div>');
}
function openCart() {
  const c = getCart();
  const ps = catalog ? catalog.products : [];
  if (!c.length) { openModal('<h2>🛒 Keranjang</h2><p class="muted">Keranjang masih kosong.</p><button class="btn btn-primary" type="button" onclick="document.getElementById(\'modal\').classList.add(\'hidden\')">Lanjut Belanja</button>'); return; }
  let total = 0;
  const rows = c.map((i) => {
    const p = ps.find((x) => x.id === i.productId); if (!p) return '';
    total += p.priceRp * i.qty;
    return '<div class="order-item"><b>' + esc(p.name) + '</b> × ' + i.qty + ' — ' + rupiah(p.priceRp * i.qty)
      + ' <button class="btn btn-small btn-outline" type="button" data-cart-dec="' + esc(p.id) + '">−</button> <button class="btn btn-small btn-outline" type="button" data-cart-inc="' + esc(p.id) + '">+</button> <button class="btn btn-small btn-outline" type="button" data-cart-del="' + esc(p.id) + '">Hapus</button></div>';
  }).join('');
  openModal('<h2>🛒 Keranjang</h2>' + rows + '<p>Total: <b>' + rupiah(total) + '</b></p>'
    + '<form id="checkoutForm">' + voucherSelectHtml() + checkoutFormHtml(profile ? profile.user : {}) + qrisHtml()
    + '<button class="btn btn-primary" type="submit" style="width:100%;margin-top:10px">Buat Pesanan</button></form>');
}
function openVipSubscribe(tier) {
  const t = (catalog.vipTiers || []).find((x) => x.tier === tier);
  if (!t) return;
  if (!isLoggedIn()) { toast('Masuk dulu untuk berlangganan VIP'); go('login'); return; }
  const choices = (t.choiceProducts || []).map((p) => '<label class="checkbox-row"><input type="checkbox" class="vip-pick" value="' + esc(p.id) + '"> ' + productImg(p, '') + '<span><b>' + esc(p.name) + '</b><br><span class="small">' + rupiah(p.priceRp) + '</span></span></label>').join('');
  openModal('<h2>👑 Langganan VIP ' + t.tier + ' — ' + esc(t.label || '') + '</h2><p>Harga langganan: <b>' + rupiah(t.priceRp) + '</b>. Pilih tepat <b>' + t.pickCount + '</b> produk gratis:</p>'
    + '<form id="vipForm">' + choices + checkoutFormHtml(profile ? profile.user : {}) + qrisHtml()
    + '<p class="small muted">Langganan VIP tidak menjanjikan keuntungan apa pun. Kamu mendapatkan produk pilihanmu + voucher check-in harian selama masa langganan.</p>'
    + '<button class="btn btn-primary" type="submit" style="width:100%;margin-top:10px">Langganan VIP ' + t.tier + ' — ' + rupiah(t.priceRp) + '</button></form>');
}

/* ---------- Chat ---------- */
function toggleChat(open) {
  const p = $('#chatPanel');
  if (open === undefined) p.classList.toggle('hidden'); else p.classList.toggle('hidden', !open);
  if (!p.classList.contains('hidden')) loadChat();
}
async function loadChat() {
  if (!isLoggedIn()) { $('#chatBody').innerHTML = '<p class="muted">Masuk dulu untuk mengobrol dengan pemilik.</p>'; return; }
  try {
    const r = await authApi('/api/chat');
    const ms = r.messages || [];
    $('#chatBody').innerHTML = ms.length ? ms.map((m) => '<div class="chat-msg ' + esc(m.sender) + '">' + esc(m.message) + '<br><span class="small">' + esc((m.createdAt || '').slice(0, 16).replace('T', ' ')) + '</span></div>').join('') : '<p class="muted">Belum ada pesan. Tulis pertanyaanmu di bawah.</p>';
    $('#chatBody').scrollTop = $('#chatBody').scrollHeight;
  } catch (e) { $('#chatBody').innerHTML = '<p class="muted">Gagal memuat chat.</p>'; }
}
async function sendChat() {
  const v = $('#chatMsg').value.trim(); if (!v) return;
  if (!isLoggedIn()) { toast('Masuk dulu untuk chat'); go('login'); return; }
  try { await authApi('/api/chat', { method: 'POST', body: JSON.stringify({ message: v }) }); $('#chatMsg').value = ''; loadChat(); }
  catch (e) { toast('Gagal mengirim: ' + e.message); }
}

/* ---------- Delegasi klik global ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-product],[data-add-cart],[data-buy-now],[data-vip-sub],[data-checkin],[data-claim-tier],[data-confirm-pay],[data-cart-inc],[data-cart-dec],[data-cart-del]');
  if (!t) return;
  if (t.dataset.product) { openProductDetail(t.dataset.product); return; }
  if (t.dataset.addCart) { addToCart(t.dataset.addCart); closeModal(); return; }
  if (t.dataset.buyNow) { addToCart(t.dataset.buyNow); closeModal(); openCart(); return; }
  if (t.dataset.vipSub) { openVipSubscribe(Number(t.dataset.vipSub)); return; }
  if (t.dataset.cartInc || t.dataset.cartDec || t.dataset.cartDel) {
    const c = getCart(); const id = t.dataset.cartInc || t.dataset.cartDec || t.dataset.cartDel;
    const it = c.find((x) => x.productId === id); if (!it) return;
    if (t.dataset.cartInc) it.qty++;
    if (t.dataset.cartDec) { it.qty--; if (it.qty <= 0) c.splice(c.indexOf(it), 1); }
    if (t.dataset.cartDel) c.splice(c.indexOf(it), 1);
    saveCart(c); openCart(); return;
  }
  if (t.dataset.checkin) {
    if (!isLoggedIn()) { toast('Masuk dulu'); go('login'); return; }
    try { const r = await authApi('/api/checkin/claim', { method: 'POST', body: '{}' }); toast('Check-in berhasil! Voucher ' + rupiah(r.voucher.amountRp) + ' (Hari ke-' + r.dayNumber + ')'); loadProfile(); }
    catch (err) { toast('Check-in gagal: ' + err.message); }
    return;
  }
  if (t.dataset.claimTier) {
    try { const r = await authApi('/api/invite/claim', { method: 'POST', body: JSON.stringify({ tier: Number(t.dataset.claimTier) }) }); toast(r.message || ('Hadiah ' + rupiah(r.amountRp) + ' diklaim')); loadProfile(); }
    catch (err) { toast('Klaim gagal: ' + err.message); }
    return;
  }
  if (t.dataset.confirmPay) {
    try { await authApi('/api/orders/' + encodeURIComponent(t.dataset.confirmPay) + '/confirm-pay', { method: 'POST', body: '{}' }); toast('Terima kasih — pemilik akan memverifikasi pembayaranmu'); loadOrders(); }
    catch (err) { toast('Gagal: ' + err.message); }
  }
});

/* ---------- Form: login/register ---------- */
$('#tabLoginBtn').addEventListener('click', () => { $('#loginForm').classList.remove('hidden'); $('#registerForm').classList.add('hidden'); $('#tabLoginBtn').classList.add('active'); $('#tabRegisterBtn').classList.remove('active'); });
$('#tabRegisterBtn').addEventListener('click', () => { $('#registerForm').classList.remove('hidden'); $('#loginForm').classList.add('hidden'); $('#tabRegisterBtn').classList.add('active'); $('#tabLoginBtn').classList.remove('active'); });
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#loginEmail').value.trim(), password: $('#loginPass').value }) }); saveLogin(r); }
  catch (err) { $('#loginMsg').textContent = 'Gagal masuk: ' + err.message; }
});
$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: $('#regName').value.trim(), email: $('#regEmail').value.trim(), password: $('#regPass').value, inviteCode: $('#regInvite').value.trim() || undefined }) });
    saveLogin(r);
  } catch (err) { $('#loginMsg').textContent = 'Gagal daftar: ' + err.message; }
});
$('#btnLogout').addEventListener('click', () => { localStorage.removeItem(TOKEN_KEY); profile = null; toast('Kamu sudah keluar'); go('login'); });

/* ---------- Form: penarikan ---------- */
$('#withdrawForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = Number($('#wdAmount').value);
  if (amount < 100000) { toast('Penarikan minimal Rp100.000'); return; }
  try {
    const r = await authApi('/api/withdraw', { method: 'POST', body: JSON.stringify({ amountRp: amount, method: $('#wdMethod').value, accountNumber: $('#wdAccount').value.trim(), accountName: $('#wdName').value.trim() }) });
    toast(r.message || 'Penarikan diajukan — diproses manual maks. 3 hari kerja'); e.target.reset(); loadWallet();
  } catch (err) { toast('Gagal: ' + err.message); }
});

/* ---------- Form dinamis: checkout & VIP (di modal) ---------- */
document.addEventListener('submit', async (e) => {
  if (e.target.id === 'checkoutForm') {
    e.preventDefault();
    if (!isLoggedIn()) { toast('Masuk dulu untuk checkout'); closeModal(); go('login'); return; }
    const items = getCart().map((i) => ({ productId: i.productId, qty: i.qty }));
    const vSel = $('#coVoucher');
    try {
      await authApi('/api/orders', { method: 'POST', body: JSON.stringify({ items, voucherId: vSel && vSel.value ? vSel.value : undefined, name: $('#coName').value.trim(), address: $('#coAddress').value.trim(), phone: $('#coPhone').value.trim(), email: $('#coEmail').value.trim() }) });
      saveCart([]); closeModal(); toast('Pesanan dibuat — status Menunggu Pembayaran. Bayar via QRIS lalu ketuk "Saya sudah bayar" di tab Saya.'); go('saya');
    } catch (err) { toast('Checkout gagal: ' + err.message); }
  }
  if (e.target.id === 'vipForm') {
    e.preventDefault();
    const picks = $$('.vip-pick:checked').map((c) => c.value);
    // Tier VIP diambil dari modal yang dibuka (disimpan di dataset saat openVipSubscribe)
    const t = Number($('#modalBox').dataset.vipTier || 0);
    try {
      await authApi('/api/orders/vip', { method: 'POST', body: JSON.stringify({ tier: t, productIds: picks, name: $('#coName').value.trim(), address: $('#coAddress').value.trim(), phone: $('#coPhone').value.trim(), email: $('#coEmail').value.trim() }) });
      closeModal(); toast('Langganan VIP berhasil dibuat — bayar lalu ketuk "Saya sudah bayar" di tab Saya.'); loadProfile(); go('saya');
    } catch (err) { toast('Langganan gagal: ' + err.message); }
  }
});
// Simpan tier VIP yang sedang dipilih saat modal VIP dibuka
const _openVip = openVipSubscribe;
openVipSubscribe = function (tier) { _openVip(tier); const b = $('#modalBox'); if (b) b.dataset.vipTier = String(tier); };

/* ---------- Invite: salin & bagikan ---------- */
$('#btnCopyInvite').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#inviteLinkInput').value); toast('Link undangan disalin'); }
  catch (e) { $('#inviteLinkInput').select(); document.execCommand('copy'); toast('Link undangan disalin'); }
});
$('#btnShareInvite').addEventListener('click', async () => {
  const link = $('#inviteLinkInput').value;
  if (navigator.share) { try { await navigator.share({ title: 'Investorasi', text: 'Belanja di Investorasi pakai kode undanganku', url: link }); } catch (e) {} }
  else { try { await navigator.clipboard.writeText(link); toast('Link disalin — bagikan ke temanmu'); } catch (e) { toast(link); } }
});

/* ---------- Chat ---------- */
$('#chatFab').addEventListener('click', () => toggleChat());
$('#chatClose').addEventListener('click', () => toggleChat(false));
$('#chatSend').addEventListener('click', sendChat);
$('#chatMsg').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
$('#btnChatSaya').addEventListener('click', () => toggleChat(true));
$('#btnCartTop').addEventListener('click', openCart);
$('#btnAdminOpen').addEventListener('click', () => go('admin'));
$$('.tab-nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));

/* ---------- ADMIN ---------- */
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
function fileToDataUrl(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); }); }
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
      return '<div class="admin-row"><b>#' + esc(String(o.id).slice(0, 8)) + '</b> — <span class="status ' + esc(o.status) + '">' + esc(o.status) + '</span><br><span class="small">' + esc(o.name || '') + ' • ' + esc(o.phone || '') + ' • ' + rupiah(o.totalRp) + '<br>' + esc(o.address || '') + '</span>'
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
      toast('VIP ' + tier + ' disimpan'); loadCatalog();
    }
    if (t.dataset.editProduct) {
      const p = ($('#adminProducts')._list || []).find((x) => String(x.id) === String(t.dataset.editProduct));
      if (p) { $('#apId').value = p.id; $('#apName').value = p.name; $('#apPrice').value = p.priceRp; $('#apTier').value = p.tier; $('#apDesc').value = p.description || ''; $('#apImage').value = p.image || ''; $('#apActive').checked = !!p.active; $('#prodFormTitle').textContent = 'Edit Produk: ' + p.name; $('#apName').focus(); window.scrollTo(0, $('#adminProductForm').offsetTop); }
    }
    if (t.dataset.toggleEvent) { await adminApi('/api/admin/events/' + encodeURIComponent(t.dataset.toggleEvent) + '/visible', { method: 'POST', body: JSON.stringify({ visible: t.dataset.visible === '1' }) }); toast('Event diperbarui'); loadAdminEvents(); loadCatalog(); }
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
    toast('Produk disimpan'); e.target.reset(); $('#apId').value = ''; $('#apActive').checked = true; loadAdminProducts(); loadCatalog();
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
    toast('Event disimpan'); e.target.reset(); $('#aeId').value = ''; $('#aeId').dataset.imageKey = ''; loadAdminEvents(); loadCatalog();
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
  try { await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'bannerColor', value: v }) }); toast('Warna banner disimpan'); loadCatalog(); }
  catch (err) { toast('Gagal: ' + err.message); }
});
$('#bannerColorInput').addEventListener('input', (e) => { $('#bannerColorText').value = e.target.value; });
$('#bannerFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { await adminApi('/api/admin/upload', { method: 'POST', body: JSON.stringify({ kind: 'banner', dataUrl: await fileToDataUrl(f) }) }); toast('Gambar banner diunggah'); loadCatalog(); }
  catch (err) { toast('Gagal upload banner: ' + err.message); }
});
$('#btnResetBanner').addEventListener('click', async () => {
  try {
    await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'bannerColor', value: '#16a34a' }) });
    await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'bannerImageKey', value: '' }) });
    toast('Banner direset ke bawaan'); loadCatalog(); loadAdminSettings();
  } catch (err) { toast('Gagal: ' + err.message); }
});
$('#btnSaveTelegram').addEventListener('click', async () => {
  try { await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'telegramLink', value: $('#setTelegram').value.trim() }) }); toast('Link Telegram disimpan'); loadCatalog(); }
  catch (err) { toast('Gagal: ' + err.message); }
});
$('#qrisFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { await adminApi('/api/admin/upload', { method: 'POST', body: JSON.stringify({ kind: 'qris', dataUrl: await fileToDataUrl(f) }) }); toast('QRIS diunggah dan aktif'); loadCatalog(); loadAdminSettings(); }
  catch (err) { toast('Gagal upload QRIS: ' + err.message); }
});
$('#btnSaveGoogleClientId').addEventListener('click', async () => {
  try { await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'googleClientId', value: $('#setGoogleClientId').value.trim() }) }); toast('Google Client ID disimpan — ingat tambahkan domain Railway sebagai Authorized JavaScript origin di Google Cloud Console'); loadAuthConfig(); }
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
(function init() {
  const params = new URLSearchParams(location.search);
  const ref = params.get('ref');
  if (ref) $('#regInvite').value = ref;
  updateCartCount();
  loadAuthConfig();
  loadCatalog();
  if (isLoggedIn()) loadProfile();
  route();
})();
