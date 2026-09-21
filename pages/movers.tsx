import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import useSWR from "swr";
import GameTabBar from "../components/GameTabBar";
import GameSubNav from "../components/GameSubNav";
import Footer from "../components/Footer";
import { sizedImage, thumbSrcSet, THUMB } from "../lib/images";
import { selectMovers, type MoverWindow } from "../lib/movers";
import { describeIndex, marketIndex } from "../lib/marketIndex";
import { TCG_CONFIGS, type TcgSlug } from "../lib/tcg.config";
import type { Product } from "../lib/products";
import styles from "../styles/Movers.module.css";

/**
 * What moved, and by how much.
 *
 * MTGGoldfish and MTGStocks built audiences on exactly this page and no
 * Canadian tracker has one. The filtering in lib/movers.ts matters more than
 * the layout: an unfiltered mover list is mostly bad data, so cheap products,
 * tiny moves, implausible swings and barely-tracked items are all excluded.
 */

type ApiResponse = { products: Product[]; generated_at: string };
const fetcher = (url: string) => fetch(url).then((r) => r.json()) as Promise<ApiResponse>;

const WINDOWS: Array<{ key: MoverWindow; label: string }> = [
  { key: "price_change_1d", label: "24 hours" },
  { key: "price_change_7d", label: "7 days" },
  { key: "price_change_30d", label: "30 days" },
];

function MoverRow({ product, field, tcg }: { product: Product; field: MoverWindow; tcg: TcgSlug }) {
  const change = product[field] ?? 0;
  const up = change > 0;
  return (
    <li className={styles.row}>
      {product.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sizedImage(product.image_url, THUMB)}
          srcSet={thumbSrcSet(product.image_url)}
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
        <Link href={`/${tcg}/${product.group_key}`} className={styles.name}>
          {product.name}
        </Link>
        <span className={styles.meta}>
          {product.retailer}
          {product.price_per_pack !== null && (
            <> · ${product.price_per_pack.toFixed(2)}/pack</>
          )}
        </span>
      </span>

      <span className={styles.price}>${product.price.toFixed(2)}</span>
      <span className={`${styles.change} ${up ? styles.up : styles.down}`}>
        {up ? "+" : ""}{change.toFixed(1)}%
      </span>
    </li>
  );
}

export default function MoversPage() {
  const router = useRouter();
  const tcg: TcgSlug = (router.query.tcg as TcgSlug) in TCG_CONFIGS
    ? (router.query.tcg as TcgSlug) : "pokemon";
  const config = TCG_CONFIGS[tcg];
  const [field, setField] = useState<MoverWindow>("price_change_7d");

  const { data, error, isLoading } = useSWR<ApiResponse>(`/api/products?tcg=${tcg}`, fetcher, {
    revalidateOnFocus: false,
  });

  const { risers, fallers } = selectMovers(data?.products ?? [], field);
  // One number for "how is the market doing" — median, with its sample size
  // stated, and withheld entirely when the sample is too thin to mean anything.
  const index = marketIndex(data?.products ?? [], field);
  const windowLabel = WINDOWS.find((w) => w.key === field)?.label ?? "7 days";
  const empty = !isLoading && !error && risers.length === 0 && fallers.length === 0;

  return (
    <>
      <Head>
        <title>{`Price Movers — ${config.displayName} | The Mana Cafe`}</title>
        <meta
          name="description"
          content={`Biggest ${config.displayName} sealed price rises and drops over the last ${windowLabel}, across Canadian retailers.`}
        />
      </Head>

      <GameTabBar tcg={tcg} />
      <GameSubNav tcg={tcg} active="movers" />

      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Price Movers</h1>
          <p className={styles.subtitle}>
            Biggest {config.shortName} sealed moves over the last {windowLabel}. Products under $15,
            moves under 5%, and anything we have tracked for less than two weeks are excluded — at
            those sizes a percentage says more about noise than about the market.
          </p>
          <div className={styles.tabs} role="group" aria-label="Time window">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                className={`${styles.tab} ${field === w.key ? styles.tabOn : ""}`}
                aria-pressed={field === w.key}
                onClick={() => setField(w.key)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </header>

        {!isLoading && !error && (
          <p className={index.change === null ? styles.state : styles.index}>
            {index.change !== null && (
              <strong className={index.change > 0 ? styles.up : index.change < 0 ? styles.down : ""}>
                {index.change > 0 ? "▲" : index.change < 0 ? "▼" : "■"}{" "}
                {index.change > 0 ? "+" : ""}{index.change.toFixed(2)}%
              </strong>
            )}{" "}
            {describeIndex(index, config.shortName)}
          </p>
        )}

        {isLoading && <p className={styles.state}>Loading movers…</p>}
        {error && <p className={styles.state} role="alert">Could not load prices. Try again shortly.</p>}
        {empty && (
          <p className={styles.state}>
            Nothing moved enough to report over {windowLabel}. The 30-day view fills in as our price
            history deepens.
          </p>
        )}

        <div className={styles.cols}>
          {fallers.length > 0 && (
            <section className={styles.col}>
              <h2 className={styles.colTitle}>
                <span className={styles.down}>▼</span> Biggest drops
                <span className={styles.count}>{fallers.length}</span>
              </h2>
              <ul className={styles.list}>
                {fallers.map((p) => <MoverRow key={p.group_key} product={p} field={field} tcg={tcg} />)}
              </ul>
            </section>
          )}

          {risers.length > 0 && (
            <section className={styles.col}>
              <h2 className={styles.colTitle}>
                <span className={styles.up}>▲</span> Biggest rises
                <span className={styles.count}>{risers.length}</span>
              </h2>
              <ul className={styles.list}>
                {risers.map((p) => <MoverRow key={p.group_key} product={p} field={field} tcg={tcg} />)}
              </ul>
            </section>
          )}
        </div>
      </main>
      <Footer
        syncedAt={data?.generated_at ?? null}
        retailersCount={new Set((data?.products ?? []).map((p) => p.retailer)).size}
        productsCount={(data?.products ?? []).length}
      />
    </>
  );
}
