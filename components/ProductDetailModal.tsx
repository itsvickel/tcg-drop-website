import { useEffect } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from "recharts";
import type { Product } from "./ProductCard";
import styles from "../styles/ProductDetail.module.css";

const SHIPPING_THRESHOLDS: Record<string, string> = {
  "Best Buy CA":        "Free $35+",
  "Walmart CA":         "Free $35+",
  "Amazon.ca":          "Free $35+/Prime",
  "Pokemon Center CA":  "Free $50+",
  "EB Games":           "Free $49+",
  "401 Games":          "Free $149+",
  "Deck Out Gaming":    "Free $100+",
  Hobbiesville:         "Free $150+",
  Danireon:             "Free $200+",
  "A&C Games":          "Free $100+",
  "Face to Face":       "Free $100+",
  "Game Keeper":        "Free $75+",
  "Remi Card Trader":   "Free $75+",
  Meeplemart:           "Free $75+",
  "Carta Magica":       "Free $100+",
  "Epic Loot":          "Free $75+",
};

function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (k === "ref" || k.startsWith("utm_") || k === "fbclid" || k === "gclid") {
        u.searchParams.delete(k);
      }
    }
    u.search = u.searchParams.toString();
    return u.toString();
  } catch {
    return url;
  }
}

function formatUpdatedDate(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

type Props = {
  product: Product;
  onClose: () => void;
};

export default function ProductDetailModal({ product, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const sorted = [...product.history].sort((a, b) => a.date.localeCompare(b.date));
  const prices = sorted.map((e) => e.price);
  const downTrend = prices.length >= 2 ? prices[prices.length - 1] <= prices[0] : true;
  const lineColor = downTrend ? "#3fb950" : "#f85149";
  const fillColor = downTrend ? "rgba(63,185,80,0.18)" : "rgba(248,81,73,0.18)";
  const allTimeLow  = prices.length ? Math.min(...prices) : product.all_time_low;
  const allTimeHigh = prices.length ? Math.max(...prices) : product.price;

  const allRetailers = [
    { retailer: product.retailer, price: product.price, url: product.url, in_stock: true },
    ...product.other_retailers,
  ].sort((a, b) => a.price - b.price);

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label={`Details for ${product.name}`}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>

        {/* Sticky header */}
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            {product.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.image_url} alt={product.name} className={styles.headerImage} />
            )}
            <div className={styles.headerText}>
              <h2 className={styles.productName}>{product.name}</h2>
              <p className={styles.bestPrice}>
                ${product.price.toFixed(2)}{" "}
                <span className={styles.bestPriceCurrency}>CAD</span>
              </p>
              <p className={styles.bestRetailer}>Best price @ {product.retailer}</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} type="button" aria-label="Close">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>

          {/* Quick stats */}
          <div className={styles.statsRow}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>All-Time Low</span>
              <strong className={styles.statValue}>${allTimeLow.toFixed(2)}</strong>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>All-Time High</span>
              <strong className={styles.statValue}>${allTimeHigh.toFixed(2)}</strong>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Stores Found</span>
              <strong className={styles.statValue}>{allRetailers.length}</strong>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Last Updated</span>
              <strong className={styles.statValue}>{formatUpdatedDate(product.updated)}</strong>
            </div>
          </div>

          {/* Where to buy */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Where to Buy</h3>
            <div className={styles.retailerTable}>
              {allRetailers.map((r) => (
                <div
                  key={r.retailer}
                  className={`${styles.retailerRow} ${r.retailer === product.retailer ? styles.bestRow : ""}`}
                >
                  <div className={styles.retailerLeft}>
                    <span className={`${styles.stockDot} ${r.in_stock ? styles.inStock : styles.outOfStock}`} />
                    <div className={styles.retailerInfo}>
                      <span className={styles.retailerName}>{r.retailer}</span>
                      <span className={styles.shippingHint}>
                        {SHIPPING_THRESHOLDS[r.retailer] ?? "Check site for shipping"}
                      </span>
                    </div>
                  </div>
                  <div className={styles.retailerRight}>
                    <span className={styles.retailerPrice}>${r.price.toFixed(2)}</span>
                    {r.retailer === product.retailer && (
                      <span className={styles.bestBadge}>BEST</span>
                    )}
                    <a
                      href={stripTracking(r.url)}
                      target="_blank"
                      rel="noreferrer"
                      className={`${styles.buyLink} ${!r.in_stock ? styles.outOfStockBuy : ""}`}
                    >
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
              <h3 className={styles.sectionTitle}>Price History — 30 Days</h3>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={sorted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(48,54,61,0.6)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#8b949e", fontSize: 11 }}
                      tickFormatter={(d: string) => {
                        const dt = new Date(d);
                        return `${dt.getMonth() + 1}/${dt.getDate()}`;
                      }}
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

          {/* Price log table */}
          {sorted.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Price Log</h3>
              <div className={styles.historyTable}>
                <div className={styles.historyHeader}>
                  <span>Date</span>
                  <span>Price</span>
                  <span>Retailer</span>
                </div>
                {[...sorted].reverse().slice(0, 20).map((entry, i) => (
                  <div key={i} className={styles.historyRow}>
                    <span className={styles.historyDate}>
                      {new Date(entry.date).toLocaleDateString("en-CA", {
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

        </div>
      </div>
    </div>
  );
}
