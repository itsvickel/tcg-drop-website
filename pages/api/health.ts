import type { NextApiRequest, NextApiResponse } from "next";

type RetailerHealth = {
  retailer: string;
  productCount: number;
  inStockCount: number;
  lastSeen: string | null;
};

type GameHealth = {
  tcg: string;
  retailerStats: RetailerHealth[];
  totalProducts: number;
  totalInStock: number;
  generatedAt: string;
  stateAge: string;
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

async function fetchStateJson(repo: string, token: string, path: string): Promise<StateJson> {
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw+json",
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<StateJson>;
}

function buildGameHealth(tcg: string, state: StateJson): GameHealth {
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
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse | ErrorResponse>
) {
  const repo  = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !token) {
    res.status(500).json({ error: "Missing GITHUB_REPO or GITHUB_TOKEN" });
    return;
  }

  try {
    const [pokemonState, mtgState] = await Promise.all([
      fetchStateJson(repo, token, "state.json"),
      fetchStateJson(repo, token, "mtg/state.json").catch(() => ({} as StateJson)),
    ]);

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");
    res.status(200).json({
      games: [
        buildGameHealth("pokemon", pokemonState),
        buildGameHealth("mtg", mtgState),
      ],
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
}
