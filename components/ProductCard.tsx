import { useState } from "react";
import Link from "next/link";
import Sparkline from "./Sparkline";
import ProductDetailModal from "./ProductDetailModal";
import styles from "../styles/Card.module.css";
import { LOW_LABEL, LOW_LABEL_TITLE } from "../lib/siteFacts";
import { hasReliableLow } from "../lib/products";
import DealScoreBreakdown from "./DealScoreBreakdown";
import { SHIPPING_THRESHOLDS } from "../lib/shipping";
import { computePackCount } from "../lib/packCount";
import { sizedImage, thumbSrcSet, THUMB } from "../lib/images";
import PriceVerdict from "./PriceVerdict";
import { restockOutlook } from "../lib/stockStats";


/**
 * The product shape is defined once in lib/products and re-exported here so
 * the many components importing it from this file keep working.
 *
 * This used to be a second, hand-maintained copy: it made `category` and
 * `last_restock_date` optional where the source has them required, and it
 * silently lacked every field added since — so components reading it could
 * not see them, and the two definitions drifted without any error.
 */
import type { Product, RetailerPrice, CardEnrichment, HistoryEntry } from "../lib/products";
export type { Product, RetailerPrice, CardEnrichment, HistoryEntry };

type ProductCardProps = {
  product: Product;
  /** Adds this product to the signed-in user's collection. Omitted when
   *  accounts are not configured, so the button simply does not render. */
  onAddToCollection?: (product: Product) => void;
  onRetailerClick?: (retailer: string) => void;
  activeRetailer?: string;
  isWishlisted?: boolean;
  onToggleWishlist?: (key: string) => void;
  isInComparison?: boolean;
  onToggleComparison?: (product: Product) => void;
  compareDisabled?: boolean;
  tcg?: string;
};


const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;

function formatRestockAge(isoDate: string): string {
  const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7)  return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  return `${Math.floor(days / 30)} months ago`;
}

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
  isInComparison = false,
  onToggleComparison,
  compareDisabled = false,
  tcg = "pokemon",
  onAddToCollection,
}: ProductCardProps) {
  const [showDetail, setShowDetail] = useState(false);

  // A "low" only earns a badge once we have watched the product long enough
  // for it to mean something — see hasReliableLow.
  const isAllTimeLow   = product.price <= product.all_time_low + 0.0001
    && hasReliableLow(product);
  const cleanUrl       = stripTrackingParams(product.url);
  const packCount      = computePackCount(product.name);
  const weeklyChange   = product.price_change_7d;
  const hasWeeklyChange = weeklyChange !== null;
  const isActiveFilter = activeRetailer === product.retailer;
  const isStale        = Date.now() - new Date(product.updated).getTime() > STALE_THRESHOLD_MS;

  const allRetailerStocks = [product.in_stock, ...product.other_retailers.map(r => r.in_stock)];
  const inStockCount    = allRetailerStocks.filter(Boolean).length;
  const totalRetailers  = allRetailerStocks.length;
  const soldOutEverywhere = inStockCount === 0;
  const outlook = restockOutlook(product.restock_rhythm);

  return (
    <>
      {/* Whole card is clickable — stop propagation on interactive children */}
      <article
        className={[
          styles.card,
          styles.cardClickable,
          isAllTimeLow         ? styles.allTimeLowCard    : "",
          product.is_preorder  ? styles.preorderTopBorder : "",
          soldOutEverywhere    ? styles.soldOutCard       : "",
        ].filter(Boolean).join(" ")}
        onClick={() => setShowDetail(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setShowDetail(true)}
        aria-label={`View details for ${product.name}`}
      >
        {/* Image */}
        <div className={styles.imageWrap}>
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sizedImage(product.image_url, THUMB)}
              srcSet={thumbSrcSet(product.image_url)}
              alt={product.name}
              className={styles.productImage}
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
                (e.target as HTMLImageElement).nextElementSibling?.removeAttribute("hidden");
              }}
            />
          ) : null}
          <div
            className={styles.imagePlaceholder}
            hidden={!!product.image_url}
            aria-hidden="true"
          >
            <span className={styles.imagePlaceholderIcon}>
              {tcg === "mtg" ? "⚡" : "🔴"}
            </span>
            <span className={styles.imagePlaceholderType}>
              {product.product_type !== "Other" ? product.product_type : product.set_name || "Sealed Product"}
            </span>
          </div>
        </div>

        {/* Badges row + wishlist heart */}
        <div className={styles.cardTopRow}>
          <div className={styles.badges}>
            {product.is_new        && <span className={`${styles.badge} ${styles.badgeNew}`}>NEW</span>}
            {product.back_in_stock && <span className={`${styles.badge} ${styles.badgeBackInStock}`}>BACK IN STOCK</span>}
            {isAllTimeLow          && <span className={`${styles.badge} ${styles.badgeAllTimeLow}`}>{LOW_LABEL.toUpperCase()}</span>}
            <PriceVerdict
              price={product.price}
              history={product.history}
              retailer={product.retailer}
              otherPrices={(product.other_retailers ?? []).map((r) => r.price)}
              compact
            />
            {product.is_preorder   && <span className={`${styles.badge} ${styles.badgePreorder}`}>PRE-ORDER</span>}
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
            {product.deal_score >= 40 && (
              <DealScoreBreakdown product={product} score={product.deal_score} compact />
            )}
          </div>
          {onToggleComparison && (
            <button
              className={`${styles.compareBtn} ${isInComparison ? styles.compareBtnActive : ""} ${compareDisabled && !isInComparison ? styles.compareBtnDisabled : ""}`}
              onClick={(e) => { e.stopPropagation(); onToggleComparison(product); }}
              type="button"
              disabled={compareDisabled && !isInComparison}
              aria-label={isInComparison ? "Remove from comparison" : "Add to comparison"}
              title={isInComparison ? "Remove from comparison" : compareDisabled ? "Max 3 products" : "Compare this product"}
            >
              {isInComparison ? "⊠" : "⊞"}
            </button>
          )}
          {onToggleWishlist && (
            <button
              className={`${styles.wishlistBtn} ${isWishlisted ? styles.wishlistBtnActive : ""}`}
              onClick={(e) => { e.stopPropagation(); onToggleWishlist(product.group_key); }}
              type="button"
              aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
              title={isWishlisted ? "Remove from My List" : "Save to My List"}
            >
              {isWishlisted ? "♥" : "♡"}
            </button>
          )}
          {onAddToCollection && (
            <button
              className={styles.collectBtn}
              onClick={(e) => { e.stopPropagation(); onAddToCollection(product); }}
              type="button"
              aria-label={`Add ${product.name} to my collection`}
              title="Add to my collection"
            >
              +
            </button>
          )}
        </div>

        {/* Name & price */}
        <h3 className={styles.productName}>{product.name}</h3>

        {/* Info chips: language · variant · product type · set */}
        <div className={styles.infoChips}>
          {product.language !== "English" && (
            <span className={`${styles.infoChip} ${styles.infoChipLang}`}>{product.language}</span>
          )}
          {product.variant && (
            <span className={`${styles.infoChip} ${styles.infoChipVariant}`}>{product.variant}</span>
          )}
          {product.product_type && product.product_type !== "Other" && (
            <span className={`${styles.infoChip} ${styles.infoChipType}`}>{product.product_type}</span>
          )}
          {product.set_name && (
            <span className={`${styles.infoChip} ${styles.infoChipSet}`}>{product.set_name}</span>
          )}
        </div>

        <p className={styles.price}>
          {`$${product.price.toFixed(2)} CAD`}
          {product.msrp !== null && product.msrp > product.price && (
            <span className={styles.msrpStrike} title="MSRP reference price">
              {`$${product.msrp.toFixed(2)}`}
            </span>
          )}
          {packCount && (
            <span className={styles.perPack}>
              {` · $${(product.price / packCount).toFixed(2)}/pack`}
            </span>
          )}
        </p>

        {!isAllTimeLow && (
          <p className={styles.lowNote}>
            {`${LOW_LABEL_TITLE}: $${product.all_time_low.toFixed(2)} CAD`}
          </p>
        )}

        {/* Retailer + shipping */}
        <div className={styles.retailerRow}>
          <button
            className={`${styles.retailerChip} ${isActiveFilter ? styles.retailerChipActive : ""}`}
            onClick={(e) => { e.stopPropagation(); onRetailerClick?.(product.retailer); }}
            title={isActiveFilter ? `Remove filter: ${product.retailer}` : `Filter by ${product.retailer}`}
            type="button"
          >
            {product.retailer}
          </button>
          <span className={styles.shippingLabel}>{getShippingThreshold(product.retailer)}</span>
        </div>

        {/* Stock count + per-store breakdown */}
        {totalRetailers > 0 && (
          <div className={styles.stockInfoRow}>
            <div className={styles.stockHeader}>
              <span className={[
                styles.stockChip,
                soldOutEverywhere
                  ? styles.stockChipRed
                  : inStockCount / totalRetailers >= 0.5
                    ? styles.stockChipGreen
                    : styles.stockChipAmber,
              ].join(" ")}>
                {inStockCount}/{totalRetailers} stores in stock
              </span>
              {soldOutEverywhere && product.last_restock_date && (
                <span className={styles.lastRestockLabel}>
                  last in stock {formatRestockAge(product.last_restock_date)}
                </span>
              )}
            </div>
            {/* What this product's own restock history suggests. Only shown
                while it is actually unavailable — on an in-stock product the
                cadence is trivia, and on an out-of-stock one it is the single
                thing the reader wants to know. Absent for most products, which
                have not restocked often enough to have a rhythm. */}
            {soldOutEverywhere && outlook && (
              <span
                className={`${styles.restockOutlook} ${styles[`outlook_${outlook.state}`]}`}
                title={outlook.detail}
              >
                {outlook.text}
              </span>
            )}
            <div className={styles.storeStockList}>
              {[
                { retailer: product.retailer, in_stock: product.in_stock },
                ...product.other_retailers.map(r => ({ retailer: r.retailer, in_stock: r.in_stock })),
              ].slice(0, 5).map(r => (
                <span
                  key={r.retailer}
                  className={`${styles.storeStockItem} ${r.in_stock ? styles.storeStockIn : styles.storeStockOut}`}
                >
                  {r.in_stock ? "●" : "○"} {r.retailer}
                </span>
              ))}
              {totalRetailers > 5 && (
                <span className={styles.storeStockMore}>+{totalRetailers - 5} more</span>
              )}
            </div>
          </div>
        )}

        <Sparkline points={product.history} />

        {/* Footer row */}
        <div className={styles.footerRow}>
          <span className={`${styles.updatedLabel} ${isStale ? styles.updatedStale : ""}`}>
            {isStale ? "⚠ " : ""}
            {`Updated ${formatUpdatedDate(product.updated)}`}
          </span>
          <div className={styles.footerActions} onClick={(e) => e.stopPropagation()}>
            <Link
              href={`/${tcg}/${product.group_key}`}
              className={styles.permalinkBtn}
              title="View product page"
            >
              ↗
            </Link>
            {/* eslint-disable-next-line jsx-a11y/anchor-has-content */}
            <a
              className={styles.buyButton}
              href={cleanUrl}
              target="_blank"
              rel="noreferrer"
            >
              Buy Now →
            </a>
          </div>
        </div>
      </article>

      {showDetail && (
        <ProductDetailModal product={product} tcg={tcg} onClose={() => setShowDetail(false)} />
      )}
    </>
  );
}
