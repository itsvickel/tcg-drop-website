import { useMemo, useState } from "react";
import useSWR from "swr";
import ProductCard, { Product } from "../components/ProductCard";
import styles from "../styles/Home.module.css";

type ApiResponse = {
  products: Product[];
  generated_at: string;
  retailers_count: number;
};

type SortOption = "price_asc" | "price_desc" | "drop" | "updated" | "name";

const REFRESH_MS = 5 * 60 * 1000;

const fetcher = async (url: string): Promise<ApiResponse> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch products");
  }
  return response.json() as Promise<ApiResponse>;
};

function byUpdatedDesc(a: Product, b: Product): number {
  return new Date(b.updated).getTime() - new Date(a.updated).getTime();
}

function byLargestDrop(a: Product, b: Product): number {
  const aDrop = a.price_change_7d ?? Number.POSITIVE_INFINITY;
  const bDrop = b.price_change_7d ?? Number.POSITIVE_INFINITY;
  return aDrop - bDrop;
}

function isAllTimeLow(product: Product): boolean {
  return product.price <= product.all_time_low + 0.0001;
}

export default function HomePage() {
  const { data, error, isLoading } = useSWR<ApiResponse>("/api/products", fetcher, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: false
  });

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("price_asc");
  const [retailer, setRetailer] = useState<string>("all");
  const [hidePreorders, setHidePreorders] = useState(false);
  const [dealsOnly, setDealsOnly] = useState(false);
  const [lowOnly, setLowOnly] = useState(false);

  const products = data?.products ?? [];

  const retailers = useMemo(() => {
    return Array.from(new Set(products.map((product) => product.retailer))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [products]);

  const stats = useMemo(() => {
    const deals = products.filter((product) => product.price_change_7d !== null && product.price_change_7d <= -5).length;
    const allTimeLow = products.filter((product) => isAllTimeLow(product)).length;

    return {
      totalProducts: products.length,
      deals,
      allTimeLow,
      retailers: new Set(products.map((product) => product.retailer)).size
    };
  }, [products]);

  const filteredProducts = useMemo(() => {
    let next = [...products];

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      next = next.filter((product) => product.name.toLowerCase().includes(q));
    }

    if (retailer !== "all") {
      next = next.filter((product) => product.retailer === retailer);
    }

    if (hidePreorders) {
      next = next.filter((product) => !product.is_preorder);
    }

    if (dealsOnly) {
      next = next.filter((product) => product.price_change_7d !== null && product.price_change_7d <= -5);
    }

    if (lowOnly) {
      next = next.filter((product) => isAllTimeLow(product));
    }

    switch (sort) {
      case "price_desc":
        next.sort((a, b) => b.price - a.price);
        break;
      case "drop":
        next.sort(byLargestDrop);
        break;
      case "updated":
        next.sort(byUpdatedDesc);
        break;
      case "name":
        next.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "price_asc":
      default:
        next.sort((a, b) => a.price - b.price);
        break;
    }

    return next;
  }, [products, query, retailer, hidePreorders, dealsOnly, lowOnly, sort]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Pokemon TCG Price Tracker</h1>
          <p className={styles.subtitle}>Live pricing across Canadian retailers</p>
        </div>
        <div className={styles.liveIndicator}>
          <span className={styles.pulseDot} />
          <span>Live</span>
        </div>
      </header>

      <section className={styles.statsBar}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Products</span>
          <strong>{stats.totalProducts}</strong>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Deals (7d drop &gt; 5%)</span>
          <strong>{stats.deals}</strong>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>At All-Time Low</span>
          <strong>{stats.allTimeLow}</strong>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Retailers</span>
          <strong>{data?.retailers_count ?? stats.retailers}</strong>
        </div>
      </section>

      <section className={styles.controls}>
        <input
          className={styles.controlInput}
          type="text"
          placeholder="Search products"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <select
          className={styles.controlInput}
          value={sort}
          onChange={(event) => setSort(event.target.value as SortOption)}
        >
          <option value="price_asc">Sort: Price ↑ Low to High</option>
          <option value="price_desc">Sort: Price ↓ High to Low</option>
          <option value="drop">Sort: Biggest Drop</option>
          <option value="updated">Sort: Recently Updated</option>
          <option value="name">Sort: Name A-Z</option>
        </select>

        <select
          className={styles.controlInput}
          value={retailer}
          onChange={(event) => setRetailer(event.target.value)}
        >
          <option value="all">All retailers</option>
          {retailers.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={hidePreorders}
            onChange={(event) => setHidePreorders(event.target.checked)}
          />
          Hide pre-orders
        </label>

        <label className={styles.toggle}>
          <input type="checkbox" checked={dealsOnly} onChange={(event) => setDealsOnly(event.target.checked)} />
          Deals only
        </label>

        <label className={styles.toggle}>
          <input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />
          All-time low only
        </label>
      </section>

      <section className={styles.resultsHeader}>
        <h2>{`Showing ${filteredProducts.length} products`}</h2>
        {data?.generated_at && (() => {
          const syncedAt = new Date(data.generated_at);
          const ageMs = Date.now() - syncedAt.getTime();
          const ageH = ageMs / (1000 * 60 * 60);
          const isStale = ageH > 2;
          const label = `Synced ${syncedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
          return (
            <span className={isStale ? styles.staleLabel : undefined} title={isStale ? `Data is ${Math.floor(ageH)}h old — prices may have changed` : undefined}>
              {isStale ? `⚠ ${label}` : label}
            </span>
          );
        })()}
      </section>

      {error && <p className={styles.errorText}>Could not load products right now.</p>}

      {isLoading ? (
        <section className={styles.grid}>
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className={styles.skeletonCard} aria-hidden="true" />
          ))}
        </section>
      ) : (
        <section className={styles.grid}>
          {filteredProducts.map((product) => (
            <ProductCard key={product.group_key} product={product} />
          ))}
        </section>
      )}
    </div>
  );
}
