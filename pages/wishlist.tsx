import { useState } from "react";
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

type SyncState = "idle" | "loading" | "success" | "error" | "unavailable";

const fetcher = async (url: string): Promise<ApiResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json() as Promise<ApiResponse>;
};

function WishlistSyncPanel({ wishlist }: { wishlist: ReturnType<typeof useWishlist> }) {
  const [email, setEmail]         = useState("");
  const [open, setOpen]           = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [message, setMessage]     = useState("");

  async function handleSave() {
    if (!email.trim()) return;
    setSyncState("loading");
    // Push all saved group_keys for each TCG — simplified: send all keys to both tcgs
    const allKeys = wishlist.items; // assuming items is string[] of group_keys
    try {
      const res = await fetch("/api/wishlist-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          tcg: "pokemon", // primary — wishlist is cross-tcg but we simplify here
          items: allKeys.map((k: string) => ({ group_key: k, product_name: k })),
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        if (res.status === 503) { setSyncState("unavailable"); setMessage(data.error ?? ""); return; }
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      setSyncState("success");
      setMessage(`Wishlist saved! Use "${email.trim()}" on any device to restore it.`);
    } catch (err) {
      setSyncState("error");
      setMessage(err instanceof Error ? err.message : "Sync failed");
    }
  }

  async function handleLoad() {
    if (!email.trim()) return;
    setSyncState("loading");
    try {
      const res = await fetch(`/api/wishlist-sync?email=${encodeURIComponent(email.trim())}&tcg=pokemon`);
      const data = await res.json() as { items?: { group_key: string }[]; error?: string };
      if (!res.ok) {
        if (res.status === 503) { setSyncState("unavailable"); setMessage(data.error ?? ""); return; }
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      const keys = (data.items ?? []).map((i: { group_key: string }) => i.group_key);
      keys.forEach((k: string) => wishlist.add(k));
      setSyncState("success");
      setMessage(`Loaded ${keys.length} item${keys.length !== 1 ? "s" : ""} from cloud.`);
    } catch (err) {
      setSyncState("error");
      setMessage(err instanceof Error ? err.message : "Sync failed");
    }
  }

  if (!open) {
    return (
      <button className={styles.syncToggle} onClick={() => setOpen(true)} type="button">
        ☁ Sync across devices
      </button>
    );
  }

  return (
    <div className={styles.syncPanel}>
      <div className={styles.syncHeader}>
        <span className={styles.syncTitle}>☁ Cloud Sync</span>
        <button className={styles.syncClose} onClick={() => setOpen(false)} type="button">✕</button>
      </div>
      <p className={styles.syncHint}>
        Enter your email to save or restore your wishlist on any device. No account required.
      </p>
      <div className={styles.syncRow}>
        <input
          type="email"
          className={styles.syncEmail}
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={syncState === "loading"}
        />
        <button
          className={styles.syncBtn}
          onClick={() => { void handleSave(); }}
          disabled={!email || syncState === "loading"}
          type="button"
        >
          {syncState === "loading" ? "…" : "Save"}
        </button>
        <button
          className={`${styles.syncBtn} ${styles.syncBtnSecondary}`}
          onClick={() => { void handleLoad(); }}
          disabled={!email || syncState === "loading"}
          type="button"
        >
          Load
        </button>
      </div>
      {message && (
        <p className={`${styles.syncMsg} ${syncState === "error" || syncState === "unavailable" ? styles.syncMsgError : styles.syncMsgOk}`}>
          {message}
        </p>
      )}
    </div>
  );
}

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

      {wishlist.hydrated && <WishlistSyncPanel wishlist={wishlist} />}

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
