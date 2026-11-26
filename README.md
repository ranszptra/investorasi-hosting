# Investorasi — Toko Online Marketplace (standalone)

Toko online mobile-first berbahasa Indonesia: katalog 23 produk nyata,
langganan VIP 7 tingkat, komisi 20% per penjualan nyata, dompet + penarikan
manual, undang teman, check-in harian VIP (VOUCHER BELANJA saja), event,
live chat, dan Panel Pemilik terpisah (PIN).

## Aturan produk (ditetapkan pemilik — JANGAN dilanggar)
- TIDAK ADA janji profit dijamin, klaim harian TUNAI, atau roda putar.
- Komisi 20% HANYA dari penjualan nyata (saat pesanan ditandai Dibayar).
- Check-in VIP memberi VOUCHER BELANJA saja (bukan uang, tidak bisa ditarik).
- Penarikan diproses manual pemilik (maks. 3 hari kerja).

## Stack
Node 24 + Express. Dual backend (pola yang sama seperti Runner Coin):
- `DATABASE_URL` diset (Supabase Postgres) → `pg` Pool; skema di
  `supabase-schema.sql` diterapkan otomatis saat start. Tabel ber-prefix
  `inv_` supaya tidak bentrok dengan tabel game di project Supabase yang sama.
- Tanpa `DATABASE_URL` → SQLite lokal (`node:sqlite`, file `investorasi.db`).

## Jalankan lokal
```bash
npm install
npm start          # http://localhost:3000
npm test           # node --test tests/ (12+ cek backend + LOAD)
```

## Env vars (Railway)
- `DATABASE_URL` — connection string Supabase Postgres (pooler, port 6543).
  Disalin dari service Lari-Koin di project Railway yang sama.
- `OWNER_SECRET` — string acak panjang (WAJIB diganti di produksi; ganti
  setelah pengguna terdaftar = semua token login lama tidak valid).
- `GOOGLE_CLIENT_ID` — opsional; Client ID OAuth "Nailong Runner Web".
  Domain Railway BARU harus ditambahkan sebagai Authorized JavaScript Origin
  di Google Cloud Console (hanya pemilik yang bisa) — sebelum itu, tombol
  login Google tampil nonaktif dan aplikasi tetap jalan normal.
- `PORT` — diisi otomatis oleh Railway.

## Struktur
- `server.js` — seluruh API (lihat `API.md`).
- `db.js` — adapter pg/SQLite + seed (23 produk, 7 tingkat VIP, pengaturan).
- `supabase-schema.sql` — skema Postgres (idempotent).
- `public/` — frontend SPA (`index.html`, `app.js`, `style.css`),
  foto produk (`products/`), halaman kebijakan (`policies/`).
- `tests/` — suite `node:test` (VIP pick-count, check-in, invite, komisi,
  withdraw, LOAD).
- `API.md` — kontrak API lengkap.

## Alur penting
- Pesanan: `Menunggu Pembayaran` → `Dibayar` → `Dikirim` → `Selesai`.
  Saat ditandai `Dibayar`: komisi 20% masuk ke pengundang + teman jadi
  TERKUALIFIKASI (bila pembelian pertama yang dibayar).
- Penarikan: `Menunggu` → `Diproses` → `Selesai`; min Rp100.000.
- Check-in: member VIP aktif, 1x/hari, 30 hari sejak langganan aktif;
  voucher per tingkat (VIP 1–4 Rp5.000, VIP 5–7 Rp15.000 — bisa diubah
  per tingkat di panel).
- Panel Pemilik: tombol "Panel Pemilik" di tab Saya + `#admin`; PIN bawaan
  `123456` — WAJIB diganti pemilik di panel.
