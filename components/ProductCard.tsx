import { useState } from "react";
import Sparkline from "./Sparkline";
import ProductDetailModal from "./ProductDetailModal";
import styles from "../styles/Card.module.css";

type HistoryEntry = {
  date: string;
  price: number;
  retailer: string;
};

export type RetailerPrice = {
  retailer: string;
  price: number;
  url: string;
  in_stock: boolean;
};

export type Product = {
  group_key: string;
  name: string;
  price: number;
  retailer: string;
  url: string;
  is_preorder: boolean;
  updated: string;
  all_time_low: number;
  price_change_7d: number | null;
  history: HistoryEntry[];
  image_url: string;
  other_retailers: RetailerPrice[];
  is_new: boolean;
};

type ProductCardProps = {
  product: Product;
  onRetailerClick?: (retailer: string) => void;
  activeRetailer?: string;
  isWishlisted?: boolean;
  onToggleWishlist?: (key: string) => void;
};

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

const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;

export function stripTrackingParams(input: string): string {
  try {
    const url = new URL(input);
    const params = url.searchParams;
    for (const key of [...params.keys()]) {
      if (key === "ref" || key.startsWith("utm_") || key === "fbclid" || key === "gclid") {
        params.delete(key);
      }
    }
    url.search = params.toString();
    return url.toString();
  } catch {
    return input;
  }
}

export function formatUpdatedDate(input: string): string {
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

function getShippingThreshold(retailer: string): string {
  return SHIPPING_THRESHOLDS[retailer] ?? "Check site";
}

export default function ProductCard({
  product,
  onRetailerClick,
  activeRetailer,
  isWishlisted = false,
  onToggleWishlist,
}: ProductCardProps) {
  const [showDetail, setShowDetail] = useState(false);

  const isAllTimeLow   = product.price <= product.all_time_low + 0.0001;
  const cleanUrl       = stripTrackingParams(product.url);
  const weeklyChange   = product.price_change_7d;
  const hasWeeklyChange = weeklyChange !== null;
  const isActiveFilter = activeRetailer === product.retailer;
  const hasHistory     = product.history.length >= 2;
  const hasOthers      = product.other_retailers.length > 0;
  const isStale        = Date.now() - new Date(product.updated).getTime() > STALE_THRESHOLD_MS;

  return (
    <>
      <article
        className={[
          styles.card,
          isAllTimeLow    ? styles.allTimeLowCard    : "",
          product.is_preorder ? styles.preorderTopBorder : "",
        ].filter(Boolean).join(" ")}
      >
        {/* Image */}
        {product.image_url && (
          <div className={styles.imageWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image_url}
              alt={product.name}
              className={styles.productImage}
              loading="lazy"
            />
          </div>
        )}

        {/* Badges row + wishlist heart */}
        <div className={styles.cardTopRow}>
          <div className={styles.badges}>
            {product.is_new     && <span className={`${styles.badge} ${styles.badgeNew}`}>NEW</span>}
            {isAllTimeLow       && <span className={`${styles.badge} ${styles.badgeAllTimeLow}`}>ALL-TIME LOW</span>}
            {product.is_preorder && <span className={`${styles.badge} ${styles.badgePreorder}`}>PRE-ORDER</span>}
            {hasWeeklyChange && weeklyChange! < 0 && (
              <span className={`${styles.badge} ${styles.badgeDrop}`}>
                {`↓${Math.abs(weeklyChange!).toFixed(0)}% this week`}
              </span>
            )}
            {hasWeeklyChange && weeklyChange! > 0 && (
              <span className={`${styles.badge} ${styles.badgeRise}`}>
                {`↑${Math.abs(weeklyChange!).toFixed(0)}%`}
              </span>
            )}
          </div>
          {onToggleWishlist && (
            <button
              className={`${styles.wishlistBtn} ${isWishlisted ? styles.wishlistBtnActive : ""}`}
              onClick={() => onToggleWishlist(product.group_key)}
              type="button"
              aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
              title={isWishlisted ? "Remove from My List" : "Save to My List"}
            >
              {isWishlisted ? "♥" : "♡"}
            </button>
          )}
        </div>

        {/* Name & price */}
        <h3 className={styles.productName}>{product.name}</h3>
        <p className={styles.price}>{`$${product.price.toFixed(2)} CAD`}</p>

        {!isAllTimeLow && (
          <p className={styles.lowNote}>
            {`All-time low: $${product.all_time_low.toFixed(2)} CAD`}
          </p>
        )}

        {/* Retailer + shipping */}
        <div className={styles.retailerRow}>
          <button
            className={`${styles.retailerChip} ${isActiveFilter ? styles.retailerChipActive : ""}`}
            onClick={() => onRetailerClick?.(product.retailer)}
            title={isActiveFilter ? `Remove filter: ${product.retailer}` : `Filter by ${product.retailer}`}
            type="button"
          >
            {product.retailer}
          </button>
          <span className={styles.shippingLabel}>{getShippingThreshold(product.retailer)}</span>
        </div>

        {/* Sparkline — click opens detail modal */}
        <div
          className={hasHistory ? styles.sparklineButton : undefined}
          onClick={() => hasHistory && setShowDetail(true)}
          role={hasHistory ? "button" : undefined}
          tabIndex={hasHistory ? 0 : undefined}
          onKeyDown={hasHistory ? (e) => e.key === "Enter" && setShowDetail(true) : undefined}
          title={hasHistory ? "Click to see full price history" : undefined}
          aria-label={hasHistory ? "View price history" : undefined}
        >
          <Sparkline points={product.history} />
        </div>

        {/* Footer row */}
        <div className={styles.footerRow}>
          <span className={`${styles.updatedLabel} ${isStale ? styles.updatedStale : ""}`}>
            {isStale ? "⚠ " : ""}
            {`Updated ${formatUpdatedDate(product.updated)}`}
          </span>
          <a className={styles.buyButton} href={cleanUrl} target="_blank" rel="noreferrer">
            Buy Now →
          </a>
        </div>

        {/* Details / more stores button */}
        {(hasOthers || hasHistory) && (
          <button
            className={styles.detailsBtn}
            onClick={() => setShowDetail(true)}
            type="button"
          >
            {hasOthers
              ? `+${product.other_retailers.length} more store${product.other_retailers.length > 1 ? "s" : ""} · View details →`
              : "View price history →"}
          </button>
        )}
      </article>

      {showDetail && (
        <ProductDetailModal product={product} onClose={() => setShowDetail(false)} />
      )}
    </>
  );
}
