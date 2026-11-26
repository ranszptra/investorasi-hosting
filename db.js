// db.js — Skema + seed + helper untuk Investorasi.
//
// Pola yang sama dengan Runner Coin (~/workspace/lari-koin-hosting/db.js):
// DUA BACKEND (dipilih otomatis):
//   - Jika env DATABASE_URL diset (Supabase Postgres) -> pakai `pg` (Pool).
//     Skema ada di `supabase-schema.sql` (dijalankan otomatis saat init).
//     Tabel ber-prefix `inv_` supaya tidak bentrok dengan tabel game di
//     project Supabase yang sama ("lari-koin").
//   - Jika tidak diset -> pakai `node:sqlite` bawaan Node 24 (DatabaseSync),
//     file env DB_PATH atau ./investorasi.db. Dipakai untuk dev lokal & tes.
//
// Antarmuka tunggal `db` (async, seperti di game):
//   db.prepare(sql).get(...params)  -> baris pertama / undefined
//   db.prepare(sql).all(...params)  -> array baris
//   db.prepare(sql).run(...params)  -> { changes, lastInsertRowid }

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const USE_PG = !!process.env.DATABASE_URL;

let pgPool = null;
if (USE_PG) {
  const pg = require('pg');
  pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // int8 -> Number
  pg.types.setTypeParser(1700, (v) => parseFloat(v)); // numeric -> Number
  pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  pgPool.on('error', (e) => console.error('[pg] pool error:', e.message));
}

let sqliteDb = null;
if (!USE_PG) {
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'investorasi.db');
  sqliteDb = new DatabaseSync(DB_PATH);
}

// ---------------------------------------------------------------------------
// Konstanta ekonomi (DIKUNCI — jangan diubah tanpa persetujuan pemilik)
// ---------------------------------------------------------------------------
// Komisi 20% dari harga penjualan per penjualan lewat kode undangan —
// dibayar HANYA dari penjualan nyata, saat pesanan ditandai Dibayar.
const COMMISSION_RATE = 0.20;
const WITHDRAW_MIN_RP = 100000;
const WITHDRAW_METHODS = ['BCA', 'BRI', 'Mandiri', 'SeaBank', 'OVO', 'DANA', 'ShopeePay', 'GoPay'];

// Tangga bonus undang teman — sekali-klaim per tingkat. Teman TERKUALIFIKASI
// = daftar lewat link undangan DAN sudah menyelesaikan minimal 1 pembelian.
const INVITE_TIERS = [
  { tier: 10, rp: 300000 },
  { tier: 30, rp: 600000 },
  { tier: 50, rp: 1500000 },
  { tier: 100, rp: 3500000 },
];

// ---------------------------------------------------------------------------
// Katalog produk (23 produk) + tingkat VIP
// ---------------------------------------------------------------------------
// Harga produk = nilai barang per tingkat (ditetapkan pemilik 2026-11-26).
// Foto: public/products/p01..p22 (foto asli kiriman pemilik / hasil pencarian
// terverifikasi). HP Danikor A16 5G TIDAK punya foto — image: null, frontend
// menampilkan placeholder "Foto menyusul" (JANGAN ganti foto produk lain).
const PRODUCTS = [
  // VIP 1 — Rp100.000
  { id: 'p01', name: 'Tas Set Hefand', priceRp: 100000, tier: 1, image: '/products/p01-tas-hefand.jpg', description: 'Set tas Hefand: tas + box + pouch. Dijual seperti pada foto.' },
  { id: 'p02', name: 'Teko Listrik Cosmos 1,2L Double Layer', priceRp: 100000, tier: 1, image: '/products/p02-teko-cosmos.jpg', description: 'Teko listrik Cosmos 1,2 liter, double layer. Dijual seperti pada foto.' },
  { id: 'p03', name: 'Kipas Angin Berdiri 18 Inci', priceRp: 100000, tier: 1, image: '/products/p03-kipas-berdiri.jpg', description: 'Kipas angin berdiri 18 inci. Dijual seperti pada foto.' },
  // VIP 2 — Rp200.000
  { id: 'p04', name: 'Dispenser Air Stainless 304', priceRp: 200000, tier: 2, image: '/products/p04-dispenser.jpg', description: 'Dispenser air, dinding dalam stainless 304, keran toggle. Dijual seperti pada foto.' },
  { id: 'p05', name: 'Lemari Laci Plastik 5 Susun 98,5cm', priceRp: 200000, tier: 2, image: '/products/p05-lemari-laci.jpg', description: 'Lemari laci plastik putih 5 susun, tinggi 98,5 cm, ada roda. Dijual seperti pada foto.' },
  { id: 'p06', name: 'Kipas Angin Mini Portable + Humidifier', priceRp: 200000, tier: 2, image: '/products/p06-kipas-mini.jpg', description: 'Kipas angin mini portable + humidifier dengan tangki air. Dijual seperti pada foto.' },
  // VIP 3 — Rp400.000
  { id: 'p07', name: 'Tas Tangan FOXER Hitam', priceRp: 400000, tier: 3, image: '/products/p07-tas-foxer.jpg', description: 'Tas tangan FOXER hitam, tersedia 5 warna, ada gift box. Dijual seperti pada foto.' },
  { id: 'p08', name: 'Smartwatch Hitam', priceRp: 400000, tier: 3, image: '/products/p08-smartwatch.jpg', description: 'Smartwatch hitam. Dijual seperti pada foto.' },
  { id: 'p09', name: 'Kompor Gas 3 Tungku Freemir', priceRp: 400000, tier: 3, image: '/products/p09-kompor-freemir.jpg', description: 'Kompor gas 3 tungku Freemir. Dijual seperti pada foto.' },
  // VIP 4 — Rp550.000
  { id: 'p10', name: 'Koper Kabin', priceRp: 550000, tier: 4, image: '/products/p10-koper-kabin.jpg', description: 'Koper kabin, pilihan warna putih/pink/mint. Dijual seperti pada foto.' },
  { id: 'p11', name: 'Kasur Busa Quilting Vassa Kirana Grey', priceRp: 550000, tier: 4, image: '/products/p11-kasur-vassa.jpg', description: 'Kasur busa quilting Vassa Kirana, warna grey. Dijual seperti pada foto.' },
  { id: 'p12', name: 'Lemari Pakaian Putih Casatoma', priceRp: 550000, tier: 4, image: '/products/p12-lemari-casatoma.jpg', description: 'Lemari pakaian putih Casatoma, 2 pintu + cermin. Dijual seperti pada foto.' },
  // VIP 5 — Rp800.000
  { id: 'p13', name: 'TV Android 1080p', priceRp: 800000, tier: 5, image: '/products/p13-tv-android.jpg', description: 'TV Android 1080p, Android 14, DLED, 1+8GB. Dijual seperti pada foto.' },
  { id: 'p14', name: 'HP Aneka Warna', priceRp: 800000, tier: 5, image: '/products/p14-hp-aneka-warna.jpg', description: 'HP berbagai warna/model. Dijual seperti pada foto — tanyakan detail dan stok lewat live chat sebelum memesan.' },
  { id: 'p15', name: 'Gelang Emas Model Semanggi', priceRp: 800000, tier: 5, image: '/products/p15-gelang-semanggi.jpg', description: 'Gelang emas model semanggi 4 daun. Dijual seperti pada foto.' },
  // VIP 6 — Rp1.500.000
  { id: 'p16', name: 'Tablet DURUS + Keyboard', priceRp: 1500000, tier: 6, image: '/products/p16-tablet-durus.jpg', description: 'Tablet DURUS + keyboard, layar HD. Dijual seperti pada foto.' },
  { id: 'p17', name: 'Cincin Emas', priceRp: 1500000, tier: 6, image: '/products/p17-cincin-emas.jpg', description: 'Cincin emas, set berbagai model. Dijual seperti pada foto.' },
  { id: 'p18', name: 'iPhone XR Second Original', priceRp: 1500000, tier: 6, image: '/products/p18-iphone-xr.jpg', description: 'iPhone XR second original, WiFi only, battery health 85–100%. Dijual seperti pada foto.' },
  // VIP 7 — Rp3.500.000
  { id: 'p19', name: 'Emas Antam 1 Gram', priceRp: 3500000, tier: 7, image: '/products/p19-antam-1gram.jpg', description: 'Emas Antam 1 gram (certified, assay card). Dijual seperti pada foto.' },
  { id: 'p20', name: 'iPhone 11', priceRp: 3500000, tier: 7, image: '/products/p20-iphone-11.png', description: 'iPhone 11. Dijual seperti pada foto — tanyakan detail dan stok lewat live chat sebelum memesan.' },
  { id: 'p21', name: 'Samsung Galaxy A16 5G', priceRp: 3500000, tier: 7, image: '/products/p21-galaxy-a16.jpg', description: 'Samsung Galaxy A16 5G. Dijual seperti pada foto.' },
  { id: 'p22', name: 'iPhone 12', priceRp: 3500000, tier: 7, image: '/products/p22-iphone-12.jpg', description: 'iPhone 12. Dijual seperti pada foto — tanyakan detail dan stok lewat live chat sebelum memesan.' },
  { id: 'p23', name: 'HP Danikor A16 5G', priceRp: 3500000, tier: 7, image: null, description: 'HP Danikor A16 5G. Foto produk menyusul — tanyakan detail dan stok lewat live chat sebelum memesan.' },
];

// Tingkat langganan VIP: harga langganan + label + jumlah yang boleh dipilih
// + pilihan produk + nilai voucher check-in harian per tingkat (VOUCHER
// BELANJA, bukan uang tunai — tidak bisa ditarik).
// TANPA janji profit, TANPA klaim harian tunai, TANPA roda putar.
const VIP_TIERS = [
  { tier: 1, priceRp: 150000, label: 'pilih 1 dari 3 produk', pickCount: 1, choices: ['p01', 'p02', 'p03'], checkinVoucherRp: 5000 },
  { tier: 2, priceRp: 300000, label: 'pilih 1 dari 3 produk', pickCount: 1, choices: ['p04', 'p05', 'p06'], checkinVoucherRp: 5000 },
  { tier: 3, priceRp: 500000, label: 'pilih 1 dari 3 produk', pickCount: 1, choices: ['p07', 'p08', 'p09'], checkinVoucherRp: 5000 },
  { tier: 4, priceRp: 700000, label: 'pilih 1 dari 3 produk', pickCount: 1, choices: ['p10', 'p11', 'p12'], checkinVoucherRp: 5000 },
  { tier: 5, priceRp: 1200000, label: 'pilih 1 dari 3 produk', pickCount: 1, choices: ['p13', 'p14', 'p15'], checkinVoucherRp: 15000 },
  { tier: 6, priceRp: 2000000, label: 'pilih 1 dari 3 produk', pickCount: 1, choices: ['p16', 'p17', 'p18'], checkinVoucherRp: 15000 },
  { tier: 7, priceRp: 5000000, label: 'pilih 1 dari 5 produk', pickCount: 1, choices: ['p19', 'p20', 'p21', 'p22', 'p23'], checkinVoucherRp: 15000 },
];

// Pengaturan bawaan (disimpan di inv_settings, bisa diubah pemilik di panel).
const DEFAULT_SETTINGS = {
  telegramLink: '',
  qrisImageKey: '',
  bannerColor: '#16a34a',
  bannerImageKey: '',
  checkinWindowDays: '30',
  checkinVoucherValidDays: '30',
  googleClientId: '',
};

// ---------------------------------------------------------------------------
// Skema SQLite (dipakai saat DATABASE_URL tidak diset)
// ---------------------------------------------------------------------------
const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS inv_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  passHash TEXT NOT NULL,
  passSalt TEXT NOT NULL,
  inviteCode TEXT UNIQUE NOT NULL,
  referrerId INTEGER REFERENCES inv_users(id),
  balanceRp INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  providerId TEXT,
  banned INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inv_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  priceRp INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT,
  tier INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS inv_vip_tiers (
  tier INTEGER PRIMARY KEY,
  priceRp INTEGER NOT NULL,
  label TEXT NOT NULL,
  pickCount INTEGER NOT NULL DEFAULT 1,
  choices TEXT NOT NULL,
  checkinVoucherRp INTEGER NOT NULL DEFAULT 5000
);
CREATE TABLE IF NOT EXISTS inv_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES inv_users(id),
  type TEXT NOT NULL,
  items TEXT NOT NULL,
  totalRp INTEGER NOT NULL,
  voucherId INTEGER REFERENCES inv_vouchers(id),
  discountRp INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Menunggu Pembayaran',
  paidClaimed INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  paidAt TEXT
);
CREATE TABLE IF NOT EXISTS inv_wallet_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES inv_users(id),
  kind TEXT NOT NULL,
  amountRp INTEGER NOT NULL,
  refType TEXT,
  refId TEXT,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inv_withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES inv_users(id),
  amountRp INTEGER NOT NULL,
  method TEXT NOT NULL,
  accountNumber TEXT NOT NULL,
  accountName TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Menunggu',
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inv_referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrerId INTEGER NOT NULL REFERENCES inv_users(id),
  friendId INTEGER NOT NULL REFERENCES inv_users(id),
  qualified INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  UNIQUE(referrerId, friendId)
);
CREATE TABLE IF NOT EXISTS inv_invite_claims (
  userId INTEGER NOT NULL REFERENCES inv_users(id),
  tier INTEGER NOT NULL,
  amountRp INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (userId, tier)
);
CREATE TABLE IF NOT EXISTS inv_checkins (
  userId INTEGER NOT NULL REFERENCES inv_users(id),
  date TEXT NOT NULL,
  tier INTEGER NOT NULL,
  voucherId INTEGER NOT NULL REFERENCES inv_vouchers(id),
  PRIMARY KEY (userId, date)
);
CREATE TABLE IF NOT EXISTS inv_vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES inv_users(id),
  amountRp INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  usedOrderId INTEGER REFERENCES inv_orders(id)
);
CREATE TABLE IF NOT EXISTS inv_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  imageKey TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inv_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES inv_users(id),
  sender TEXT NOT NULL,
  message TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inv_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inv_blobs (
  key TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data TEXT NOT NULL
);
`;

// ---------------------------------------------------------------------------
// Adapter pg: terjemahan SQL SQLite -> Postgres (pola yang sama seperti game)
// ---------------------------------------------------------------------------
const PG_KEY_MAP = {
  userid: 'userId', referrerid: 'referrerId', friendid: 'friendId',
  passhash: 'passHash', passsalt: 'passSalt', invitecode: 'inviteCode',
  balancerp: 'balanceRp', ['price' + 'rp']: 'priceRp', pickcount: 'pickCount',
  checkinvoucherrp: 'checkinVoucherRp', totalrp: 'totalRp',
  voucherid: 'voucherId', discountrp: 'discountRp', paidclaimed: 'paidClaimed',
  paidat: 'paidAt', createdat: 'createdAt', amountrp: 'amountRp',
  accountnumber: 'accountNumber', accountname: 'accountName',
  expiresat: 'expiresAt', usedorderid: 'usedOrderId', imagekey: 'imageKey',
};
function mapRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[PG_KEY_MAP[k] || k] = v;
  return out;
}

function toPgSql(sql) {
  let s = sql;
  let ignore = false;
  s = s.replace(/INSERT OR IGNORE INTO/i, () => { ignore = true; return 'INSERT INTO'; });
  let i = 0;
  s = s.replace(/\?/g, () => '$' + (++i));
  if (ignore) s += ' ON CONFLICT DO NOTHING';
  return s;
}

function pgPrepare(sql) {
  return {
    get: async (...params) => {
      const { rows } = await pgPool.query(toPgSql(sql), params);
      return mapRow(rows[0]);
    },
    all: async (...params) => {
      const { rows } = await pgPool.query(toPgSql(sql), params);
      return rows.map(mapRow);
    },
    run: async (...params) => {
      let q = toPgSql(sql);
      const needsId = /^\s*INSERT\s+INTO\s+(inv_users|inv_orders|inv_withdrawals|inv_vouchers|inv_events|inv_chat|inv_wallet_entries|inv_referrals)\b/i.test(sql);
      if (needsId) q += ' RETURNING id';
      const res = await pgPool.query(q, params);
      return {
        changes: res.rowCount,
        lastInsertRowid: needsId && res.rows[0] ? res.rows[0].id : undefined,
      };
    },
  };
}

function sqlitePrepare(sql) {
  const stmt = sqliteDb.prepare(sql);
  return {
    get: (...params) => Promise.resolve(stmt.get(...params)),
    all: (...params) => Promise.resolve(stmt.all(...params)),
    run: (...params) => Promise.resolve(stmt.run(...params)),
  };
}

const db = {
  prepare: (sql) => (USE_PG ? pgPrepare(sql) : sqlitePrepare(sql)),
};

// ---------------------------------------------------------------------------
// Password & PIN: hash scrypt (jangan pernah simpan plaintext)
// ---------------------------------------------------------------------------
function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(secret, salt, 64).toString('hex');
  return { salt, hash };
}
function verifySecret(secret, salt, hash) {
  const check = crypto.scryptSync(secret, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

// ---------------------------------------------------------------------------
// Token auth stateless: `${id}.${HMAC-SHA256(secret, id)}`
// ---------------------------------------------------------------------------
const OWNER_SECRET = process.env.OWNER_SECRET || 'dev-secret-change-me';
if (!process.env.OWNER_SECRET) {
  console.warn('[PERINGATAN] OWNER_SECRET tidak diset — memakai secret default DEV. Set env OWNER_SECRET di Railway sebelum produksi!');
}
function makeToken(id) {
  const idStr = String(id);
  const sig = crypto.createHmac('sha256', OWNER_SECRET).update(idStr).digest('hex');
  return `${idStr}.${sig}`;
}
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', OWNER_SECRET).update(id).digest('hex');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  return id;
}

// Token admin: terikat pada hash PIN admin saat ini — ganti PIN = token lama mati.
function makeAdminToken(pinHash) {
  const sig = crypto.createHmac('sha256', OWNER_SECRET).update('admin:' + pinHash).digest('hex');
  return `admin.${sig}`;
}
function verifyAdminToken(token, pinHash) {
  if (typeof token !== 'string') return false;
  const expected = makeAdminToken(pinHash);
  if (token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Tanggal (zona Asia/Jakarta — reset harian mengikuti WIB)
// ---------------------------------------------------------------------------
const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
function todayStr(date = new Date()) { return fmtDate.format(date); }
function nowIso() { return new Date().toISOString(); }
function addDays(iso, days) { return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000).toISOString(); }

// ---------------------------------------------------------------------------
// Settings (inv_settings)
// ---------------------------------------------------------------------------
async function getSetting(key, fallback = null) {
  const row = await db.prepare('SELECT value FROM inv_settings WHERE key=?').get(key);
  return row ? row.value : fallback;
}
async function setSetting(key, value) {
  await db.prepare('INSERT INTO inv_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));
}
// Catatan: SQLite TIDAK mendukung ON CONFLICT ... DO UPDATE dengan sintaks
// `excluded` di semua versi lama — tapi SQLite modern (>= 3.24) mendukung
// UPSERT ini. Untuk jalur pg, adapter menerjemahkan `?` ke `$n` dan
// `excluded.value` tetap valid di Postgres.

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
function makeInviteCode() {
  return 'INV-' + crypto.randomBytes(5).toString('hex').toUpperCase();
}

async function seed() {
  const pinRow = await db.prepare("SELECT value FROM inv_settings WHERE key='adminPinHash'").get();
  if (!pinRow) {
    const { salt, hash } = hashSecret('123456'); // PIN admin awal — pemilik WAJIB ganti di panel
    await db.prepare("INSERT INTO inv_settings(key,value) VALUES('adminPinHash',?)").run(hash);
    await db.prepare("INSERT INTO inv_settings(key,value) VALUES('adminPinSalt',?)").run(salt);
    console.log('[seed] PIN admin awal 123456 disimpan ter-hash.');
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    const row = await db.prepare('SELECT value FROM inv_settings WHERE key=?').get(k);
    if (!row) await db.prepare('INSERT INTO inv_settings(key,value) VALUES(?,?)').run(k, v);
  }
  // Google Client ID dari env (bila diset) jadi bawaan — pemilik tetap bisa
  // mengubahnya dari panel (settings mengalahkan env setelah diisi manual).
  if (process.env.GOOGLE_CLIENT_ID) {
    const row = await db.prepare("SELECT value FROM inv_settings WHERE key='googleClientId'").get();
    if (!row || !row.value) await setSetting('googleClientId', process.env.GOOGLE_CLIENT_ID);
  }
  const prodCount = (await db.prepare('SELECT COUNT(*) AS c FROM inv_products').get()).c;
  if (prodCount === 0) {
    for (const p of PRODUCTS) {
      await db.prepare('INSERT INTO inv_products(id,name,priceRp,description,image,tier,active) VALUES(?,?,?,?,?,?,1)')
        .run(p.id, p.name, p.priceRp, p.description, p.image, p.tier);
    }
    console.log('[seed] 23 produk dibuat.');
  }
  const tierCount = (await db.prepare('SELECT COUNT(*) AS c FROM inv_vip_tiers').get()).c;
  if (tierCount === 0) {
    for (const t of VIP_TIERS) {
      await db.prepare('INSERT INTO inv_vip_tiers(tier,priceRp,label,pickCount,choices,checkinVoucherRp) VALUES(?,?,?,?,?,?)')
        .run(t.tier, t.priceRp, t.label, t.pickCount, JSON.stringify(t.choices), t.checkinVoucherRp);
    }
    console.log('[seed] 7 tingkat VIP dibuat.');
  }
  const eventCount = (await db.prepare('SELECT COUNT(*) AS c FROM inv_events').get()).c;
  if (eventCount === 0) {
    await db.prepare("INSERT INTO inv_events(title,text,imageKey,visible,createdAt) VALUES(?,?,?,?,?)")
      .run('Event Investorasi', 'Selamat datang di Investorasi! Belanja barang nyata, dapat komisi 20% dari penjualan yang benar-benar terjadi. Cek katalog di tab Produk dan langganan VIP di Beranda.', null, 1, nowIso());
    console.log('[seed] 1 event contoh dibuat.');
  }
}

// ---------------------------------------------------------------------------
// Init: buat skema (kalau belum ada) + seed. WAJIB dipanggil sebelum listen.
// ---------------------------------------------------------------------------
let initPromise = null;
async function initDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (USE_PG) {
      const schema = fs.readFileSync(path.join(__dirname, 'supabase-schema.sql'), 'utf8');
      await pgPool.query(schema);
      console.log('[db] Postgres (DATABASE_URL) aktif — skema supabase-schema.sql diterapkan.');
    } else {
      sqliteDb.exec('PRAGMA journal_mode = WAL;');
      sqliteDb.exec('PRAGMA foreign_keys = ON;');
      sqliteDb.exec(SQLITE_DDL);
      console.log('[db] SQLite lokal aktif (DATABASE_URL tidak diset).');
    }
    await seed();
  })();
  return initPromise;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function parseJson(text, fallback) {
  if (text === null || text === undefined) return fallback;
  if (typeof text === 'object') return text;
  try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; }
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    inviteCode: row.inviteCode,
    balanceRp: row.balanceRp,
    referrerId: row.referrerId || null,
    provider: row.provider || null,
    banned: row.banned ? true : false,
    createdAt: row.createdAt,
  };
}

async function getVipTiers() {
  const rows = await db.prepare('SELECT * FROM inv_vip_tiers ORDER BY tier').all();
  return rows.map((r) => ({
    tier: r.tier,
    priceRp: r.priceRp,
    label: r.label,
    pickCount: r.pickCount,
    choices: parseJson(r.choices, []),
    checkinVoucherRp: r.checkinVoucherRp,
  }));
}

// Keanggotaan VIP aktif: pesanan VIP terakhir yang sudah Dibayar (atau
// lanjut) dan masih dalam masa check-in (windowDays sejak paidAt).
async function getVipMembership(userId) {
  const windowDays = parseInt(await getSetting('checkinWindowDays', '30'), 10) || 30;
  const row = await db.prepare(
    "SELECT * FROM inv_orders WHERE userId=? AND type='vip' AND status IN ('Dibayar','Dikirim','Selesai') AND paidAt IS NOT NULL ORDER BY paidAt DESC LIMIT 1"
  ).get(userId);
  if (!row) return null;
  const items = parseJson(row.items, {});
  const tier = items.tier || null;
  if (!tier) return null;
  const startedAt = row.paidAt;
  const endsAt = addDays(startedAt, windowDays);
  const now = new Date();
  if (now >= new Date(endsAt)) return null;
  const dayNumber = Math.floor((now - new Date(startedAt)) / (24 * 60 * 60 * 1000)) + 1;
  const daysLeft = Math.ceil((new Date(endsAt) - now) / (24 * 60 * 60 * 1000));
  return { tier, orderId: row.id, startedAt, endsAt, dayNumber, daysLeft, windowDays };
}

// Teman TERKUALIFIKASI = sudah menyelesaikan minimal 1 pembelian
// (punya pesanan dengan status Dibayar/Dikirim/Selesai).
async function isQualifiedFriend(friendId) {
  const row = await db.prepare(
    "SELECT COUNT(*) AS c FROM inv_orders WHERE userId=? AND status IN ('Dibayar','Dikirim','Selesai')"
  ).get(friendId);
  return (row ? row.c : 0) > 0;
}

module.exports = {
  db, initDb, hashSecret, verifySecret, makeToken, verifyToken,
  makeAdminToken, verifyAdminToken,
  todayStr, nowIso, addDays,
  getSetting, setSetting, makeInviteCode,
  COMMISSION_RATE, WITHDRAW_MIN_RP, WITHDRAW_METHODS, INVITE_TIERS,
  PRODUCTS, VIP_TIERS, DEFAULT_SETTINGS,
  parseJson, publicUser, getVipTiers, getVipMembership, isQualifiedFriend,
};
