/**
 * dataFetcher.ts — Transparent data source abstraction.
 *
 * Priority:
 *   1. Vercel Blob (fast, no rate limits) — when BLOB_READ_WRITE_TOKEN is set
 *   2. GitHub raw API — fallback, rate-limited at 60 req/h unauthenticated
 *
 * Setup: add BLOB_READ_WRITE_TOKEN to Vercel environment variables.
 * Then upload game data with: pnpm blob:upload (see scripts/ below).
 *
 * Blob URL format: <BLOB_BASE_URL>/<game>/<filename>
 * e.g. https://abc.public.blob.vercel-storage.com/pokemon/state.json
 */

/**
 * How long any single upstream read may take.
 *
 * None of these had a deadline, which meant a slow blob or a stalled GitHub
 * connection hung until something else gave up first. During a build that
 * something else is Next's static worker, which kills the page at 60 seconds,
 * retries three times and then fails the whole build — so a page with a
 * perfectly good try/catch fallback never reached its catch, because the fetch
 * had not failed, it had merely not finished. That is how a slow network turns
 * into a failed deploy with nothing in the log to explain it.
 *
 * Fifteen seconds is far longer than a healthy read of a few hundred kilobytes
 * and comfortably inside the 60 second budget, so a timeout now degrades to the
 * GitHub fallback, or to the page's own cached or empty state, instead of
 * taking the deploy down.
 */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * A checkout of the data repo to read from instead of the network, in
 * development only.
 *
 * Without this the site is close to unusable locally. The GitHub contents API
 * serves these files slowly from some networks — measured here at 45 seconds
 * for the 287KB card index and 17 for the prices — so every page fell back or
 * timed out, and the scanner in particular came up with an empty fingerprint
 * table and silently degraded to reading titles. That made the one feature that
 * most needs hands-on testing the one feature that could not be tested.
 *
 * Set LOCAL_DATA_DIR to point at a tcg-drop-alert checkout, or leave it unset
 * and the sibling directory is used when it exists.
 *
 * Gated on Vercel's own marker rather than NODE_ENV, because `next build` sets
 * NODE_ENV=production and a local production build is exactly when this is
 * wanted: otherwise every prerendered page waits on the same slow API and
 * builds with empty data, which is not a useful rehearsal of the real one.
 * On Vercel the variable is always set, so this is never consulted there.
 */
const LOCAL_DATA_DIR = process.env.VERCEL
  ? ""
  : process.env.LOCAL_DATA_DIR ?? "../tcg-drop-alert";

const BLOB_BASE_URL = process.env.BLOB_BASE_URL ?? "";
const GITHUB_REPO   = process.env.GITHUB_REPO ?? "";
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN ?? "";

async function fetchFromBlob<T>(blobPath: string): Promise<T> {
  if (!BLOB_BASE_URL) throw new Error("BLOB_BASE_URL not set");
  const url = `${BLOB_BASE_URL}/${blobPath}`;
  const res = await fetch(url, {
    next: { revalidate: 180 },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  } as RequestInit);
  if (!res.ok) throw new Error(`Blob fetch failed: ${res.status} for ${blobPath}`);
  return res.json() as Promise<T>;
}

/**
 * The local file for a data path, if we are in development and it exists.
 *
 * Deliberately synchronous and cheap: it runs before every fetch, and an
 * existsSync on a path that is usually absent costs nothing worth measuring.
 */
function localDataFile(filePath: string): string | null {
  if (!LOCAL_DATA_DIR) return null;
  try {
    // Required lazily so the bundler never pulls node:fs into a client build.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const full = path.resolve(process.cwd(), LOCAL_DATA_DIR, filePath);
    return fs.existsSync(full) ? full : null;
  } catch {
    return null;
  }
}

function readLocal(file: string): Buffer {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  const fs = require("fs") as typeof import("fs");
  return fs.readFileSync(file);
}

async function fetchFromGitHub<T>(filePath: string): Promise<T> {
  if (!GITHUB_REPO || !GITHUB_TOKEN) throw new Error("GITHUB_REPO or GITHUB_TOKEN not set");
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.raw+json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub fetch failed: ${res.status} for ${filePath} — ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export type DataSource = "blob" | "github";

/**
 * Fetch a game data file, preferring Vercel Blob when available, and report
 * which source served it (surfaced on the health dashboard).
 *
 * @param gameFolder - e.g. "" (pokemon root) or "mtg"
 * @param fileName   - e.g. "state.json"
 */
export async function fetchGameDataWithSource<T>(
  gameFolder: string,
  fileName: string
): Promise<{ data: T; source: DataSource }> {
  const filePath = gameFolder ? `${gameFolder}/${fileName}` : fileName;

  const local = localDataFile(filePath);
  if (local) {
    const raw = readLocal(local);
    const text = filePath.endsWith(".gz")
      ? (require("zlib") as typeof import("zlib")).gunzipSync(raw).toString("utf-8")
      : raw.toString("utf-8");
    return { data: JSON.parse(text) as T, source: "github" };
  }

  if (BLOB_BASE_URL) {
    try {
      return { data: await fetchFromBlob<T>(filePath), source: "blob" };
    } catch (err) {
      // Log but fall through to GitHub
      console.warn(`[dataFetcher] Blob miss for ${filePath}:`, err);
    }
  }

  return { data: await fetchFromGitHub<T>(filePath), source: "github" };
}

/**
 * Fetch a game data file, preferring Vercel Blob when available.
 */
export async function fetchGameData<T>(gameFolder: string, fileName: string): Promise<T> {
  const { data } = await fetchGameDataWithSource<T>(gameFolder, fileName);
  return data;
}

/**
 * Fetch a game data file as raw bytes, for the ones that are not JSON.
 *
 * Needed by the gzipped singles inventory: `.json()` on a gzip stream returns
 * mojibake rather than throwing, so it has to be read as bytes and inflated by
 * the caller. Blob serves the compressed file as-is; GitHub's contents API is
 * asked for the raw blob rather than the base64 JSON wrapper.
 */
export async function fetchGameBytes(
  gameFolder: string,
  fileName: string
): Promise<Buffer> {
  const filePath = gameFolder ? `${gameFolder}/${fileName}` : fileName;

  const local = localDataFile(filePath);
  if (local) return readLocal(local);

  if (BLOB_BASE_URL) {
    try {
      const res = await fetch(`${BLOB_BASE_URL}/${filePath}`, {
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      } as RequestInit);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.warn(`[dataFetcher] Blob miss for ${filePath}:`, err);
    }
  }

  if (!GITHUB_REPO || !GITHUB_TOKEN) throw new Error("GITHUB_REPO or GITHUB_TOKEN not set");
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.raw",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status} for ${filePath}`);
  return Buffer.from(await res.arrayBuffer());
}

/*
 * ── Vercel Blob upload script ──────────────────────────────────────────────
 *
 * Add this to package.json scripts:
 *   "blob:upload": "npx tsx scripts/uploadBlob.ts"
 *
 * Then create scripts/uploadBlob.ts:
 *
 *   import { put } from "@vercel/blob";
 *   import { readFileSync } from "fs";
 *
 *   const GAMES = [
 *     { folder: "",    files: ["state.json", "price_history.json", "stock_changes.json"] },
 *     { folder: "mtg", files: ["state.json", "price_history.json", "stock_changes.json"] },
 *   ];
 *
 *   for (const { folder, files } of GAMES) {
 *     for (const file of files) {
 *       const content = readFileSync(`../tcg-drop-alert/${folder ? folder + "/" : ""}${file}`);
 *       const blobPath = folder ? `${folder}/${file}` : file;
 *       const { url } = await put(blobPath, content, { access: "public", addRandomSuffix: false });
 *       console.log("Uploaded:", blobPath, "→", url);
 *     }
 *   }
 *
 * Run: BLOB_READ_WRITE_TOKEN=... npx tsx scripts/uploadBlob.ts
 *
 * Then set BLOB_BASE_URL in Vercel env to the base URL prefix (without trailing slash).
 * Example: https://abc123.public.blob.vercel-storage.com
 *
 * The GitHub Actions scrapers should also upload after each scan.
 * Add this step to .github/workflows/pokemon-tracker.yml after "Persist state":
 *
 *   - name: Upload to Vercel Blob
 *     if: env.BLOB_READ_WRITE_TOKEN != ''
 *     env:
 *       BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}
 *     run: |
 *       pip install requests
 *       python scripts/upload_blob.py
 */
