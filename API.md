# API.md — Kontrak API Investorasi (backend `server.js`)

Base URL: sama dengan origin web (fetch relatif, mis. `/api/catalog`).
Auth pengguna: header `Authorization: Bearer <token>` (dari login/register/Google).
Auth admin: header `Authorization: Bearer <adminToken>` (dari `POST /api/admin/login`).
Semua respons sukses: `{ ok: true, ... }`. Error: `{ ok: false, error: "..." }` + status HTTP.

## Publik
- `GET /api/health` → `{ ok, service: "investorasi", time, products }`
- `GET /api/auth/config` → `{ ok, googleConfigured: bool, googleClientId: string|null }`
- `GET /api/catalog` → `{ ok, products: [{id,name,priceRp,description,image,tier}], vipTiers: [{tier,priceRp,label,pickCount,choices,checkinVoucherRp,choiceProducts:[{id,name,priceRp,image,description}]}], banner: {color, imageUrl|null}, events: [{id,title,text,imageUrl|null}], qrisActive: bool, qrisImageUrl: string|null, telegramLink: string|null }`
  - `image` produk bisa `null` (HP Danikor A16 5G) → tampilkan placeholder "Foto menyusul", JANGAN pakai foto produk lain.
- `GET /api/blob/:key` → bytes gambar (banner / QRIS / event / foto produk upload).

## Auth
- `POST /api/auth/register` `{name, email, password, inviteCode?}` → `{ ok, token, user }`
  - `inviteCode` opsional (kode `INV-...` pengundang). Password min 6 karakter.
- `POST /api/auth/login` `{email, password}` → `{ ok, token, user }`
- `POST /api/auth/google` `{idToken, inviteCode?}` → `{ ok, token, user }`
  - `idToken` = Google ID token dari Google Identity Services. Bila Client ID
    belum diisi pemilik, endpoint menolak 400 ("Login Google belum diaktifkan").
- `GET /api/profile` (auth) → `{ ok, user, membership: {tier, orderId, startedAt, endsAt, dayNumber, daysLeft, windowDays}|null, vouchers: [{id,amountRp,status,expiresAt,createdAt}], invite: {code, referredTotal, qualified, tiers: [{tier, rp, claimed, canClaim}]}, checkin: {isMember, tier, dayNumber, daysLeft, claimedToday} }`
  - `user`: `{ id, name, email, inviteCode, balanceRp, referrerId, provider, banned, createdAt }`

## Belanja (auth)
- `POST /api/orders` `{items:[{productId, qty}], voucherId?, name, address, phone, email}` → `{ ok, order }`
  - Status awal `Menunggu Pembayaran`. `voucherId` = voucher aktif milik user (diskon = min(nilai voucher, total)).
- `POST /api/orders/vip` `{tier, productIds, name, address, phone, email}` → `{ ok, order }`
  - Server memvalidasi: jumlah `productIds` HARUS = `pickCount` tingkat itu dan
    semuanya ada di `choices` tingkat itu. Total = harga langganan tingkat.
- `GET /api/orders` (auth) → `{ ok, orders: [...] }` (items sudah di-parse).
- `POST /api/orders/:id/confirm-pay` (auth) → menandai "sudah bayar" (pemilik lalu verifikasi manual).

## Dompet (auth)
- `GET /api/wallet` (auth) → `{ ok, balanceRp, minWithdrawRp: 100000, methods: ["BCA","BRI","Mandiri","SeaBank","OVO","DANA","ShopeePay","GoPay"], entries, withdrawals, vouchers }`
- `POST /api/withdraw` (auth) `{amountRp, method, accountNumber, accountName}` → `{ ok, withdrawalId, message }`
  - Minimal Rp100.000, saldo harus cukup. Status awal `Menunggu`.
- `POST /api/invite/claim` (auth) `{tier}` → `{ ok, amountRp, message }`
  - Tangga: 10 teman = Rp300.000, 30 = Rp600.000, 50 = Rp1.500.000, 100 = Rp3.500.000.
  - Sekali klaim per tingkat; butuh teman TERKUALIFIKASI (daftar lewat link + min. 1 pembelian).

## Check-in VIP (auth)
- `POST /api/checkin/claim` (auth) → `{ ok, voucher: {id, amountRp, expiresAt}, dayNumber, daysLeft, message }`
  - Hanya member VIP aktif; 1x/hari; 30 hari sejak langganan aktif.
  - Hadiah = VOUCHER BELANJA (bukan uang, tidak bisa ditarik). Nilai per tingkat:
    VIP 1–4 Rp5.000/hari, VIP 5–7 Rp15.000/hari (bisa diubah pemilik di panel).

## Chat (auth)
- `GET /api/chat` → `{ ok, messages: [{id, userId, sender: "user"|"owner", message, createdAt}] }`
- `POST /api/chat` `{message}` → `{ ok, id }`

## Admin (token admin)
- `POST /api/admin/login` `{pin}` → `{ ok, token }` (PIN bawaan `123456`)
- `POST /api/admin/change-pin` `{oldPin, newPin}` (newPin 4–8 digit)
- `GET /api/admin/overview` → `{ ok, users, ordersByStatus, pendingWithdrawals, recentOrders, recentWithdrawals }`
- `GET /api/admin/orders?status=` → `{ ok, orders }`
- `POST /api/admin/orders/:id/status` `{status}` — status: `Menunggu Pembayaran` → `Dibayar` → `Dikirim` → `Selesai` (maju saja). Saat jadi `Dibayar`: komisi 20% otomatis masuk ke pengundang + teman jadi terkualifikasi.
- `GET /api/admin/withdrawals` → `{ ok, withdrawals }`
- `POST /api/admin/withdrawals/:id/status` `{status}` — `Menunggu` → `Diproses` → `Selesai`.
- `GET /api/admin/products` → `{ ok, products }` (semua, termasuk nonaktif)
- `POST /api/admin/products` `{id?, name, priceRp, description, image, tier, active}` → `{ ok, id }` (tanpa `id` = produk baru)
- `GET /api/admin/vip-tiers` → `{ ok, vipTiers }`
- `POST /api/admin/vip-tiers` `{tier, priceRp, label, pickCount, choices, checkinVoucherRp}` → `{ ok }`
- `GET /api/admin/settings` → `{ ok, settings: {telegramLink, bannerColor, bannerImageKey, qrisImageKey, checkinWindowDays, checkinVoucherValidDays, googleClientId} }`
- `POST /api/admin/settings` `{key, value}` → `{ ok }`
- `POST /api/admin/upload` `{kind: "banner"|"qris"|"event"|"product", key?, dataUrl}` → `{ ok, key, url }`
  - `dataUrl` = `data:image/(png|jpeg|webp);base64,...` (maks. ~3 MB). `banner`/`qris` memakai key tetap; `event`/`product` boleh kirim `key` sendiri.
- `GET /api/admin/events` → `{ ok, events }`
- `POST /api/admin/events` `{id?, title, text, imageKey, visible}` → `{ ok, id }`
- `POST /api/admin/events/:id/visible` `{visible}` → `{ ok }`
- `GET /api/admin/chat` → `{ ok, messages }` (semua pengguna, ada `userName`)
- `POST /api/admin/chat` `{userId, message}` → `{ ok, id }`

## Aturan keras (jangan dilanggar di frontend)
- TIDAK ADA janji profit dijamin, klaim harian TUNAI, atau roda putar — di mana pun.
- Voucher check-in = potongan belanja saja; tampilkan terpisah dari saldo di Dompet.
- Tagline Beranda jujur: "Toko online barang nyata — komisi 20% dari penjualan yang benar-benar terjadi." (atau sejenis, tanpa janji keuntungan).
- Foto Danikor = placeholder "Foto menyusul" (image null).
