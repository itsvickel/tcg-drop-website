import styles from "../styles/Footer.module.css";

type Props = {
  syncedAt: string | null;
  retailersCount: number;
  productsCount: number;
};

export default function Footer({ syncedAt, retailersCount, productsCount }: Props) {
  const syncDate = syncedAt ? new Date(syncedAt) : null;
  const syncLabel = syncDate
    ? syncDate.toLocaleString("en-CA", {
        timeZone: "America/Toronto",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.col}>
          <span className={styles.brand}>TCG Drop</span>
          <span className={styles.tagline}>
            Canadian retail prices, auto-refreshed every 3 hours
          </span>
        </div>
        <div className={styles.col}>
          <div className={styles.meta}>
            <span>{productsCount.toLocaleString()} products</span>
            <span className={styles.dot}>·</span>
            <span>{retailersCount} retailers</span>
            <span className={styles.dot}>·</span>
            <span>Updated {syncLabel}</span>
          </div>
          <p className={styles.disclaimer}>
            Prices are for informational purposes only. Always verify the current price
            before purchasing. Prices may change without notice.
          </p>
        </div>
      </div>
    </footer>
  );
}
