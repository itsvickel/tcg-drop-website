import type { NextApiRequest, NextApiResponse } from "next";
import { fetchGameBytes, fetchGameDataWithSource, type DataSource } from "../../lib/dataFetcher";
import { gunzipSync } from "zlib";
import type { SinglesEnrichmentJson } from "../../lib/products";

type RetailerHealth = {
  retailer: string;
  productCount: number;
  inStockCount: number;
  lastSeen: string | null;
};

type SinglesHealth = {
  matched: number;
  unmatched: number;
  generatedAt: string;
  ageHours: number;
};

/**
 * Whether the scanner has anything to work with.
 *
 * Worth reporting because its failure is silent: with no fingerprint table the
 * scanner falls back to reading card titles and still looks like it is working,
 * just badly. That cost a long time to notice once already. Here it is a
 * number that is either large or zero.
 */
type ScannerHealth = {
  /** Artwork fingerprints available to match against. */
  fingerprints: number;
  fingerprintsAgeHours: number | null;
  /** Cards in the searchable catalogue. */
  catalogue: number;
  /** Cards with a TCGplayer market price. */
  priced: number;
  pricedAgeHours: number | null;
};

type GameHealth = {
  tcg: string;
  retailerStats: RetailerHealth[];
  totalProducts: number;
  totalInStock: number;
  generatedAt: string;
  stateAge: string;
  dataSource: DataSource;
  singles: SinglesHealth | null;
  scanner: ScannerHealth;
};

type HealthResponse = {
  games: GameHealth[];
  fetchedAt: string;
};

type ErrorResponse = { error: string };

type StateRawProduct = {
  retailer: string;
  price: number;
  in_stock: boolean;
  last_seen: string;
};

type StateJson = {
  products?: Record<string, StateRawProduct>;
  generated_at?: string;
};

function buildSinglesHealth(enrichment: SinglesEnrichmentJson | null): SinglesHealth | null {
  if (!enrichment?.generated_at) return null;
  return {
    matched: enrichment.matched ?? 0,
    unmatched: enrichment.unmatched ?? 0,
    generatedAt: enrichment.generated_at,
    ageHours: Math.round((Date.now() - new Date(enrichment.generated_at).getTime()) / 3600000),
  };
}

const EMPTY_SCANNER: ScannerHealth = {
  fingerprints: 0,
  fingerprintsAgeHours: null,
  catalogue: 0,
  priced: 0,
  pricedAgeHours: null,
};

function ageHours(generatedAt: unknown): number | null {
  if (typeof generatedAt !== "string") return null;
  const then = Date.parse(generatedAt);
  return Number.isNaN(then) ? null : Math.round((Date.now() - then) / 3600000);
}

/** A gzipped data file, parsed, or null if it is not published for this game. */
async function readGz<T>(folder: string, file: string): Promise<T | null> {
  try {
    const raw = await fetchGameBytes(folder, file);
    // Sniffed: a .gz served with Content-Encoding: gzip arrives already
    // inflated, and inflating twice throws.
    const isGzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    return JSON.parse((isGzip ? gunzipSync(raw) : raw).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

async function buildScannerHealth(folder: string): Promise<ScannerHealth> {
  const [hashes, index, prices] = await Promise.all([
    readGz<{ generated_at?: string; hashes?: Record<string, string> }>(folder, "card_hashes.json.gz"),
    readGz<{ cards?: unknown[] }>(folder, "card_index.json.gz"),
    readGz<{ generated_at?: string; cards?: Record<string, unknown> }>(folder, "tcgplayer_prices.json.gz"),
  ]);
  return {
    fingerprints: Object.keys(hashes?.hashes ?? {}).length,
    fingerprintsAgeHours: ageHours(hashes?.generated_at),
    catalogue: (index?.cards ?? []).length,
    priced: Object.keys(prices?.cards ?? {}).length,
    pricedAgeHours: ageHours(prices?.generated_at),
  };
}

function buildGameHealth(
  tcg: string,
  state: StateJson,
  dataSource: DataSource,
  singles: SinglesHealth | null
): Omit<GameHealth, "scanner"> {
  const byRetailer = new Map<string, RetailerHealth>();

  for (const raw of Object.values(state.products ?? {})) {
    if (!raw.retailer || raw.price == null || raw.price < 3) continue;
    const existing = byRetailer.get(raw.retailer) ?? {
      retailer: raw.retailer,
      productCount: 0,
      inStockCount: 0,
      lastSeen: null,
    };
    existing.productCount++;
    if (raw.in_stock) existing.inStockCount++;
    if (!existing.lastSeen || (raw.last_seen && raw.last_seen > existing.lastSeen)) {
      existing.lastSeen = raw.last_seen ?? null;
    }
    byRetailer.set(raw.retailer, existing);
  }

  const retailerStats = Array.from(byRetailer.values()).sort(
    (a, b) => b.productCount - a.productCount
  );

  const totalProducts = retailerStats.reduce((s, r) => s + r.productCount, 0);
  const totalInStock  = retailerStats.reduce((s, r) => s + r.inStockCount, 0);

  const stateAge = state.generated_at
    ? Math.round((Date.now() - new Date(state.generated_at).getTime()) / 60000) + " min ago"
    : "unknown";

  return {
    tcg,
    retailerStats,
    totalProducts,
    totalInStock,
    generatedAt: state.generated_at ?? "",
    stateAge,
    dataSource,
    singles,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse | ErrorResponse>
) {
  const hasGithub = !!(process.env.GITHUB_REPO && process.env.GITHUB_TOKEN);
  const hasBlob   = !!process.env.BLOB_BASE_URL;

  if (!hasGithub && !hasBlob) {
    res.status(500).json({ error: "Missing GITHUB_REPO/GITHUB_TOKEN (or BLOB_BASE_URL)" });
    return;
  }

  try {
    const emptyState = { data: {} as StateJson, source: "github" as DataSource };
    const [pokemonState, mtgState, mtgEnrichment, pokemonScanner, mtgScanner] =
      await Promise.all([
        fetchGameDataWithSource<StateJson>("", "state.json"),
        fetchGameDataWithSource<StateJson>("mtg", "state.json").catch(() => emptyState),
        fetchGameDataWithSource<SinglesEnrichmentJson>("mtg", "singles_enrichment.json")
          .then((r) => r.data)
          .catch(() => null),
        buildScannerHealth("").catch(() => EMPTY_SCANNER),
        buildScannerHealth("mtg").catch(() => EMPTY_SCANNER),
      ]);

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");
    res.status(200).json({
      games: [
        { ...buildGameHealth("pokemon", pokemonState.data, pokemonState.source, null),
          scanner: pokemonScanner },
        { ...buildGameHealth("mtg", mtgState.data, mtgState.source, buildSinglesHealth(mtgEnrichment)),
          scanner: mtgScanner },
      ],
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
}
