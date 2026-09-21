/**
 * siteUrl.ts — the single source of truth for this site's public origin.
 *
 * It was previously hardcoded in three places with *two different domains*:
 * the sitemap and alert emails said pokemon-drop.ca, while the canonical tag on
 * product pages said tcgdrop.ca. That splits ranking signal between two hosts
 * and, worse, both currently fail to resolve — so the sitemap was advertising
 * dead URLs and alert emails were linking people nowhere.
 *
 * Set NEXT_PUBLIC_SITE_URL in the Vercel project to whichever domain is live.
 * NEXT_PUBLIC_ is required because the canonical tag is rendered client-side;
 * a server-only variable would be undefined there and cause a hydration
 * mismatch. It is readable from server code too, so API routes share it.
 *
 * The fallback is the Vercel domain rather than a custom one, because a URL
 * that resolves is always better than a prettier one that does not — and that
 * is not hypothetical. The project was renamed and the old vercel.app host
 * started returning 404 for everything, while NEXT_PUBLIC_SITE_URL was never
 * set. So every canonical tag told Google the real page lived at a dead URL,
 * the whole sitemap advertised dead URLs, and alert emails linked people
 * nowhere. Keep this pointing at a host that actually answers.
 */

const FALLBACK = "https://themanacafe.vercel.app";

function normalize(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return FALLBACK;
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export const SITE_URL: string = normalize(
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_BASE_URL ?? FALLBACK
);

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}/${path.replace(/^\/+/, "")}`;
}
