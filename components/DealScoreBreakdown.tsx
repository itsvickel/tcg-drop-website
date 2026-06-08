import { useEffect, useRef, useState } from "react";
import type { Product } from "./ProductCard";
import styles from "../styles/DealScoreBreakdown.module.css";

export type DealSignal = {
  label: string;
  value: string;
  positive: boolean;
};

export function computeDealSignals(product: {
  price: number;
  all_time_low: number;
  price_change_7d: number | null;
  in_stock: boolean;
  is_preorder: boolean;
  msrp: number | null;
}): DealSignal[] {
  const signals: DealSignal[] = [];

  if (product.all_time_low > 0) {
    const pctAbove = ((product.price - product.all_time_low) / product.all_time_low) * 100;
    if (pctAbove <= 0.01) {
      signals.push({ label: "Price", value: "At all-time low", positive: true });
    } else {
      signals.push({
        label: "Price",
        value: `+${pctAbove.toFixed(0)}% above ATL`,
        positive: pctAbove < 10,
      });
    }
  }

  if (product.price_change_7d !== null) {
    const pct = product.price_change_7d;
    if (pct <= -1) {
      signals.push({ label: "7-day trend", value: `↓ ${Math.abs(pct).toFixed(1)}%`, positive: true });
    } else if (pct >= 1) {
      signals.push({ label: "7-day trend", value: `↑ ${pct.toFixed(1)}%`, positive: false });
    } else {
      signals.push({ label: "7-day trend", value: "Stable", positive: true });
    }
  }

  if (product.msrp !== null && product.msrp > product.price) {
    const savings = ((product.msrp - product.price) / product.msrp) * 100;
    signals.push({
      label: "vs MSRP",
      value: `${savings.toFixed(0)}% off ($${product.msrp.toFixed(2)})`,
      positive: true,
    });
  }

  if (product.is_preorder) {
    signals.push({ label: "Status", value: "Pre-order", positive: false });
  } else if (product.in_stock) {
    signals.push({ label: "Status", value: "In stock", positive: true });
  } else {
    signals.push({ label: "Status", value: "Out of stock", positive: false });
  }

  return signals;
}

type Props = {
  product: Product;
  score: number;
  compact?: boolean;
};

export default function DealScoreBreakdown({ product, score, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const signals = computeDealSignals(product);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const colorClass =
    score >= 70 ? styles.hot : score >= 40 ? styles.good : styles.neutral;

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${compact ? styles.compact : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      <span
        className={`${styles.badge} ${colorClass}`}
        title="Deal score — hover or tap for breakdown"
      >
        {score >= 70 ? "🔥 " : ""}
        {score}
      </span>
      {open && (
        <div className={styles.tooltip} role="tooltip">
          <p className={styles.tooltipTitle}>Deal score breakdown</p>
          {signals.map((s) => (
            <div key={s.label} className={styles.row}>
              <span className={styles.rowLabel}>{s.label}</span>
              <span className={s.positive ? styles.positive : styles.negative}>
                {s.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
