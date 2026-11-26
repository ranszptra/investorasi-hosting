// test-checkin.mjs — Check-in harian VIP (voucher belanja saja).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, api, register, adminLogin, makePaidVipOrder, profile } from './helpers.mjs';

test('check-in: non-member ditolak, member klaim 1x/hari, klaim ganda ditolak', async () => {
  const s = await startServer();
  try {
    const admin = await adminLogin(s.base);
    const biasa = await register(s.base, 'Biasa', 'biasa@test.id');
    // Bukan member -> tolak
    let r = await api(s.base, 'POST', '/api/checkin/claim', { token: biasa.token });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /langganan dulu/i);

    // Jadi member VIP 1 (bayar 150rb) -> klaim berhasil, voucher 5.000
    const member = await register(s.base, 'Member Satu', 'member1@test.id');
    await makePaidVipOrder(s.base, member.token, admin, 1, ['p01']);
    r = await api(s.base, 'POST', '/api/checkin/claim', { token: member.token });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.voucher.amountRp, 5000);
    assert.equal(r.json.dayNumber, 1);

    // Klaim kedua di hari yang sama -> tolak
    r = await api(s.base, 'POST', '/api/checkin/claim', { token: member.token });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Sudah check-in hari ini/);

    // Voucher tercatat di profil (bukan saldo)
    const p = await profile(s.base, member.token);
    assert.equal(p.vouchers.length, 1);
    assert.equal(p.vouchers[0].amountRp, 5000);
    assert.equal(p.user.balanceRp, 0); // voucher BUKAN saldo tunai
    assert.equal(p.checkin.claimedToday, true);
  } finally {
    await s.stop();
  }
});

test('check-in: nilai voucher beda per tingkat (VIP 1 = 5rb, VIP 5 = 15rb)', async () => {
  const s = await startServer();
  try {
    const admin = await adminLogin(s.base);
    const m1 = await register(s.base, 'Member VIP1', 'mv1@test.id');
    await makePaidVipOrder(s.base, m1.token, admin, 1, ['p02']);
    let r = await api(s.base, 'POST', '/api/checkin/claim', { token: m1.token });
    assert.equal(r.json.voucher.amountRp, 5000);

    const m5 = await register(s.base, 'Member VIP5', 'mv5@test.id');
    await makePaidVipOrder(s.base, m5.token, admin, 5, ['p13']);
    r = await api(s.base, 'POST', '/api/checkin/claim', { token: m5.token });
    assert.equal(r.json.voucher.amountRp, 15000);

    // Admin ubah nilai VIP 1 jadi 7.000 -> klaim member baru ikut nilai baru
    r = await api(s.base, 'POST', '/api/admin/vip-tiers', {
      adminToken: admin,
      body: { tier: 1, priceRp: 150000, label: 'pilih 1 dari 3 produk', pickCount: 1, choices: ['p01', 'p02', 'p03'], checkinVoucherRp: 7000 },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const m1b = await register(s.base, 'Member VIP1b', 'mv1b@test.id');
    await makePaidVipOrder(s.base, m1b.token, admin, 1, ['p03']);
    r = await api(s.base, 'POST', '/api/checkin/claim', { token: m1b.token });
    assert.equal(r.json.voucher.amountRp, 7000);
  } finally {
    await s.stop();
  }
});

test('check-in: voucher bisa dipakai di checkout dan tidak bisa dipakai 2x', async () => {
  const s = await startServer();
  try {
    const admin = await adminLogin(s.base);
    const m = await register(s.base, 'Member V', 'mv@test.id');
    await makePaidVipOrder(s.base, m.token, admin, 1, ['p01']);
    const claim = await api(s.base, 'POST', '/api/checkin/claim', { token: m.token });
    const voucherId = claim.json.voucher.id;

    // Beli produk 100.000 pakai voucher 5.000 -> total 95.000
    const checkout = { name: 'Member V', address: 'Jl. Tes 1', phone: '0811', email: 'mv@test.id' };
    let r = await api(s.base, 'POST', '/api/orders', {
      token: m.token,
      body: { items: [{ productId: 'p02', qty: 1 }], voucherId, ...checkout },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.order.totalRp, 95000);
    assert.equal(r.json.order.discountRp, 5000);

    // Pakai voucher yang sama lagi -> tolak
    r = await api(s.base, 'POST', '/api/orders', {
      token: m.token,
      body: { items: [{ productId: 'p03', qty: 1 }], voucherId, ...checkout },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /tidak aktif|tidak ditemukan/);
  } finally {
    await s.stop();
  }
});

test('check-in: masa 30 hari — langganan 31 hari lalu sudah tidak bisa klaim', async () => {
  const s = await startServer();
  try {
    const admin = await adminLogin(s.base);
    const m = await register(s.base, 'Member Lama', 'ml@test.id');
    const userId = m.user.id;
    // Sisipkan langsung pesanan VIP Dibayar 31 hari lalu (simulasi langganan lama).
    const db = new DatabaseSync(s.dbPath);
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      "INSERT INTO inv_orders(userId,type,items,totalRp,name,address,phone,email,status,createdAt,paidAt) VALUES(?,'vip','{\"tier\":1,\"productIds\":[\"p01\"]}',150000,'Member Lama','Jl. Tes','0811','ml@test.id','Dibayar',?,?)"
    ).run(userId, old, old);
    db.close();

    const p = await profile(s.base, m.token);
    assert.equal(p.membership, null);
    assert.equal(p.checkin.isMember, false);
    const r = await api(s.base, 'POST', '/api/checkin/claim', { token: m.token });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /langganan dulu/i);
  } finally {
    await s.stop();
  }
});
