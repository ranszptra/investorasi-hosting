// test-invite.mjs — Tangga bonus undang teman (sekali-klaim per tingkat).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, register, adminLogin, makePaidProductOrder, profile } from './helpers.mjs';

// Daftarkan teman lewat kode undangan + belanja 1x (jadi TERKUALIFIKASI).
async function qualifiedFriend(s, admin, referrerCode, i) {
  const f = await register(s.base, `Teman ${i}`, `teman${i}@test.id`, 'rahasia123', referrerCode);
  await makePaidProductOrder(s.base, f.token, admin, 'p01');
  return f;
}

test('invite: teman tanpa pembelian belum terkualifikasi; klaim butuh ambang', async () => {
  const s = await startServer();
  try {
    const admin = await adminLogin(s.base);
    const ref = await register(s.base, 'Pengundang', 'ref@test.id');
    // 1 teman daftar tapi BELUM belanja -> belum terkualifikasi
    await register(s.base, 'Teman Nol', 'teman0@test.id', 'rahasia123', ref.user.inviteCode);
    let p = await profile(s.base, ref.token);
    assert.equal(p.invite.referredTotal, 1);
    assert.equal(p.invite.qualified, 0);

    // Klaim tingkat 10 dengan 0 terkualifikasi -> tolak
    let r = await api(s.base, 'POST', '/api/invite/claim', { token: ref.token, body: { tier: 10 } });
    assert.equal(r.status, 400);

    // Teman belanja 1x -> terkualifikasi
    await qualifiedFriend(s, admin, ref.user.inviteCode, 1);
    p = await profile(s.base, ref.token);
    assert.equal(p.invite.qualified, 1);

    // Tingkat tidak ada -> tolak
    r = await api(s.base, 'POST', '/api/invite/claim', { token: ref.token, body: { tier: 7 } });
    assert.equal(r.status, 400);
  } finally {
    await s.stop();
  }
});

test('invite: 10 teman terkualifikasi -> klaim Rp300.000 sekali, klaim ganda ditolak', async () => {
  const s = await startServer();
  try {
    const admin = await adminLogin(s.base);
    const ref = await register(s.base, 'Pengundang', 'ref@test.id');
    for (let i = 1; i <= 10; i++) await qualifiedFriend(s, admin, ref.user.inviteCode, i);

    let p = await profile(s.base, ref.token);
    assert.equal(p.invite.qualified, 10);
    assert.equal(p.invite.tiers.find((t) => t.tier === 10).canClaim, true);
    assert.equal(p.invite.tiers.find((t) => t.tier === 30).canClaim, false);

    // Klaim tingkat 10 -> Rp300.000 masuk dompet (saldo total 500.000:
    // 200.000 komisi dari 10 pembelian teman @Rp100.000 + 300.000 bonus)
    let r = await api(s.base, 'POST', '/api/invite/claim', { token: ref.token, body: { tier: 10 } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.amountRp, 300000);
    p = await profile(s.base, ref.token);
    assert.equal(p.user.balanceRp, 500000);
    const w = await api(s.base, 'GET', '/api/wallet', { token: ref.token });
    const bonus = w.json.entries.find((e) => e.kind === 'invite_bonus');
    assert.ok(bonus, 'entri invite_bonus harus ada');
    assert.equal(bonus.amountRp, 300000);
    assert.equal(p.invite.tiers.find((t) => t.tier === 10).claimed, true);
    assert.equal(p.invite.tiers.find((t) => t.tier === 10).canClaim, false);

    // Klaim ulang tingkat yang sama -> tolak
    r = await api(s.base, 'POST', '/api/invite/claim', { token: ref.token, body: { tier: 10 } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /sudah diklaim/);

    // Klaim tingkat 30 dengan 10 teman -> tolak
    r = await api(s.base, 'POST', '/api/invite/claim', { token: ref.token, body: { tier: 30 } });
    assert.equal(r.status, 400);
  } finally {
    await s.stop();
  }
});
