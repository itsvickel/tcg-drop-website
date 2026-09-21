import Head from "next/head";
import Link from "next/link";
import type { GetStaticProps } from "next";
import Footer from "../../components/Footer";
import { loadApiResponseCached } from "../../lib/serverProducts";
import { TCG_CONFIGS } from "../../lib/tcg.config";
import { summariseRetailers, type RetailerSummary } from "../../lib/retailers";
import { shippingLabel } from "../../lib/shipping";
import { SITE_URL } from "../../lib/siteUrl";
import styles from "../../styles/Retailers.module.css";

/**
 * Every Canadian shop we track, with what it carries and what delivery costs.
 *
 * Server-rendered rather than fetched on mount. The listing pages were changed
 * to embed real prices for exactly this reason, and a directory page that
 * arrives empty to a crawler is a directory page nobody finds.
 */

type Props = { retailers: RetailerSummary[]; generatedAt: string };

export const getStaticProps: GetStaticProps<Props> = async () => {
  try {
    const [mtg, pokemon] = await Promise.all([
      loadApiResponseCached(TCG_CONFIGS.mtg),
      loadApiResponseCached(TCG_CONFIGS.pokemon),
    ]);
    return {
      props: {
        retailers: summariseRetailers([
          { game: "mtg", products: mtg.products },
          { game: "pokemon", products: pokemon.products },
        ]),
        generatedAt: mtg.generated_at || "",
      },
      revalidate: 3600,
    };
  } catch (err) {
    // A transient data-repo outage should render an empty directory, not bake
    // an error page into the CDN.
    console.error("[retailers] getStaticProps failed:", err);
    return { props: { retailers: [], generatedAt: "" }, revalidate: 120 };
  }
};

export default function RetailersPage({ retailers, generatedAt }: Props) {
  const withPolicy = retailers.filter((r) => r.policy?.freeOver != null).length;
  // Best-price wins, not raw listings: summing listings double-counts a
  // product stocked by several shops.
  const totalListings = retailers.reduce((n, r) => n + r.bestPriceWins, 0);

  return (
    <>
      <Head>
        <title>Canadian Pokémon &amp; Magic Card Shops — Prices and Shipping | The Mana Cafe</title>
        <meta
          name="description"
          content={`Compare ${retailers.length} Canadian card shops: how much of the catalogue each carries, where they sit on price, and what their free-shipping threshold is.`}
        />
        <link rel="canonical" href={`${SITE_URL}/retailers`} />
      </Head>

      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Canadian card shops</h1>
          <p className={styles.subtitle}>
            Every shop we track prices from, with what it carries and what
            delivery costs. Shipping thresholds are read from each retailer&rsquo;s
            own policy page — {withPolicy} of {retailers.length} publish one, and
            the rest say &ldquo;check site&rdquo; rather than a number we guessed.
          </p>
        </header>

        {retailers.length === 0 ? (
          <p className={styles.empty}>
            Retailer data is briefly unavailable. It refreshes automatically.
          </p>
        ) : (
          <ul className={styles.grid}>
            {retailers.map((r) => (
              <li key={r.slug} className={styles.card}>
                <Link href={`/retailers/${r.slug}`} className={styles.cardLink}>
                  <span className={styles.name}>{r.name}</span>
                </Link>
                <dl className={styles.stats}>
                  <div className={styles.stat}>
                    <dt>Listings</dt>
                    <dd>{r.listings.toLocaleString("en-CA")}</dd>
                  </div>
                  <div className={styles.stat}>
                    <dt>Cheapest here</dt>
                    <dd>{r.bestPriceWins.toLocaleString("en-CA")}</dd>
                  </div>
                  <div className={styles.stat}>
                    <dt>Delivery</dt>
                    <dd className={styles.shipping}>
                      {r.policy ? shippingLabel(r.name) : "Check site"}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}

        {generatedAt && (
          <p className={styles.stamp}>
            Prices last refreshed {new Date(generatedAt).toLocaleString("en-CA")}.
          </p>
        )}
      </main>

      <Footer
        syncedAt={generatedAt || null}
        retailersCount={retailers.length}
        productsCount={totalListings}
      />
    </>
  );
}
