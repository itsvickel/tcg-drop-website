import Head from "next/head";
import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import GameTabBar from "../components/GameTabBar";
import Footer from "../components/Footer";
import { useWishlist } from "../hooks/useWishlist";
import { optimizeCart, MAX_STORES, type WantedItem } from "../lib/cartOptimizer";
import { PROVINCES, taxLabel } from "../lib/tax";
import { sizedImage, thumbSrcSet, THUMB } from "../lib/images";
import type { Product } from "../lib/products";
import styles from "../styles/Cart.module.css";

/**
 * The cheapest way to actually buy your list.
 *
 * Buying every item wherever it is individually cheapest usually means six
 * stores and six shipping fees. This works out which two or three stores
 * minimise the real total — the question every multi-item buyer is asking and
 * that no Canadian tracker answers.
 *
 * The page deliberately shows its working: which store each item comes from,
 * what each order subtotals, and where shipping could not be priced. A plan you
 * cannot check is a plan you cannot trust.
 */

type ApiResponse = { products: Product[] };
const fetcher = (url: string) => fetch(url).then((r) => r.json()) as Promise<ApiResponse>;
const money = (n: number) => `$${n.toFixed(2)}`;

export default function CartPage() {
  const wishlist = useWishlist();
  const [province, setProvince] = useState<string>("");
  const [maxStores, setMaxStores] = useState<number>(MAX_STORES);

  const mtg = useSWR<ApiResponse>("/api/products?tcg=mtg", fetcher, { revalidateOnFocus: false });
  const pkm = useSWR<ApiResponse>("/api/products?tcg=pokemon", fetcher, { revalidateOnFocus: false });
  const loading = (!mtg.data && !mtg.error) || (!pkm.data && !pkm.error);

  const products = useMemo(
    () => [...(mtg.data?.products ?? []), ...(pkm.data?.products ?? [])],
    [mtg.data, pkm.data]
  );

  const byKey = useMemo(() => new Map(products.map((p) => [p.group_key, p])), [products]);

  const wanted: WantedItem[] = useMemo(() => {
    if (!wishlist.hydrated) return [];
    return wishlist.items
      .map((key: string) => {
        const product = byKey.get(key);
        return product ? { group_key: key, name: product.name, quantity: 1 } : null;
      })
      .filter((x: WantedItem | null): x is WantedItem => x !== null);
  }, [wishlist.hydrated, wishlist.items, byKey]);

  const result = useMemo(
    () => optimizeCart(wanted, products, { province: province || null, maxStores }),
    [wanted, products, province, maxStores]
  );

  const plan = result.best;

  return (
    <>
      <Head>
        <title>Cheapest Way to Buy — The Mana Cafe</title>
        <meta
          name="description"
          content="Work out which Canadian stores to order from so your whole list costs the least, shipping and tax included."
        />
        <meta name="robots" content="noindex, follow" />
      </Head>

      <GameTabBar tcg="pokemon" />

      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Cheapest way to buy your list</h1>
          <p className={styles.subtitle}>
            Buying each item wherever it is cheapest usually means several orders and several
            shipping fees. This works out which stores actually minimise the total.
          </p>
        </header>

        <div className={styles.controls}>
          <label className={styles.control}>
            <span className={styles.controlLabel}>Ship to</span>
            <select
              className={styles.select}
              value={province}
              onChange={(e) => setProvince(e.target.value)}
            >
              <option value="">No province (tax excluded)</option>
              {PROVINCES.map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
          </label>

          <label className={styles.control}>
            <span className={styles.controlLabel}>Max orders</span>
            <select
              className={styles.select}
              value={maxStores}
              onChange={(e) => setMaxStores(Number(e.target.value))}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>{n} store{n === 1 ? "" : "s"}</option>
              ))}
            </select>
          </label>
        </div>

        {loading && <p className={styles.state}>Loading prices…</p>}

        {!loading && wanted.length === 0 && (
          <p className={styles.state}>
            Your list is empty. Add products with the ♡ on any card, then come back and we will work
            out the cheapest way to buy them all. <Link href="/mtg/sealed">Browse sealed product</Link>.
          </p>
        )}

        {!loading && wanted.length > 0 && !plan && (
          <p className={styles.state}>
            None of the items on your list are currently stocked by a retailer we can price.
          </p>
        )}

        {plan && (
          <>
            <section className={styles.summary}>
              <div className={styles.summaryMain}>
                <span className={styles.summaryLabel}>Best total</span>
                <strong className={styles.summaryValue}>{money(plan.total)}</strong>
                <span className={styles.summarySub}>
                  {plan.lines.length} item{plan.lines.length === 1 ? "" : "s"} from{" "}
                  {plan.stores.length} store{plan.stores.length === 1 ? "" : "s"}
                  {province ? ` · ${taxLabel(province)}` : " · tax not included"}
                </span>
              </div>

              <div className={styles.summarySide}>
                {result.saving !== null && result.saving > 0 && (
                  <p className={styles.saving}>
                    Saves {money(result.saving)} versus buying each item at its own lowest price.
                  </p>
                )}
                {result.saving === null && result.fewerOrders > 0 && (
                  <p className={styles.saving}>
                    {result.fewerOrders} fewer order{result.fewerOrders === 1 ? "" : "s"} than buying
                    each item at its own lowest price.
                  </p>
                )}
                {plan.unpricedShipping.length > 0 && (
                  <p className={styles.caveat}>
                    Shipping is not published by {plan.unpricedShipping.join(", ")}, so it is not in
                    this total — check at checkout.
                  </p>
                )}
                {!plan.complete && (
                  <p className={styles.caveat}>
                    {plan.missing.length} item{plan.missing.length === 1 ? "" : "s"} on your list are
                    not stocked by any retailer we track right now.
                  </p>
                )}
              </div>
            </section>

            <section className={styles.stores}>
              {plan.stores.map((store) => {
                const lines = plan.lines.filter((l) => l.retailer === store.retailer);
                return (
                  <div key={store.retailer} className={styles.store}>
                    <header className={styles.storeHead}>
                      <h2 className={styles.storeName}>{store.retailer}</h2>
                      <span className={styles.storeTotal}>{money(store.subtotal)}</span>
                    </header>

                    <p className={styles.storeShip}>
                      {store.shipsFree ? (
                        <span className={styles.free}>Ships free</span>
                      ) : store.shippingKnown ? (
                        <>+{money(store.shipping ?? 0)} shipping</>
                      ) : (
                        <span className={styles.unknown}>Shipping not published</span>
                      )}
                      {store.addToFree !== null && store.addToFree > 0 && !store.shipsFree && (
                        <> · {money(store.addToFree)} more for free delivery</>
                      )}
                    </p>

                    <ul className={styles.lines}>
                      {lines.map((line) => {
                        const product = byKey.get(line.item.group_key);
                        return (
                          <li key={line.item.group_key} className={styles.line}>
                            {product?.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={sizedImage(product.image_url, THUMB)}
                                srcSet={thumbSrcSet(product.image_url)}
                                alt=""
                                className={styles.thumb}
                                loading="lazy"
                                width={32}
                                height={32}
                                decoding="async"
                              />
                            ) : (
                              <span className={styles.thumbBlank} aria-hidden="true" />
                            )}
                            <a
                              href={line.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.lineName}
                            >
                              {line.item.name}
                            </a>
                            <span className={styles.linePrice}>{money(line.lineTotal)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </section>

            <p className={styles.method}>
              Compared every combination of up to {maxStores} of the {result.consideredRetailers}{" "}
              retailers that stock something on your list, assigning each item to the cheapest store
              in that combination. Where a retailer publishes no shipping policy we assume a typical
              parcel rate when ranking, but never add it to the total shown.
            </p>
          </>
        )}
      </main>
      <Footer syncedAt={null} retailersCount={0} productsCount={products.length} />
    </>
  );
}
