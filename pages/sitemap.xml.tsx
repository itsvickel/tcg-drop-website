import type { GetServerSideProps } from "next";
import { TCG_CONFIGS } from "../lib/tcg.config";
import { loadApiResponse } from "../lib/serverProducts";
import { SITE_URL } from "../lib/siteUrl";
import { summariseRetailers } from "../lib/retailers";
import type { Product } from "../lib/products";

const SITE = SITE_URL;
const ACTIVE_GAMES = ["pokemon", "mtg"] as const;

function url(loc: string, changefreq: string, priority: string): string {
  return `<url><loc>${loc}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const entries: string[] = [];

  for (const tcg of ACTIVE_GAMES) {
    entries.push(url(`${SITE}/${tcg}/sealed`, "daily", "1.0"));
    entries.push(url(`${SITE}/${tcg}/singles`, "daily", "0.8"));
    entries.push(url(`${SITE}/${tcg}/deals`, "daily", "0.9"));
  }
  for (const tcg of ACTIVE_GAMES) {
    entries.push(url(`${SITE}/movers?tcg=${tcg}`, "daily", "0.8"));
    entries.push(url(`${SITE}/sets?tcg=${tcg}`, "weekly", "0.7"));
  }
  entries.push(url(`${SITE}/drops`, "daily", "0.8"));
  entries.push(url(`${SITE}/retailers`, "weekly", "0.7"));
  entries.push(url(`${SITE}/calendar`, "weekly", "0.7"));
  // One entry, not one per game: the page picks its game from a query param
  // and the content is otherwise identical, so listing both would be two URLs
  // for one page.
  entries.push(url(`${SITE}/scan`, "weekly", "0.7"));

  // Product pages — the long tail. The feeds are kept so the retailer pages
  // can be listed from the same load rather than fetching them twice.
  const feeds: { game: string; products: Product[] }[] = [];
  for (const tcg of ACTIVE_GAMES) {
    try {
      const feed = await loadApiResponse(TCG_CONFIGS[tcg]);
      feeds.push({ game: tcg, products: feed.products });
      for (const product of feed.products) {
        entries.push(
          url(`${SITE}/${tcg}/${encodeURIComponent(product.group_key)}`, "daily", "0.5")
        );
      }
    } catch {
      // Feed unavailable — ship the static entries rather than failing
    }
  }

  // One page per retailer. Listed from live data rather than a hardcoded list,
  // so a shop the crawler picked up this morning is discoverable today.
  for (const retailer of summariseRetailers(feeds)) {
    entries.push(url(`${SITE}/retailers/${retailer.slug}`, "weekly", "0.6"));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>`;

  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");
  res.write(xml);
  res.end();

  return { props: {} };
};

export default function Sitemap() {
  return null;
}
