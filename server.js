// server.js — Investorasi (toko online marketplace).
// Node 24 + Express. Dual backend via db.js (Supabase Postgres bila
// DATABASE_URL diset, SQLite lokal bila tidak).
// Start: `npm start` (PORT env, default 3000). Serve statis dari ./public/.
//
// ATURAN PRODUK (ditetapkan pemilik 2026-11-26, JANGAN dilanggar):
// - TIDAK ADA janji profit dijamin, klaim harian tunai, atau roda putar.
// - Komisi 20% HANYA dari penjualan nyata (saat pesanan ditandai Dibayar).
// - Check-in VIP memberi VOUCHER BELANJA saja (bukan uang, tidak bisa ditarik).
// - Penarikan diproses manual pemilik (maks. 3 hari kerja).

const express = require('express');
const path = require('node:path');
const {
  db, initDb, hashSecret, verifySecret, makeToken, verifyToken,
  makeAdminToken, verifyAdminToken,
  todayStr, nowIso, addDays,
  getSetting, setSetting, makeInviteCode,
  COMMISSION_RATE, WITHDRAW_MIN_RP, WITHDRAW_METHODS, INVITE_TIERS,
  parseJson, publicUser, getVipTiers, getVipMembership, isQualifiedFriend,
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Bungkus handler async agar error dilempar ke middleware error.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function fail(res, code, msg) { return res.status(code).json({ ok: false, error: msg }); }

async function getAdminPin() {
  const hash = await getSetting('adminPinHash', '');
  const salt = await getSetting('adminPinSalt', '');
  return { hash, salt };
}

async function requireUser(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return fail(res, 401, 'Login dulu');
  const id = verifyToken(m[1]);
  if (!id) return fail(res, 401, 'Sesi tidak valid — login ulang');
  const row = await db.prepare('SELECT * FROM inv_users WHERE id=?').get(id);
  if (!row) return fail(res, 401, 'Akun tidak ditemukan');
  if (row.banned) return fail(res, 403, 'Akun diblokir');
  req.user = row;
  next();
}

async function requireAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return fail(res, 401, 'PIN admin diperlukan');
  const { hash } = await getAdminPin();
  if (!hash || !verifyAdminToken(m[1], hash)) return fail(res, 401, 'Token admin tidak valid');
  next();
}

const ORDER_STATUSES = ['Menunggu Pembayaran', 'Dibayar', 'Dikirim', 'Selesai'];
const WITHDRAW_STATUSES = ['Menunggu', 'Diproses', 'Selesai'];

// ---------------------------------------------------------------------------
// Health + config publik
// ---------------------------------------------------------------------------
app.get('/api/health', ah(async (req, res) => {
  const products = (await db.prepare('SELECT COUNT(*) AS c FROM inv_products').get()).c;
  res.json({ ok: true, service: 'investorasi', time: nowIso(), products });
}));

app.get('/api/auth/config', ah(async (req, res) => {
  const googleClientId = await getSetting('googleClientId', '');
  res.json({ ok: true, googleConfigured: !!googleClientId, googleClientId: googleClientId || null });
}));

// ---------------------------------------------------------------------------
// Auth pengguna
// ---------------------------------------------------------------------------
async function findUserByEmail(email) {
  return db.prepare('SELECT * FROM inv_users WHERE email=?').get(String(email).toLowerCase().trim());
}

app.post('/api/auth/register', ah(async (req, res) => {
  const { name, email, password, inviteCode } = req.body || {};
  if (!name || !String(name).trim()) return fail(res, 400, 'Nama wajib diisi');
  if (!email || !/^\S+@\S+\.\S+$/.test(String(email))) return fail(res, 400, 'Email tidak valid');
  if (!password || String(password).length < 6) return fail(res, 400, 'Password minimal 6 karakter');
  const emailNorm = String(email).toLowerCase().trim();
  const nameTrim = String(name).trim();
  if (await db.prepare('SELECT id FROM inv_users WHERE email=?').get(emailNorm)) return fail(res, 400, 'Email sudah terdaftar — silakan login');
  if (await db.prepare('SELECT id FROM inv_users WHERE name=?').get(nameTrim)) return fail(res, 400, 'Nama sudah dipakai — pilih nama lain');
  let referrerId = null;
  if (inviteCode) {
    const ref = await db.prepare('SELECT id FROM inv_users WHERE inviteCode=?').get(String(inviteCode).trim().toUpperCase());
    if (ref) referrerId = ref.id;
  }
  const { salt, hash } = hashSecret(String(password));
  const code = makeInviteCode();
  const r = await db.prepare(
    'INSERT INTO inv_users(name,email,passHash,passSalt,inviteCode,referrerId,balanceRp,createdAt) VALUES(?,?,?,?,?,?,0,?)'
  ).run(nameTrim, emailNorm, hash, salt, code, referrerId, nowIso());
  const userId = r.lastInsertRowid;
  if (referrerId) {
    await db.prepare('INSERT OR IGNORE INTO inv_referrals(referrerId,friendId,qualified,createdAt) VALUES(?,?,0,?)')
      .run(referrerId, userId, nowIso());
  }
  const row = await db.prepare('SELECT * FROM inv_users WHERE id=?').get(userId);
  res.json({ ok: true, token: makeToken(userId), user: publicUser(row) });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return fail(res, 400, 'Email dan password wajib diisi');
  const row = await findUserByEmail(email);
  if (!row) return fail(res, 401, 'Email atau password salah');
  if (!verifySecret(String(password), row.passSalt, row.passHash)) return fail(res, 401, 'Email atau password salah');
  if (row.banned) return fail(res, 403, 'Akun diblokir');
  res.json({ ok: true, token: makeToken(row.id), user: publicUser(row) });
}));

// Login Google (Google Identity Services): frontend mengirim id_token,
// server memverifikasi ke endpoint resmi Google, lalu cocokkan aud dengan
// Client ID yang diisi pemilik di panel. Bila Client ID belum diisi, endpoint
// ini menolak dengan pesan jelas — aplikasi TIDAK rusak.
async function verifyGoogleIdToken(idToken, clientId) {
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
    if (!r.ok) return null;
    const j = await r.json();
    if (j.aud !== clientId || !j.email) return null;
    return { email: String(j.email).toLowerCase(), sub: j.sub, name: j.name || String(j.email).split('@')[0] };
  } catch {
    return null;
  }
}

app.post('/api/auth/google', ah(async (req, res) => {
  const { idToken, inviteCode } = req.body || {};
  if (!idToken) return fail(res, 400, 'Token Google tidak ada');
  const clientId = await getSetting('googleClientId', '');
  if (!clientId) return fail(res, 400, 'Login Google belum diaktifkan pemilik — isi Google Client ID di Panel Pemilik dulu');
  const g = await verifyGoogleIdToken(idToken, clientId);
  if (!g) return fail(res, 401, 'Token Google tidak valid');
  let row = await findUserByEmail(g.email);
  if (row) {
    if (row.banned) return fail(res, 403, 'Akun diblokir');
    if (!row.providerId) {
      await db.prepare('UPDATE inv_users SET provider=?, providerId=? WHERE id=?').run('google', g.sub, row.id);
    }
    return res.json({ ok: true, token: makeToken(row.id), user: publicUser(row) });
  }
  // Akun baru via Google: password diisi acak (tidak dipakai — login via Google).
  const { salt, hash } = hashSecret('google-' + g.sub + '-' + Date.now());
  let referrerId = null;
  if (inviteCode) {
    const ref = await db.prepare('SELECT id FROM inv_users WHERE inviteCode=?').get(String(inviteCode).trim().toUpperCase());
    if (ref) referrerId = ref.id;
  }
  let name = g.name;
  let n = 0;
  while (await db.prepare('SELECT id FROM inv_users WHERE name=?').get(name)) { n += 1; name = `${g.name} ${n}`; }
  const code = makeInviteCode();
  const r = await db.prepare(
    'INSERT INTO inv_users(name,email,passHash,passSalt,inviteCode,referrerId,balanceRp,provider,providerId,createdAt) VALUES(?,?,?,?,?,?,0,?,?,?)'
  ).run(name, g.email, hash, salt, code, referrerId, 'google', g.sub, nowIso());
  const userId = r.lastInsertRowid;
  if (referrerId) {
    await db.prepare('INSERT OR IGNORE INTO inv_referrals(referrerId,friendId,qualified,createdAt) VALUES(?,?,0,?)')
      .run(referrerId, userId, nowIso());
  }
  row = await db.prepare('SELECT * FROM inv_users WHERE id=?').get(userId);
  res.json({ ok: true, token: makeToken(userId), user: publicUser(row) });
}));

// ---------------------------------------------------------------------------
// Blob (gambar upload: banner, event, QRIS, foto produk) — disimpan base64
// di DB supaya selamat dari redeploy (disk Railway bersifat ephemeral).
// ---------------------------------------------------------------------------
app.get('/api/blob/:key', ah(async (req, res) => {
  const key = String(req.params.key);
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return fail(res, 400, 'Key tidak valid');
  const row = await db.prepare('SELECT mime, data FROM inv_blobs WHERE key=?').get(key);
  if (!row) return fail(res, 404, 'Gambar tidak ditemukan');
  const buf = Buffer.from(row.data, 'base64');
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buf);
}));

// ---------------------------------------------------------------------------
// Katalog publik + profil
// ---------------------------------------------------------------------------
app.get('/api/catalog', ah(async (req, res) => {
  const products = await db.prepare("SELECT * FROM inv_products WHERE active=1 ORDER BY tier, id").all();
  const tiers = await getVipTiers();
  const prodById = {};
  for (const p of products) prodById[p.id] = p;
  const tiersOut = tiers.map((t) => ({
    ...t,
    choiceProducts: t.choices.map((id) => prodById[id]).filter(Boolean).map((p) => ({
      id: p.id, name: p.name, priceRp: p.priceRp, image: p.image, description: p.description,
    })),
  }));
  const bannerColor = await getSetting('bannerColor', '#16a34a');
  const bannerImageKey = await getSetting('bannerImageKey', '');
  const qrisImageKey = await getSetting('qrisImageKey', '');
  const telegramLink = await getSetting('telegramLink', '');
  const events = await db.prepare('SELECT * FROM inv_events WHERE visible=1 ORDER BY id DESC').all();
  res.json({
    ok: true,
    products: products.map((p) => ({ id: p.id, name: p.name, priceRp: p.priceRp, description: p.description, image: p.image, tier: p.tier })),
    vipTiers: tiersOut,
    banner: { color: bannerColor, imageUrl: bannerImageKey ? `/api/blob/${bannerImageKey}` : null },
    events: events.map((e) => ({ id: e.id, title: e.title, text: e.text, imageUrl: e.imageKey ? `/api/blob/${e.imageKey}` : null })),
    qrisActive: !!qrisImageKey,
    qrisImageUrl: qrisImageKey ? `/api/blob/${qrisImageKey}` : null,
    telegramLink: telegramLink || null,
  });
}));

app.get('/api/profile', requireUser, ah(async (req, res) => {
  const u = req.user;
  const membership = await getVipMembership(u.id);
  const myVouchers = await db.prepare("SELECT * FROM inv_vouchers WHERE userId=? AND status='active' ORDER BY createdAt DESC").all(u.id);
  const referred = await db.prepare('SELECT COUNT(*) AS c FROM inv_referrals WHERE referrerId=?').get(u.id);
  const qualified = await db.prepare('SELECT COUNT(*) AS c FROM inv_referrals WHERE referrerId=? AND qualified=1').get(u.id);
  const claims = await db.prepare('SELECT tier FROM inv_invite_claims WHERE userId=?').all(u.id);
  const claimedSet = new Set(claims.map((c) => c.tier));
  const tiers = INVITE_TIERS.map((t) => ({ ...t, claimed: claimedSet.has(t.tier), canClaim: qualified.c >= t.tier && !claimedSet.has(t.tier) }));
  const today = todayStr();
  const claimedToday = await db.prepare('SELECT * FROM inv_checkins WHERE userId=? AND date=?').get(u.id, today);
  res.json({
    ok: true,
    user: publicUser(u),
    membership,
    vouchers: myVouchers.map((v) => ({ id: v.id, amountRp: v.amountRp, status: v.status, expiresAt: v.expiresAt, createdAt: v.createdAt })),
    invite: {
      code: u.inviteCode,
      referredTotal: referred.c,
      qualified: qualified.c,
      tiers,
    },
    checkin: {
      isMember: !!membership,
      tier: membership ? membership.tier : null,
      dayNumber: membership ? membership.dayNumber : null,
      daysLeft: membership ? membership.daysLeft : null,
      claimedToday: !!claimedToday,
    },
  });
}));

// ---------------------------------------------------------------------------
// Pesanan (produk + VIP)
// ---------------------------------------------------------------------------
async function applyVoucher(userId, voucherId, totalRp) {
  if (!voucherId) return { discountRp: 0, voucher: null };
  const v = await db.prepare('SELECT * FROM inv_vouchers WHERE id=? AND userId=?').get(voucherId, userId);
  if (!v) throw Object.assign(new Error('Voucher tidak ditemukan di akunmu'), { status: 400 });
  if (v.status !== 'active') throw Object.assign(new Error('Voucher sudah tidak aktif'), { status: 400 });
  if (new Date(v.expiresAt) <= new Date()) throw Object.assign(new Error('Voucher sudah kedaluwarsa'), { status: 400 });
  const discountRp = Math.min(v.amountRp, totalRp);
  return { discountRp, voucher: v };
}

function validCheckout(body) {
  const { name, address, phone, email } = body || {};
  if (!name || !String(name).trim()) return 'Nama lengkap wajib diisi';
  if (!address || !String(address).trim()) return 'Alamat lengkap wajib diisi';
  if (!phone || !String(phone).trim()) return 'Nomor HP wajib diisi';
  if (!email || !/^\S+@\S+\.\S+$/.test(String(email))) return 'Email tidak valid';
  return null;
}

app.post('/api/orders', requireUser, ah(async (req, res) => {
  const { items, voucherId, name, address, phone, email } = req.body || {};
  const err = validCheckout(req.body);
  if (err) return fail(res, 400, err);
  if (!Array.isArray(items) || items.length === 0) return fail(res, 400, 'Keranjang kosong');
  let totalRp = 0;
  const normItems = [];
  for (const it of items) {
    const p = await db.prepare('SELECT * FROM inv_products WHERE id=? AND active=1').get(it.productId);
    if (!p) return fail(res, 400, `Produk tidak ditemukan: ${it.productId}`);
    const qty = Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1));
    normItems.push({ productId: p.id, name: p.name, priceRp: p.priceRp, qty });
    totalRp += p.priceRp * qty;
  }
  let discountRp = 0;
  let voucher = null;
  try {
    ({ discountRp, voucher } = await applyVoucher(req.user.id, voucherId, totalRp));
  } catch (e) {
    return fail(res, e.status || 400, e.message);
  }
  const finalTotal = Math.max(0, totalRp - discountRp);
  const r = await db.prepare(
    'INSERT INTO inv_orders(userId,type,items,totalRp,voucherId,discountRp,name,address,phone,email,status,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(req.user.id, 'product', JSON.stringify(normItems), finalTotal, voucher ? voucher.id : null, discountRp,
    String(name).trim(), String(address).trim(), String(phone).trim(), String(email).trim(), 'Menunggu Pembayaran', nowIso());
  const orderId = r.lastInsertRowid;
  if (voucher) {
    await db.prepare("UPDATE inv_vouchers SET status='used', usedOrderId=? WHERE id=?").run(orderId, voucher.id);
  }
  const order = await db.prepare('SELECT * FROM inv_orders WHERE id=?').get(orderId);
  res.json({ ok: true, order: { ...order, items: parseJson(order.items, []) } });
}));

app.post('/api/orders/vip', requireUser, ah(async (req, res) => {
  const { tier, productIds, voucherId, name, address, phone, email } = req.body || {};
  const err = validCheckout(req.body);
  if (err) return fail(res, 400, err);
  const t = parseInt(tier, 10);
  const tierRow = await db.prepare('SELECT * FROM inv_vip_tiers WHERE tier=?').get(t);
  if (!tierRow) return fail(res, 400, 'Tingkat VIP tidak ditemukan');
  const choices = parseJson(tierRow.choices, []);
  const picked = Array.isArray(productIds) ? [...new Set(productIds)] : [];
  if (picked.length !== tierRow.pickCount) {
    return fail(res, 400, `Pilih tepat ${tierRow.pickCount} produk untuk ${tierRow.label}`);
  }
  for (const pid of picked) {
    if (!choices.includes(pid)) return fail(res, 400, `Produk ${pid} bukan pilihan tingkat VIP ${t}`);
    const p = await db.prepare('SELECT * FROM inv_products WHERE id=? AND active=1').get(pid);
    if (!p) return fail(res, 400, `Produk tidak tersedia: ${pid}`);
  }
  const items = { tier: t, productIds: picked };
  let discountRp = 0;
  let voucher = null;
  try {
    ({ discountRp, voucher } = await applyVoucher(req.user.id, voucherId, tierRow.priceRp));
  } catch (e) {
    return fail(res, e.status || 400, e.message);
  }
  const finalTotal = Math.max(0, tierRow.priceRp - discountRp);
  const r = await db.prepare(
    'INSERT INTO inv_orders(userId,type,items,totalRp,voucherId,discountRp,name,address,phone,email,status,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(req.user.id, 'vip', JSON.stringify(items), finalTotal, voucher ? voucher.id : null, discountRp,
    String(name).trim(), String(address).trim(), String(phone).trim(), String(email).trim(), 'Menunggu Pembayaran', nowIso());
  if (voucher) {
    await db.prepare("UPDATE inv_vouchers SET status='used', usedOrderId=? WHERE id=?").run(r.lastInsertRowid, voucher.id);
  }
  const order = await db.prepare('SELECT * FROM inv_orders WHERE id=?').get(r.lastInsertRowid);
  res.json({ ok: true, order: { ...order, items: parseJson(order.items, {}) } });
}));

app.get('/api/orders', requireUser, ah(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM inv_orders WHERE userId=? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ ok: true, orders: rows.map((o) => ({ ...o, items: parseJson(o.items, o.type === 'vip' ? {} : []) })) });
}));

app.post('/api/orders/:id/confirm-pay', requireUser, ah(async (req, res) => {
  const order = await db.prepare('SELECT * FROM inv_orders WHERE id=? AND userId=?').get(req.params.id, req.user.id);
  if (!order) return fail(res, 404, 'Pesanan tidak ditemukan');
  if (order.status !== 'Menunggu Pembayaran') return fail(res, 400, `Pesanan sudah ${order.status}`);
  await db.prepare('UPDATE inv_orders SET paidClaimed=1 WHERE id=?').run(order.id);
  res.json({ ok: true, message: 'Konfirmasi pembayaran dicatat — pemilik akan memverifikasi dan menandai Dibayar' });
}));

// ---------------------------------------------------------------------------
// Dompet: saldo, penarikan, voucher
// ---------------------------------------------------------------------------
app.get('/api/wallet', requireUser, ah(async (req, res) => {
  const u = await db.prepare('SELECT * FROM inv_users WHERE id=?').get(req.user.id);
  const entries = await db.prepare('SELECT * FROM inv_wallet_entries WHERE userId=? ORDER BY id DESC LIMIT 50').all(u.id);
  const withdrawals = await db.prepare('SELECT * FROM inv_withdrawals WHERE userId=? ORDER BY id DESC LIMIT 20').all(u.id);
  const vouchers = await db.prepare('SELECT * FROM inv_vouchers WHERE userId=? ORDER BY id DESC LIMIT 20').all(u.id);
  res.json({
    ok: true,
    balanceRp: u.balanceRp,
    minWithdrawRp: WITHDRAW_MIN_RP,
    methods: WITHDRAW_METHODS,
    entries,
    withdrawals,
    vouchers: vouchers.map((v) => ({ id: v.id, amountRp: v.amountRp, status: v.status, expiresAt: v.expiresAt, createdAt: v.createdAt, usedOrderId: v.usedOrderId })),
  });
}));

app.post('/api/withdraw', requireUser, ah(async (req, res) => {
  const { amountRp, method, accountNumber, accountName } = req.body || {};
  const amount = parseInt(amountRp, 10);
  if (!amount || amount < WITHDRAW_MIN_RP) return fail(res, 400, `Minimal penarikan Rp${WITHDRAW_MIN_RP.toLocaleString('id-ID')}`);
  if (!WITHDRAW_METHODS.includes(method)) return fail(res, 400, 'Metode penarikan tidak valid');
  if (!accountNumber || !String(accountNumber).trim()) return fail(res, 400, 'Nomor rekening / nomor HP wajib diisi');
  if (!accountName || !String(accountName).trim()) return fail(res, 400, 'Nama pemilik akun wajib diisi');
  const u = await db.prepare('SELECT * FROM inv_users WHERE id=?').get(req.user.id);
  if (u.balanceRp < amount) return fail(res, 400, 'Saldo tidak cukup');
  const r = await db.prepare(
    'INSERT INTO inv_withdrawals(userId,amountRp,method,accountNumber,accountName,status,createdAt) VALUES(?,?,?,?,?,?,?)'
  ).run(u.id, amount, method, String(accountNumber).trim(), String(accountName).trim(), 'Menunggu', nowIso());
  await db.prepare('UPDATE inv_users SET balanceRp=balanceRp-? WHERE id=?').run(amount, u.id);
  await db.prepare("INSERT INTO inv_wallet_entries(userId,kind,amountRp,refType,refId,createdAt) VALUES(?, 'withdrawal', ?, 'withdrawal', ?, ?)")
    .run(u.id, -amount, String(r.lastInsertRowid), nowIso());
  res.json({ ok: true, withdrawalId: r.lastInsertRowid, message: 'Permintaan penarikan dicatat — diproses manual pemilik maks. 3 hari kerja' });
}));

// ---------------------------------------------------------------------------
// Undang teman: tangga bonus sekali-klaim
// ---------------------------------------------------------------------------
app.post('/api/invite/claim', requireUser, ah(async (req, res) => {
  const tier = parseInt((req.body || {}).tier, 10);
  const def = INVITE_TIERS.find((t) => t.tier === tier);
  if (!def) return fail(res, 400, 'Tingkat bonus tidak ditemukan');
  const qualified = (await db.prepare('SELECT COUNT(*) AS c FROM inv_referrals WHERE referrerId=? AND qualified=1').get(req.user.id)).c;
  if (qualified < tier) return fail(res, 400, `Butuh ${tier} teman terkualifikasi — sekarang ${qualified}`);
  const already = await db.prepare('SELECT * FROM inv_invite_claims WHERE userId=? AND tier=?').get(req.user.id, tier);
  if (already) return fail(res, 400, 'Bonus tingkat ini sudah diklaim');
  await db.prepare('INSERT INTO inv_invite_claims(userId,tier,amountRp,createdAt) VALUES(?,?,?,?)')
    .run(req.user.id, tier, def.rp, nowIso());
  await db.prepare('UPDATE inv_users SET balanceRp=balanceRp+? WHERE id=?').run(def.rp, req.user.id);
  await db.prepare("INSERT INTO inv_wallet_entries(userId,kind,amountRp,refType,refId,createdAt) VALUES(?, 'invite_bonus', ?, 'invite_tier', ?, ?)")
    .run(req.user.id, def.rp, String(tier), nowIso());
  res.json({ ok: true, amountRp: def.rp, message: `Bonus Rp${def.rp.toLocaleString('id-ID')} masuk ke dompet` });
}));

// ---------------------------------------------------------------------------
// Check-in harian VIP — VOUCHER BELANJA saja (bukan uang, tidak bisa ditarik)
// ---------------------------------------------------------------------------
app.post('/api/checkin/claim', requireUser, ah(async (req, res) => {
  const membership = await getVipMembership(req.user.id);
  if (!membership) return fail(res, 400, 'Check-in hanya untuk member VIP aktif — langganan dulu');
  const today = todayStr();
  const existing = await db.prepare('SELECT * FROM inv_checkins WHERE userId=? AND date=?').get(req.user.id, today);
  if (existing) return fail(res, 400, 'Sudah check-in hari ini — kembali besok');
  const tierRow = await db.prepare('SELECT * FROM inv_vip_tiers WHERE tier=?').get(membership.tier);
  if (!tierRow) return fail(res, 400, 'Tingkat VIP tidak ditemukan');
  const amountRp = tierRow.checkinVoucherRp;
  const validDays = parseInt(await getSetting('checkinVoucherValidDays', '30'), 10) || 30;
  const expiresAt = addDays(nowIso(), validDays);
  const v = await db.prepare(
    "INSERT INTO inv_vouchers(userId,amountRp,status,expiresAt,createdAt) VALUES(?,?,'active',?,?)"
  ).run(req.user.id, amountRp, expiresAt, nowIso());
  await db.prepare('INSERT INTO inv_checkins(userId,date,tier,voucherId) VALUES(?,?,?,?)')
    .run(req.user.id, today, membership.tier, v.lastInsertRowid);
  res.json({
    ok: true,
    voucher: { id: v.lastInsertRowid, amountRp, expiresAt },
    dayNumber: membership.dayNumber,
    daysLeft: membership.daysLeft,
    message: `Voucher belanja Rp${amountRp.toLocaleString('id-ID')} diklaim — hanya untuk belanja di toko, tidak bisa diuangkan`,
  });
}));

// ---------------------------------------------------------------------------
// Live chat (pengguna <-> pemilik)
// ---------------------------------------------------------------------------
app.get('/api/chat', requireUser, ah(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM inv_chat WHERE userId=? ORDER BY id ASC LIMIT 200').all(req.user.id);
  res.json({ ok: true, messages: rows });
}));

app.post('/api/chat', requireUser, ah(async (req, res) => {
  const { message } = req.body || {};
  if (!message || !String(message).trim()) return fail(res, 400, 'Pesan kosong');
  if (String(message).length > 2000) return fail(res, 400, 'Pesan terlalu panjang');
  const r = await db.prepare('INSERT INTO inv_chat(userId,sender,message,createdAt) VALUES(?,?,?,?)')
    .run(req.user.id, 'user', String(message).trim(), nowIso());
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// ---------------------------------------------------------------------------
// Admin (Panel Pemilik) — area terpisah, PIN-gated
// ---------------------------------------------------------------------------
app.post('/api/admin/login', ah(async (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return fail(res, 400, 'PIN wajib diisi');
  const { hash, salt } = await getAdminPin();
  if (!hash || !verifySecret(String(pin), salt, hash)) return fail(res, 401, 'PIN pemilik salah');
  res.json({ ok: true, token: makeAdminToken(hash) });
}));

app.post('/api/admin/change-pin', requireAdmin, ah(async (req, res) => {
  const { oldPin, newPin } = req.body || {};
  const { hash, salt } = await getAdminPin();
  if (!oldPin || !verifySecret(String(oldPin), salt, hash)) return fail(res, 401, 'PIN lama salah');
  if (!newPin || !/^\d{4,8}$/.test(String(newPin))) return fail(res, 400, 'PIN baru harus 4–8 digit angka');
  const h = hashSecret(String(newPin));
  await setSetting('adminPinHash', h.hash);
  await setSetting('adminPinSalt', h.salt);
  res.json({ ok: true, message: 'PIN pemilik diganti' });
}));

app.get('/api/admin/overview', requireAdmin, ah(async (req, res) => {
  const users = (await db.prepare('SELECT COUNT(*) AS c FROM inv_users').get()).c;
  const ordersByStatus = await db.prepare('SELECT status, COUNT(*) AS c FROM inv_orders GROUP BY status').all();
  const pendingWithdrawals = (await db.prepare("SELECT COUNT(*) AS c FROM inv_withdrawals WHERE status='Menunggu'").get()).c;
  const recentOrders = await db.prepare('SELECT * FROM inv_orders ORDER BY id DESC LIMIT 10').all();
  const recentWithdrawals = await db.prepare('SELECT * FROM inv_withdrawals ORDER BY id DESC LIMIT 10').all();
  res.json({
    ok: true,
    users,
    ordersByStatus,
    pendingWithdrawals,
    recentOrders: recentOrders.map((o) => ({ ...o, items: parseJson(o.items, o.type === 'vip' ? {} : []) })),
    recentWithdrawals,
  });
}));

// Efek saat pesanan ditandai Dibayar (SEKALI saja — dijaga paidAt):
//  - komisi 20% ke pengundang (bila pembeli daftar lewat kode undangan)
//  - teman jadi TERKUALIFIKASI bila ini pembelian pertama yang dibayar
async function applyPaidEffects(order) {
  if (order.paidAt) return;
  await db.prepare('UPDATE inv_orders SET paidAt=? WHERE id=?').run(nowIso(), order.id);
  const buyer = await db.prepare('SELECT * FROM inv_users WHERE id=?').get(order.userId);
  if (!buyer) return;
  if (buyer.referrerId) {
    const commission = Math.round(order.totalRp * COMMISSION_RATE);
    if (commission > 0) {
      await db.prepare('UPDATE inv_users SET balanceRp=balanceRp+? WHERE id=?').run(commission, buyer.referrerId);
      await db.prepare("INSERT INTO inv_wallet_entries(userId,kind,amountRp,refType,refId,createdAt) VALUES(?, 'commission', ?, 'order', ?, ?)")
        .run(buyer.referrerId, commission, String(order.id), nowIso());
    }
  }
  const firstPaid = (await db.prepare("SELECT COUNT(*) AS c FROM inv_orders WHERE userId=? AND status IN ('Dibayar','Dikirim','Selesai')").get(order.userId)).c;
  if (firstPaid <= 1) {
    await db.prepare('UPDATE inv_referrals SET qualified=1 WHERE friendId=?').run(order.userId);
  }
}

app.get('/api/admin/orders', requireAdmin, ah(async (req, res) => {
  const status = req.query.status;
  const rows = status
    ? await db.prepare('SELECT * FROM inv_orders WHERE status=? ORDER BY id DESC LIMIT 100').all(status)
    : await db.prepare('SELECT * FROM inv_orders ORDER BY id DESC LIMIT 100').all();
  res.json({ ok: true, orders: rows.map((o) => ({ ...o, items: parseJson(o.items, o.type === 'vip' ? {} : []) })) });
}));

app.post('/api/admin/orders/:id/status', requireAdmin, ah(async (req, res) => {
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) return fail(res, 400, 'Status tidak valid');
  const order = await db.prepare('SELECT * FROM inv_orders WHERE id=?').get(req.params.id);
  if (!order) return fail(res, 404, 'Pesanan tidak ditemukan');
  const fromIdx = ORDER_STATUSES.indexOf(order.status);
  const toIdx = ORDER_STATUSES.indexOf(status);
  if (toIdx < fromIdx) return fail(res, 400, `Pesanan sudah ${order.status} — tidak bisa mundur`);
  await db.prepare('UPDATE inv_orders SET status=? WHERE id=?').run(status, order.id);
  if (status === 'Dibayar') await applyPaidEffects({ ...order, status });
  const updated = await db.prepare('SELECT * FROM inv_orders WHERE id=?').get(order.id);
  res.json({ ok: true, order: { ...updated, items: parseJson(updated.items, updated.type === 'vip' ? {} : []) } });
}));

app.get('/api/admin/withdrawals', requireAdmin, ah(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM inv_withdrawals ORDER BY id DESC LIMIT 100').all();
  res.json({ ok: true, withdrawals: rows });
}));

app.post('/api/admin/withdrawals/:id/status', requireAdmin, ah(async (req, res) => {
  const { status } = req.body || {};
  if (!WITHDRAW_STATUSES.includes(status)) return fail(res, 400, 'Status tidak valid');
  const w = await db.prepare('SELECT * FROM inv_withdrawals WHERE id=?').get(req.params.id);
  if (!w) return fail(res, 404, 'Penarikan tidak ditemukan');
  const fromIdx = WITHDRAW_STATUSES.indexOf(w.status);
  const toIdx = WITHDRAW_STATUSES.indexOf(status);
  if (toIdx < fromIdx) return fail(res, 400, `Penarikan sudah ${w.status} — tidak bisa mundur`);
  await db.prepare('UPDATE inv_withdrawals SET status=? WHERE id=?').run(status, w.id);
  res.json({ ok: true });
}));

app.get('/api/admin/products', requireAdmin, ah(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM inv_products ORDER BY tier, id').all();
  res.json({ ok: true, products: rows });
}));

app.post('/api/admin/products', requireAdmin, ah(async (req, res) => {
  const { id, name, priceRp, description, image, tier, active } = req.body || {};
  if (!name || !String(name).trim()) return fail(res, 400, 'Nama produk wajib diisi');
  const price = parseInt(priceRp, 10);
  if (!price || price <= 0) return fail(res, 400, 'Harga harus lebih dari 0');
  const tierNum = tier === null || tier === undefined || tier === '' ? null : parseInt(tier, 10);
  if (id) {
    const existing = await db.prepare('SELECT * FROM inv_products WHERE id=?').get(id);
    if (!existing) return fail(res, 404, 'Produk tidak ditemukan');
    await db.prepare('UPDATE inv_products SET name=?, priceRp=?, description=?, image=?, tier=?, active=? WHERE id=?')
      .run(String(name).trim(), price, String(description || ''), image || null, tierNum, active ? 1 : 0, id);
    return res.json({ ok: true, id });
  }
  const newId = 'x' + Date.now().toString(36);
  await db.prepare('INSERT INTO inv_products(id,name,priceRp,description,image,tier,active) VALUES(?,?,?,?,?,?,?)')
    .run(newId, String(name).trim(), price, String(description || ''), image || null, tierNum, active === false ? 0 : 1);
  res.json({ ok: true, id: newId });
}));

app.get('/api/admin/vip-tiers', requireAdmin, ah(async (req, res) => {
  res.json({ ok: true, vipTiers: await getVipTiers() });
}));

app.post('/api/admin/vip-tiers', requireAdmin, ah(async (req, res) => {
  const { tier, priceRp, label, pickCount, choices, checkinVoucherRp } = req.body || {};
  const t = parseInt(tier, 10);
  const row = await db.prepare('SELECT * FROM inv_vip_tiers WHERE tier=?').get(t);
  if (!row) return fail(res, 404, 'Tingkat VIP tidak ditemukan');
  const price = parseInt(priceRp, 10);
  if (!price || price <= 0) return fail(res, 400, 'Harga langganan harus lebih dari 0');
  const pick = parseInt(pickCount, 10);
  if (!pick || pick < 1) return fail(res, 400, 'Jumlah yang boleh dipilih minimal 1');
  if (!Array.isArray(choices) || choices.length < pick) return fail(res, 400, `Pilihan produk minimal ${pick} (sesuai jumlah yang boleh dipilih)`);
  for (const pid of choices) {
    const p = await db.prepare('SELECT id FROM inv_products WHERE id=? AND active=1').get(pid);
    if (!p) return fail(res, 400, `Produk tidak tersedia: ${pid}`);
  }
  const voucher = parseInt(checkinVoucherRp, 10);
  if (Number.isNaN(voucher) || voucher < 0 || voucher > 10000000) return fail(res, 400, 'Nilai voucher check-in tidak valid (0–10.000.000)');
  await db.prepare('UPDATE inv_vip_tiers SET priceRp=?, label=?, pickCount=?, choices=?, checkinVoucherRp=? WHERE tier=?')
    .run(price, String(label || row.label), pick, JSON.stringify([...new Set(choices)]), voucher, t);
  res.json({ ok: true });
}));

const EDITABLE_SETTINGS = ['telegramLink', 'bannerColor', 'bannerImageKey', 'qrisImageKey', 'checkinWindowDays', 'checkinVoucherValidDays', 'googleClientId'];
app.get('/api/admin/settings', requireAdmin, ah(async (req, res) => {
  const out = {};
  for (const k of EDITABLE_SETTINGS) out[k] = await getSetting(k, '');
  res.json({ ok: true, settings: out });
}));

app.post('/api/admin/settings', requireAdmin, ah(async (req, res) => {
  const { key, value } = req.body || {};
  if (!EDITABLE_SETTINGS.includes(key)) return fail(res, 400, 'Pengaturan tidak bisa diubah');
  if (key === 'bannerColor' && value && !/^#[0-9a-fA-F]{6}$/.test(String(value))) return fail(res, 400, 'Warna harus format hex, misal #16a34a');
  if ((key === 'checkinWindowDays' || key === 'checkinVoucherValidDays')) {
    const n = parseInt(value, 10);
    if (!n || n < 1 || n > 365) return fail(res, 400, 'Nilai harus 1–365 hari');
  }
  await setSetting(key, String(value ?? ''));
  res.json({ ok: true });
}));

// Upload gambar (base64 data URL via JSON — tanpa multipart).
// kind: banner | qris | event | product. key: untuk event/product (opsional —
// dibuat otomatis bila kosong); banner/qris memakai key tetap.
app.post('/api/admin/upload', requireAdmin, ah(async (req, res) => {
  const { kind, key, dataUrl } = req.body || {};
  if (!['banner', 'qris', 'event', 'product'].includes(kind)) return fail(res, 400, 'Jenis upload tidak valid');
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return fail(res, 400, 'Gambar harus PNG/JPG/WebP (data URL base64)');
  if (m[2].length > 4 * 1024 * 1024) return fail(res, 400, 'Gambar terlalu besar (maks. ~3 MB)');
  const mime = 'image/' + (m[1] === 'jpg' ? 'jpeg' : m[1]);
  let blobKey = key && /^[A-Za-z0-9._-]+$/.test(key) ? key : null;
  if (kind === 'banner') blobKey = 'banner';
  if (kind === 'qris') blobKey = 'qris';
  if (!blobKey) blobKey = `${kind}-${Date.now().toString(36)}`;
  await db.prepare('INSERT INTO inv_blobs(key,mime,data) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET mime=excluded.mime, data=excluded.data')
    .run(blobKey, mime, m[2]);
  if (kind === 'banner') await setSetting('bannerImageKey', blobKey);
  if (kind === 'qris') await setSetting('qrisImageKey', blobKey);
  res.json({ ok: true, key: blobKey, url: `/api/blob/${blobKey}` });
}));

app.get('/api/admin/events', requireAdmin, ah(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM inv_events ORDER BY id DESC').all();
  res.json({ ok: true, events: rows });
}));

app.post('/api/admin/events', requireAdmin, ah(async (req, res) => {
  const { id, title, text, imageKey, visible } = req.body || {};
  if (!title || !String(title).trim()) return fail(res, 400, 'Judul event wajib diisi');
  if (id) {
    const existing = await db.prepare('SELECT * FROM inv_events WHERE id=?').get(id);
    if (!existing) return fail(res, 404, 'Event tidak ditemukan');
    await db.prepare('UPDATE inv_events SET title=?, text=?, imageKey=?, visible=? WHERE id=?')
      .run(String(title).trim(), String(text || ''), imageKey || null, visible ? 1 : 0, id);
    return res.json({ ok: true, id });
  }
  const r = await db.prepare('INSERT INTO inv_events(title,text,imageKey,visible,createdAt) VALUES(?,?,?,?,?)')
    .run(String(title).trim(), String(text || ''), imageKey || null, visible === false ? 0 : 1, nowIso());
  res.json({ ok: true, id: r.lastInsertRowid });
}));

app.post('/api/admin/events/:id/visible', requireAdmin, ah(async (req, res) => {
  const { visible } = req.body || {};
  const row = await db.prepare('SELECT * FROM inv_events WHERE id=?').get(req.params.id);
  if (!row) return fail(res, 404, 'Event tidak ditemukan');
  await db.prepare('UPDATE inv_events SET visible=? WHERE id=?').run(visible ? 1 : 0, row.id);
  res.json({ ok: true });
}));

app.get('/api/admin/chat', requireAdmin, ah(async (req, res) => {
  const rows = await db.prepare(
    'SELECT c.*, u.name AS userName FROM inv_chat c JOIN inv_users u ON u.id=c.userId ORDER BY c.id DESC LIMIT 300'
  ).all();
  res.json({ ok: true, messages: rows.reverse() });
}));

app.post('/api/admin/chat', requireAdmin, ah(async (req, res) => {
  const { userId, message } = req.body || {};
  if (!userId) return fail(res, 400, 'userId wajib diisi');
  if (!message || !String(message).trim()) return fail(res, 400, 'Pesan kosong');
  const u = await db.prepare('SELECT id FROM inv_users WHERE id=?').get(userId);
  if (!u) return fail(res, 404, 'Pengguna tidak ditemukan');
  const r = await db.prepare('INSERT INTO inv_chat(userId,sender,message,createdAt) VALUES(?,?,?,?)')
    .run(userId, 'owner', String(message).trim(), nowIso());
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// ---------------------------------------------------------------------------
// 404 + error handler + start
// ---------------------------------------------------------------------------
app.use((req, res) => res.status(404).json({ ok: false, error: 'Endpoint tidak ditemukan' }));
app.use((e, req, res, next) => {
  console.error('[error]', e && e.stack ? e.stack : e);
  if (res.headersSent) return next(e);
  res.status(500).json({ ok: false, error: 'Kesalahan server' });
});

(async () => {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Investorasi backend jalan di port ${PORT}`);
  });
})();

module.exports = app;
