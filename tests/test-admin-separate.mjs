// tests/test-admin-separate.mjs — Panel Pemilik terpisah dari toko.
// (a) Toko (index.html + app.js) TIDAK punya jalan masuk ke admin sama sekali.
// (b) /admin.html termuat (200) dan berisi gate PIN.
// (c) Login admin + endpoint admin jalan dengan PIN seed di server lokal.
// (d) supabase-schema.sql: urutan CREATE TABLE topologis — semua REFERENCES
//     menunjuk ke tabel yang sudah dibuat lebih dulu (tidak ada FK sirkular
//     saat bootstrap database baru).
//
// Nilai PIN seed TIDAK ditulis di file ini: dibaca dari db.js (fungsi seed)
// saat tes jalan, hanya untuk memeriksa bahwa nilainya tidak bocor ke file
// publik mana pun.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, api, adminLogin } from './helpers.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function seedPinFromDbJs() {
  const src = read('db.js');
  const m = src.match(/hashSecret\('(\d{4,8})'\)/);
  assert.ok(m, 'PIN seed tidak ditemukan di db.js');
  return m[1];
}

test('toko: tidak ada jalan masuk ke admin (index.html + app.js)', () => {
  const html = read('public/index.html');
  const js = read('public/app.js');
  for (const [name, src] of [['index.html', html], ['app.js', js]]) {
    assert.ok(!/admin/i.test(src), `${name} masih mengandung kata "admin"`);
    assert.ok(!src.includes('Panel Pemilik'), `${name} masih mengandung "Panel Pemilik"`);
    assert.ok(!src.includes('#admin'), `${name} masih mengandung route #admin`);
    assert.ok(!src.includes('/api/admin/'), `${name} masih memanggil /api/admin/`);
  }
  // Tidak ada lagi tombol/link panel di tab Saya.
  assert.ok(!html.includes('btnAdminOpen'), 'index.html masih punya btnAdminOpen');
  assert.ok(!html.includes('view-admin'), 'index.html masih punya view-admin');
});

test('file publik: nilai PIN seed tidak bocor ke file mana pun', () => {
  const pin = seedPinFromDbJs();
  for (const f of ['public/index.html', 'public/app.js', 'public/admin.html', 'public/admin.js', 'README.md', 'API.md', 'supabase-schema.sql']) {
    assert.ok(!read(f).includes(pin), `${f} masih mengandung nilai PIN seed`);
  }
  // admin.html juga tidak boleh menyebut PIN bawaan dengan angka apa pun.
  const adminHtml = read('public/admin.html');
  assert.ok(!/PIN bawaan[^<]*\d{4,8}/i.test(adminHtml), 'admin.html menyebut PIN bawaan berangka');
});

test('skema Postgres: urutan tabel topologis, tanpa FK sirkular', () => {
  const sql = read('supabase-schema.sql');
  const order = [];
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(/g)) order.push(m[1]);
  assert.ok(order.length >= 14, 'jumlah tabel tidak wajar: ' + order.length);
  const created = new Set();
  const problems = [];
  // Periksa tiap REFERENCES inline: target harus sudah dibuat sebelumnya.
  const blocks = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\);\n/sg)];
  for (const [, table, body] of blocks) {
    for (const ref of body.matchAll(/REFERENCES (\w+)\s*\(/g)) {
      const target = ref[1];
      if (target !== table && !created.has(target)) problems.push(`${table} -> ${target} (belum dibuat)`);
    }
    created.add(table);
  }
  assert.deepEqual(problems, [], 'REFERENCES ke tabel yang belum dibuat: ' + problems.join(', '));
  // usedOrderId di inv_vouchers harus bigint polos (FK ditambah di DO block akhir).
  const vouchers = blocks.find((b) => b[1] === 'inv_vouchers');
  assert.ok(vouchers, 'blok inv_vouchers tidak ditemukan');
  assert.ok(!/usedOrderId bigint REFERENCES/i.test(vouchers[2]), 'usedOrderId masih punya REFERENCES inline');
  assert.ok(/usedOrderId bigint/.test(vouchers[2]), 'kolom usedOrderId hilang');
  assert.ok(order.indexOf('inv_vouchers') < order.indexOf('inv_orders'), 'inv_vouchers harus dibuat SEBELUM inv_orders');
  assert.ok(order.indexOf('inv_vouchers') < order.indexOf('inv_checkins'), 'inv_vouchers harus dibuat SEBELUM inv_checkins');
  // DO block penambah FK ada di akhir file dan idempotent.
  assert.ok(sql.includes("ADD CONSTRAINT inv_vouchers_usedorderid_fkey FOREIGN KEY (usedOrderId) REFERENCES inv_orders(id)"),
    'DO block FK usedOrderId tidak ditemukan');
  assert.ok(sql.includes('pg_constraint'), 'DO block harus memeriksa pg_constraint (idempotent)');
});

test('server: /admin.html termuat + gate PIN ada, toko tetap jalan', async () => {
  const s = await startServer();
  try {
    const admin = await fetch(s.base + '/admin.html');
    assert.equal(admin.status, 200);
    const adminHtml = await admin.text();
    assert.ok(adminHtml.includes('adminPinForm'), '/admin.html tidak berisi form PIN');
    assert.ok(adminHtml.includes('Panel Pemilik'), '/admin.html tidak berisi judul Panel Pemilik');
    assert.ok(adminHtml.includes('/admin.js'), '/admin.html tidak memuat admin.js');
    const adminJs = await fetch(s.base + '/admin.js');
    assert.equal(adminJs.status, 200);
    const home = await fetch(s.base + '/');
    assert.equal(home.status, 200);
    const homeHtml = await home.text();
    assert.ok(!/admin/i.test(homeHtml), 'halaman toko yang disajikan masih mengandung "admin"');
    assert.ok(!homeHtml.includes('Panel Pemilik'), 'halaman toko masih mengandung "Panel Pemilik"');
  } finally { await s.stop(); }
});

test('server: login admin + endpoint admin jalan; PIN salah ditolak', async () => {
  const s = await startServer();
  try {
    const token = await adminLogin(s.base);
    assert.ok(token.startsWith('admin.'), 'token admin tidak valid');
    const ov = await api(s.base, 'GET', '/api/admin/overview', { adminToken: token });
    assert.equal(ov.status, 200);
    assert.ok(ov.json.ok);
    assert.equal(typeof ov.json.users, 'number');
    const bad = await api(s.base, 'POST', '/api/admin/login', { body: { pin: '000000' } });
    assert.equal(bad.status, 401);
    const noAuth = await api(s.base, 'GET', '/api/admin/overview');
    assert.equal(noAuth.status, 401);
  } finally { await s.stop(); }
});
