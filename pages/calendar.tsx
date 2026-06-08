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

function SetCard({ set }: { set: CalendarSet }) {
  const days = daysUntil(set.release_date);
  const released = days <= 0;
  const soon = days > 0 && days <= 14;

  return (
    <div className={`${styles.card} ${released ? styles.released : ""} ${soon ? styles.soon : ""}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardMeta}>
          <span className={styles.series}>{set.series}</span>
          <span className={`${styles.typeBadge} ${set.type === "Special Set" ? styles.typeSpecial : styles.typeMain}`}>
            {set.type}
          </span>
        </div>
        {!released && (
          <span className={`${styles.countdownBadge} ${soon ? styles.countdownSoon : ""}`}>
            {days === 1 ? "Tomorrow" : `${days} days`}
          </span>
        )}
        {released && (
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
    </div>
  );
}

export default function CalendarPage() {
  const { data, error, isLoading } = useSWR<CalendarResponse>("/api/calendar", fetcher, {
    revalidateOnFocus: false,
  });

  const now = new Date().toISOString().slice(0, 10);
  const upcoming = data?.sets.filter((s) => s.release_date >= now).sort((a, b) => a.release_date.localeCompare(b.release_date)) ?? [];
  const past = data?.sets.filter((s) => s.release_date < now).sort((a, b) => b.release_date.localeCompare(a.release_date)) ?? [];

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
            <p className={styles.subtitle}>Upcoming and recent Pokemon TCG set releases</p>
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
                <h2 className={styles.sectionTitle}>Upcoming Releases</h2>
                <div className={styles.grid}>
                  {upcoming.map((s) => <SetCard key={s.name} set={s} />)}
                </div>
              </section>
            )}

            {past.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Past Releases</h2>
                <div className={styles.grid}>
                  {past.map((s) => <SetCard key={s.name} set={s} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
