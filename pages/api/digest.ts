import type { NextApiRequest, NextApiResponse } from "next";
import type { ApiResponse, Product } from "./products";

const SECRET = process.env.DIGEST_SECRET ?? "";
const TOP_N  = 10;

export type DigestDeal = Pick<
  Product,
  | "group_key"
  | "name"
  | "price"
  | "all_time_low"
  | "price_change_7d"
  | "deal_score"
  | "msrp"
  | "image_url"
  | "url"
  | "retailer"
>;

export type DigestResponse = {
  generated_at: string;
  week: string;
  deals: DigestDeal[];
};

function getWeekString(now: Date): string {
  const d = new Date(now);
  const dayOfWeek = d.getDay();
  const daysToMonday = (dayOfWeek + 6) % 7;
  d.setDate(d.getDate() - daysToMonday);
  return d.toISOString().slice(0, 10);
}

function buildHtml(deals: DigestDeal[], week: string): string {
  const rows = deals
    .map((d, i) => {
      const dropBadge =
        d.price_change_7d !== null && d.price_change_7d < 0
          ? `<span style="color:#3fb950;font-weight:700;">↓${Math.abs(
              d.price_change_7d
            ).toFixed(0)}%</span>`
          : "";
      const msrpLine =
        d.msrp !== null && d.msrp > d.price
          ? `<div style="font-size:12px;color:#8b949e;">MSRP $${d.msrp.toFixed(2)} &middot; ${(
              ((d.msrp - d.price) / d.msrp) *
              100
            ).toFixed(0)}% off</div>`
          : "";
      const imgTag = d.image_url
        ? `<img src="${d.image_url}" alt="" width="48" height="48" style="object-fit:contain;border-radius:4px;" />`
        : "";
      return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #30363d;vertical-align:middle;font-size:13px;color:#8b949e;">${
            i + 1
          }</td>
          <td style="padding:10px 8px;border-bottom:1px solid #30363d;vertical-align:middle;">${imgTag}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #30363d;vertical-align:middle;">
            <div style="font-weight:600;color:#c9d1d9;">${d.name}</div>
            <div style="font-size:12px;color:#8b949e;">${d.retailer}</div>
            ${msrpLine}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #30363d;vertical-align:middle;text-align:right;white-space:nowrap;">
            <div style="font-family:monospace;font-weight:700;color:#58a6ff;">$${d.price.toFixed(
              2
            )}</div>
            ${dropBadge}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #30363d;vertical-align:middle;text-align:center;">
            <a href="${d.url}" style="background:#238636;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">Buy</a>
          </td>
        </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pokemon TCG Top Deals — Week of ${week}</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <h1 style="color:#c9d1d9;font-size:20px;margin:0 0 4px;">🔥 Top Pokemon TCG deals</h1>
    <p style="color:#8b949e;font-size:13px;margin:0 0 24px;">Week of ${week} &middot; Canadian retailers &middot; Prices in CAD</p>
    <table style="width:100%;border-collapse:collapse;">
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:24px;font-size:12px;color:#8b949e;text-align:center;">
      <a href="{{unsubscribe_url}}" style="color:#58a6ff;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (SECRET) {
    const auth = (req.headers.authorization ?? "").trim();
    if (auth !== `Bearer ${SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const host = req.headers.host ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const productsRes = await fetch(`${protocol}://${host}/api/products`, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!productsRes.ok) {
      throw new Error(`products endpoint returned ${productsRes.status}`);
    }

    const data = (await productsRes.json()) as ApiResponse;
    const products = data.products ?? [];

    const deals: DigestDeal[] = products
      .filter((p) => p.in_stock && p.deal_score > 0)
      .sort((a, b) => b.deal_score - a.deal_score)
      .slice(0, TOP_N)
      .map((p) => ({
        group_key:      p.group_key,
        name:           p.name,
        price:          p.price,
        all_time_low:   p.all_time_low,
        price_change_7d: p.price_change_7d,
        deal_score:     p.deal_score,
        msrp:           p.msrp,
        image_url:      p.image_url,
        url:            p.url,
        retailer:       p.retailer,
      }));

    const week         = getWeekString(new Date());
    const generated_at = new Date().toISOString();

    if (req.query.format === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");
      return res.status(200).send(buildHtml(deals, week));
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");
    const payload: DigestResponse = { generated_at, week, deals };
    return res.status(200).json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
}
