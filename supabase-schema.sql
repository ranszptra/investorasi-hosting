-- supabase-schema.sql — Skema Postgres (Supabase) untuk Investorasi.
--
-- CARA PAKAI (pilih satu):
--   1. Supabase Dashboard → SQL Editor → tempel seluruh file ini → Run.
--   2. Otomatis: server (db.js) menjalankan file ini sendiri saat start
--      jika env DATABASE_URL diset.
--
-- File ini idempotent: aman dijalankan berulang (CREATE TABLE IF NOT EXISTS).
-- Semua tabel ber-prefix `inv_` supaya tidak bentrok dengan tabel game
-- Runner Coin di project Supabase yang sama ("lari-koin").
--
-- Konversi dari skema SQLite di db.js:
--   INTEGER (id)        -> bigint GENERATED ALWAYS AS IDENTITY
--   INTEGER (uang)      -> bigint
--   INTEGER (counter)   -> integer
--   TEXT                -> text
--   kolom JSON TEXT     -> jsonb (choices, items)
--   base64 gambar       -> text (inv_blobs.data)
--
-- CATATAN: PIN admin awal TIDAK di-seed di sini — hash scrypt-nya
-- dibuat aplikasi (db.js, fungsi seed()) saat pertama jalan, sama seperti
-- di SQLite. Jangan pernah menulis PIN plaintext ke file ini.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS inv_users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text UNIQUE NOT NULL,
  email text UNIQUE NOT NULL,
  passHash text NOT NULL,
  passSalt text NOT NULL,
  inviteCode text UNIQUE NOT NULL,
  referrerId bigint REFERENCES inv_users(id),
  balanceRp bigint NOT NULL DEFAULT 0,
  provider text,
  providerId text,
  banned integer NOT NULL DEFAULT 0,
  createdAt text NOT NULL
);

CREATE TABLE IF NOT EXISTS inv_products (
  id text PRIMARY KEY,
  name text NOT NULL,
  priceRp bigint NOT NULL,
  description text NOT NULL DEFAULT '',
  image text,
  tier integer,
  active integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS inv_vip_tiers (
  tier integer PRIMARY KEY,
  priceRp bigint NOT NULL,
  label text NOT NULL,
  pickCount integer NOT NULL DEFAULT 1,
  choices jsonb NOT NULL,
  checkinVoucherRp bigint NOT NULL DEFAULT 5000
);

CREATE TABLE IF NOT EXISTS inv_vouchers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  userId bigint NOT NULL REFERENCES inv_users(id),
  amountRp bigint NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expiresAt text NOT NULL,
  createdAt text NOT NULL,
  usedOrderId bigint -- FK ke inv_orders ditambah di akhir file (DO block)
);

CREATE TABLE IF NOT EXISTS inv_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  userId bigint NOT NULL REFERENCES inv_users(id),
  type text NOT NULL,
  items jsonb NOT NULL,
  totalRp bigint NOT NULL,
  voucherId bigint REFERENCES inv_vouchers(id),
  discountRp bigint NOT NULL DEFAULT 0,
  name text NOT NULL,
  address text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'Menunggu Pembayaran',
  paidClaimed integer NOT NULL DEFAULT 0,
  createdAt text NOT NULL,
  paidAt text
);

CREATE TABLE IF NOT EXISTS inv_wallet_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  userId bigint NOT NULL REFERENCES inv_users(id),
  kind text NOT NULL,
  amountRp bigint NOT NULL,
  refType text,
  refId text,
  createdAt text NOT NULL
);

CREATE TABLE IF NOT EXISTS inv_withdrawals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  userId bigint NOT NULL REFERENCES inv_users(id),
  amountRp bigint NOT NULL,
  method text NOT NULL,
  accountNumber text NOT NULL,
  accountName text NOT NULL,
  status text NOT NULL DEFAULT 'Menunggu',
  createdAt text NOT NULL
);

CREATE TABLE IF NOT EXISTS inv_referrals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrerId bigint NOT NULL REFERENCES inv_users(id),
  friendId bigint NOT NULL REFERENCES inv_users(id),
  qualified integer NOT NULL DEFAULT 0,
  createdAt text NOT NULL,
  UNIQUE (referrerId, friendId)
);

CREATE TABLE IF NOT EXISTS inv_invite_claims (
  userId bigint NOT NULL REFERENCES inv_users(id),
  tier integer NOT NULL,
  amountRp bigint NOT NULL,
  createdAt text NOT NULL,
  PRIMARY KEY (userId, tier)
);

CREATE TABLE IF NOT EXISTS inv_checkins (
  userId bigint NOT NULL REFERENCES inv_users(id),
  date text NOT NULL,
  tier integer NOT NULL,
  voucherId bigint NOT NULL REFERENCES inv_vouchers(id),
  PRIMARY KEY (userId, date)
);

CREATE TABLE IF NOT EXISTS inv_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  text text NOT NULL DEFAULT '',
  imageKey text,
  visible integer NOT NULL DEFAULT 1,
  createdAt text NOT NULL
);

CREATE TABLE IF NOT EXISTS inv_chat (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  userId bigint NOT NULL REFERENCES inv_users(id),
  sender text NOT NULL,
  message text NOT NULL,
  createdAt text NOT NULL
);

CREATE TABLE IF NOT EXISTS inv_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS inv_blobs (
  key text PRIMARY KEY,
  mime text NOT NULL,
  data text NOT NULL
);

-- FK sirkular inv_vouchers.usedOrderId -> inv_orders(id) ditambah di sini,
-- SETELAH semua tabel ada. DO block membuatnya idempotent (aman dijalankan
-- berulang, dan aman untuk database lama yang sudah punya FK ini).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inv_vouchers_usedorderid_fkey') THEN
    ALTER TABLE inv_vouchers ADD CONSTRAINT inv_vouchers_usedorderid_fkey FOREIGN KEY (usedOrderId) REFERENCES inv_orders(id);
  END IF;
END $$;
