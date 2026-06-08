import { useEffect } from "react";
import Sparkline from "./Sparkline";
import DealScoreBreakdown from "./DealScoreBreakdown";
import { stripTrackingParams } from "./ProductCard";
import { SHIPPING_THRESHOLDS } from "../lib/shipping";
import type { Product } from "./ProductCard";
import styles from "../styles/CompareModal.module.css";

type ModalProps = {
  products: Product[];
  onClose: () => void;
  onRemove: (key: string) => void;
};

export default function CompareModal({ products, onClose, onRemove }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Compare products"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.title}>Compare products</h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            type="button"
            aria-label="Close comparison"
          >
            ✕
          </button>
        </div>

        <div
          className={styles.columns}
          style={{ gridTemplateColumns: `repeat(${products.length}, 1fr)` }}
        >
          {products.map((p) => {
            const atlPct =
              p.all_time_low > 0
                ? ((p.price - p.all_time_low) / p.all_time_low) * 100
                : null;
            const isAtl = atlPct !== null && atlPct <= 0.01;
            const allRetailers = [
              { retailer: p.retailer, price: p.price, url: p.url, in_stock: p.in_stock },
              ...p.other_retailers,
            ].sort((a, b) => a.price - b.price);

            return (
              <div key={p.group_key} className={styles.col}>
                {p.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt={p.name} className={styles.image} />
                )}
                <h3 className={styles.name}>{p.name}</h3>

                <div className={styles.rows}>
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>Best price</span>
                    <span className={`${styles.dataValue}`}>
                      ${p.price.toFixed(2)}
                    </span>
                  </div>
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>vs ATL</span>
                    <span
                      className={`${styles.dataValue} ${
                        isAtl ? styles.green : styles.orange
                      }`}
                    >
                      {isAtl
                        ? "AT ATL"
                        : atlPct !== null
                        ? `+${atlPct.toFixed(0)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>7-day</span>
                    <span
                      className={`${styles.dataValue} ${
                        p.price_change_7d !== null && p.price_change_7d < 0
                          ? styles.green
                          : p.price_change_7d !== null && p.price_change_7d > 0
                          ? styles.red
                          : ""
                      }`}
                    >
                      {p.price_change_7d !== null
                        ? `${p.price_change_7d < 0 ? "↓" : "↑"} ${Math.abs(
                            p.price_change_7d
                          ).toFixed(1)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>Deal score</span>
                    <DealScoreBreakdown
                      product={p}
                      score={p.deal_score}
                      compact
                    />
                  </div>
                  {p.msrp !== null && (
                    <div className={styles.dataRow}>
                      <span className={styles.dataLabel}>MSRP</span>
                      <span className={styles.dataValue}>
                        ${p.msrp.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                <div className={styles.sparkWrap}>
                  <Sparkline points={p.history} />
                </div>

                <div className={styles.retailerList}>
                  {allRetailers.slice(0, 5).map((r) => {
                    const shippingHint = SHIPPING_THRESHOLDS[r.retailer];
                    return (
                      <div key={r.retailer}>
                        <div className={styles.retailerRow}>
                          <span
                            className={`${styles.dot} ${
                              r.in_stock ? styles.dotGreen : styles.dotGrey
                            }`}
                          />
                          <span className={styles.retailerName}>{r.retailer}</span>
                          <span className={styles.retailerPrice}>
                            ${r.price.toFixed(2)}
                          </span>
                          <a
                            href={stripTrackingParams(r.url)}
                            target="_blank"
                            rel="noreferrer"
                            className={`${styles.buyLink} ${
                              !r.in_stock ? styles.buyLinkOos : ""
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.in_stock ? "Buy →" : "View →"}
                          </a>
                        </div>
                        {shippingHint && (
                          <p className={styles.shippingHint}>{shippingHint}</p>
                        )}
                      </div>
                    );
                  })}
                  {allRetailers.length > 5 && (
                    <p
                      style={{
                        fontSize: "0.72rem",
                        color: "#8b949e",
                        margin: 0,
                      }}
                    >
                      +{allRetailers.length - 5} more — open product for full list
                    </p>
                  )}
                </div>

                <div className={styles.colFooter}>
                  <a
                    href={stripTrackingParams(p.url)}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.buyBtn}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Buy best price →
                  </a>
                  <button
                    className={styles.removeBtn}
                    onClick={() => onRemove(p.group_key)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Floating compare bar ─────────────────────────────────────────────── */

type BarProps = {
  products: Product[];
  onRemove: (key: string) => void;
  onCompare: () => void;
  onClear: () => void;
};

export function CompareBar({ products, onRemove, onCompare, onClear }: BarProps) {
  if (products.length === 0) return null;

  return (
    <div className={styles.compareBar}>
      <div className={styles.compareBarItems}>
        {products.map((p) => (
          <div key={p.group_key} className={styles.compareBarItem}>
            {p.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.image_url}
                alt={p.name}
                className={styles.compareBarThumb}
              />
            ) : (
              <div className={styles.compareBarThumb} />
            )}
            <button
              className={styles.compareBarRemove}
              onClick={() => onRemove(p.group_key)}
              type="button"
              aria-label={`Remove ${p.name} from comparison`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button className={styles.compareBarBtn} onClick={onCompare} type="button">
        Compare ({products.length})
      </button>
      <button className={styles.compareBarClear} onClick={onClear} type="button">
        Clear all
      </button>
    </div>
  );
}
