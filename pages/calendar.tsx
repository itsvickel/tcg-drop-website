import { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import useSWR from "swr";
import type { CalendarResponse, CalendarSet, CalendarProduct } from "./api/calendar";
import { TBA_DATE } from "../lib/calendar";
import { TCG_CONFIGS, type TcgSlug } from "../lib/tcg.config";
import styles from "../styles/Calendar.module.css";

const fetcher = (url: string) => fetch(url).then((r) => r.json()) as Promise<CalendarResponse>;

function formatDate(iso: string): string {
  if (iso === TBA_DATE || iso.startsWith("9999")) return "Date TBA";
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function daysUntil(iso: string): number {
  const now = new Date();
  const release = new Date(iso + "T12:00:00Z");
  return Math.ceil((release.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const SOURCE_LABELS: Record<string, string> = {
  "pokemontcg.io": "pokemontcg.io",
  bulbapedia: "Bulbapedia",
  scryfall: "Scryfall",
};

// Date-provenance sources only — retailer corroboration is cited per product.
function dateSources(sources?: string[]): string[] {
  return (sources ?? []).filter((s) => s !== "retailer").map((s) => SOURCE_LABELS[s] ?? s);
}

function ProductRow({ product, setDate, tcg, cta }: { product: CalendarProduct; setDate: string; tcg: TcgSlug; cta: string }) {
  const ownDate =
    product.release_date && product.release_date !== setDate && product.release_date !== TBA_DATE
      ? product.release_date
      : null;
  const hasPrice = typeof product.price === "number";

  return (
    <li className={styles.productRow}>
      <div className={styles.productThumb}>
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.name}
            className={styles.thumbImg}
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.target as HTMLImageElement).nextElementSibling?.removeAttribute("hidden");
            }}
          />
        ) : null}
        <div className={styles.thumbPlaceholder} hidden={!!product.image_url} aria-hidden="true">
          {tcg === "mtg" ? "⚡" : "🔴"}
        </div>
      </div>

      <div className={styles.productBody}>
        {product.group_key ? (
          <Link href={`/${tcg}/${product.group_key}`} className={styles.productName}>{product.name}</Link>
        ) : (
          <span className={styles.productName}>{product.name}</span>
        )}
        <div className={styles.productSub}>
          {hasPrice ? (
            <>
              <span className={styles.productPrice}>${product.price!.toFixed(2)}</span>
              {product.retailer && <span className={styles.productRetailer}>· {product.retailer}</span>}
            </>
          ) : (
            <span className={styles.productTypeMuted}>{product.product_type}</span>
          )}
          {ownDate && <span className={styles.productDate}>· {formatDate(ownDate)}</span>}
        </div>
      </div>

      <div className={styles.productCta}>
        {typeof product.in_stock === "boolean" && (
          <span
            className={`${styles.stockDot} ${product.in_stock ? styles.stockIn : styles.stockOut}`}
            title={product.in_stock ? "In stock" : "Out of stock"}
          />
        )}
        {product.url && (
          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.buyLink} ${cta === "Pre-order" ? styles.buyPreorder : ""}`}
          >
            {cta} →
          </a>
        )}
      </div>
    </li>
  );
}

function ConfidenceTag({ confidence }: { confidence: CalendarSet["date_confidence"] }) {
  if (confidence === "confirmed") {
    return <span className={`${styles.confTag} ${styles.confConfirmed}`} title="Date corroborated by multiple sources">✓ Confirmed</span>;
  }
  if (confidence === "tentative") {
    return <span className={`${styles.confTag} ${styles.confTentative}`} title="From a single source or sources disagree — may change">● Tentative</span>;
  }
  return null; // tba is shown via the date itself + header badge
}

function SetCard({ set, isCurrent = false, tcg }: { set: CalendarSet; isCurrent?: boolean; tcg: TcgSlug }) {
  const isTba = set.date_confidence === "tba";
  const days = daysUntil(set.release_date);
  const released = !isTba && days <= 0;
  const soon = !isTba && days > 0 && days <= 14;
  const cta = released ? "Buy" : "Pre-order";
  const sources = dateSources(set.sources);

  return (
    <div className={`${styles.card} ${soon ? styles.soon : ""} ${isCurrent ? styles.currentCard : ""}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardMeta}>
          <span className={styles.series}>{set.series}</span>
          <span className={`${styles.typeBadge} ${set.type === "Special Set" ? styles.typeSpecial : styles.typeMain}`}>
            {set.type}
          </span>
        </div>

        {isCurrent && <span className={styles.currentBadge}>Current</span>}
        {!isCurrent && isTba && <span className={styles.tbaBadge}>Date TBA</span>}
        {!isCurrent && !isTba && !released && (
          <span className={`${styles.countdownBadge} ${soon ? styles.countdownSoon : ""}`}>
            {days === 1 ? "Tomorrow" : `${days} days`}
          </span>
        )}
        {!isCurrent && !isTba && released && <span className={styles.releasedBadge}>Released</span>}
      </div>

      <h2 className={styles.setName}>{set.name}</h2>
      <p className={styles.releaseDate}>
        {formatDate(set.release_date)}
        <ConfidenceTag confidence={set.date_confidence} />
      </p>

      {(sources.length > 0 || set.url) && (
        <p className={styles.sourceLine}>
          <span className={styles.sourceLabel}>Source:</span>{" "}
          {sources.length > 0 ? sources.join(", ") : "official"}
          {set.url && (
            <a
              href={set.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.sourceLink}
              title="View source page"
            >
              ↗
            </a>
          )}
        </p>
      )}

      {set.notes && <p className={styles.notes}>{set.notes}</p>}

      {set.products.length > 0 && (
        <ul className={styles.products}>
          {set.products.map((p) => (
            <ProductRow key={p.name} product={p} setDate={set.release_date} tcg={tcg} cta={cta} />
          ))}
        </ul>
      )}

      <div className={styles.cardLinks}>
        <a href={`/${tcg}?set=${encodeURIComponent(set.name)}`} className={styles.priceLink}>
          View all prices →
        </a>
      </div>
    </div>
  );
}

const PAST_LIMIT = 12;

export default function CalendarPage() {
  const router = useRouter();
  const [showAllPast, setShowAllPast] = useState(false);

  const tcg: TcgSlug = (router.query.tcg as TcgSlug) in TCG_CONFIGS
    ? (router.query.tcg as TcgSlug)
    : "pokemon";
  const config = TCG_CONFIGS[tcg];

  const { data, error, isLoading } = useSWR<CalendarResponse>(`/api/calendar?tcg=${tcg}`, fetcher, {
    revalidateOnFocus: false,
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const twelveMonthsAgoStr = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().slice(0, 10);
  })();

  const upcoming = data?.sets
    .filter((s) => s.release_date > todayStr)
    .sort((a, b) => a.release_date.localeCompare(b.release_date)) ?? [];

  const recent = data?.sets
    .filter((s) => s.release_date <= todayStr && s.release_date >= twelveMonthsAgoStr)
    .sort((a, b) => b.release_date.localeCompare(a.release_date)) ?? [];

  const past = data?.sets
    .filter((s) => s.release_date < twelveMonthsAgoStr)
    .sort((a, b) => b.release_date.localeCompare(a.release_date)) ?? [];

  const mostRecentName = [...recent, ...past][0]?.name;
  const visiblePast = showAllPast ? past : past.slice(0, PAST_LIMIT);

  return (
    <>
      <Head>
        <title>Release Calendar — {config.displayName} Price Tracker</title>
        <meta name="description" content={`Upcoming and recent ${config.displayName} set release dates`} />
      </Head>

      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <Link href={`/${tcg}`} className={styles.backLink}>← Back to tracker</Link>
            <h1 className={styles.title}>Release Calendar</h1>
            <p className={styles.subtitle}>{config.displayName} drops — dates, products &amp; live prices</p>
          </div>
        </header>

        {isLoading && (
          <div className={styles.loading}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.skeletonCard} />
            ))}
          </div>
        )}

        {error && (
          <p className={styles.error}>Could not load calendar. Please try again shortly.</p>
        )}

        {data && (
          <>
            {upcoming.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Upcoming &amp; Pre-Orders</h2>
                <div className={styles.grid}>
                  {upcoming.map((s) => <SetCard key={s.name} set={s} tcg={tcg} />)}
                </div>
              </section>
            )}

            {recent.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Recently Released</h2>
                <div className={styles.grid}>
                  {recent.map((s) => (
                    <SetCard key={s.name} set={s} isCurrent={s.name === mostRecentName} tcg={tcg} />
                  ))}
                </div>
              </section>
            )}

            {past.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Past Releases</h2>
                <div className={styles.grid}>
                  {visiblePast.map((s) => (
                    <SetCard key={s.name} set={s} isCurrent={s.name === mostRecentName} tcg={tcg} />
                  ))}
                </div>
                {past.length > PAST_LIMIT && !showAllPast && (
                  <button className={styles.showMoreBtn} onClick={() => setShowAllPast(true)}>
                    Show all {past.length} sets ↓
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
