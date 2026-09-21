import { useEffect, useState } from "react";
import PriceVerdict from "./PriceVerdict";
import Head from "next/head";
import Link from "next/link";
import { absoluteUrl } from "../lib/siteUrl";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import GameTabBar from "./GameTabBar";
import AlertModal from "./AlertModal";
import RestockModal from "./RestockModal";
import ImageLightbox from "./ImageLightbox";
import DealScoreBreakdown from "./DealScoreBreakdown";
import type { Product } from "./ProductCard";
import type { TcgSlug } from "../lib/tcg.config";
import { SHIPPING_THRESHOLDS, deliveredPrice } from "../lib/shipping";
import { HIGH_LABEL_TITLE, LOW_LABEL, LOW_LABEL_TITLE } from "../lib/siteFacts";
import { hasReliableLow } from "../lib/products";
import { computePackCount } from "../lib/packCount";
import styles from "../styles/ProductDetailPage.module.css";
import { sizedImage, DETAIL } from "../lib/images";
import { changeOver, roiSinceFirstSeen } from "../lib/insights";
import { breadcrumbJsonLd, jsonLdString, productJsonLd } from "../lib/structuredData";
import { setSlug } from "../lib/movers";
import PriceMatchHelper from "./PriceMatchHelper";

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
  /**
   * Rendered on the server so crawlers (and the first paint) see the real
   * product rather than a skeleton. When present the client still refetches
   * for fresh prices, but never shows a loading state.
   */
  initialProduct?: Product | null;
};

export default function ProductDetailPage({ tcg, groupKey, initialProduct = null }: Props) {
  const [product, setProduct] = useState<Product | null>(initialProduct);
  const [loading, setLoading] = useState(!initialProduct);
  const [error, setError] = useState("");
  const [showAlert, setShowAlert] = useState(false);
  const [showZoom, setShowZoom] = useState(false);
  const [showRestock, setShowRestock] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-tcg", tcg);
    return () => { document.documentElement.removeAttribute("data-tcg"); };
  }, [tcg]);

  useEffect(() => {
    if (!initialProduct) setLoading(true);
    setError("");
    // One product with its full history, rather than the entire 2,645-item
    // catalogue filtered down to a single record on the client.
    fetch(`/api/product/${encodeURIComponent(groupKey)}?tcg=${tcg}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error ?? "Product not found");
        return data as { product: Product };
      })
      .then(data => {
        if (data.product) setProduct(data.product);
        else setError("Product not found — it may have been delisted.");
      })
      .catch((err: Error) => setError(err.message || "Failed to load product data."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Change windows and return-since-tracking, shown beside the price history.
  const change1d = product ? changeOver(product.history, product.price, 1) : null;
  const change30d = product ? changeOver(product.history, product.price, 30) : null;
  const roi = product ? roiSinceFirstSeen(product.price, product.history) : null;

  const jsonLd = product ? jsonLdString(productJsonLd(product, tcg)) : null;
  const breadcrumb = product
    ? jsonLdString(
        breadcrumbJsonLd([
          { name: tcgLabel, path: `${tcg}/sealed` },
          ...(product.set_name ? [{ name: product.set_name, path: `sets/${setSlug(product.set_name)}?tcg=${tcg}` }] : []),
          { name: product.name, path: `${tcg}/${groupKey}` },
        ])
      )
    : null;

  const allRetailers = product
    ? [
        { retailer: product.retailer, price: product.price, url: product.url, in_stock: product.in_stock },
        ...product.other_retailers,
      ].sort((a, b) => a.price - b.price)
    : [];

  const pageTitle = product
    ? `${product.name} — The Mana Cafe`
    : loading ? "Loading… — The Mana Cafe" : "Not Found — The Mana Cafe";

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
        <link rel="canonical" href={absoluteUrl(`${tcg}/${groupKey}`)} />
        {jsonLd && (
          <script
            type="application/ld+json"
            // Serialised through jsonLdString, which escapes "<" so a product
            // name cannot terminate this tag early.
            dangerouslySetInnerHTML={{ __html: jsonLd }}
          />
        )}
        {breadcrumb && (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: breadcrumb }} />
        )}
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
                  <img
                    src={sizedImage(product.image_url, DETAIL)}
                    alt={product.name}
                    className={styles.heroImg}
                    style={{ cursor: "zoom-in" }}
                    title="Click to zoom"
                    onClick={() => setShowZoom(true)}
                  />
                </div>
              )}
              <div className={styles.heroInfo}>
                <div className={styles.heroBadges}>
                  {product.is_new && <span className={styles.badgeNew}>NEW</span>}
                  {product.back_in_stock && <span className={styles.badgeBis}>BACK IN STOCK</span>}
                  {product.price <= product.all_time_low + 0.0001 && hasReliableLow(product)
                    && <span className={styles.badgeAtl}>{LOW_LABEL.toUpperCase()}</span>}
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

                {/* Full, non-compact verdict. The grid card renders the compact
                    form, where the percentile, cross-shop and stale-price chips
                    are suppressed for space and survive only as a tooltip —
                    which on a touch screen means not at all. This page has the
                    room, and is where someone deciding whether to buy is
                    looking. */}
                <div className={styles.heroVerdict}>
                  <PriceVerdict
                    price={product.price}
                    history={product.history}
                    retailer={product.retailer}
                    otherPrices={(product.other_retailers ?? []).map((r) => r.price)}
                  />
                </div>

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
                <span className={styles.statLabel}>{LOW_LABEL_TITLE}</span>
                <strong className={styles.statValue}>${allTimeLow.toFixed(2)}</strong>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>{HIGH_LABEL_TITLE}</span>
                <strong className={styles.statValue}>${allTimeHigh.toFixed(2)}</strong>
              </div>
              {product.price_per_pack !== null && product.pack_count !== null && (
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Per Pack</span>
                  <strong className={styles.statValue}>
                    ${product.price_per_pack.toFixed(2)}
                  </strong>
                  <span className={styles.statLabel}>{product.pack_count} packs</span>
                </div>
              )}
              {roi && (
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Since First Tracked</span>
                  <strong className={styles.statValue}>
                    {roi.pct > 0 ? "+" : ""}{roi.pct.toFixed(1)}%
                  </strong>
                  <span className={styles.statLabel}>over {roi.days} days</span>
                </div>
              )}
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
                        <span className={styles.shippingHint}>
                          {(() => {
                            const d = deliveredPrice(r.price, r.retailer);
                            return d.shipsFree
                              ? "Ships free"
                              : d.total !== null
                                ? `$${d.total.toFixed(2)} delivered`
                                : d.label;
                          })()}
                        </span>
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

            <PriceMatchHelper product={product} />
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
        <AlertModal product={product} tcg={tcg} onClose={() => setShowAlert(false)} />
      )}
      {showRestock && product && (
        <RestockModal product={product} tcg={tcg} onClose={() => setShowRestock(false)} />
      )}
      {showZoom && product?.image_url && (
        <ImageLightbox
          src={(product.card?.image_url || product.image_url).replace("/normal/", "/large/")}
          alt={product.name}
          onClose={() => setShowZoom(false)}
        />
      )}
    </>
  );
}
