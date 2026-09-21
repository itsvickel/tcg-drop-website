import Head from "next/head";
import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import SetProgressPanel from "../components/SetProgress";
import CollectionValueChart from "../components/CollectionValueChart";
import { setProgress } from "../lib/setCompletion";
import GameTabBar from "../components/GameTabBar";
import Footer from "../components/Footer";
import { useAuth } from "../hooks/useAuth";
import { useCollection } from "../hooks/useCollection";
import { coverageNote, portfolioTotals, valueCollection } from "../lib/collection";
import { sizedImage, thumbSrcSet, THUMB } from "../lib/images";
import { downloadCsv, toCsv } from "../lib/csv";
import type { ApiResponse, Product } from "../lib/products";
import styles from "../styles/Collection.module.css";

/**
 * What you own, and what it is worth.
 *
 * The wishlist answers "what do I want"; this answers "what do I have, and how
 * has it done". Valuation coverage is stated rather than assumed — a holding we
 * cannot price shows as unvalued, never as zero, because a product dropping out
 * of the feed should not look like a crash.
 */

const fetcher = (url: string) => fetch(url).then((r) => r.json()) as Promise<ApiResponse>;

const money = (n: number) => `$${n.toFixed(2)}`;

export default function CollectionPage() {
  const auth = useAuth();
  const collection = useCollection();
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const mtg = useSWR<ApiResponse>("/api/products?tcg=mtg", fetcher, { revalidateOnFocus: false });
  const pkm = useSWR<ApiResponse>("/api/products?tcg=pokemon", fetcher, { revalidateOnFocus: false });

  const products = useMemo(
    () => [...(mtg.data?.products ?? []), ...(pkm.data?.products ?? [])],
    [mtg.data, pkm.data]
  );

  const valued = useMemo(
    () => valueCollection(collection.holdings, products),
    [collection.holdings, products]
  );
  const totals = useMemo(() => portfolioTotals(valued), [valued]);

  // Set sizes come from the singles enrichment, which only runs for Magic.
  // Pokemon holdings simply produce no rows rather than wrong ones.
  const progress = useMemo(
    () => setProgress(valued, mtg.data?.sets, products),
    [valued, mtg.data?.sets, products]
  );
  const note = coverageNote(totals);

  // Fixed for the life of the mount so the chart's last point cannot shift
  // under a re-render, and so a tab left open overnight does not silently
  // extend its own window.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const err = await auth.signIn(email.trim());
    setNotice(err ?? "Check your email for a sign-in link.");
  }

  const gainClass = totals.gain > 0 ? styles.up : totals.gain < 0 ? styles.down : "";

  // A collection someone spent months entering should not be trapped here.
  function exportCsv() {
    const csv = toCsv(
      ["Product", "Game", "Quantity", "Unit cost (CAD)", "Purchased", "Market price (CAD)", "Market value (CAD)", "Gain (CAD)"],
      valued.map((v) => [
        v.product_name || v.group_key,
        v.tcg,
        v.quantity,
        v.unit_cost ?? "",
        v.purchased_at ?? "",
        v.marketPrice ?? "",
        v.marketValue ?? "",
        v.gain ?? "",
      ])
    );
    downloadCsv(`tcg-drop-collection-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <>
      <Head>
        <title>My Collection — The Mana Cafe</title>
        <meta name="description" content="Track what you own and what it is worth, in Canadian dollars." />
        {/* Private to the signed-in user, so there is nothing here to index. */}
        <meta name="robots" content="noindex, follow" />
      </Head>

      <GameTabBar tcg="pokemon" />

      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>My Collection</h1>
          <p className={styles.subtitle}>
            What you own, priced against the same Canadian retailers the rest of the site tracks.
          </p>
        </header>

        {!collection.enabled && (
          <p className={styles.state}>Accounts are not configured on this deployment yet.</p>
        )}

        {collection.enabled && !collection.signedIn && (
          <section className={styles.signIn}>
            <h2 className={styles.signInTitle}>Sign in to track your collection</h2>
            <p className={styles.signInText}>
              We will email you a link — no password. Your collection is private to your account.
            </p>
            <form className={styles.signInForm} onSubmit={(e) => { void handleSignIn(e); }}>
              <input
                className={styles.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-label="Email address"
              />
              <button className={styles.primaryBtn} type="submit" disabled={!email.trim()}>
                Email me a link
              </button>
            </form>
            {notice && <p className={styles.notice}>{notice}</p>}
          </section>
        )}

        {collection.signedIn && (
          <>
            <section className={styles.totals} aria-label="Portfolio summary">
              <div className={styles.totalCard}>
                <span className={styles.totalLabel}>Market value</span>
                <strong className={styles.totalValue}>{money(totals.marketValue)}</strong>
                <span className={styles.totalSub}>
                  {totals.units} item{totals.units === 1 ? "" : "s"}
                </span>
              </div>
              <div className={styles.totalCard}>
                <span className={styles.totalLabel}>Cost basis</span>
                <strong className={styles.totalValue}>{money(totals.costTotal)}</strong>
                <span className={styles.totalSub}>
                  {totals.withCost} of {totals.holdings} recorded
                </span>
              </div>
              <div className={`${styles.totalCard} ${gainClass}`}>
                <span className={styles.totalLabel}>Profit / loss</span>
                <strong className={styles.totalValue}>
                  {totals.gain >= 0 ? "+" : ""}{money(totals.gain)}
                </strong>
                <span className={styles.totalSub}>
                  {totals.gainPct === null
                    ? "no cost basis recorded"
                    : `${totals.gainPct >= 0 ? "+" : ""}${totals.gainPct.toFixed(1)}%`}
                </span>
              </div>
            </section>

            {valued.length > 0 && (
              <CollectionValueChart holdings={valued} today={today} />
            )}

            {collection.holdings.length > 0 && (
              <div className={styles.actions}>
                <button type="button" className={styles.exportBtn} onClick={exportCsv}>
                  Export CSV
                </button>
              </div>
            )}

            <SetProgressPanel rows={progress} />

            {note && <p className={styles.coverage}>{note}</p>}
            {collection.error && <p className={styles.error} role="alert">{collection.error}</p>}

            {collection.holdings.length === 0 ? (
              <p className={styles.state}>
                Nothing here yet. Add products from any listing page — look for{" "}
                <strong>Add to collection</strong> on a product.
              </p>
            ) : (
              <ul className={styles.list}>
                {valued.map((v) => (
                  <li key={v.group_key} className={styles.row}>
                    {v.product?.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sizedImage(v.product.image_url, THUMB)}
                        srcSet={thumbSrcSet(v.product.image_url)}
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
                      {v.product ? (
                        <Link href={`/${v.tcg}/${v.group_key}`} className={styles.name}>
                          {v.product_name || v.product.name}
                        </Link>
                      ) : (
                        <span className={styles.name}>{v.product_name || v.group_key}</span>
                      )}
                      <span className={styles.meta}>
                        {v.quantity}&times; ·{" "}
                        {v.unit_cost === null ? "no cost recorded" : `paid ${money(v.unit_cost)} each`}
                        {v.purchased_at ? ` · ${v.purchased_at}` : ""}
                      </span>
                    </span>

                    <span className={styles.value}>
                      {v.marketValue === null ? (
                        <span className={styles.unvalued} title="No longer tracked, so not valued">
                          unvalued
                        </span>
                      ) : (
                        money(v.marketValue)
                      )}
                    </span>

                    <span
                      className={`${styles.gain} ${
                        (v.gain ?? 0) > 0 ? styles.up : (v.gain ?? 0) < 0 ? styles.down : ""
                      }`}
                    >
                      {v.gain === null ? "—" : `${v.gain >= 0 ? "+" : ""}${money(v.gain)}`}
                    </span>

                    <button
                      type="button"
                      className={styles.removeBtn}
                      aria-label={`Remove ${v.product_name || v.group_key}`}
                      onClick={() => { void collection.remove(v.group_key); }}
                    >
                      &times;
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
      <Footer syncedAt={null} retailersCount={0} productsCount={products.length} />
    </>
  );
}
