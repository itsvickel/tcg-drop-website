import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import styles from "../styles/Health.module.css";

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

type HealthData = {
  games: GameHealth[];
  fetchedAt: string;
};

function formatLastSeen(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 48) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

function stockRatio(r: RetailerHealth): number {
  return r.productCount > 0 ? (r.inStockCount / r.productCount) * 100 : 0;
}

function stalenessClass(lastSeen: string | null): string {
  if (!lastSeen) return styles.staleRed;
  const h = (Date.now() - new Date(lastSeen).getTime()) / 3600000;
  if (h > 12) return styles.staleRed;
  if (h > 6)  return styles.staleAmber;
  return styles.staleGreen;
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/health")
      .then(r => r.json())
      .then(setData)
      .catch(() => setError("Failed to load health data."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Head>
        <title>Scraper Health — TCG Drop</title>
        <meta name="robots" content="noindex" />
      </Head>

      <nav className={styles.topBar}>
        <Link href="/pokemon" className={styles.homeLink}>← TCG Drop</Link>
        <span className={styles.topBarTitle}>Scraper Health</span>
      </nav>

      <main className={styles.main}>
        <h1 className={styles.pageTitle}>Scraper Health Dashboard</h1>
        <p className={styles.pageSubtitle}>Per-retailer scan counts and data freshness</p>

        {loading && (
          <div className={styles.loadingRow}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className={styles.skeleton} />
            ))}
          </div>
        )}

        {error && <p className={styles.errorText}>{error}</p>}

        {data && data.games.map(game => (
          <section key={game.tcg} className={styles.gameSection}>
            <div className={styles.gameHeader}>
              <h2 className={styles.gameTitle}>
                {game.tcg === "mtg" ? "⚡ MTG" : "🔴 Pokémon"}
              </h2>
              <div className={styles.gameSummary}>
                <span className={styles.summaryChip}>
                  <strong>{game.totalProducts}</strong> products
                </span>
                <span className={styles.summaryChip}>
                  <strong>{game.totalInStock}</strong> in stock
                </span>
                <span className={styles.summaryChip}>
                  State: <strong>{game.stateAge}</strong>
                </span>
              </div>
            </div>

            <div className={styles.retailerGrid}>
              {game.retailerStats.map(r => (
                <div key={r.retailer} className={styles.retailerCard}>
                  <div className={styles.retailerCardTop}>
                    <span className={styles.retailerName}>{r.retailer}</span>
                    <span className={`${styles.freshnessIndicator} ${stalenessClass(r.lastSeen)}`} title={r.lastSeen ?? "never"} />
                  </div>

                  <div className={styles.retailerStats}>
                    <div className={styles.statPair}>
                      <span className={styles.statNum}>{r.productCount}</span>
                      <span className={styles.statDesc}>products</span>
                    </div>
                    <div className={styles.statPair}>
                      <span className={styles.statNum}>{r.inStockCount}</span>
                      <span className={styles.statDesc}>in stock</span>
                    </div>
                    <div className={styles.statPair}>
                      <span className={styles.statNum}>{stockRatio(r).toFixed(0)}%</span>
                      <span className={styles.statDesc}>availability</span>
                    </div>
                  </div>

                  <div className={styles.stockBar}>
                    <div
                      className={styles.stockBarFill}
                      style={{ width: `${stockRatio(r)}%` }}
                    />
                  </div>

                  <div className={styles.lastSeen}>
                    <span className={`${styles.freshnessIndicator} ${stalenessClass(r.lastSeen)}`} />
                    Last seen: {formatLastSeen(r.lastSeen)}
                  </div>
                </div>
              ))}
            </div>

            {game.retailerStats.length === 0 && (
              <p className={styles.noData}>No data — scraper may not have run yet for this game.</p>
            )}
          </section>
        ))}

        {data && (
          <p className={styles.fetchedAt}>
            Data fetched {new Date(data.fetchedAt).toLocaleString("en-CA", {
              timeZone: "America/Toronto", month: "short", day: "numeric",
              hour: "numeric", minute: "2-digit",
            })}
          </p>
        )}
      </main>
    </>
  );
}
