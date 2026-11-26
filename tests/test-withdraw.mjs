// test-withdraw.mjs — Penarikan: min Rp100.000, saldo cukup, alur status.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, register, adminLogin, makePaidProductOrder, profile } from './helpers.mjs';

// Danai pengguna: jadi pengundang, teman belanja produk Rp1.500.000 -> komisi 300.000.
async function fundedUser(s, admin) {
  const ref = await register(s.base, 'Pengundang', 'ref@test.id');
  const friend = await register(s.base, 'Teman', 'teman@test.id', 'rahasia123', ref.user.inviteCode);
  await makePaidProductOrder(s.base, friend.token, admin, 'p16'); // Rp1.500.000
  const p = await profile(s.base, ref.token);
  assert.equal(p.user.balanceRp, 300000);
  return ref;
}

test('withdraw: di bawah minimum / saldo kurang / metode salah ditolak', async () => {
  const s = await startServer();
  try {
    const admin = await adminLogin(s.base);
    const u = await fundedUser(s, admin);

    // Di bawah Rp100.000 -> tolak
    let r = await api(s.base, 'POST', '/api/withdraw', {
      token: u.token, body: { amountRp: 99999, method: 'DANA', accountNumber: '0811', accountName: 'Pengundang' },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Minimal penarikan/);

    // Melebihi saldo (300.000) -> tolak
    r = await api(s.base, 'POST', '/api/withdraw', {
      token: u.token, body: { amountRp: 300001, method: 'DANA', accountNumber: '0811', accountName: 'Pengundang' },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Saldo tidak cukup/);

    // Metode tidak ada -> tolak
    r = await api(s.base, 'POST', '/api/withdraw', {
      token: u.token, body: { amountRp: 100000, method: 'PayPal', accountNumber: '0811', accountName: 'Pengundang' },
    });
    assert.equal(r.status, 400);

    // Tanpa nama pemilik -> tolak
    r = await api(s.base, 'POST', '/api/withdraw', {
      token: u.token, body: { amountRp: 100000, method: 'BCA', accountNumber: '1234567890', accountName: '' },
    });
    assert.equal(r.status, 400);

    // Saldo tetap 300.000 (tidak ada penarikan yang lolos)
    const p = await profile(s.base, u.token);
    assert.equal(p.user.balanceRp, 300000);
  } finally {
    await s.stop();
  }
});

test('withdraw: penarikan valid mengurangi saldo + alur Menunggu -> Diproses -> Selesai', async () => {
  const s = await startServer();
  try {
    const admin = await adminLogin(s.base);
    const u = await fundedUser(s, admin);

    let r = await api(s.base, 'POST', '/api/withdraw', {
      token: u.token, body: { amountRp: 100000, method: 'BCA', accountNumber: '1234567890', accountName: 'Pengundang' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const wid = r.json.withdrawalId;

    let p = await profile(s.base, u.token);
    assert.equal(p.user.balanceRp, 200000); // 300.000 - 100.000

    const w = await api(s.base, 'GET', '/api/wallet', { token: u.token });
    assert.equal(w.json.withdrawals[0].status, 'Menunggu');
    assert.equal(w.json.withdrawals[0].method, 'BCA');
    assert.equal(w.json.entries[0].kind, 'withdrawal');
    assert.equal(w.json.entries[0].amountRp, -100000);

    // Admin: Diproses -> Selesai
    r = await api(s.base, 'POST', `/api/admin/withdrawals/${wid}/status`, { adminToken: admin, body: { status: 'Diproses' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    r = await api(s.base, 'POST', `/api/admin/withdrawals/${wid}/status`, { adminToken: admin, body: { status: 'Selesai' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));

    // Mundur status -> tolak
    r = await api(s.base, 'POST', `/api/admin/withdrawals/${wid}/status`, { adminToken: admin, body: { status: 'Menunggu' } });
    assert.equal(r.status, 400);
  } finally {
    await s.stop();
  }
});
