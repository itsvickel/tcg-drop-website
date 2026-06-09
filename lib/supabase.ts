/**
 * supabase.ts — Supabase client singleton.
 *
 * Setup:
 *   1. pnpm add @supabase/supabase-js
 *   2. Add to Vercel env vars:
 *        SUPABASE_URL=https://xxxx.supabase.co
 *        SUPABASE_ANON_KEY=eyJhbGci...
 *   3. Run migration: supabase db push  (or paste SQL into Supabase SQL editor)
 *
 * When SUPABASE_URL is not set, all calls silently no-op so the app
 * continues to work with just GitHub/Blob data.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (typeof window !== "undefined") return null; // server-side only
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }
  return _client;
}

export type PriceHistoryRow = {
  tcg: string;
  group_key: string;
  date: string;
  price: number;
  retailer: string;
};

export type WishlistRow = {
  email_hash: string;
  tcg: string;
  group_key: string;
  product_name: string;
};

export type UserAlertRow = {
  id?: string;
  email_hash: string;
  email: string;
  tcg: string;
  group_key: string;
  product_name: string;
  threshold: number;
  active: boolean;
  last_triggered?: string | null;
};

/**
 * Upsert price history entries in bulk.
 * Safe to call on every scraper run — the unique index prevents duplicates.
 */
export async function upsertPriceHistory(rows: PriceHistoryRow[]): Promise<void> {
  const db = getSupabaseClient();
  if (!db || rows.length === 0) return;
  const { error } = await db
    .from("price_history")
    .upsert(rows, { onConflict: "tcg,group_key,date,retailer" });
  if (error) console.error("[supabase] price_history upsert error:", error.message);
}

/**
 * Fetch price history for a single product.
 */
export async function fetchPriceHistory(
  tcg: string,
  groupKey: string,
  limit = 90
): Promise<PriceHistoryRow[]> {
  const db = getSupabaseClient();
  if (!db) return [];
  const { data, error } = await db
    .from("price_history")
    .select("tcg, group_key, date, price, retailer")
    .eq("tcg", tcg)
    .eq("group_key", groupKey)
    .order("date", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[supabase] fetchPriceHistory error:", error.message);
    return [];
  }
  return (data ?? []) as PriceHistoryRow[];
}

/**
 * Get or create a wishlist for an email hash.
 */
export async function getWishlist(emailHash: string, tcg: string): Promise<WishlistRow[]> {
  const db = getSupabaseClient();
  if (!db) return [];
  const { data, error } = await db
    .from("wishlists")
    .select("email_hash, tcg, group_key, product_name")
    .eq("email_hash", emailHash)
    .eq("tcg", tcg);
  if (error) {
    console.error("[supabase] getWishlist error:", error.message);
    return [];
  }
  return (data ?? []) as WishlistRow[];
}

export async function addToWishlist(row: WishlistRow): Promise<void> {
  const db = getSupabaseClient();
  if (!db) return;
  const { error } = await db
    .from("wishlists")
    .upsert(row, { onConflict: "email_hash,tcg,group_key" });
  if (error) console.error("[supabase] addToWishlist error:", error.message);
}

export async function removeFromWishlist(
  emailHash: string,
  tcg: string,
  groupKey: string
): Promise<void> {
  const db = getSupabaseClient();
  if (!db) return;
  const { error } = await db
    .from("wishlists")
    .delete()
    .eq("email_hash", emailHash)
    .eq("tcg", tcg)
    .eq("group_key", groupKey);
  if (error) console.error("[supabase] removeFromWishlist error:", error.message);
}
