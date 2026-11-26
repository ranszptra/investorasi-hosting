// test-load.mjs — Server naik, katalog lengkap, foto produk tersedia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api } from './helpers.mjs';

test('load: health ok, katalog 23 produk + 7 tingkat + 1 event', async () => {
  const s = await startServer();
  try {
    const h = await api(s.base, 'GET', '/api/health');
    assert.equal(h.status, 200);
    assert.equal(h.json.ok, true);
    assert.equal(h.json.service, 'investorasi');
    assert.equal(h.json.products, 23);

    const cat = await api(s.base, 'GET', '/api/catalog');
    assert.equal(cat.status, 200);
    assert.equal(cat.json.products.length, 23);
    assert.equal(cat.json.vipTiers.length, 7);
    assert.equal(cat.json.events.length, 1);
    assert.equal(cat.json.banner.color, '#16a34a');
    assert.equal(cat.json.qrisActive, false);
    assert.equal(cat.json.telegramLink, null);

    // Harga per tingkat produk sesuai ketetapan pemilik
    const byTier = {};
    for (const p of cat.json.products) (byTier[p.tier] = byTier[p.tier] || []).push(p);
    assert.deepEqual(Object.keys(byTier).sort(), ['1', '2', '3', '4', '5', '6', '7']);
    assert.equal(byTier[1].length, 3);
    assert.equal(byTier[7].length, 5);
    assert.ok(byTier[1].every((p) => p.priceRp === 100000));
    assert.ok(byTier[7].every((p) => p.priceRp === 3500000));

    // Harga langganan VIP
    const prices = cat.json.vipTiers.map((t) => t.priceRp);
    assert.deepEqual(prices, [150000, 300000, 500000, 700000, 1200000, 2000000, 5000000]);

    // Nilai voucher check-in per tingkat (VIP 1-4 = 5rb, VIP 5-7 = 15rb)
    const vouchers = cat.json.vipTiers.map((t) => t.checkinVoucherRp);
    assert.deepEqual(vouchers, [5000, 5000, 5000, 5000, 15000, 15000, 15000]);

    // Danikor TANPA foto (null) — bukan foto produk lain
    const danikor = cat.json.products.find((p) => p.id === 'p23');
    assert.equal(danikor.image, null);
    assert.equal(danikor.name, 'HP Danikor A16 5G');

    // Semua produk lain punya foto
    for (const p of cat.json.products) {
      if (p.id === 'p23') continue;
      assert.ok(p.image && p.image.startsWith('/products/'), `${p.id} tanpa foto`);
    }
  } finally {
    await s.stop();
  }
});

test('load: halaman utama + foto produk tersaji (HTTP 200)', async () => {
  const s = await startServer();
  try {
    const home = await fetch(s.base + '/');
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /Investorasi/);

    const photo = await fetch(s.base + '/products/p01-tas-hefand.jpg');
    assert.equal(photo.status, 200);
    assert.match(photo.headers.get('content-type'), /image\/jpeg/);

    const png = await fetch(s.base + '/products/p20-iphone-11.png');
    assert.equal(png.status, 200);
    assert.match(png.headers.get('content-type'), /image\/png/);

    // Auth config: Google belum dikonfigurasi (tanpa env) -> googleConfigured false
    const cfg = await api(s.base, 'GET', '/api/auth/config');
    assert.equal(cfg.json.googleConfigured, false);
    assert.equal(cfg.json.googleClientId, null);
  } finally {
    await s.stop();
  }
});
