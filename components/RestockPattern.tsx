import {
  restockSentence,
  weekdayIntensity,
  WEEKDAY_SHORT,
  type RetailerPattern,
} from "../lib/stockStats";
import styles from "../styles/RestockPattern.module.css";

/**
 * When a shop restocks: a seven-cell weekday strip, and a sentence only when
 * there is one worth writing.
 *
 * The strip is a CSS grid rather than a chart because seven numbers do not need
 * an axis, and because recharts would arrive with a tooltip, a legend and a
 * responsive container for a widget that is 200 pixels wide.
 *
 * Three things here are load-bearing rather than decorative:
 *
 *   * The counts are always visible, not on hover. A heatmap whose numbers hide
 *     behind a pointer invites the reader to judge a shop by how dark a square
 *     looks, and dark squares here can be four restocks.
 *   * "No clear pattern" renders as text rather than as a hidden section. The
 *     absence is a finding — most shops genuinely restock whenever stock
 *     arrives — and hiding it would let the reader assume we never looked.
 *   * The footnote says days are UTC and that we check twice a day. The evening
 *     scan lands late the previous day in Eastern time, so a shop whose Tuesday
 *     column is tallest may really be restocking Monday evening, and a reader
 *     planning around it deserves to know that before they set an alarm.
 */
export default function RestockPattern({
  retailer,
  pattern,
}: {
  retailer: string;
  pattern: RetailerPattern | null;
}) {
  if (!pattern || pattern.restocks === 0) return null;

  const sentence = restockSentence(pattern);
  const intensity = weekdayIntensity(pattern);
  const peak = Math.max(...pattern.by_weekday);

  return (
    <section className={styles.wrap} aria-labelledby="restock-pattern-heading">
      <h2 className={styles.heading} id="restock-pattern-heading">
        When {retailer} restocks
      </h2>

      {sentence ? (
        <p className={styles.verdict}>{sentence}</p>
      ) : (
        <p className={styles.verdictMuted}>
          {pattern.verdict === "insufficient"
            ? `Only ${pattern.restocks} restock${pattern.restocks === 1 ? "" : "s"} on record so far — not enough to call a pattern.`
            : `No clear weekday pattern. Its ${pattern.restocks} restocks are spread across the week.`}
        </p>
      )}

      <ol className={styles.grid} aria-label="Restocks by weekday">
        {pattern.by_weekday.map((count, i) => {
          const top = pattern.top_days.includes(
            ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i]
          );
          return (
            <li
              key={WEEKDAY_SHORT[i]}
              className={`${styles.cell} ${top ? styles.cellTop : ""}`}
            >
              <span className={styles.day}>{WEEKDAY_SHORT[i]}</span>
              <span
                className={styles.bar}
                // Opacity rather than a colour ramp: one hue keeps the strip
                // readable for the ~8% of men with red-green colour blindness,
                // and the count below each bar carries the real value anyway.
                style={{ opacity: 0.18 + intensity[i] * 0.82 }}
                aria-hidden="true"
              />
              <span className={styles.count}>{count}</span>
            </li>
          );
        })}
      </ol>

      <p className={styles.footnote}>
        {pattern.restocks.toLocaleString("en-CA")} restocks across{" "}
        {pattern.products.toLocaleString("en-CA")} product
        {pattern.products === 1 ? "" : "s"}, {formatRange(pattern.first_restock, pattern.last_restock)}.
        Busiest day: {peak}. We check twice a day and date by UTC, so a restock
        late in the evening Eastern time lands on the next day here.
      </p>
    </section>
  );
}

function formatRange(from: string, to: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return from === to ? `on ${fmt(from)}` : `${fmt(from)} to ${fmt(to)}`;
}
