import Head from "next/head";
import Link from "next/link";
import type { GetStaticPaths, GetStaticProps } from "next";
import Footer from "../../components/Footer";
import RestockPattern from "../../components/RestockPattern";
import { loadApiResponseCached, loadStockStatsCached } from "../../lib/serverProducts";
import { mergePatterns, type RetailerPattern } from "../../lib/stockStats";
import { TCG_CONFIGS } from "../../lib/tcg.config";
import { bestSellersFor, summariseRetailers, type RetailerSummary } from "../../lib/retailers";
import { shippingLabel } from "../../lib/shipping";
import { leanForSsr, type Product } from "../../lib/products";
import { SITE_URL } from "../../lib/siteUrl";
import { UPDATE_CADENCE } from "../../lib/siteFacts";
import styles from "../../styles/Retailers.module.css";

/**
 * One shop: what it carries, where it sits on price, what delivery costs.
 *
 * Substance matters here beyond taste. A page per retailer that only restated
 * the shop's name would be a doorway page and would deserve to be treated as
 * one. Everything on it is measured from listings we actually hold, and the
 * shipping terms link to the retailer's own policy page so the reader can check
 * rather than take our word for it.
 */

const SAMPLE_SIZE = 12;

type Props = {
  retailer: RetailerSummary;
  /** Cheapest in-stock listings, each tagged with the game it links to. */
  samples: (Product & { game: string })[];
  generatedAt: string;
  /**
   * Both games' restock history for this shop, summed. A shop that sells
   * Pokemon and Magic has one restock habit, not two, and showing one game's
   * slice would describe a fraction of its activity as though it were the whole.
   */
  restock: RetailerPattern | null;
};

export const getStaticPaths: GetStaticPaths = async () => {
  // Built on demand: the retailer list grows with the crawler, and a shop added
  // this morning should not 404 until the next deploy.
  return { paths: [], fallback: "blocking" };
};

export const getStaticProps: GetStaticProps<Props> = async (ctx) => {
  const slug = String(ctx.params?.slug ?? "");
  try {
    const [mtg, pokemon, mtgStats, pokemonStats] = await Promise.all([
      loadApiResponseCached(TCG_CONFIGS.mtg),
      loadApiResponseCached(TCG_CONFIGS.pokemon),
      loadStockStatsCached(TCG_CONFIGS.mtg),
      loadStockStatsCached(TCG_CONFIGS.pokemon),
    ]);
    const feeds = [
      { game: "mtg", products: mtg.products },
      { game: "pokemon", products: pokemon.products },
    ];
    const retailer = summariseRetailers(feeds).find((r) => r.slug === slug);

    if (!retailer) return { notFound: true, revalidate: 3600 };

    return {
      props: {
        retailer,
        samples: bestSellersFor(feeds, retailer.name, SAMPLE_SIZE)
          .map(({ product, game }) => ({ ...leanForSsr(product), game })),
        generatedAt: mtg.generated_at || "",
        restock: mergePatterns([
          mtgStats.retailers[retailer.name],
          pokemonStats.retailers[retailer.name],
        ]),
      },
      revalidate: 3600,
    };
  } catch (err) {
    console.error(`[retailers/${slug}] getStaticProps failed:`, err);
    // Retry shortly rather than caching a 404 over a transient outage.
    return { notFound: true, revalidate: 120 };
  }
};

const money = (n: number) => `$${n.toFixed(2)}`;

export default function RetailerPage({ retailer, samples, generatedAt, restock }: Props) {
  const games = retailer.games
    .map((g) => TCG_CONFIGS[g as keyof typeof TCG_CONFIGS]?.displayName ?? g)
    .join(" and ");

  const title = `${retailer.name} — Card Prices and Shipping | TCG Drop`;
  const description =
    `${retailer.name} prices tracked across ${retailer.listings.toLocaleString("en-CA")} ` +
    `listings. Where it is cheapest, what it carries, and what delivery costs.`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={`${SITE_URL}/retailers/${retailer.slug}`} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "Retailers",
                  item: `${SITE_URL}/retailers`,
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: retailer.name,
                  item: `${SITE_URL}/retailers/${retailer.slug}`,
                },
              ],
            }),
          }}
        />
      </Head>

      <main className={styles.page}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <Link href="/retailers">Retailers</Link>
          <span aria-hidden="true"> / </span>
          <span>{retailer.name}</span>
        </nav>

        <header className={styles.header}>
          <h1 className={styles.title}>{retailer.name}</h1>
          <p className={styles.subtitle}>
            We track {retailer.listings.toLocaleString("en-CA")} {games} listing
            {retailer.listings === 1 ? "" : "s"} here, refreshed {UPDATE_CADENCE}.
            {retailer.bestPriceWins > 0 && (
              <>
                {" "}It holds the cheapest price we can find on{" "}
                <strong>{retailer.bestPriceWins.toLocaleString("en-CA")}</strong> of them.
              </>
            )}
          </p>
        </header>

        <section className={styles.factGrid} aria-label="At a glance">
          <div className={styles.fact}>
            <span className={styles.factLabel}>In stock now</span>
            <strong className={styles.factValue}>
              {retailer.inStock.toLocaleString("en-CA")}
            </strong>
            <span className={styles.factSub}>
              of {retailer.listings.toLocaleString("en-CA")} tracked
            </span>
          </div>

          <div className={styles.fact}>
            <span className={styles.factLabel}>Typical price</span>
            <strong className={styles.factValue}>
              {retailer.medianPrice === null ? "—" : money(retailer.medianPrice)}
            </strong>
            <span className={styles.factSub}>
              {retailer.cheapest !== null && retailer.dearest !== null
                ? `${money(retailer.cheapest)} – ${money(retailer.dearest)}`
                : "no listings priced"}
            </span>
          </div>

          <div className={styles.fact}>
            <span className={styles.factLabel}>Sealed / singles</span>
            <strong className={styles.factValue}>
              {retailer.sealed.toLocaleString("en-CA")} / {retailer.singles.toLocaleString("en-CA")}
            </strong>
            <span className={styles.factSub}>listings by type</span>
          </div>

          <div className={styles.fact}>
            <span className={styles.factLabel}>Delivery</span>
            <strong className={styles.factValueSm}>
              {retailer.policy ? shippingLabel(retailer.name) : "Check site"}
            </strong>
            <span className={styles.factSub}>
              {retailer.policy?.source ? (
                <a href={retailer.policy.source} target="_blank" rel="noopener noreferrer nofollow">
                  their policy page
                </a>
              ) : (
                // Saying nothing beats inventing a threshold: a wrong number
                // makes the delivered-price comparison actively misleading.
                "no threshold published"
              )}
            </span>
          </div>
        </section>

        {retailer.policy?.note && <p className={styles.note}>{retailer.policy.note}</p>}

        <RestockPattern retailer={retailer.name} pattern={restock} />

        {samples.length > 0 && (
          <section className={styles.samples}>
            <h2 className={styles.sectionTitle}>Cheapest here right now</h2>
            <p className={styles.sectionNote}>
              Products this shop has in stock at the lowest price we can find
              anywhere we look.
            </p>
            <ul className={styles.sampleList}>
              {samples.map((p) => (
                <li key={`${p.game}-${p.group_key}`} className={styles.sampleRow}>
                  <Link
                    href={`/${p.game}/${encodeURIComponent(p.group_key)}`}
                    className={styles.sampleName}
                  >
                    {p.name}
                  </Link>
                  <span className={styles.samplePrice}>{money(p.price)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className={styles.stamp}>
          Prices are what we last saw, not a quote — always confirm at checkout.
          {generatedAt && ` Last refreshed ${new Date(generatedAt).toLocaleString("en-CA")}.`}
        </p>
      </main>

      <Footer
        syncedAt={generatedAt || null}
        retailersCount={1}
        productsCount={retailer.listings}
      />
    </>
  );
}
