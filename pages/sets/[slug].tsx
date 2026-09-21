import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import useSWR from "swr";
import GameTabBar from "../../components/GameTabBar";
import GameSubNav from "../../components/GameSubNav";
import Footer from "../../components/Footer";
import { sizedImage, thumbSrcSet, THUMB } from "../../lib/images";
import { findSetBySlug } from "../../lib/movers";
import { deliveredPrice } from "../../lib/shipping";
import { TCG_CONFIGS, type TcgSlug } from "../../lib/tcg.config";
import type { Product } from "../../lib/products";
import styles from "../../styles/Movers.module.css";

/** One set, every sealed product in it, cheapest first. */

type ApiResponse = { products: Product[] };
const fetcher = (url: string) => fetch(url).then((r) => r.json()) as Promise<ApiResponse>;

export default function SetPage() {
  const router = useRouter();
  const tcg: TcgSlug = (router.query.tcg as TcgSlug) in TCG_CONFIGS
    ? (router.query.tcg as TcgSlug) : "pokemon";
  const slug = typeof router.query.slug === "string" ? router.query.slug : "";

  const { data, error, isLoading } = useSWR<ApiResponse>(`/api/products?tcg=${tcg}`, fetcher, {
    revalidateOnFocus: false,
  });

  const products = data?.products ?? [];
  const setName = findSetBySlug(products, slug);
  const inSet = products
    .filter((p) => p.set_name === setName && p.category !== "single")
    .sort((a, b) => a.price - b.price);

  const cheapest = inSet[0];
  const title = setName ?? "Set";

  return (
    <>
      <Head>
        <title>{`${title} Sealed Prices — The Mana Cafe`}</title>
        <meta
          name="description"
          content={
            cheapest
              ? `${title} sealed product across Canadian retailers, from $${cheapest.price.toFixed(2)}. Compare ${inSet.length} products.`
              : `${title} sealed product prices across Canadian retailers.`
          }
        />
      </Head>

      <GameTabBar tcg={tcg} />
      <GameSubNav tcg={tcg} active="sets" />

      <main className={styles.page}>
        <header className={styles.header}>
          <Link href={`/sets?tcg=${tcg}`} className={styles.back}>← All sets</Link>
          <h1 className={styles.title}>{title}</h1>
          {inSet.length > 0 && (
            <p className={styles.subtitle}>
              {inSet.length} sealed product{inSet.length === 1 ? "" : "s"} tracked, from $
              {cheapest.price.toFixed(2)}.
            </p>
          )}
        </header>

        {isLoading && <p className={styles.state}>Loading…</p>}
        {error && <p className={styles.state} role="alert">Could not load this set.</p>}
        {!isLoading && !error && inSet.length === 0 && (
          <p className={styles.state}>
            Nothing tracked for this set yet. <Link href={`/sets?tcg=${tcg}`}>Browse all sets</Link>.
          </p>
        )}

        <ul className={styles.list}>
          {inSet.map((p) => {
            const delivered = deliveredPrice(p.price, p.retailer);
            return (
              <li key={p.group_key} className={styles.row}>
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sizedImage(p.image_url, THUMB)}
                    srcSet={thumbSrcSet(p.image_url)}
                    alt=""
                    className={styles.thumb}
                    loading="lazy"
                    width={40}
                    height={40}
                    decoding="async"
                  />
                ) : (
                  <span className={styles.thumbBlank} aria-hidden="true" />
                )}
                <span className={styles.body}>
                  <Link href={`/${tcg}/${p.group_key}`} className={styles.name}>{p.name}</Link>
                  <span className={styles.meta}>
                    {p.retailer}
                    {p.price_per_pack !== null && <> · ${p.price_per_pack.toFixed(2)}/pack</>}
                    {delivered.shipsFree && <> · ships free</>}
                  </span>
                </span>
                <span className={styles.price}>${p.price.toFixed(2)}</span>
                {p.price_change_7d !== null && (
                  <span className={`${styles.change} ${p.price_change_7d > 0 ? styles.up : styles.down}`}>
                    {p.price_change_7d > 0 ? "+" : ""}{p.price_change_7d.toFixed(1)}%
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </main>
      <Footer
        syncedAt={null}
        retailersCount={new Set(inSet.map((p) => p.retailer)).size}
        productsCount={inSet.length}
      />
    </>
  );
}
