// test-commission.mjs — Komisi 20% hanya dari penjualan nyata (saat Dibayar).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, register, adminLogin, makePaidProductOrder, profile } from './helpers.mjs';

test('komisi: 20% masuk ke pengundang HANYA setelah pesanan Dibayar', async () => {
  const s = await startServer();
  try {
    const admin = await adminLogin(s.base);
    const ref = await register(s.base, 'Pengundang', 'ref@test.id');
    const friend = await register(s.base, 'Teman', 'teman@test.id', 'rahasia123', ref.user.inviteCode);

    // Teman pesan produk Rp100.000 (belum Dibayar) -> pengundang masih 0
    const checkout = { name: 'Teman', address: 'Jl. Tes 1', phone: '0811', email: 'teman@test.id' };
    let r = await api(s.base, 'POST', '/api/orders', {
      token: friend.token,
      body: { items: [{ productId: 'p01', qty: 1 }], ...checkout },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const orderId = r.json.order.id;
    let p = await profile(s.base, ref.token);
    assert.equal(p.user.balanceRp, 0);

    // Tandai Dibayar -> komisi 20% x 100.000 = 20.000 masuk
    r = await api(s.base, 'POST', `/api/admin/orders/${orderId}/status`, { adminToken: admin, body: { status: 'Dibayar' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    p = await profile(s.base, ref.token);
    assert.equal(p.user.balanceRp, 20000);

    // Entri dompet tercatat sebagai commission
    const w = await api(s.base, 'GET', '/api/wallet', { token: ref.token });
    assert.equal(w.json.entries[0].kind, 'commission');
    assert.equal(w.json.entries[0].amountRp, 20000);

    // Tandai Dikirim lalu Selesai -> komisi TIDAK dobel
    await api(s.base, 'POST', `/api/admin/orders/${orderId}/status`, { adminToken: admin, body: { status: 'Dikirim' } });
    await api(s.base, 'POST', `/api/admin/orders/${orderId}/status`, { adminToken: admin, body: { status: 'Selesai' } });
    p = await profile(s.base, ref.token);
    assert.equal(p.user.balanceRp, 20000);
  } finally {
    await s.stop();
  }
});

test('komisi: tanpa pengundang, tidak ada komisi ke siapa pun', async () => {
  const s = await startServer();
  try {
    const admin = await adminLogin(s.base);
    const solo = await register(s.base, 'Solo', 'solo@test.id');
    await makePaidProductOrder(s.base, solo.token, admin, 'p03');
    const p = await profile(s.base, solo.token);
    assert.equal(p.user.balanceRp, 0);
    const w = await api(s.base, 'GET', '/api/wallet', { token: solo.token });
    assert.equal(w.json.entries.length, 0);
  } finally {
    await s.stop();
  }
});
