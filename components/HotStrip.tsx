import type { Product } from "./ProductCard";
import styles from "../styles/HotStrip.module.css";

type Props = {
  products: Product[];
  onSelect: (product: Product) => void;
};

const HOT_DROP_PCT     = -5;
const HOT_WINDOW_MS    = 48 * 60 * 60 * 1000;
const HOT_MAX_ITEMS    = 8;
const HOT_MIN_TO_SHOW  = 2;

export function getHotProducts(products: Product[]): Product[] {
  const cutoff = Date.now() - HOT_WINDOW_MS;
  return products
    .filter(
      (p) =>
        p.price_change_7d !== null &&
        p.price_change_7d <= HOT_DROP_PCT &&
        new Date(p.updated).getTime() >= cutoff
    )
    .sort((a, b) => (a.price_change_7d ?? 0) - (b.price_change_7d ?? 0))
    .slice(0, HOT_MAX_ITEMS);
}

export default function HotStrip({ products, onSelect }: Props) {
  const hot = getHotProducts(products);
  if (hot.length < HOT_MIN_TO_SHOW) return null;

  return (
    <section className={styles.strip} aria-label="Hot deals right now">
      <h3 className={styles.heading}>🔥 Hot right now</h3>
      <div className={styles.row}>
        {hot.map((p) => (
          <button
            key={p.group_key}
            className={styles.item}
            onClick={() => onSelect(p)}
            type="button"
            aria-label={`View ${p.name} — ${Math.abs(p.price_change_7d!).toFixed(0)}% drop`}
          >
            {p.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.image_url} alt="" className={styles.thumb} loading="lazy" />
            ) : (
              <div className={styles.thumbPlaceholder} />
            )}
            <span className={styles.name}>{p.name}</span>
            <span className={styles.price}>${p.price.toFixed(2)}</span>
            <span className={styles.drop}>↓{Math.abs(p.price_change_7d!).toFixed(0)}%</span>
          </button>
        ))}
      </div>
    </section>
  );
}
