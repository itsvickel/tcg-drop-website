import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildSeries,
  seriesNote,
  EMPTY_SERIES,
  type BasketItem,
  type CollectionSeries,
  type PricePoint,
} from "../lib/collectionHistory";
import type { ValuedHolding } from "../lib/collection";
import styles from "../styles/CollectionChart.module.css";

/**
 * Your collection's value over the window we have prices for.
 *
 * Fetches history for the held products only — a POST, so the list of what
 * somebody owns never lands in a URL or an access log — and combines it with
 * quantities in the browser. The server is told which products, never how many,
 * so no request here can reconstruct anyone's portfolio value.
 *
 * The cost-basis reference line is drawn only when every holding in the chart
 * has a recorded cost. A partial cost basis under a full market line would put
 * two numbers on one axis that are counting different things, and the gap
 * between them would read as profit that is really just missing data.
 */

const money = (n: number) => `$${n.toFixed(2)}`;

type Props = {
  holdings: ValuedHolding[];
  /** Today, as YYYY-MM-DD. Passed so the chart's last point is deterministic. */
  today: string;
};

type FetchState = "idle" | "loading" | "ready" | "error";

export default function CollectionValueChart({ holdings, today }: Props) {
  const [series, setSeries] = useState<CollectionSeries>(EMPTY_SERIES);
  const [state, setState] = useState<FetchState>("idle");

  // Grouped by game: the two feeds are separate, so history comes from two
  // requests. Sorted so the key is stable and an unrelated re-render does not
  // refetch.
  const byGame = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const h of holdings) {
      const list = map.get(h.tcg) ?? [];
      list.push(h.group_key);
      map.set(h.tcg, list);
    }
    for (const list of map.values()) list.sort();
    return map;
  }, [holdings]);

  const requestKey = useMemo(
    () =>
      [...byGame.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([game, keys]) => `${game}:${keys.join(",")}`)
        .join("|"),
    [byGame]
  );

  useEffect(() => {
    if (!requestKey) {
      setSeries(EMPTY_SERIES);
      setState("idle");
      return;
    }

    let cancelled = false;
    setState("loading");

    (async () => {
      try {
        const responses = await Promise.all(
          [...byGame.entries()].map(async ([tcg, keys]) => {
            const res = await fetch("/api/collection-history", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tcg, keys }),
            });
            if (!res.ok) throw new Error(`history ${res.status}`);
            return (await res.json()) as { series: Record<string, PricePoint[]> };
          })
        );
        if (cancelled) return;

        const merged: Record<string, PricePoint[]> = {};
        for (const response of responses) Object.assign(merged, response.series);

        const basket: BasketItem[] = holdings.map((h) => ({
          group_key: h.group_key,
          quantity: h.quantity,
          history: merged[h.group_key] ?? [],
          marketPrice: h.marketPrice,
        }));

        setSeries(buildSeries(basket, today));
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // holdings is intentionally excluded: requestKey already changes whenever
    // the set of tracked products does, and depending on the array itself would
    // refetch on every quantity edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, today]);

  if (state === "idle" && holdings.length === 0) return null;

  if (state === "loading") {
    return (
      <section className={styles.wrap}>
        <h2 className={styles.heading}>Value over time</h2>
        <p className={styles.muted}>Building the chart…</p>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className={styles.wrap}>
        <h2 className={styles.heading}>Value over time</h2>
        <p className={styles.muted}>
          Could not load price history just now. The totals above are unaffected.
        </p>
      </section>
    );
  }

  if (!series.points.length) {
    return (
      <section className={styles.wrap}>
        <h2 className={styles.heading}>Value over time</h2>
        <p className={styles.muted}>
          Not enough price history yet for the things you hold. This fills in as
          we keep tracking them.
        </p>
      </section>
    );
  }

  // Only meaningful when every charted holding has a cost — see the note above.
  const charted = holdings.filter((h) => series.included > 0 && h.marketPrice !== null);
  const allHaveCost = charted.length > 0 && charted.every((h) => h.costTotal !== null);
  const costBasis = allHaveCost
    ? charted.reduce((sum, h) => sum + (h.costTotal ?? 0), 0)
    : null;

  const up = (series.change ?? 0) >= 0;
  const colour = up ? "#3fb950" : "#f85149";

  return (
    <section className={styles.wrap}>
      <div className={styles.head}>
        <h2 className={styles.heading}>Value over time</h2>
        <div className={styles.delta}>
          <strong className={up ? styles.up : styles.down}>
            {up ? "+" : "−"}
            {money(Math.abs(series.change ?? 0))}
          </strong>
          {series.changePct !== null && (
            <span className={up ? styles.up : styles.down}>
              {up ? "+" : "−"}
              {Math.abs(series.changePct).toFixed(1)}%
            </span>
          )}
          <span className={styles.window}>over {series.points.length} days</span>
        </div>
      </div>

      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={series.points} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="collectionValueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colour} stopOpacity={0.28} />
                <stop offset="100%" stopColor={colour} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#21262d" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#6e7681", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#30363d" }}
              minTickGap={28}
              tickFormatter={(d: string) =>
                new Date(`${d}T00:00:00Z`).toLocaleDateString("en-CA", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })
              }
            />
            <YAxis
              tick={{ fill: "#6e7681", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={58}
              // Never zero-based: a collection worth $900 that moved $40 would
              // render as a flat line against a $0 floor, hiding the only thing
              // the chart exists to show.
              domain={["dataMin - 20", "dataMax + 20"]}
              tickFormatter={(v: number) => `$${Math.round(v)}`}
            />
            <Tooltip
              contentStyle={{
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: 8,
                fontSize: "0.78rem",
              }}
              labelStyle={{ color: "#8b949e" }}
              labelFormatter={(d) =>
                new Date(`${d}T00:00:00Z`).toLocaleDateString("en-CA", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })
              }
              formatter={(v: number) => [money(v), "Value"]}
            />
            {costBasis !== null && (
              <ReferenceLine
                y={costBasis}
                stroke="#8b949e"
                strokeDasharray="4 4"
                label={{
                  value: `cost ${money(costBasis)}`,
                  fill: "#8b949e",
                  fontSize: 10,
                  position: "insideBottomLeft",
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="value"
              stroke={colour}
              strokeWidth={2}
              fill="url(#collectionValueFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className={styles.note}>{seriesNote(series)}</p>
    </section>
  );
}
