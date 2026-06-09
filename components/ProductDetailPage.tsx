import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import GameTabBar from "./GameTabBar";
import AlertModal from "./AlertModal";
import RestockModal from "./RestockModal";
import DealScoreBreakdown from "./DealScoreBreakdown";
import type { Product } from "./ProductCard";
import type { TcgSlug } from "../lib/tcg.config";
import { SHIPPING_THRESHOLDS } from "../lib/shipping";
import { computePackCount } from "../lib/packCount";
import styles from "../styles/ProductDetailPage.module.css";

type TooltipPayload = {
  active?: boolean;
  payload?: Array<{ payload: { date: string; price: number; retailer: string } }>;
  label?: string;
};

function ChartTooltip({ active, payload, label }: TooltipPayload) {
  if (!active || !payload?.length) return null;
  const entry = payload[0].payload;
  const date = label
    ? new Date(label).toLocaleDateString("en-CA", {
        timeZone: "America/Toronto",
        month: "long", day: "numeric", year: "numeric",
      })
    : "";
  return (
    <div style={{
      background: "#161b22", border: "1px solid #30363d", borderRadius: "8px",
      padding: "8px 12px", fontSize: "0.82rem", color: "#c9d1d9", lineHeight: 1.6,
    }}>
      <div style={{ color: "#8b949e", marginBottom: 4 }}>{date}</div>
      <div style={{ color: "#58a6ff", fontWeight: 700, fontFamily: "JetBrains Mono, monospace" }}>
        ${entry.price.toFixed(2)} CAD
      </div>
      <div style={{ color: "#8b949e", fontSize: "0.78rem" }}>{entry.retailer}</div>
    </div>
  );
}

function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (k === "ref" || k.startsWith("utm_") || k === "fbclid" || k === "gclid") u.searchParams.delete(k);
    }
    u.search = u.searchParams.toString();
    return u.toString();
  } catch {
    return url;
  }
}

type Props = {
  tcg: TcgSlug;
  groupKey: string;
};

export default function ProductDetailPage({ tcg, groupKey }: Props) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAlert, setShowAlert] = useState(false);
  const [showRestock, setShowRestock] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-tcg", tcg);
    return () => { document.documentElement.removeAttribute("data-tcg"); };
  }, [tcg]);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/products?tcg=${tcg}`)
      .then(r => r.json())
      .then(data => {
        const found: Product | undefined = data.products?.find((p: Product) => p.group_key === groupKey);
        if (found) setProduct(found);
        else setError("Product not found — it may have been delisted.");
      })
      .catch(() => setError("Failed to load product data."))
      .finally(() => setLoading(false));
  }, [tcg, groupKey]);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available */ }
  };

  const tcgLabel = tcg === "mtg" ? "MTG" : "Pokémon";
  const listingHref = `/${tcg}`;

  const sorted = product ? [...product.history].sort((a, b) => a.date.localeCompare(b.date)) : [];
  const prices = sorted.map(e => e.price);
  const downTrend = prices.length >= 2 ? prices[prices.length - 1] <= prices[0] : true;
  const lineColor = downTrend ? "#3fb950" : "#f85149";
  const fillColor = downTrend ? "rgba(63,185,80,0.18)" : "rgba(248,81,73,0.18)";
  const allTimeLow  = prices.length ? Math.min(...prices) : product?.all_time_low ?? 0;
  const allTimeHigh = prices.length ? Math.max(...prices) : product?.price ?? 0;
  const packCount = product ? computePackCount(product.name) : null;

  const allRetailers = product
    ? [
        { retailer: product.retailer, price: product.price, url: product.url, in_stock: product.in_stock },
        ...product.other_retailers,
      ].sort((a, b) => a.price - b.price)
    : [];

  const pageTitle = product
    ? `${product.name} — TCG Drop`
    : loading ? "Loading… — TCG Drop" : "Not Found — TCG Drop";

  const pageDescription = product
    ? `Best price: $${product.price.toFixed(2)} CAD @ ${product.retailer}. Track price history and compare ${allRetailers.length} retailers.`
    : "";

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        {product?.image_url && <meta property="og:image" content={product.image_url} />}
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:type" content="product" />
        <link rel="canonical" href={`https://tcgdrop.ca/${tcg}/${groupKey}`} />
      </Head>

      <GameTabBar tcg={tcg} />

      <main className={styles.main}>
        {/* Breadcrumb */}
        <div className={styles.breadcrumb}>
          <Link href={listingHref} className={styles.backLink}>
            ← {tcgLabel}
          </Link>
          {product && (
            <>
              <span className={styles.breadcrumbSep}>/</span>
              <span className={styles.breadcrumbCurrent}>{product.set_name || product.product_type}</span>
            </>
          )}
        </div>

        {loading && (
          <div className={styles.skeleton}>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={styles.skeletonBlock} />
            ))}
          </div>
        )}

        {error && (
          <div className={styles.errorState}>
            <p>{error}</p>
            <Link href={listingHref} className={styles.backLink}>← Back to {tcgLabel} listings</Link>
          </div>
        )}

        {product && (
          <>
            {/* Product hero */}
            <div className={styles.hero}>
              {product.image_url && (
                <div className={styles.heroImage}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={product.image_url} alt={product.name} className={styles.heroImg} />
                </div>
              )}
              <div className={styles.heroInfo}>
                <div className={styles.heroBadges}>
                  {product.is_new && <span className={styles.badgeNew}>NEW</span>}
                  {product.back_in_stock && <span className={styles.badgeBis}>BACK IN STOCK</span>}
                  {product.price <= product.all_time_low + 0.0001 && <span className={styles.badgeAtl}>ALL-TIME LOW</span>}
                  {product.is_preorder && <span className={styles.badgePre}>PRE-ORDER</span>}
                  {product.language !== "English" && <span className={styles.badgeLang}>{product.language}</span>}
                  {product.variant && <span className={styles.badgeVariant}>{product.variant}</span>}
                </div>

                <h1 className={styles.heroTitle}>{product.name}</h1>

                <div className={styles.heroMeta}>
                  {product.product_type !== "Other" && (
                    <span className={styles.metaChip}>{product.product_type}</span>
                  )}
                  {product.set_name && (
                    <span className={styles.metaChip}>{product.set_name}</span>
                  )}
                </div>

                <div className={styles.heroPriceRow}>
                  <span className={styles.heroPrice}>${product.price.toFixed(2)} CAD</span>
                  {packCount && (
                    <span className={styles.heroPerPack}>
                      ${(product.price / packCount).toFixed(2)}/pack
                    </span>
                  )}
                </div>

                <p className={styles.heroRetailer}>Best price @ {product.retailer}</p>

                <div className={styles.heroActions}>
                  <a
                    href={stripTracking(product.url)}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.buyBtn}
                  >
                    Buy Now →
                  </a>
                  <button className={styles.alertBtn} onClick={() => setShowAlert(true)} type="button">
                    🔔 Price Alert
                  </button>
                  {!product.in_stock && (
                    <button className={styles.restockBtn} onClick={() => setShowRestock(true)} type="button">
                      📦 Restock Alert
                    </button>
                  )}
                  <button className={styles.shareBtn} onClick={handleShare} type="button">
                    {copied ? "✓ Copied!" : "🔗 Share"}
                  </button>
                </div>
              </div>
            </div>

            {/* Stats strip */}
            <div className={styles.statsStrip}>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>All-Time Low</span>
                <strong className={styles.statValue}>${allTimeLow.toFixed(2)}</strong>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>All-Time High</span>
                <strong className={styles.statValue}>${allTimeHigh.toFixed(2)}</strong>
              </div>
              {product.msrp && (
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>MSRP</span>
                  <strong className={styles.statValue}>${product.msrp.toFixed(2)}</strong>
                </div>
              )}
              {product.price_change_7d !== null && (
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>7-Day Change</span>
                  <strong
                    className={product.price_change_7d < 0 ? styles.statGreen : styles.statRed}
                  >
                    {product.price_change_7d > 0 ? "+" : ""}
                    {product.price_change_7d.toFixed(1)}%
                  </strong>
                </div>
              )}
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Deal Score</span>
                <DealScoreBreakdown product={product} score={product.deal_score} />
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Stores Tracked</span>
                <strong className={styles.statValue}>{allRetailers.length}</strong>
              </div>
            </div>

            {/* Retailers */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Where to Buy</h2>
              <div className={styles.retailerTable}>
                {allRetailers.map(r => (
                  <div
                    key={r.retailer}
                    className={`${styles.retailerRow} ${r.retailer === product.retailer ? styles.bestRow : ""}`}
                  >
                    <div className={styles.retailerLeft}>
                      <span className={`${styles.stockDot} ${r.in_stock ? styles.inStock : styles.outOfStock}`} />
                      <div>
                        <span className={styles.retailerName}>{r.retailer}</span>
                        <span className={styles.shippingHint}>{SHIPPING_THRESHOLDS[r.retailer] ?? "Check site"}</span>
                      </div>
                    </div>
                    <div className={styles.retailerRight}>
                      <span className={styles.retailerPrice}>${r.price.toFixed(2)}</span>
                      {r.retailer === product.retailer && <span className={styles.bestBadge}>BEST</span>}
                      <a href={stripTracking(r.url)} target="_blank" rel="noreferrer" className={styles.buyLink}>
                        {r.in_stock ? "Buy →" : "View →"}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Price history chart */}
            {sorted.length >= 2 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Price History</h2>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={sorted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(48,54,61,0.6)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: "#8b949e", fontSize: 11 }}
                        tickFormatter={(d: string) =>
                          new Date(d).toLocaleDateString("en-CA", {
                            timeZone: "America/Toronto",
                            month: "numeric", day: "numeric",
                          })
                        }
                        minTickGap={28}
                      />
                      <YAxis
                        tick={{ fill: "#8b949e", fontSize: 11 }}
                        tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                        width={54}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke={lineColor}
                        fill={fillColor}
                        strokeWidth={2}
                        dot={{ fill: lineColor, r: 3, strokeWidth: 0 }}
                        activeDot={{ r: 5, strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Price log */}
            {sorted.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Price Log</h2>
                <div className={styles.historyTable}>
                  <div className={styles.historyHeader}>
                    <span>Date</span>
                    <span>Price</span>
                    <span>Retailer</span>
                  </div>
                  {[...sorted].reverse().slice(0, 90).map((entry, i) => (
                    <div key={i} className={styles.historyRow}>
                      <span className={styles.historyDate}>
                        {new Date(entry.date).toLocaleDateString("en-CA", {
                          timeZone: "America/Toronto",
                          month: "short", day: "numeric",
                        })}
                      </span>
                      <span className={styles.historyPrice}>${entry.price.toFixed(2)}</span>
                      <span className={styles.historyRetailer}>{entry.retailer}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {showAlert && product && (
        <AlertModal product={product} onClose={() => setShowAlert(false)} />
      )}
      {showRestock && product && (
        <RestockModal product={product} tcg={tcg} onClose={() => setShowRestock(false)} />
      )}
    </>
  );
}
