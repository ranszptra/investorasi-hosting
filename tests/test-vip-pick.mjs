// test-vip-pick.mjs — Validasi jumlah pilihan produk langganan VIP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, register } from './helpers.mjs';

test('VIP pick-count: jumlah salah / produk luar tingkat ditolak, yang benar diterima', async () => {
  const s = await startServer();
  try {
    const u = await register(s.base, 'Vip Tester', 'vip@test.id');
    const t = u.token;
    const checkout = { name: 'Vip Tester', address: 'Jl. Tes 1', phone: '0811', email: 'vip@test.id' };

    // 0 produk -> tolak
    let r = await api(s.base, 'POST', '/api/orders/vip', { token: t, body: { tier: 1, productIds: [], ...checkout } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Pilih tepat 1/);

    // 2 produk padahal pickCount=1 -> tolak
    r = await api(s.base, 'POST', '/api/orders/vip', { token: t, body: { tier: 1, productIds: ['p01', 'p02'], ...checkout } });
    assert.equal(r.status, 400);

    // Produk dari tingkat lain (p04 = VIP 2) untuk VIP 1 -> tolak
    r = await api(s.base, 'POST', '/api/orders/vip', { token: t, body: { tier: 1, productIds: ['p04'], ...checkout } });
    assert.equal(r.status, 400);

    // Produk tidak ada -> tolak
    r = await api(s.base, 'POST', '/api/orders/vip', { token: t, body: { tier: 1, productIds: ['p99'], ...checkout } });
    assert.equal(r.status, 400);

    // Benar: VIP 1 pilih p02 -> diterima, total = harga langganan 150.000
    r = await api(s.base, 'POST', '/api/orders/vip', { token: t, body: { tier: 1, productIds: ['p02'], ...checkout } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.order.totalRp, 150000);
    assert.equal(r.json.order.type, 'vip');
    assert.equal(r.json.order.status, 'Menunggu Pembayaran');

    // VIP 7: 5 pilihan, pilih 1 (Danikor tanpa foto tetap boleh dipilih)
    r = await api(s.base, 'POST', '/api/orders/vip', { token: t, body: { tier: 7, productIds: ['p23'], ...checkout } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.order.totalRp, 5000000);

    // VIP 7 pilih 2 -> tolak (pickCount=1)
    r = await api(s.base, 'POST', '/api/orders/vip', { token: t, body: { tier: 7, productIds: ['p19', 'p20'], ...checkout } });
    assert.equal(r.status, 400);
  } finally {
    await s.stop();
  }
});

test('VIP pick-count: admin bisa ubah pickCount jadi 2 dan server mengikuti', async () => {
  const s = await startServer();
  try {
    const admin = (await api(s.base, 'POST', '/api/admin/login', { body: { pin: '123456' } })).json.token;
    const u = await register(s.base, 'Vip Dua', 'vip2@test.id');
    const checkout = { name: 'Vip Dua', address: 'Jl. Tes 1', phone: '0811', email: 'vip2@test.id' };

    // Ubah VIP 1: pickCount 2, label baru
    let r = await api(s.base, 'POST', '/api/admin/vip-tiers', {
      adminToken: admin,
      body: { tier: 1, priceRp: 150000, label: 'pilih 2 dari 3 produk', pickCount: 2, choices: ['p01', 'p02', 'p03'], checkinVoucherRp: 5000 },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));

    // Sekarang pilih 1 -> tolak (butuh tepat 2)
    r = await api(s.base, 'POST', '/api/orders/vip', { token: u.token, body: { tier: 1, productIds: ['p01'], ...checkout } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Pilih tepat 2/);

    // Pilih 2 -> diterima
    r = await api(s.base, 'POST', '/api/orders/vip', { token: u.token, body: { tier: 1, productIds: ['p01', 'p03'], ...checkout } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.order.totalRp, 150000);

    // Katalog menampilkan label baru
    const cat = await api(s.base, 'GET', '/api/catalog');
    assert.equal(cat.json.vipTiers[0].label, 'pilih 2 dari 3 produk');
    assert.equal(cat.json.vipTiers[0].pickCount, 2);
  } finally {
    await s.stop();
  }
});
