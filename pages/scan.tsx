import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import GameTabBar from "../components/GameTabBar";
import GameSubNav from "../components/GameSubNav";
import Footer from "../components/Footer";
import { providerCredit } from "../lib/cardProviders";
import type { CardMatch, LookupResponse } from "../lib/cardLookup";
import { TCG_CONFIGS, type TcgSlug } from "../lib/tcg.config";
import { SITE_URL } from "../lib/siteUrl";
import styles from "../styles/Scan.module.css";

/**
 * Look up a single card — by camera, or by typing.
 *
 * The two paths are peers. A scanner is the reason to visit, but OCR on a
 * photographed card fails often enough that treating typing as the fallback
 * would make the page feel broken; instead the camera fills the search box and
 * the user corrects it. That also means the page is fully usable on a desktop
 * with no camera at all.
 *
 * What the page shows, in order of who vouches for it:
 *
 *   The card, its set and its collector number come from a card database, and
 *   are as reliable as that database. The market price beside it is a US
 *   reference converted to Canadian dollars — it is what the card trades for,
 *   not what anybody here sells it for, and it is labelled that way.
 *
 *   Canadian prices are our own, scraped from the shops we track. Most cards
 *   will have none: this site's crawl covers sealed product far better than
 *   singles, and saying "no Canadian listing tracked" is the honest answer
 *   rather than leaving a card looking worthless.
 */

const CardScanner = dynamic(() => import("../components/CardScanner"), { ssr: false });

const money = (n: number) => `$${n.toFixed(2)}`;

export default function ScanPage() {
  const router = useRouter();
  const tcg: TcgSlug = router.query.tcg === "mtg" ? "mtg" : "pokemon";

  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [setId, setSetId] = useState("");
  const [sort, setSort] = useState("newest");
  const [stockedOnly, setStockedOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-tcg", tcg);
    return () => document.documentElement.removeAttribute("data-tcg");
  }, [tcg]);

  const runLookup = useCallback(
    async (
      text: string,
      game: TcgSlug,
      offset = 0,
      filters: {
        setId?: string; sort?: string; stocked?: boolean;
        cardId?: string; tiedIds?: string[];
      } = {}
    ) => {
      const trimmed = text.trim();
      if (trimmed.length < 2) return;
      if (offset > 0) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      setSubmitted(trimmed);
      try {
        // Filters go to the server so they apply across every printing, not
        // just the twelve already on screen. Filtering the loaded page would
        // quietly mean "of the twelve you happen to have".
        const params = new URLSearchParams({
          tcg: game,
          q: trimmed,
          offset: String(offset),
          sort: filters.sort ?? "newest",
        });
        if (filters.setId) params.set("set", filters.setId);
        if (filters.stocked) params.set("stocked", "1");
        // An exact printing recognised by its artwork. The server skips
        // searching entirely when this is present.
        if (filters.cardId) params.set("id", filters.cardId);
        // The artwork was recognised but the printing was not — a reprint. The
        // server resolves these to one card name and searches it.
        if (filters.tiedIds?.length) params.set("ids", filters.tiedIds.join(","));
        const res = await fetch(`/api/card-lookup?${params}`);
        const payload = await res.json();
        if (!res.ok) {
          if (offset === 0) setResult(null);
          setError(payload?.error ?? "Lookup failed.");
        } else {
          const next = payload as LookupResponse;
          // A later page appends. Replacing would throw away the printings
          // somebody has already scrolled past to get here.
          setResult((prev) =>
            offset > 0 && prev
              ? { ...next, matches: [...prev.matches, ...next.matches] }
              : next
          );

          // A lookup by artwork was submitted as a card id, which is not
          // something anyone can search for. Now that the card is known, its
          // name replaces the id as what was searched — because `submitted` is
          // what the set filter, the game switch and Show more all re-run, and
          // every one of them would otherwise go hunting for "sv08.5-009" and
          // come back with nothing.
          const identified = next.matches[0]?.name;
          if ((filters.cardId || filters.tiedIds?.length) && identified) {
            setQuery(identified);
            setSubmitted(identified);
          }
        }
      } catch {
        if (offset === 0) setResult(null);
        setError("Could not reach the lookup service.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  /** Re-run the current search with the current filters. */
  const applyFilters = useCallback(
    (next: { setId?: string; sort?: string; stocked?: boolean }) => {
      const merged = {
        setId: next.setId ?? setId,
        sort: next.sort ?? sort,
        stocked: next.stocked ?? stockedOnly,
      };
      // Back to page one. Keeping the offset would show page three of a filter
      // that may only have one page.
      if (submitted) void runLookup(submitted, tcg, 0, merged);
    },
    [runLookup, setId, sort, stockedOnly, submitted, tcg]
  );

  const handleScan = useCallback(
    (text: string, cardId?: string, tiedIds?: string[]) => {
      // The camera stays open. The scanner reads continuously, so closing it on
      // the first hit would end the session at the exact moment somebody wants
      // to check the next card — and if the reading was wrong, it would also
      // have taken away the only way to try again.
      //
      // A card recognised by artwork carries its id, and the set filter is
      // dropped for it: the picture already named one printing, and filtering
      // that to a set could only ever hide it. The box is left empty rather
      // than filled with the id; `runLookup` puts the card's real name there
      // once the lookup comes back.
      const byArt = !!cardId || !!tiedIds?.length;
      setQuery(byArt ? "" : text);
      void runLookup(text, tcg, 0, {
        setId: byArt ? "" : setId,
        sort,
        stocked: stockedOnly,
        cardId,
        tiedIds,
      });
    },
    [runLookup, setId, sort, stockedOnly, tcg]
  );

  const credit = providerCredit(tcg);
  const title = `Card Scanner and Price Lookup — ${TCG_CONFIGS[tcg].displayName} | TCG Drop`;

  // Read defensively. A rolling deploy, or a response cached by the API before
  // its shape last changed, can hand this page a payload without a field it
  // expects — and a blank page is a far worse outcome than a missing section.
  const matches = result?.matches ?? [];
  const unconfirmed = result?.unconfirmedListings ?? [];
  // `total` is how many printings exist, `matches.length` how many are loaded.
  const total = result?.total ?? matches.length;
  const hasMore = matches.length < total;
  const sets = result?.sets ?? [];

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta
          name="description"
          content={`Scan or search a ${TCG_CONFIGS[tcg].displayName} card to see its set, collector number, market value and Canadian prices.`}
        />
        <link rel="canonical" href={`${SITE_URL}/scan`} />
      </Head>

      <GameTabBar tcg={tcg} />
      <GameSubNav tcg={tcg} active="scan" />

      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Card lookup</h1>
          <p className={styles.lede}>
            Point your camera at a card, or type its name. You get the set it is
            from, its collector number, what it trades for, and any Canadian
            listing we track.
          </p>
        </header>

        <div className={styles.gameSwitch} role="group" aria-label="Choose a game">
          {(["pokemon", "mtg"] as TcgSlug[]).map((slug) => (
            <button
              key={slug}
              type="button"
              className={`${styles.gameBtn} ${slug === tcg ? styles.gameBtnActive : ""}`}
              onClick={() => {
                void router.replace({ query: { ...router.query, tcg: slug } }, undefined, {
                  shallow: true,
                });
                if (submitted)
                  void runLookup(submitted, slug, 0, {
                    // A set id belongs to one game's catalogue, so it cannot
                    // survive a switch to the other.
                    setId: "",
                    sort,
                    stocked: stockedOnly,
                  });
                setSetId("");
              }}
            >
              {TCG_CONFIGS[slug].displayName}
            </button>
          ))}
        </div>

        <form
          className={styles.searchRow}
          onSubmit={(e) => {
            e.preventDefault();
            void runLookup(query, tcg, 0, { setId, sort, stocked: stockedOnly });
          }}
        >
          <input
            ref={inputRef}
            className={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tcg === "mtg" ? "e.g. Lightning Bolt, or Sol Ring 2783" : "e.g. Iono, or Charizard ex 223/197"
            }
            aria-label="Card name or collector number"
            autoComplete="off"
          />
          <button type="submit" className={styles.searchBtn} disabled={query.trim().length < 2}>
            Look up
          </button>
          <button
            type="button"
            className={styles.scanBtn}
            onClick={() => setCameraOpen((v) => !v)}
          >
            {cameraOpen ? "Hide camera" : "Scan a card"}
          </button>
        </form>

        <p className={styles.tip}>
          Adding the collector number from the bottom of the card — “223/197” —
          pins the exact printing. Without it you get every printing, and their
          prices can differ by a factor of ten.
        </p>

        {cameraOpen && (
          <CardScanner
            tcg={tcg}
            onRead={handleScan}
            onClose={() => setCameraOpen(false)}
          />
        )}

        {loading && <p className={styles.state}>Looking that up…</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {result && !loading && (
          <section className={styles.results} aria-live="polite">
            <h2 className={styles.resultsHeading}>
              {total === 0
                ? `Nothing matched “${result.query}”`
                : result.exact
                  ? "One printing matched"
                  : `${total} printing${total === 1 ? "" : "s"} of “${result.query}”`}
            </h2>
            {result.correctedTo && (
              <p className={styles.corrected}>
                No card is called “{result.query}”, so we searched for{" "}
                <strong>{result.correctedTo}</strong>.
              </p>
            )}
            {result.note && <p className={styles.state}>{result.note}</p>}

            {/* Only worth showing once there is something to narrow. A filter
                bar above three results is furniture. */}
            {total > 3 && (
              <div className={styles.filters} role="group" aria-label="Filter results">
                {sets.length > 1 && (
                  <label className={styles.filterField}>
                    <span className={styles.filterLabel}>Set</span>
                    <select
                      className={styles.filterSelect}
                      value={setId}
                      onChange={(e) => {
                        setSetId(e.target.value);
                        applyFilters({ setId: e.target.value });
                      }}
                    >
                      <option value="">All sets ({total})</option>
                      {sets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.count})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className={styles.filterField}>
                  <span className={styles.filterLabel}>Order</span>
                  <select
                    className={styles.filterSelect}
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value);
                      applyFilters({ sort: e.target.value });
                    }}
                  >
                    <option value="newest">Newest sets first</option>
                    <option value="oldest">Oldest sets first</option>
                    <option value="number">Collector number</option>
                  </select>
                </label>

                <label className={styles.filterCheck}>
                  <input
                    type="checkbox"
                    checked={stockedOnly}
                    onChange={(e) => {
                      setStockedOnly(e.target.checked);
                      applyFilters({ stocked: e.target.checked });
                    }}
                  />
                  In stock in Canada
                </label>

                {(setId || stockedOnly || sort !== "newest") && (
                  <button
                    type="button"
                    className={styles.filterClear}
                    onClick={() => {
                      setSetId("");
                      setSort("newest");
                      setStockedOnly(false);
                      applyFilters({ setId: "", sort: "newest", stocked: false });
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {stockedOnly && (
              <p className={styles.filterNote}>
                Stock is checked against the printings loaded so far, so “show
                more” can turn up others.
              </p>
            )}

            <ul className={styles.cardList}>
              {matches.map((match) => (
                <CardResult key={match.id} match={match} />
              ))}
            </ul>

            {hasMore && (
              <button
                type="button"
                className={styles.moreBtn}
                disabled={loadingMore}
                onClick={() =>
                  void runLookup(submitted, tcg, matches.length, {
                    setId,
                    sort,
                    stocked: stockedOnly,
                  })
                }
              >
                {loadingMore
                  ? "Loading…"
                  : `Show more (${total - matches.length} left)`}
              </button>
            )}

            {unconfirmed.length > 0 && (
              <section className={styles.maybe}>
                <h3 className={styles.maybeHeading}>
                  Canadian listings for this card — printing not confirmed
                </h3>
                <p className={styles.maybeLabel}>
                  These shops list a card by this name, but the listing does not
                  say which printing, and the printings above are not worth the
                  same. Check the listing before buying.
                </p>
                <ul className={styles.listings}>
                  {unconfirmed.map((l, i) => (
                    <li key={`${l.groupKey}-${l.retailer}-${i}`} className={styles.listing}>
                      <span className={l.inStock ? styles.dotIn : styles.dotOut} aria-hidden="true">
                        ●
                      </span>
                      <a href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                        {l.retailer}
                      </a>
                      <strong>{money(l.price)}</strong>
                      {!l.inStock && <em className={styles.oos}>out of stock</em>}
                      <em className={styles.maybeName}>{l.name}</em>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>
        )}

        <p className={styles.credit}>
          {credit.label} (
          <a href={credit.url} target="_blank" rel="noopener noreferrer">
            {credit.url.replace("https://", "")}
          </a>
          ). Market values are a US reference converted to Canadian dollars, not
          a price anyone here is charging.
        </p>
      </main>

      <Footer syncedAt={null} retailersCount={0} productsCount={0} />
    </>
  );
}

function CardResult({ match }: { match: CardMatch }) {
  return (
    <li className={styles.card}>
      {match.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.cardArt}
          src={match.imageUrl}
          alt={match.name}
          loading="lazy"
          width={120}
          height={167}
        />
      ) : (
        <div className={styles.cardArtEmpty} aria-hidden="true" />
      )}

      <div className={styles.cardBody}>
        <h3 className={styles.cardName}>
          {match.sourceUrl ? (
            <a href={match.sourceUrl} target="_blank" rel="noopener noreferrer">
              {match.name}
            </a>
          ) : (
            match.name
          )}
        </h3>

        <p className={styles.cardMeta}>
          {match.setName}
          {match.collectorNumber && (
            <>
              {" "}· #{match.collectorNumber}
              {match.setTotal ? `/${match.setTotal}` : ""}
            </>
          )}
          {match.rarity && <> · {match.rarity}</>}
        </p>

        <p className={styles.market}>
          {match.marketCad !== null ? (
            <>
              <strong>{money(match.marketCad)}</strong>
              <span className={styles.marketNote}>
                market value{match.marketUsd !== null && ` · US$${match.marketUsd.toFixed(2)}`}
              </span>
            </>
          ) : (
            <span className={styles.marketNote}>No market price published for this printing</span>
          )}
        </p>

        {match.listings.length > 0 ? (
          <ul className={styles.listings}>
            {match.listings.map((l, i) => (
              <li key={`${l.groupKey}-${l.retailer}-${i}`} className={styles.listing}>
                <span className={l.inStock ? styles.dotIn : styles.dotOut} aria-hidden="true">
                  ●
                </span>
                <a href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                  {l.retailer}
                </a>
                <strong>{money(l.price)}</strong>
                {!l.inStock && <em className={styles.oos}>out of stock</em>}
                {/* Always shown when we have it: a price without its finish,
                    condition and language is not comparable to the one above
                    it. */}
                {l.detail && <em className={styles.copyDetail}>{l.detail}</em>}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.noListings}>
            No Canadian listing tracked for this printing.{" "}
            <Link href="/alerts">Set an alert</Link> and we will tell you when
            one appears.
          </p>
        )}
      </div>
    </li>
  );
}
