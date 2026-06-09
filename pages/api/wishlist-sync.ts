/**
 * /api/wishlist-sync — Email-based cross-device wishlist sync via Supabase.
 *
 * POST body: { email, tcg, items: [{ group_key, product_name }] }
 *   → writes items to Supabase, returns merged list
 *
 * GET  ?email=<hash>&tcg=<slug>
 *   → returns saved wishlist for this email
 *
 * DELETE body: { email, tcg, group_key }
 *   → removes one item
 *
 * Email is hashed (SHA-256) server-side before storage.
 * We never store the raw email in the wishlist table.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "crypto";
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  type WishlistRow,
} from "../../lib/supabase";

function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export type WishlistSyncItem = {
  group_key: string;
  product_name: string;
};

export type WishlistSyncResponse = {
  items: WishlistSyncItem[];
  tcg: string;
};

type ErrorResponse = { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WishlistSyncResponse | { ok: true } | ErrorResponse>
) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(503).json({ error: "Cloud sync not configured (SUPABASE_URL missing)" });
  }

  // GET — fetch saved wishlist
  if (req.method === "GET") {
    const { email, tcg } = req.query;
    if (typeof email !== "string" || !isValidEmail(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }
    if (typeof tcg !== "string") {
      return res.status(400).json({ error: "tcg param required" });
    }
    const emailHash = hashEmail(email);
    const rows = await getWishlist(emailHash, tcg);
    return res.status(200).json({
      tcg,
      items: rows.map((r) => ({ group_key: r.group_key, product_name: r.product_name })),
    });
  }

  // POST — push local wishlist to cloud (merge)
  if (req.method === "POST") {
    const { email, tcg, items } = req.body as {
      email?: string;
      tcg?: string;
      items?: WishlistSyncItem[];
    };
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }
    if (!tcg || typeof tcg !== "string") {
      return res.status(400).json({ error: "tcg required" });
    }
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "items array required" });
    }
    const emailHash = hashEmail(email);
    await Promise.all(
      items.map((item) =>
        addToWishlist({ email_hash: emailHash, tcg, group_key: item.group_key, product_name: item.product_name })
      )
    );
    // Return the full merged wishlist
    const rows = await getWishlist(emailHash, tcg);
    return res.status(200).json({
      tcg,
      items: rows.map((r) => ({ group_key: r.group_key, product_name: r.product_name })),
    });
  }

  // DELETE — remove one item
  if (req.method === "DELETE") {
    const { email, tcg, group_key } = req.body as {
      email?: string;
      tcg?: string;
      group_key?: string;
    };
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }
    if (!tcg || !group_key) {
      return res.status(400).json({ error: "tcg and group_key required" });
    }
    const emailHash = hashEmail(email);
    await removeFromWishlist(emailHash, tcg, group_key);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
