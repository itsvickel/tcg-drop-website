import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import useSWR from "swr";
import ConfidenceBadge from "../components/ConfidenceBadge";
import SelloutBadge from "../components/SelloutBadge";
import {
  EVENT_LABELS,
  bestListing,
  confidenceBand,
  countdownTo,
  formatCountdown,
  formatGoLive,
  formatReleaseDate,
  daysUntil,
  isLiveNow,
  sectionDrops,
  type Drop,
  type DropEvent,
  type DropsResponse,
  type Listing,
} from "../lib/drops";
import { TCG_CONFIGS, type TcgSlug } from "../lib/tcg.config";
import styles from "../styles/Drops.module.css";
import { sizedImage, THUMB } from "../lib/images";

const fetcher = (url: string) => fetch(url).then((r) => r.json()) as Promise<DropsResponse>;

/** Ticks once a second, but only while something on screen needs it. */
function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const STATUS_TEXT: Record<Listing["status"], string> = {
  live: "Buy now",
  coming_soon: "Listed",
  sold_out: "Sold out",
  unknown: "Check",
};

function RetailerRow({ listing }: { listing: Listing }) {
  return (
    <li className={styles.retailer}>
      <span className={`${styles.dot} ${styles[`dot_${listing.status}`]}`} aria-hidden="true" />
      <a
        href={listing.url}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.retailerName}
      >
        {listing.retailer}
      </a>
      {/* Positive, not merely a number. The crawler writes 0.0 when it could
          not read a price — which happens on sold-out listings, where the page
          often stops showing one — and `typeof === "number"` let that through
          as "$0.00". Four of the eleven listings on this page were advertising
          free sealed product. A missing price should look missing. */}
      {typeof listing.price === "number" && listing.price > 0 && (
        <span className={styles.retailerPrice}>
          ${listing.price.toFixed(2)}
          {listing.currency && listing.currency !== "CAD" ? ` ${listing.currency}` : ""}
        </span>
      )}
      {listing.queue && (
        <span className={styles.queueTag} title="A virtual waiting room fronts this drop">
          queue
        </span>
      )}
      <span className={`${styles.statusTag} ${styles[`status_${listing.status}`]}`}>
        {STATUS_TEXT[listing.status]}
      </span>
    </li>
  );
}

function GoLiveLine({ drop, now }: { drop: Drop; now: Date }) {
  if (!drop.go_live) return null;
  const countdown = countdownTo(drop.go_live.at, now);

  if (countdown.past) {
    return (
      <p className={styles.goLive}>
        <span className={styles.goLiveLabel}>Went live</span>
        <time dateTime={drop.go_live.at}>{formatGoLive(drop.go_live.at)}</time>
      </p>
    );
  }

  return (
    <p className={`${styles.goLive} ${styles.goLiveUpcoming}`}>
      <span className={styles.goLiveLabel}>Goes live in</span>
      <span className={styles.countdown}>{formatCountdown(countdown)}</span>
      <time className={styles.goLiveAbs} dateTime={drop.go_live.at}>
        {formatGoLive(drop.go_live.at)}
      </time>
    </p>
  );
}

function DropCard({ drop, now, accuracyNote }: { drop: Drop; now: Date; accuracyNote?: string }) {
  const live = isLiveNow(drop);
  const best = bestListing(drop);
  const days = drop.release_date ? daysUntil(drop.release_date, now) : null;
  const band = confidenceBand(drop.confidence?.score ?? 0);

  return (
    <article className={`${styles.card} ${live ? styles.cardLive : ""}`}>
      <div className={styles.cardMedia}>
        {drop.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sizedImage(drop.image_url, THUMB)}
            alt=""
            className={styles.thumb}
            loading="lazy"
            width={72}
            height={72}
            decoding="async"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className={styles.thumbPlaceholder} aria-hidden="true">
            {drop.kind === "secret_lair" ? "🎴" : drop.game === "mtg" ? "⚡" : "🔴"}
          </div>
        )}
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardTop}>
          <div className={styles.cardMeta}>
            {drop.series && <span className={styles.series}>{drop.series}</span>}
            {drop.kind === "secret_lair" && <span className={styles.slTag}>Secret Lair</span>}
          </div>
          <div className={styles.cardBadges}>
            {/* Two separate chips on purpose. "Will it happen when they said?"
                and "will it still be there when I get to it?" are different
                questions that routinely point opposite ways, and a combined
                score would hide the one the reader came for. */}
            {drop.sellout && <SelloutBadge sellout={drop.sellout} compact />}
            <ConfidenceBadge confidence={drop.confidence} accuracyNote={accuracyNote} compact />
          </div>
        </div>

        <h3 className={styles.name}>
          {drop.url ? (
            <a href={drop.url} target="_blank" rel="noopener noreferrer">{drop.name}</a>
          ) : (
            drop.name
          )}
        </h3>

        <p className={styles.dateLine}>
          <time dateTime={drop.release_date}>{formatReleaseDate(drop.release_date)}</time>
          {days !== null && days > 0 && band !== "undated" && (
            <span className={styles.daysTag}>{days === 1 ? "tomorrow" : `${days} days`}</span>
          )}
          {live && <span className={styles.liveTag}>Live now</span>}
        </p>

        <GoLiveLine drop={drop} now={now} />

        {drop.where?.length > 0 ? (
          <ul className={styles.retailers}>
            {drop.where.map((listing) => (
              <RetailerRow key={`${listing.retailer}-${listing.url}`} listing={listing} />
            ))}
          </ul>
        ) : (
          <p className={styles.noRetailers}>No storefront listings yet — we&apos;ll flag it here when pre-orders open.</p>
        )}

        {drop.news && drop.news.length > 0 && (
          <ul className={styles.news}>
            {drop.news.map((item) => (
              <li key={item.url}>
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </a>
                <span className={styles.newsSource}>{item.source}</span>
              </li>
            ))}
          </ul>
        )}

        {best?.url && (
          <a
            href={best.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.cta} ${live ? styles.ctaLive : ""}`}
          >
            {live ? "Buy now" : "View listing"} →
          </a>
        )}
      </div>
    </article>
  );
}

function EventRow({ event }: { event: DropEvent }) {
  return (
    <li className={styles.event}>
      <span className={`${styles.eventTag} ${styles[`event_${event.type}`]}`}>
        {EVENT_LABELS[event.type] ?? event.type}
      </span>
      <span className={styles.eventText}>
        {event.url ? (
          <a href={event.url} target="_blank" rel="noopener noreferrer">{event.text}</a>
        ) : (
          event.text
        )}
      </span>
      <time className={styles.eventDate} dateTime={event.at}>{event.at}</time>
    </li>
  );
}

export default function DropsPage() {
  const router = useRouter();
  const tcg: TcgSlug = (router.query.tcg as TcgSlug) in TCG_CONFIGS
    ? (router.query.tcg as TcgSlug)
    : "pokemon";
  const config = TCG_CONFIGS[tcg];

  const { data, error, isLoading } = useSWR<DropsResponse>(
    `/api/drops?tcg=${tcg}`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 5 * 60 * 1000 }
  );

  const drops = data?.drops ?? [];
  const sections = sectionDrops(drops);

  // Only run the per-second clock when a countdown is actually on screen.
  const hasCountdown = sections.soon.some(
    (d) => d.go_live && new Date(d.go_live.at).getTime() > Date.now()
  );
  const now = useNow(hasCountdown);

  const accuracyFor = (score: number): string | undefined => {
    const band = (data?.calibration ?? []).find((b) => {
      const [low, high] = b.band.split("-").map(Number);
      return score >= low && score <= high;
    });
    if (!band || band.n < 5 || band.accuracy === null) return undefined;
    return `Our ${band.band}% calls have landed ${Math.round(band.accuracy * 100)}% of the time (n=${band.n}).`;
  };

  const empty = !isLoading && !error && drops.length === 0;

  return (
    <>
      <Head>
        <title>{`Upcoming Drops — ${config.displayName}`}</title>
        <meta
          name="description"
          content={`When and where upcoming ${config.displayName} drops go live, with a confidence rating on every date.`}
        />
      </Head>

      <div className={styles.page}>
        <header className={styles.header}>
          <Link href={`/${tcg}`} className={styles.backLink}>← Back to tracker</Link>
          <h1 className={styles.title}>Upcoming Drops</h1>
          <p className={styles.subtitle}>
            When and where the next {config.shortName} drops go live — each date rated for how
            likely it is to hold.
          </p>
        </header>

        {isLoading && (
          <div className={styles.loading} aria-busy="true" aria-label="Loading drops">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.skeleton} />
            ))}
          </div>
        )}

        {error && (
          <p className={styles.error} role="alert">
            Could not load the drops feed. It should be back shortly — the tracker itself is
            unaffected.
          </p>
        )}

        {empty && (
          <p className={styles.empty}>
            No upcoming {config.shortName} drops tracked yet. This fills in as sources announce
            them — usually a few months ahead.
          </p>
        )}

        {sections.soon.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Going live soon
              <span className={styles.count}>{sections.soon.length}</span>
            </h2>
            <div className={styles.grid}>
              {sections.soon.map((drop) => (
                <DropCard
                  key={drop.id}
                  drop={drop}
                  now={now}
                  accuracyNote={accuracyFor(drop.confidence?.score ?? 0)}
                />
              ))}
            </div>
          </section>
        )}

        {data && data.events.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>What just changed</h2>
            <ul className={styles.events}>
              {data.events.slice(0, 12).map((event, i) => (
                <EventRow key={`${event.at}-${event.type}-${event.drop_id}-${i}`} event={event} />
              ))}
            </ul>
          </section>
        )}

        {sections.scheduled.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Scheduled
              <span className={styles.count}>{sections.scheduled.length}</span>
            </h2>
            <div className={styles.grid}>
              {sections.scheduled.map((drop) => (
                <DropCard
                  key={drop.id}
                  drop={drop}
                  now={now}
                  accuracyNote={accuracyFor(drop.confidence?.score ?? 0)}
                />
              ))}
            </div>
          </section>
        )}

        {sections.undated.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Announced, no date yet
              <span className={styles.count}>{sections.undated.length}</span>
            </h2>
            <div className={styles.grid}>
              {sections.undated.map((drop) => (
                <DropCard key={drop.id} drop={drop} now={now} />
              ))}
            </div>
          </section>
        )}

        {data && data.attribution.length > 0 && (
          <footer className={styles.credits}>
            <p className={styles.creditsTitle}>Sources</p>
            <ul className={styles.creditsList}>
              {data.attribution.map((credit) => (
                <li key={credit.source}>
                  <a href={credit.url} target="_blank" rel="noopener noreferrer">{credit.name}</a>
                  {credit.licence && <span className={styles.licence}>{credit.licence}</span>}
                </li>
              ))}
            </ul>
            {data.generated_at && (
              <p className={styles.updated}>Last updated {data.generated_at}</p>
            )}
          </footer>
        )}
      </div>
    </>
  );
}
