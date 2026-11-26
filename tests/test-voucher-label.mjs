// test-voucher-label.mjs — Voucher kepake di checkout produk + langganan VIP,
// harga langsung kepotong (pratinjau), dan pemakaian voucher kelihatan
// di daftar pesanan (web member + panel admin).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, api, register, adminLogin, makePaidVipOrder } from './helpers.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminJs = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');

test('label: panel admin + web member menampilkan pemakaian voucher', () => {
  assert.ok(adminJs.includes('Pakai voucher'), 'admin.js belum menampilkan label voucher');
  assert.ok(adminJs.includes('discountRp'), 'admin.js belum memakai discountRp');
  assert.ok(appJs.includes('Pakai voucher'), 'app.js belum menampilkan label voucher');
  assert.ok(appJs.includes('coDiscountLine'), 'app.js belum ada pratinjau diskon voucher');
  assert.ok(appJs.includes("e.target.id !== 'coVoucher'"), 'app.js belum ada handler pilih voucher');
  assert.ok(appJs.includes('voucherSelectHtml()'), 'form VIP belum ada pilihan voucher');
});

test('voucher: kepake di langganan VIP, total kepotong, tidak bisa 2x, kelihatan di admin', async () => {
  const s = await startServer();
  try {
    const admin = await adminLogin(s.base);
    const m = await register(s.base, 'Member V', 'mvl@test.id');
    await makePaidVipOrder(s.base, m.token, admin, 1, ['p01']);
    const claim = await api(s.base, 'POST', '/api/checkin/claim', { token: m.token });
    const voucherId = claim.json.voucher.id;
    const checkout = { name: 'Member V', address: 'Jl. Tes 1', phone: '0811', email: 'mvl@test.id' };

    // Langganan VIP 1 (150.000) pakai voucher 5.000 -> total 145.000
    let r = await api(s.base, 'POST', '/api/orders/vip', {
      token: m.token,
      body: { tier: 1, productIds: ['p02'], voucherId, ...checkout },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.order.totalRp, 145000);
    assert.equal(r.json.order.discountRp, 5000);
    assert.equal(r.json.order.voucherId, voucherId);

    // Voucher sudah 'used' -> pakai lagi ditolak
    r = await api(s.base, 'POST', '/api/orders/vip', {
      token: m.token,
      body: { tier: 1, productIds: ['p03'], voucherId, ...checkout },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /tidak aktif|tidak ditemukan/);

    // Daftar pesanan member + admin sama-sama membawa discountRp
    const mine = await api(s.base, 'GET', '/api/orders', { token: m.token });
    const used = mine.json.orders.find((o) => o.voucherId === voucherId);
    assert.ok(used && used.discountRp === 5000);
    const adm = await api(s.base, 'GET', '/api/admin/orders', { adminToken: admin });
    const usedAdm = adm.json.orders.find((o) => o.voucherId === voucherId);
    assert.ok(usedAdm && usedAdm.discountRp === 5000);
  } finally {
    await s.stop();
  }
});
