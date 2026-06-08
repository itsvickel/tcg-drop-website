import Link from "next/link";
import useSWR from "swr";
import ProductCard, { Product } from "../components/ProductCard";
import Footer from "../components/Footer";
import { useWishlist } from "../hooks/useWishlist";
import styles from "../styles/Wishlist.module.css";

type ApiResponse = {
  products: Product[];
  generated_at: string;
  retailers_count: number;
};

const fetcher = async (url: string): Promise<ApiResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json() as Promise<ApiResponse>;
};

export default function WishlistPage() {
  const wishlist = useWishlist();

  const { data, error, isLoading } = useSWR<ApiResponse>(
    wishlist.hydrated && wishlist.count > 0 ? "/api/products" : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const savedProducts = (data?.products ?? []).filter((p) =>
    wishlist.has(p.group_key)
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href="/" className={styles.backLink}>← Back</Link>
          <h1 className={styles.title}>My List</h1>
        </div>
        {wishlist.count > 0 && (
          <span className={styles.count}>{wishlist.count} saved</span>
        )}
      </header>

      {error && (
        <p className={styles.error}>Could not load products. Try again shortly.</p>
      )}

      {wishlist.hydrated && wishlist.count === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Your list is empty</p>
          <p className={styles.emptyHint}>
            Click the ♡ on any product card on the main page to save it here.
          </p>
          <Link href="/" className={styles.browseLink}>Browse products →</Link>
        </div>
      )}

      {isLoading && wishlist.count > 0 && (
        <section className={styles.grid}>
          {Array.from({ length: Math.min(wishlist.count, 12) }).map((_, i) => (
            <div key={i} className={styles.skeletonCard} aria-hidden="true" />
          ))}
        </section>
      )}

      {savedProducts.length > 0 && (
        <>
          <section className={styles.grid}>
            {savedProducts.map((product) => (
              <ProductCard
                key={product.group_key}
                product={product}
                isWishlisted
                onToggleWishlist={wishlist.toggle}
              />
            ))}
          </section>
          <Footer
            syncedAt={data?.generated_at ?? null}
            retailersCount={data?.retailers_count ?? 0}
            productsCount={savedProducts.length}
          />
        </>
      )}
    </div>
  );
}
