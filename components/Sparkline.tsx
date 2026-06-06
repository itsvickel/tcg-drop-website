import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import styles from "../styles/Card.module.css";

type SparklinePoint = {
  date: string;
  price: number;
  retailer: string;
};

type SparklineProps = {
  points: SparklinePoint[];
};

const tooltipStyle: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: "6px",
  fontSize: "0.78rem",
  color: "#c9d1d9",
  padding: "4px 8px"
};

export default function Sparkline({ points }: SparklineProps) {
  if (points.length < 2) {
    return <div className={styles.sparklineEmpty}>Not enough data yet</div>;
  }

  const first = points[0].price;
  const last = points[points.length - 1].price;
  const downTrend = last <= first;
  const color = downTrend ? "#3fb950" : "#f85149";
  const fill = downTrend ? "rgba(63, 185, 80, 0.18)" : "rgba(248, 81, 73, 0.18)";

  return (
    <div className={styles.sparklineWrap}>
      <ResponsiveContainer width="100%" height={48}>
        <AreaChart data={points}>
          <Area type="monotone" dataKey="price" stroke={color} fill={fill} strokeWidth={2} dot={false} />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ stroke: "rgba(139,148,158,0.25)", strokeWidth: 1 }}
            formatter={(value: number) => [`$${Number(value).toFixed(2)} CAD`, "Price"]}
            labelFormatter={(_label: unknown, payload: Array<{ payload?: SparklinePoint }>) => {
              const date = payload?.[0]?.payload?.date;
              if (date) {
                return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
              }
              return "";
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
