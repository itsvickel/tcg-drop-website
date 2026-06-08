import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import useSWR from "swr";
import ProductCard, { Product } from "../components/ProductCard";
import ProductDetailModal from "../components/ProductDetailModal";
import Footer from "../components/Footer";
import NewsletterSignup from "../components/NewsletterSignup";
import { useWishlist } from "../hooks/useWishlist";
import styles from "../styles/Home.module.css";
import HotStrip from "../components/HotStrip";

type ApiResponse = {
  products: Product[];
  generated_at: string;
  retailers_count: number;
};

type SortOption = "price_asc" | "price_desc" | "drop" | "atl_pct" | "deal" | "updated" | "name";
const VALID_SORTS: SortOption[] = ["price_asc", "price_desc", "drop", "atl_pct", "deal", "updated", "name"];

const REFRESH_MS = 5 * 60 * 1000;
const PAGE_SIZE  = 48;

const fetcher = async (url: string): Promise<ApiResponse> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch products");
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

function byAllTimeLowPct(a: Product, b: Product): number {
  const aPct = a.all_time_low > 0 ? (a.price - a.all_time_low) / a.all_time_low : 0;
  const bPct = b.all_time_low > 0 ? (b.price - b.all_time_low) / b.all_time_low : 0;
  return aPct - bPct;
}

function byDealScore(a: Product, b: Product): number {
  return b.deal_score - a.deal_score;
}

function isAtAllTimeLow(product: Product): boolean {
  return product.price <= product.all_time_low + 0.0001;
}

export default function HomePage() {
  const router   = useRouter();
  const wishlist = useWishlist();
  const [autoAlertProduct, setAutoAlertProduct] = useState<Product | null>(null);
  const [hotProduct, setHotProduct] = useState<Product | null>(null);
  const pendingAlertKey = useRef<string | null>(null);

  const { data, error, isLoading } = useSWR<ApiResponse>("/api/products", fetcher, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: false,
  });

  // ── Filter state ─────────────────────────────────────────────────────────
  const [query,         setQuery]         = useState("");
  const [sort,          setSort]          = useState<SortOption>("price_asc");
  const [retailer,      setRetailer]      = useState<string>("all");
  const [language,      setLanguage]      = useState<string>("all");
  const [productType,   setProductType]   = useState<string>("all");
  const [setName,       setSetName]       = useState<string>("all");
  const [priceMin,      setPriceMin]      = useState<string>("");
  const [priceMax,      setPriceMax]      = useState<string>("");
  const [inStockOnly,   setInStockOnly]   = useState(false);
  const [hidePreorders, setHidePreorders] = useState(false);
  const [dealsOnly,     setDealsOnly]     = useState(false);
  const [lowOnly,       setLowOnly]       = useState(false);
  const [newOnly,       setNewOnly]       = useState(false);
  const [wishlistOnly,  setWishlistOnly]  = useState(false);
  const [visibleCount,  setVisibleCount]  = useState(PAGE_SIZE);
  const [urlReady,      setUrlReady]      = useState(false);

  // ── Sync from URL on first load ──────────────────────────────────────────
  useEffect(() => {
    if (!router.isReady) return;
    const { q, s, r, lang, type, set, pmin, pmax, stock, p, d, l, n, w, alert: alertParam } = router.query;
    if (typeof q    === "string") setQuery(q);
    if (typeof s    === "string" && VALID_SORTS.includes(s as SortOption)) setSort(s as SortOption);
    if (typeof r    === "string") setRetailer(r);
    if (typeof lang === "string") setLanguage(lang);
    if (typeof type === "string") setProductType(type);
    if (typeof set  === "string") setSetName(set);
    if (typeof pmin === "string") setPriceMin(pmin);
    if (typeof pmax === "string") setPriceMax(pmax);
    if (stock === "1") setInStockOnly(true);
    if (p     === "1") setHidePreorders(true);
    if (d     === "1") setDealsOnly(true);
    if (l     === "1") setLowOnly(true);
    if (n     === "1") setNewOnly(true);
    if (w     === "1") setWishlistOnly(true);
    if (typeof alertParam === "string") pendingAlertKey.current = alertParam;
    setUrlReady(true);
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Write filters back to URL ────────────────────────────────────────────
  useEffect(() => {
    if (!urlReady) return;
    const params: Record<string, string> = {};
    if (query)              params.q     = query;
    if (sort !== "price_asc")   params.s = sort;
    if (retailer !== "all")     params.r = retailer;
    if (language !== "all")     params.lang  = language;
    if (productType !== "all")  params.type  = productType;
    if (setName !== "all")      params.set   = setName;
    if (priceMin)           params.pmin  = priceMin;
    if (priceMax)           params.pmax  = priceMax;
    if (inStockOnly)        params.stock = "1";
    if (hidePreorders)      params.p     = "1";
    if (dealsOnly)          params.d     = "1";
    if (lowOnly)            params.l     = "1";
    if (newOnly)            params.n     = "1";
    if (wishlistOnly)       params.w     = "1";
    void router.replace({ query: params }, undefined, { shallow: true });
  }, [query, sort, retailer, language, productType, setName, priceMin, priceMax, // eslint-disable-line react-hooks/exhaustive-deps
      inStockOnly, hidePreorders, dealsOnly, lowOnly, newOnly, wishlistOnly, urlReady]);

  const products = data?.products ?? [];

  // ── Auto-open detail modal from ?alert=group_key ─────────────────────────
  useEffect(() => {
    if (!pendingAlertKey.current || products.length === 0) return;
    const match = products.find((p) => p.group_key === pendingAlertKey.current);
    if (match) {
      setAutoAlertProduct(match);
      pendingAlertKey.current = null;
    }
  }, [products]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset pagination whenever any filter changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, sort, retailer, language, productType, setName, priceMin, priceMax,
      inStockOnly, hidePreorders, dealsOnly, lowOnly, newOnly, wishlistOnly]);

  // ── Dropdown option lists (derived from loaded products) ─────────────────
  const retailers = useMemo(
    () => Array.from(new Set(products.map((p) => p.retailer))).sort((a, b) => a.localeCompare(b)),
    [products]
  );

  const retailerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) counts[p.retailer] = (counts[p.retailer] ?? 0) + 1;
    return counts;
  }, [products]);

  const languages = useMemo(
    () => Array.from(new Set(products.map((p) => p.language).filter(Boolean))).sort(),
    [products]
  );

  const languageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) if (p.language) counts[p.language] = (counts[p.language] ?? 0) + 1;
    return counts;
  }, [products]);

  const productTypes = useMemo(
    () =>
      Array.from(new Set(products.map((p) => p.product_type).filter((t) => Boolean(t) && t !== "Other"))).sort(),
    [products]
  );

  const productTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) if (p.product_type && p.product_type !== "Other") counts[p.product_type] = (counts[p.product_type] ?? 0) + 1;
    return counts;
  }, [products]);

  const setNames = useMemo(
    () => Array.from(new Set(products.map((p) => p.set_name).filter(Boolean))).sort(),
    [products]
  );

  const setNameCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) if (p.set_name) counts[p.set_name] = (counts[p.set_name] ?? 0) + 1;
    return counts;
  }, [products]);

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const deals      = products.filter((p) => p.price_change_7d !== null && p.price_change_7d <= -5).length;
    const allTimeLow = products.filter((p) => isAtAllTimeLow(p)).length;
    const isNew      = products.filter((p) => p.is_new).length;
    return {
      totalProducts: products.length,
      deals,
      allTimeLow,
      isNew,
      retailers: new Set(products.map((p) => p.retailer)).size,
    };
  }, [products]);

  // ── Filtered + sorted products ───────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    let next = [...products];

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      next = next.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (retailer    !== "all") next = next.filter((p) => p.retailer    === retailer);
    if (language    !== "all") next = next.filter((p) => p.language    === language);
    if (productType !== "all") next = next.filter((p) => p.product_type === productType);
    if (setName     !== "all") next = next.filter((p) => p.set_name    === setName);
    if (inStockOnly)           next = next.filter((p) => p.in_stock);
    if (hidePreorders)         next = next.filter((p) => !p.is_preorder);
    if (dealsOnly)             next = next.filter((p) => p.price_change_7d !== null && p.price_change_7d <= -5);
    if (lowOnly)               next = next.filter((p) => isAtAllTimeLow(p));
    if (newOnly)               next = next.filter((p) => p.is_new);
    if (wishlistOnly)          next = next.filter((p) => wishlist.has(p.group_key));

    const minP = priceMin ? parseFloat(priceMin) : null;
    const maxP = priceMax ? parseFloat(priceMax) : null;
    if (minP !== null && !isNaN(minP)) next = next.filter((p) => p.price >= minP);
    if (maxP !== null && !isNaN(maxP)) next = next.filter((p) => p.price <= maxP);

    switch (sort) {
      case "price_desc": next.sort((a, b) => b.price - a.price); break;
      case "drop":       next.sort(byLargestDrop); break;
      case "atl_pct":    next.sort(byAllTimeLowPct); break;
      case "deal":       next.sort(byDealScore); break;
      case "updated":    next.sort(byUpdatedDesc); break;
      case "name":       next.sort((a, b) => a.name.localeCompare(b.name)); break;
      default:           next.sort((a, b) => a.price - b.price);
    }

    return next;
  }, [products, query, retailer, language, productType, setName, priceMin, priceMax,
      inStockOnly, hidePreorders, dealsOnly, lowOnly, newOnly, wishlistOnly, wishlist, sort]);

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const hasMore         = visibleCount < filteredProducts.length;
  const remaining       = filteredProducts.length - visibleCount;

  const activeFilterCount = [
    query, retailer !== "all", language !== "all", productType !== "all",
    setName !== "all", priceMin, priceMax, inStockOnly, hidePreorders,
    dealsOnly, lowOnly, newOnly, wishlistOnly,
  ].filter(Boolean).length;

  function handleRetailerClick(name: string) {
    setRetailer((prev) => (prev === name ? "all" : name));
  }

  function clearFilters() {
    setQuery("");
    setRetailer("all");
    setLanguage("all");
    setProductType("all");
    setSetName("all");
    setPriceMin("");
    setPriceMax("");
    setInStockOnly(false);
    setHidePreorders(false);
    setDealsOnly(false);
    setLowOnly(false);
    setNewOnly(false);
    setWishlistOnly(false);
  }

  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>Pokemon TCG Price Tracker</h1>
          <p className={styles.heroTagline}>
            Track sealed product prices across {stats.retailers || "50"}+ Canadian retailers.
            Prices updated automatically every 3 hours.
          </p>
          <div className={styles.heroStats}>
            <div className={styles.heroStat}>
              <strong>{stats.totalProducts.toLocaleString()}</strong>
              <span>Products tracked</span>
            </div>
            <div className={`${styles.heroStat} ${styles.heroStatGreen}`}>
              <strong>{stats.deals}</strong>
              <span>Deals this week</span>
            </div>
            <div className={`${styles.heroStat} ${styles.heroStatGreen}`}>
              <strong>{stats.allTimeLow}</strong>
              <span>At all-time low</span>
            </div>
            <div className={styles.heroStat}>
              <strong>{stats.retailers || data?.retailers_count}</strong>
              <span>Retailers</span>
            </div>
          </div>
          <NewsletterSignup />
        </div>
      </section>

      <div className={styles.page}>
        {/* ── Sticky compact header ───────────────────────────────────────── */}
        <header className={styles.header}>
          <div>
            <h2 className={styles.title}>Pokemon TCG Tracker</h2>
            <p className={styles.subtitle}>Live Canadian pricing</p>
          </div>
          <div className={styles.headerRight}>
            {wishlist.count > 0 && (
              <Link href="/wishlist" className={styles.wishlistNav}>
                ♥ My List{` (${wishlist.count})`}
              </Link>
            )}
            <Link href="/calendar" className={styles.calendarNav}>📅 Calendar</Link>
            <Link href="/alerts" className={styles.calendarNav}>🔔 My Alerts</Link>
            <div className={styles.liveIndicator}>
              <span className={styles.pulseDot} />
              <span>Live</span>
            </div>
          </div>
        </header>

        {/* ── Stats bar ───────────────────────────────────────────────────── */}
        <section className={styles.statsBar}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Products</span>
            <strong>{stats.totalProducts.toLocaleString()}</strong>
          </div>
          <div className={`${styles.statCard} ${styles.statCardGreen}`}>
            <span className={styles.statLabel}>Deals (7d drop)</span>
            <strong>{stats.deals}</strong>
          </div>
          <div className={`${styles.statCard} ${styles.statCardGreen}`}>
            <span className={styles.statLabel}>All-Time Low</span>
            <strong>{stats.allTimeLow}</strong>
          </div>
          <div className={`${styles.statCard} ${styles.statCardBlue}`}>
            <span className={styles.statLabel}>New This Week</span>
            <strong>{stats.isNew}</strong>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Retailers</span>
            <strong>{data?.retailers_count ?? stats.retailers}</strong>
          </div>
        </section>

        {/* ── Hot strip ──────────────────────────────────────────────────── */}
        {products.length > 0 && (
          <HotStrip products={products} onSelect={setHotProduct} />
        )}

        {/* ── Controls ────────────────────────────────────────────────────── */}
        <section className={styles.controls}>

          {/* Row 1: search · sort · retailer */}
          <div className={styles.controlsRow1}>
            <input
              className={`${styles.controlInput} ${styles.controlSearch}`}
              type="text"
              placeholder="Search products…"
              aria-label="Search products"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className={styles.controlInput}
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              aria-label="Sort order"
            >
              <option value="price_asc">Price ↑ Low to High</option>
              <option value="price_desc">Price ↓ High to Low</option>
              <option value="drop">Biggest 7-Day Drop</option>
              <option value="deal">Best Deal Score</option>
              <option value="atl_pct">Closest to All-Time Low</option>
              <option value="updated">Recently Updated</option>
              <option value="name">Name A–Z</option>
            </select>
            <select
              className={`${styles.controlInput} ${styles.controlRetailer}`}
              value={retailer}
              onChange={(e) => setRetailer(e.target.value)}
              aria-label="Filter by retailer"
            >
              <option value="all">All retailers</option>
              {retailers.map((r) => (
                <option key={r} value={r}>
                  {r}{retailerCounts[r] ? ` (${retailerCounts[r]})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Row 2: language · product type · set · price range */}
          <div className={styles.controlsRow2}>
            <select
              className={styles.controlInput}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label="Filter by language"
            >
              <option value="all">All languages</option>
              {languages.map((l) => (
                <option key={l} value={l}>{l}{languageCounts[l] ? ` (${languageCounts[l]})` : ""}</option>
              ))}
            </select>
            <select
              className={styles.controlInput}
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
              aria-label="Filter by product type"
            >
              <option value="all">All product types</option>
              {productTypes.map((t) => (
                <option key={t} value={t}>{t}{productTypeCounts[t] ? ` (${productTypeCounts[t]})` : ""}</option>
              ))}
            </select>
            <select
              className={`${styles.controlInput} ${styles.controlSet}`}
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
              aria-label="Filter by set"
            >
              <option value="all">All sets / expansions</option>
              {setNames.map((s) => (
                <option key={s} value={s}>{s}{setNameCounts[s] ? ` (${setNameCounts[s]})` : ""}</option>
              ))}
            </select>
            <div className={styles.priceRange}>
              <span className={styles.priceRangeLabel}>$</span>
              <input
                className={styles.priceInput}
                type="number"
                min="0"
                placeholder="Min"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
                aria-label="Minimum price"
              />
              <span className={styles.priceRangeSep}>–</span>
              <input
                className={styles.priceInput}
                type="number"
                min="0"
                placeholder="Max"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
                aria-label="Maximum price"
              />
            </div>
          </div>

          {/* Row 3: toggles + clear */}
          <div className={styles.controlsRow3}>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
              />
              In stock
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={hidePreorders}
                onChange={(e) => setHidePreorders(e.target.checked)}
              />
              Hide pre-orders
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={dealsOnly}
                onChange={(e) => setDealsOnly(e.target.checked)}
              />
              Deals only
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={lowOnly}
                onChange={(e) => setLowOnly(e.target.checked)}
              />
              All-time low only
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={newOnly}
                onChange={(e) => setNewOnly(e.target.checked)}
              />
              New arrivals
            </label>
            <label className={`${styles.toggle} ${styles.toggleWishlist}`}>
              <input
                type="checkbox"
                checked={wishlistOnly}
                onChange={(e) => setWishlistOnly(e.target.checked)}
              />
              ♥ My List{wishlist.count > 0 ? ` (${wishlist.count})` : ""}
            </label>
            {activeFilterCount > 0 && (
              <button
                className={styles.clearFiltersBtn}
                onClick={clearFilters}
                type="button"
              >
                ✕ Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
              </button>
            )}
          </div>
        </section>

        {/* ── Results header ───────────────────────────────────────────────── */}
        <section className={styles.resultsHeader}>
          <h2>
            {`Showing ${visibleProducts.length} of ${filteredProducts.length} product${filteredProducts.length !== 1 ? "s" : ""}`}
          </h2>
          {data?.generated_at && (() => {
            const syncedAt = new Date(data.generated_at);
            const ageH     = (Date.now() - syncedAt.getTime()) / (1000 * 60 * 60);
            const isStale  = ageH > 2;
            const label    = `Synced ${syncedAt.toLocaleString("en-CA", {
              timeZone: "America/Toronto",
              hour: "numeric",
              minute: "2-digit",
            })}`;
            return (
              <span
                className={isStale ? styles.staleLabel : undefined}
                title={isStale ? `Data is ${Math.floor(ageH)}h old — prices may have changed` : undefined}
              >
                {isStale ? `⚠ ${label}` : label}
              </span>
            );
          })()}
        </section>

        {error && (
          <p className={styles.errorText}>Could not load products right now. Will retry shortly.</p>
        )}

        {/* ── Grid ────────────────────────────────────────────────────────── */}
        {isLoading ? (
          <section className={styles.grid}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className={styles.skeletonCard} aria-hidden="true" />
            ))}
          </section>
        ) : filteredProducts.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>
              {wishlistOnly && wishlist.count === 0
                ? "Your list is empty"
                : "No products match your filters"}
            </p>
            <p className={styles.emptyHint}>
              {wishlistOnly && wishlist.count === 0
                ? "Click the ♡ on any product card to save it here."
                : "Try adjusting the search or clearing some filters."}
            </p>
            <button className={styles.clearButton} onClick={clearFilters}>
              Clear all filters
            </button>
          </div>
        ) : (
          <>
            <section className={styles.grid}>
              {visibleProducts.map((product) => (
                <ProductCard
                  key={product.group_key}
                  product={product}
                  onRetailerClick={handleRetailerClick}
                  activeRetailer={retailer}
                  isWishlisted={wishlist.hydrated ? wishlist.has(product.group_key) : false}
                  onToggleWishlist={wishlist.toggle}
                />
              ))}
            </section>

            {hasMore && (
              <div className={styles.loadMoreWrap}>
                <button
                  className={styles.loadMoreButton}
                  onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                >
                  {`Show ${Math.min(remaining, PAGE_SIZE)} more  (${remaining} remaining)`}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        {autoAlertProduct && (
          <ProductDetailModal
            product={autoAlertProduct}
            autoOpenAlert={true}
            onClose={() => setAutoAlertProduct(null)}
          />
        )}
        {hotProduct && (
          <ProductDetailModal
            product={hotProduct}
            onClose={() => setHotProduct(null)}
          />
        )}
        <Footer
          syncedAt={data?.generated_at ?? null}
          retailersCount={data?.retailers_count ?? stats.retailers}
          productsCount={stats.totalProducts}
        />
      </div>
    </>
  );
}
