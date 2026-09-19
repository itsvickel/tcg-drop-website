import { useEffect, useRef, useState } from "react";
import { selloutBand, type Sellout } from "../lib/drops";
import styles from "../styles/SelloutBadge.module.css";

/**
 * How fast this kind of product has been selling out — "camp the page" or "no
 * rush", with the evidence one hover away.
 *
 * Sits beside ConfidenceBadge and deliberately does not merge with it. The two
 * answer different questions and can point opposite ways: a rumoured date on a
 * product type that vanishes in a day, or a date locked to the hour on
 * something that sits on shelves for a fortnight. Averaging them would destroy
 * the only two facts a buyer is actually weighing.
 *
 * The statistic is about the product *type*, never this drop — an unreleased
 * product has no shelf life of its own to measure. The tooltip says so in those
 * words, because "sells out in 2 days" read as a claim about this specific
 * release would be a promise we have no standing to make.
 */

type Props = {
  sellout: Sellout;
  compact?: boolean;
};

const UNIT_PLURAL: Record<string, string> = {
  case: "Cases",
  box: "Boxes",
  bundle: "Bundles",
  tin: "Tins",
  deck: "Decks",
  blister: "Blisters",
  pack: "Packs",
};

export default function SelloutBadge({ sellout, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!sellout) return null;

  const band = selloutBand(sellout.median_days);
  const unit = UNIT_PLURAL[sellout.size_class] ?? "These";
  const days = Math.round(sellout.median_days);
  const quick = Math.round(sellout.gone_within_a_day_pct * 100);
  const label = days <= 1 ? "Gone in a day" : `~${days} days`;

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${compact ? styles.compact : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={`${styles.badge} ${styles[band]}`}
        aria-expanded={open}
        aria-label={`Similar products stay in stock about ${days} days. Show details.`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        <span className={styles.icon} aria-hidden="true">
          ⏱
        </span>
        <span className={styles.value}>{label}</span>
      </button>

      {open && (
        <div className={styles.tooltip} role="tooltip">
          <p className={styles.tooltipTitle}>How fast does this kind sell out?</p>
          <p className={styles.tooltipLede}>
            {unit} we track have stayed in stock about <strong>{days}</strong>{" "}
            {days === 1 ? "day" : "days"} once they land.
          </p>

          <ul className={styles.rows}>
            <li className={styles.row}>
              <span className={styles.rowLabel}>Typical shelf life</span>
              <span className={styles.rowValue}>
                {days} {days === 1 ? "day" : "days"}
              </span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowLabel}>Fastest quarter</span>
              <span className={styles.rowValue}>
                under {Math.max(1, Math.round(sellout.p25_days))} day
                {Math.round(sellout.p25_days) === 1 ? "" : "s"}
              </span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowLabel}>Gone within a day</span>
              <span className={styles.rowValue}>{quick}%</span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowLabel}>Based on</span>
              <span className={styles.rowValue}>{sellout.runs} restocks</span>
            </li>
          </ul>

          <p className={styles.caveat}>
            This describes {unit.toLowerCase()} in general, not this release —
            it has not gone on sale yet. We check stock twice a day, so anything
            that sells out faster than that reads here as one day.
          </p>
        </div>
      )}
    </div>
  );
}
