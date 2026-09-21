import Head from "next/head";
import type { GetStaticProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import useSWR from "swr";
import GameTabBar from "../components/GameTabBar";
import GameSubNav from "../components/GameSubNav";
import Footer from "../components/Footer";
import { setSlug, setsWithCounts } from "../lib/movers";
import { TCG_CONFIGS, type TcgSlug } from "../lib/tcg.config";
import type { ApiResponse } from "../lib/products";
import { loadApiResponseCached } from "../lib/serverProducts";
import styles from "../styles/Movers.module.css";

/**
 * Index of every set with sealed product.
 *
 * PriceCharting and Pokecompare both organise around the set, because that is
 * how buyers think ("what's Bloomburrow going for?"). It is also the page shape
 * that ranks — which it could not do while the set list only existed after the
 * client had mounted and fetched. Both games' lists are now server-rendered.
 *
 * Both, rather than one, because the game comes from a query string that
 * getStaticProps cannot see. The lists are one row per set, so carrying the
 * pair costs far less than the catalogue would.
 */

const fetcher = (url: string) => fetch(url).then((r) => r.json()) as Promise<ApiResponse>;

type SetRow = { set: string; count: number; cheapest: number };
type Props = { initialSets: Record<string, SetRow[]> };

export const getStaticProps: GetStaticProps<Props> = async () => {
  const initialSets: Record<string, SetRow[]> = {};
  for (const game of ["pokemon", "mtg"] as const) {
    try {
      const feed = await loadApiResponseCached(TCG_CONFIGS[game]);
      initialSets[game] = setsWithCounts(feed.products);
    } catch (err) {
      // One game's feed being unavailable should not blank the other.
      console.error(`[sets] getStaticProps failed for ${game}:`, err);
      initialSets[game] = [];
    }
  }
  return { props: { initialSets }, revalidate: 900 };
};

export default function SetsPage({ initialSets }: Props) {
  const router = useRouter();
  const tcg: TcgSlug = (router.query.tcg as TcgSlug) in TCG_CONFIGS
    ? (router.query.tcg as TcgSlug) : "pokemon";
  const config = TCG_CONFIGS[tcg];

  const { data, error } = useSWR<ApiResponse>(`/api/products?tcg=${tcg}`, fetcher, {
    revalidateOnFocus: false,
  });

  // Prefer freshly fetched sets, fall back to what was rendered on the server.
  // Never show a loading state over a list we already have: that is what hid
  // the server-rendered products on the listing pages.
  const fetched = data?.products ? setsWithCounts(data.products) : null;
  const sets = fetched?.length ? fetched : initialSets[tcg] ?? [];
  const isLoading = !data && sets.length === 0;

  return (
    <>
      <Head>
        <title>{`All ${config.displayName} Sets — Sealed Prices | The Mana Cafe`}</title>
        <meta
          name="description"
          content={`Every ${config.displayName} set with sealed product tracked across Canadian retailers, with the cheapest current price for each.`}
        />
      </Head>

      <GameTabBar tcg={tcg} />
      <GameSubNav tcg={tcg} active="sets" />

      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Sets</h1>
          <p className={styles.subtitle}>
            Every {config.shortName} set we track sealed product for, with the cheapest current price.
          </p>
        </header>

        {isLoading && <p className={styles.state}>Loading sets…</p>}
        {error && <p className={styles.state} role="alert">Could not load sets. Try again shortly.</p>}
        {!isLoading && !error && sets.length === 0 && (
          <p className={styles.state}>No sealed products are grouped into sets yet.</p>
        )}

        <ul className={styles.setGrid}>
          {sets.map((s) => (
            <li key={s.set} className={styles.setCard}>
              <Link href={`/sets/${setSlug(s.set)}?tcg=${tcg}`} className={styles.setLink}>
                <span className={styles.setName}>{s.set}</span>
                <span className={styles.setMeta}>
                  {s.count} product{s.count === 1 ? "" : "s"} · from ${s.cheapest.toFixed(2)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <Footer
        syncedAt={null}
        retailersCount={new Set((data?.products ?? []).map((p) => p.retailer)).size}
        productsCount={(data?.products ?? []).length}
      />
    </>
  );
}
