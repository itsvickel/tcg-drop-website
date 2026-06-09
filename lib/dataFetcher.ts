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

/**
 * Fetch a game data file, preferring Vercel Blob when available.
 *
 * @param gameFolder - e.g. "" (pokemon root) or "mtg"
 * @param fileName   - e.g. "state.json"
 */
export async function fetchGameData<T>(gameFolder: string, fileName: string): Promise<T> {
  const filePath = gameFolder ? `${gameFolder}/${fileName}` : fileName;

  if (BLOB_BASE_URL) {
    try {
      return await fetchFromBlob<T>(filePath);
    } catch (err) {
      // Log but fall through to GitHub
      console.warn(`[dataFetcher] Blob miss for ${filePath}:`, err);
    }
  }

  return fetchFromGitHub<T>(filePath);
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
