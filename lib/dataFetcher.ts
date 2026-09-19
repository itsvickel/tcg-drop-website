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

const BLOB_BASE_URL = process.env.BLOB_BASE_URL ?? "";
const GITHUB_REPO   = process.env.GITHUB_REPO ?? "";
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN ?? "";

async function fetchFromBlob<T>(blobPath: string): Promise<T> {
  if (!BLOB_BASE_URL) throw new Error("BLOB_BASE_URL not set");
  const url = `${BLOB_BASE_URL}/${blobPath}`;
  const res = await fetch(url, { next: { revalidate: 180 } } as RequestInit);
  if (!res.ok) throw new Error(`Blob fetch failed: ${res.status} for ${blobPath}`);
  return res.json() as Promise<T>;
}

async function fetchFromGitHub<T>(filePath: string): Promise<T> {
  if (!GITHUB_REPO || !GITHUB_TOKEN) throw new Error("GITHUB_REPO or GITHUB_TOKEN not set");
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.raw+json",
    },
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

  if (BLOB_BASE_URL) {
    try {
      const res = await fetch(`${BLOB_BASE_URL}/${filePath}`, {
        next: { revalidate: 900 },
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
