import { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import useSWR from "swr";
import type { CalendarResponse, CalendarSet } from "./api/calendar";
import styles from "../styles/Calendar.module.css";

const fetcher = (url: string) => fetch(url).then((r) => r.json()) as Promise<CalendarResponse>;

function formatDate(iso: string): string {
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

function SetCard({ set, isCurrent = false }: { set: CalendarSet; isCurrent?: boolean }) {
  const days = daysUntil(set.release_date);
  const released = days <= 0;
  const soon = days > 0 && days <= 14;

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
        {!isCurrent && !released && (
          <span className={`${styles.countdownBadge} ${soon ? styles.countdownSoon : ""}`}>
            {days === 1 ? "Tomorrow" : `${days} days`}
          </span>
        )}
        {!isCurrent && released && (
          <span className={styles.releasedBadge}>Released</span>
        )}
      </div>

      <h2 className={styles.setName}>{set.name}</h2>
      <p className={styles.releaseDate}>{formatDate(set.release_date)}</p>

      {set.notes && <p className={styles.notes}>{set.notes}</p>}

      <div className={styles.products}>
        {set.products.map((p) => (
          <span key={p} className={styles.productChip}>{p}</span>
        ))}
      </div>

      <div className={styles.cardLinks}>
        <a href={`/?set=${encodeURIComponent(set.name)}`} className={styles.priceLink}>
          View prices →
        </a>
        {set.url && (
          <a href={set.url} target="_blank" rel="noopener noreferrer" className={styles.extLink}>
            Bulbapedia ↗
          </a>
        )}
      </div>
    </div>
  );
}

const PAST_LIMIT = 12;

export default function CalendarPage() {
  const [showAllPast, setShowAllPast] = useState(false);

  const { data, error, isLoading } = useSWR<CalendarResponse>("/api/calendar", fetcher, {
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
        <title>Release Calendar — Pokemon TCG Price Tracker</title>
        <meta name="description" content="Upcoming and recent Pokemon TCG set release dates" />
      </Head>

      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <Link href="/" className={styles.backLink}>← Back to tracker</Link>
            <h1 className={styles.title}>Release Calendar</h1>
            <p className={styles.subtitle}>Pokemon TCG set releases — upcoming, current, and past</p>
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
                  {upcoming.map((s) => <SetCard key={s.name} set={s} />)}
                </div>
              </section>
            )}

            {recent.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Recently Released</h2>
                <div className={styles.grid}>
                  {recent.map((s) => (
                    <SetCard key={s.name} set={s} isCurrent={s.name === mostRecentName} />
                  ))}
                </div>
              </section>
            )}

            {past.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Past Releases</h2>
                <div className={styles.grid}>
                  {visiblePast.map((s) => (
                    <SetCard key={s.name} set={s} isCurrent={s.name === mostRecentName} />
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
