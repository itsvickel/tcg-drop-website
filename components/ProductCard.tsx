import Sparkline from "./Sparkline";
import styles from "../styles/Card.module.css";

type HistoryEntry = {
  date: string;
  price: number;
  retailer: string;
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
};

type ProductCardProps = {
  product: Product;
};

const SHIPPING_THRESHOLDS: Record<string, string> = {
  "Best Buy CA": "Free $35+",
  "Walmart CA": "Free $35+",
  "Amazon.ca": "Free $35+/Prime",
  "Pokemon Center CA": "Free $50+",
  "EB Games": "Free $49+",
  "401 Games": "Free $149+",
  "Deck Out Gaming": "Free $100+",
  Hobbiesville: "Free $150+",
  Danireon: "Free $200+",
  "A&C Games": "Free $100+",
  "Face to Face": "Free $100+",
  "Game Keeper": "Free $75+",
  "Remi Card Trader": "Free $75+"
};

function stripTrackingParams(input: string): string {
  try {
    const url = new URL(input);
    const params = url.searchParams;

    const keys = [...params.keys()];
    for (const key of keys) {
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

function formatUpdatedDate(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getShippingThreshold(retailer: string): string {
  return SHIPPING_THRESHOLDS[retailer] ?? "Check site";
}

export default function ProductCard({ product }: ProductCardProps) {
  const isAllTimeLow = product.price <= product.all_time_low + 0.0001;
  const cleanUrl = stripTrackingParams(product.url);
  const weeklyChange = product.price_change_7d;
  const hasWeeklyChange = weeklyChange !== null;

  return (
    <article
      className={`${styles.card} ${isAllTimeLow ? styles.allTimeLowCard : ""} ${
        product.is_preorder ? styles.preorderTopBorder : ""
      }`}
    >
      {product.image_url && (
        <div className={styles.imageWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={product.image_url} alt={product.name} className={styles.productImage} />
        </div>
      )}

      <div className={styles.badges}>
        {isAllTimeLow && <span className={`${styles.badge} ${styles.badgeAllTimeLow}`}>ALL-TIME LOW</span>}
        {product.is_preorder && <span className={`${styles.badge} ${styles.badgePreorder}`}>PRE-ORDER</span>}
        {hasWeeklyChange && weeklyChange < 0 && (
          <span className={`${styles.badge} ${styles.badgeDrop}`}>{`↓${Math.abs(weeklyChange).toFixed(0)}% this week`}</span>
        )}
        {hasWeeklyChange && weeklyChange > 0 && (
          <span className={`${styles.badge} ${styles.badgeRise}`}>{`↑${Math.abs(weeklyChange).toFixed(0)}%`}</span>
        )}
      </div>

      <h3 className={styles.productName}>{product.name}</h3>
      <p className={styles.price}>{`$${product.price.toFixed(2)} CAD`}</p>

      {!isAllTimeLow && (
        <p className={styles.lowNote}>{`All-time low: $${product.all_time_low.toFixed(2)} CAD`}</p>
      )}

      <div className={styles.retailerRow}>
        <span className={styles.retailerChip}>{product.retailer}</span>
        <span className={styles.shippingLabel}>{getShippingThreshold(product.retailer)}</span>
      </div>

      <Sparkline points={product.history} />

      <div className={styles.footerRow}>
        <span className={styles.updatedLabel}>{`Updated ${formatUpdatedDate(product.updated)}`}</span>
        <a className={styles.buyButton} href={cleanUrl} target="_blank" rel="noreferrer">
          Buy Now →
        </a>
      </div>
    </article>
  );
}
