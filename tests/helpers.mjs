// tests/helpers.mjs — Boot server uji (SQLite temp) + helper API.
// Dipakai semua suite; tiap suite mem-boot server sendiri di port acak.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function freePort() {
  return 31000 + Math.floor(Math.random() * 1500);
}

export async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-test-'));
  const dbPath = path.join(dir, 'test.db');
  const port = freePort();
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), OWNER_SECRET: 'test-secret-123' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) break;
    } catch { /* belum naik */ }
    if (Date.now() > deadline) throw new Error('server tidak naik: ' + out);
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    base, dbPath, dir,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* abaikan */ }
    },
  };
}

export async function api(base, method, p, { token, adminToken, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = adminToken || token;
  if (t) headers.Authorization = `Bearer ${t}`;
  const r = await fetch(base + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}

export async function register(base, name, email, password = 'rahasia123', inviteCode) {
  const body = { name, email, password };
  if (inviteCode) body.inviteCode = inviteCode;
  const r = await api(base, 'POST', '/api/auth/register', { body });
  if (!r.json?.ok) throw new Error('register gagal: ' + JSON.stringify(r.json));
  return r.json;
}

export async function adminLogin(base, pin = '123456') {
  const r = await api(base, 'POST', '/api/admin/login', { body: { pin } });
  if (!r.json?.ok) throw new Error('admin login gagal: ' + JSON.stringify(r.json));
  return r.json.token;
}

// Buat pesanan produk lalu tandai Dibayar oleh admin. Mengembalikan order.
export async function makePaidProductOrder(base, userToken, adminToken, productId, qty = 1) {
  const c = await api(base, 'POST', '/api/orders', {
    token: userToken,
    body: {
      items: [{ productId, qty }],
      name: 'Pembeli Tes', address: 'Jl. Tes No. 1, Jepara', phone: '081234567890', email: 'tes@example.com',
    },
  });
  if (!c.json?.ok) throw new Error('buat order gagal: ' + JSON.stringify(c.json));
  const orderId = c.json.order.id;
  const m = await api(base, 'POST', `/api/admin/orders/${orderId}/status`, { adminToken, body: { status: 'Dibayar' } });
  if (!m.json?.ok) throw new Error('tandai Dibayar gagal: ' + JSON.stringify(m.json));
  return m.json.order;
}

// Buat pesanan VIP lalu tandai Dibayar. Mengembalikan order.
export async function makePaidVipOrder(base, userToken, adminToken, tier, productIds) {
  const c = await api(base, 'POST', '/api/orders/vip', {
    token: userToken,
    body: {
      tier, productIds,
      name: 'Member Tes', address: 'Jl. Tes No. 1, Jepara', phone: '081234567890', email: 'tes@example.com',
    },
  });
  if (!c.json?.ok) throw new Error('buat order VIP gagal: ' + JSON.stringify(c.json));
  const orderId = c.json.order.id;
  const m = await api(base, 'POST', `/api/admin/orders/${orderId}/status`, { adminToken, body: { status: 'Dibayar' } });
  if (!m.json?.ok) throw new Error('tandai Dibayar VIP gagal: ' + JSON.stringify(m.json));
  return m.json.order;
}

export async function profile(base, token) {
  const r = await api(base, 'GET', '/api/profile', { token });
  if (!r.json?.ok) throw new Error('profile gagal: ' + JSON.stringify(r.json));
  return r.json;
}
