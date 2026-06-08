import type { GetServerSideProps } from "next";
import Link from "next/link";
import type { DigestResponse } from "./api/digest";
import styles from "../styles/Digest.module.css";

type Props = { digest: DigestResponse | null };

export const getServerSideProps: GetServerSideProps<Props> = async ({ req }) => {
  const host     = req.headers.host ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const secret   = process.env.DIGEST_SECRET ?? "";

  try {
    const res = await fetch(`${protocol}://${host}/api/digest`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    if (!res.ok) return { props: { digest: null } };
    const digest = (await res.json()) as DigestResponse;
    return { props: { digest } };
  } catch (_e) {
    return { props: { digest: null } };
  }
};

export default function DigestPage({ digest }: Props) {
  if (!digest) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>Could not load this week&apos;s deals right now.</p>
        <p style={{ textAlign: "center" }}>
          <Link href="/">← Back to tracker</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>🔥 Top Pokemon TCG deals</h1>
      <p className={styles.sub}>
        Week of {digest.week} &middot; Canadian retailers &middot; Prices in CAD
      </p>

      <div className={styles.list}>
        {digest.deals.map((deal, i) => {
          const isAtl =
            deal.all_time_low > 0 && deal.price <= deal.all_time_low + 0.0001;
          const hasDiscount =
            deal.msrp !== null && deal.msrp > deal.price;
          const savings =
            hasDiscount
              ? (((deal.msrp! - deal.price) / deal.msrp!) * 100).toFixed(0)
              : null;

          return (
            <div key={deal.group_key} className={styles.dealRow}>
              <span className={styles.rank}>{i + 1}</span>
              {deal.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={deal.image_url}
                  alt=""
                  className={styles.thumb}
                  loading="lazy"
                />
              ) : (
                <div className={styles.thumb} />
              )}
              <div className={styles.info}>
                <p className={styles.name}>{deal.name}</p>
                <p className={styles.retailer}>{deal.retailer}</p>
                {hasDiscount && (
                  <p className={styles.msrp}>
                    {savings}% off MSRP (${deal.msrp!.toFixed(2)})
                  </p>
                )}
              </div>
              <div className={styles.right}>
                <span className={styles.price}>${deal.price.toFixed(2)}</span>
                {deal.price_change_7d !== null && deal.price_change_7d < 0 && (
                  <span className={styles.drop}>
                    ↓{Math.abs(deal.price_change_7d).toFixed(0)}%
                  </span>
                )}
                {isAtl && <span className={styles.atl}>ATL</span>}
                <a
                  href={deal.url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.buyBtn}
                >
                  Buy →
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <p className={styles.footer}>
        Generated{" "}
        {new Date(digest.generated_at).toLocaleString("en-CA", {
          timeZone: "America/Toronto",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
        {" · "}
        <Link href="/">← Back to tracker</Link>
      </p>
    </div>
  );
}
