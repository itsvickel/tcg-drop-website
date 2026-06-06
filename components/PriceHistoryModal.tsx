import { useEffect } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from "recharts";
import styles from "../styles/Modal.module.css";

type HistoryEntry = {
  date: string;
  price: number;
  retailer: string;
};

type Props = {
  name: string;
  history: HistoryEntry[];
  onClose: () => void;
};

type TooltipPayload = {
  active?: boolean;
  payload?: Array<{ payload: HistoryEntry }>;
  label?: string;
};

function CustomTooltip({ active, payload, label }: TooltipPayload) {
  if (!active || !payload?.length) return null;
  const entry = payload[0].payload;
  const date = label
    ? new Date(label).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    : "";
  return (
    <div style={{
      background: "#161b22", border: "1px solid #30363d", borderRadius: "8px",
      padding: "8px 12px", fontSize: "0.82rem", color: "#c9d1d9", lineHeight: 1.6
    }}>
      <div style={{ color: "#8b949e", marginBottom: 4 }}>{date}</div>
      <div style={{ color: "#58a6ff", fontWeight: 700, fontFamily: "JetBrains Mono, monospace" }}>
        ${entry.price.toFixed(2)} CAD
      </div>
      <div style={{ color: "#8b949e", fontSize: "0.78rem" }}>{entry.retailer}</div>
    </div>
  );
}

export default function PriceHistoryModal({ name, history, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const prices = sorted.map((e) => e.price);
  const downTrend = prices[prices.length - 1] <= prices[0];
  const color = downTrend ? "#3fb950" : "#f85149";
  const fill  = downTrend ? "rgba(63,185,80,0.18)" : "rgba(248,81,73,0.18)";
  const allTimeLow  = Math.min(...prices);
  const allTimeHigh = Math.max(...prices);

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Price history">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{name}</h2>
          <button className={styles.closeButton} onClick={onClose} type="button" aria-label="Close">✕ Close</button>
        </div>

        <div className={styles.statsRow}>
          <span>All-time low: <strong>${allTimeLow.toFixed(2)}</strong></span>
          <span>All-time high: <strong>${allTimeHigh.toFixed(2)}</strong></span>
          <span>Data points: <strong>{sorted.length}</strong></span>
        </div>

        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={sorted} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="price"
                stroke={color}
                fill={fill}
                strokeWidth={2}
                dot={{ fill: color, r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <p className={styles.hint}>Each point shows the best price found across all retailers on that day.</p>
      </div>
    </div>
  );
}
