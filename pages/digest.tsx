import type { GetServerSideProps } from "next";
import Link from "next/link";
import type { DigestResponse } from "./api/digest";
import type { TcgSlug } from "../lib/tcg.config";
import { TCG_CONFIGS } from "../lib/tcg.config";
import styles from "../styles/Digest.module.css";

type Props = { digest: DigestResponse | null; tcg: TcgSlug };

export const getServerSideProps: GetServerSideProps<Props> = async ({ req, query }) => {
  const tcg = (query.tcg === "mtg" ? "mtg" : "pokemon") as TcgSlug;
  const host     = req.headers.host ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const secret   = process.env.DIGEST_SECRET ?? "";

  try {
    const res = await fetch(`${protocol}://${host}/api/digest?tcg=${tcg}`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    if (!res.ok) return { props: { digest: null, tcg } };
    const digest = (await res.json()) as DigestResponse;
    return { props: { digest, tcg } };
  } catch (_e) {
    return { props: { digest: null, tcg } };
  }
};

export default function DigestPage({ digest, tcg }: Props) {
  const config = TCG_CONFIGS[tcg];
  const otherTcg = tcg === "pokemon" ? "mtg" : "pokemon";
  const otherConfig = TCG_CONFIGS[otherTcg];

  if (!digest) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>Could not load this week&apos;s deals right now.</p>
        <p style={{ textAlign: "center" }}>
          <Link href={`/${tcg}`}>← Back to tracker</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.tcgSwitcher}>
        <Link href="/digest?tcg=pokemon" className={tcg === "pokemon" ? styles.tcgActive : styles.tcgLink}>
          {TCG_CONFIGS.pokemon.shortName}
        </Link>
        <span className={styles.tcgDivider}>|</span>
        <Link href="/digest?tcg=mtg" className={tcg === "mtg" ? styles.tcgActive : styles.tcgLink}>
          {TCG_CONFIGS.mtg.shortName}
        </Link>
      </div>
      <h1 className={styles.heading}>🔥 Top {config.shortName} deals</h1>
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
        <Link href={`/${tcg}`}>← Back to tracker</Link>
        {" · "}
        <Link href={`/digest?tcg=${otherTcg}`}>{otherConfig.shortName} digest →</Link>
      </p>
    </div>
  );
}
