/**
 * The site origin used to be hardcoded in three places with two different
 * domains, both of which stopped resolving. These tests pin the normalisation
 * so a trailing slash or a bare hostname in the env var cannot produce a
 * malformed canonical tag or sitemap entry.
 *
 * SITE_URL is resolved at module load, so each case re-imports in isolation.
 */

function loadWith(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  let mod: typeof import("../lib/siteUrl");
  jest.isolateModules(() => {
    mod = require("../lib/siteUrl");
  });
  process.env = saved;
  return mod!;
}

const CLEAR = { NEXT_PUBLIC_SITE_URL: undefined, SITE_BASE_URL: undefined };

describe("SITE_URL", () => {
  it("prefers NEXT_PUBLIC_SITE_URL", () => {
    const { SITE_URL } = loadWith({ ...CLEAR, NEXT_PUBLIC_SITE_URL: "https://example.ca" });
    expect(SITE_URL).toBe("https://example.ca");
  });

  it("falls back to SITE_BASE_URL for server-only contexts", () => {
    const { SITE_URL } = loadWith({ ...CLEAR, SITE_BASE_URL: "https://server-only.ca" });
    expect(SITE_URL).toBe("https://server-only.ca");
  });

  it("strips trailing slashes so joined paths never double up", () => {
    const { SITE_URL, absoluteUrl } = loadWith({ ...CLEAR, NEXT_PUBLIC_SITE_URL: "https://example.ca///" });
    expect(SITE_URL).toBe("https://example.ca");
    expect(absoluteUrl("sitemap.xml")).toBe("https://example.ca/sitemap.xml");
  });

  it("adds a scheme to a bare hostname", () => {
    const { SITE_URL } = loadWith({ ...CLEAR, NEXT_PUBLIC_SITE_URL: "example.ca" });
    expect(SITE_URL).toBe("https://example.ca");
  });

  it("ignores an empty env var rather than producing a schemeless URL", () => {
    const { SITE_URL } = loadWith({ ...CLEAR, NEXT_PUBLIC_SITE_URL: "   " });
    expect(SITE_URL).toMatch(/^https:\/\/.+/);
  });

  it("defaults to a host that actually resolves", () => {
    // Hardcoded on purpose, and it is meant to fail when the site moves.
    //
    // It already has. The project was renamed, the old vercel.app host started
    // 404ing everything, NEXT_PUBLIC_SITE_URL was never set — and so every
    // canonical tag told Google the real page lived at a dead URL, the sitemap
    // advertised dead URLs, and alert emails linked people nowhere. Nothing
    // caught it, because a stale constant looks exactly like a fresh one.
    //
    // So this test exists to make a rename impossible to do quietly. If you are
    // here because it failed: check the new host answers before updating it.
    const { SITE_URL } = loadWith(CLEAR);
    expect(SITE_URL).toBe("https://themanacafe.vercel.app");
  });
});

describe("absoluteUrl", () => {
  it("joins a leading-slash path without doubling", () => {
    const { absoluteUrl } = loadWith({ ...CLEAR, NEXT_PUBLIC_SITE_URL: "https://example.ca" });
    expect(absoluteUrl("/mtg/foo")).toBe("https://example.ca/mtg/foo");
    expect(absoluteUrl("mtg/foo")).toBe("https://example.ca/mtg/foo");
  });
});
