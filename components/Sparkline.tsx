import { Area, AreaChart, ResponsiveContainer } from "recharts";
import styles from "../styles/Card.module.css";

type SparklinePoint = {
  date: string;
  price: number;
  retailer: string;
};

type SparklineProps = {
  points: SparklinePoint[];
};

export default function Sparkline({ points }: SparklineProps) {
  if (points.length < 2) {
    return <div className={styles.sparklineEmpty}>Not enough data yet</div>;
  }

  const first = points[0].price;
  const last = points[points.length - 1].price;
  const downTrend = last <= first;

  return (
    <div className={styles.sparklineWrap}>
      <ResponsiveContainer width="100%" height={48}>
        <AreaChart data={points}>
          <Area
            type="monotone"
            dataKey="price"
            stroke={downTrend ? "#3fb950" : "#f85149"}
            fill={downTrend ? "rgba(63, 185, 80, 0.18)" : "rgba(248, 81, 73, 0.18)"}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
