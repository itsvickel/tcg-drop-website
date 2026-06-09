-- TCG Drop initial schema
-- Run via: supabase db push  (after linking your project)

-- ── price_history ─────────────────────────────────────────────────────────────
-- Replaces the flat price_history.json files.
-- Indexed for fast "get history for product X in game Y" queries.

create table if not exists price_history (
  id          bigserial primary key,
  tcg         text        not null,           -- 'pokemon' | 'mtg' etc.
  group_key   text        not null,
  date        date        not null,
  price       numeric(8,2) not null,
  retailer    text        not null,
  created_at  timestamptz default now()
);

create index if not exists price_history_lookup
  on price_history (tcg, group_key, date desc);

-- Prevent duplicate daily entries per product+retailer
create unique index if not exists price_history_unique_day
  on price_history (tcg, group_key, date, retailer);

-- ── wishlists ─────────────────────────────────────────────────────────────────
-- Email-keyed cross-device wishlist. No passwords; email is the identifier.
-- Hashed to avoid storing PII in plaintext (use SHA-256 hex of lowercase email).

create table if not exists wishlists (
  id          bigserial primary key,
  email_hash  text        not null,           -- SHA-256(lowercase(email))
  tcg         text        not null,
  group_key   text        not null,
  product_name text       not null,
  added_at    timestamptz default now(),
  constraint wishlists_unique unique (email_hash, tcg, group_key)
);

create index if not exists wishlists_by_email on wishlists (email_hash, tcg);

-- ── user_alerts ───────────────────────────────────────────────────────────────
-- Mirrors alerts.json but in Postgres for faster queries.
-- The JSON file remains the source of truth for the Python scraper;
-- this table is for the web UI lookups.

create table if not exists user_alerts (
  id              uuid primary key default gen_random_uuid(),
  email_hash      text        not null,
  email           text        not null,       -- stored for email dispatch
  tcg             text        not null,
  group_key       text        not null,
  product_name    text        not null,
  threshold       numeric(8,2) not null,
  created_at      timestamptz default now(),
  last_triggered  timestamptz,
  active          boolean     default true,
  constraint user_alerts_unique unique (email, tcg, group_key)
);

create index if not exists user_alerts_active on user_alerts (email_hash, active);

-- ── Row-level security ────────────────────────────────────────────────────────
-- Enable RLS. Access is controlled by email_hash matching.
-- These policies assume you pass email_hash as a query param and validate
-- server-side (not via Supabase auth JWT — we're using email-only, no accounts).

alter table price_history enable row level security;
alter table wishlists      enable row level security;
alter table user_alerts    enable row level security;

-- price_history is read-only from the client (writes come from server-side API)
create policy "price_history read" on price_history
  for select using (true);

-- wishlists: server-side only (no direct client access)
create policy "wishlists server" on wishlists
  using (false);

-- user_alerts: server-side only
create policy "user_alerts server" on user_alerts
  using (false);
