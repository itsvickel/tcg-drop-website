import type { NextApiRequest, NextApiResponse } from "next";
import { getTcgConfig } from "../../lib/tcg.config";
import { loadApiResponseCached } from "../../lib/serverProducts";
import { getClientIp, rateLimit } from "../../lib/rateLimit";
import type { PricePoint } from "../../lib/collectionHistory";

/**
 * Price history for a named set of products — the input to the collection value
 * chart.
 *
 * POST rather than GET, and this is the whole reason: the request body is a
 * list of what somebody owns. In a query string that list would land in access
 * logs, in any proxy along the way, and in a shareable URL. It is not worth a
 * cache hit.
 *
 * The server is told which products, never how many or what they cost. The page
 * multiplies by quantity and compares against cost basis on the client, so a
 * request here cannot reconstruct the value of anyone's collection.
 *
 * Existing routes serve history too, but neither fits: /api/products trims each
 * product to ten points for the list payload, and lifting that for a whole feed
 * to chart twenty holdings would ship several megabytes. /api/product/[key]
 * carries full history but one product per request.
 */

export type CollectionHistoryResponse = {
  series: Record<string, PricePoint[]>;
  /** Keys we were asked about but do not track. */
  missing: string[];
};

/**
 * A collection larger than this is almost certainly a script. Real ones are
 * dozens of rows; the cap is generous enough that no honest user meets it and
 * low enough that one request cannot walk the catalogue.
 */
const MAX_KEYS = 250;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CollectionHistoryResponse | { error: string }>
) {
  // Per-user data, so never shared by a CDN. The upstream feed this reads is
  // already cached server-side, so the cost of a miss here is small.
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limited = rateLimit(getClientIp(req));
  if (!limited.allowed) {
    res.setHeader("Retry-After", String(Math.ceil(limited.retryAfterMs / 1000)));
    return res.status(429).json({ error: "Too many requests" });
  }

  const body = (req.body ?? {}) as { tcg?: unknown; keys?: unknown };

  let config;
  try {
    config = getTcgConfig(typeof body.tcg === "string" ? body.tcg : "pokemon");
  } catch {
    return res.status(400).json({ error: "Invalid tcg" });
  }

  if (!Array.isArray(body.keys)) {
    return res.status(400).json({ error: "keys must be an array of group keys" });
  }
  const keys = body.keys
    .filter((k): k is string => typeof k === "string" && k.length > 0)
    .slice(0, MAX_KEYS);

  if (keys.length === 0) {
    return res.status(200).json({ series: {}, missing: [] });
  }

  try {
    const feed = await loadApiResponseCached(config);
    const byKey = new Map(feed.products.map((p) => [p.group_key, p]));

    const series: Record<string, PricePoint[]> = {};
    const missing: string[] = [];

    for (const key of keys) {
      const product = byKey.get(key);
      if (!product) {
        missing.push(key);
        continue;
      }
      // Retailer is dropped: the chart needs date and price, and the shop that
      // happened to be cheapest on a Tuesday in July is not the user's business
      // here — it is already on the product page.
      series[key] = product.history.map((h) => ({ date: h.date, price: h.price }));
    }

    return res.status(200).json({ series, missing });
  } catch (err) {
    // The underlying error carries the data-repo URL and a slice of the
    // upstream body, so it is logged and not returned.
    console.error("[api/collection-history] failed:", err);
    return res.status(503).json({ error: "Price history temporarily unavailable" });
  }
}
