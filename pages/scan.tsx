import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import GameTabBar from "../components/GameTabBar";
import GameSubNav from "../components/GameSubNav";
import Footer from "../components/Footer";
import { providerCredit } from "../lib/cardProviders";
import { buildLookupQuery } from "../lib/cardLookup";
import {
  addToHistory,
  clearHistory,
  conditionOf,
  entryKey,
  entryValue,
  historyValue,
  loadHistory,
  relativeTime,
  setCondition,
  type ScanHistoryEntry,
} from "../lib/scanHistory";
import { CONDITIONS, CONDITION_LABELS, type Condition } from "../lib/cardCondition";
import { downloadCsv } from "../lib/scanExport";
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
  /**
   * Whether a scan is waiting to be acknowledged.
   *
   * The camera fills the screen on a phone and the results render underneath
   * it, so a successful scan used to produce no visible change at all — you had
   * to know to scroll. This drives a sheet over the camera instead, opened the
   * instant a card is recognised rather than when the lookup returns, so there
   * is immediate feedback that the scan landed and then the answer arrives in
   * the same place.
   */
  const [scanSheet, setScanSheet] = useState(false);
  /** Incremented on "Scan another", to let the scanner re-read the same card. */
  const [rescanKey, setRescanKey] = useState(0);
  /**
   * Whether the last scan recognised the artwork but not the printing.
   *
   * The sheet has to say so. A reprint scan legitimately cannot tell which of
   * a dozen printings is in your hand, and leading with the first one as though
   * it were the answer puts a single confident price on a card whose printings
   * can differ tenfold — the exact mistake the matcher refused to make.
   */
  const [scanAmbiguous, setScanAmbiguous] = useState(false);
  /**
   * A brief confirmation over the viewfinder, in place of a modal.
   *
   * Scanning is a stack activity. A sheet that has to be dismissed after every
   * card turns forty cards into forty taps, so a recognised card now flashes a
   * line here, drops into the strip, and the camera keeps going — which is how
   * every scanner built for volume behaves. The details are still one tap away
   * on the strip.
   */
  const [banner, setBanner] = useState<string | null>(null);
  /**
   * Which stored scan the detail sheet is showing.
   *
   * Needed because grading writes back to that entry, and the lookup result on
   * its own does not say which row it came from — two printings of one card are
   * separate rows with separate grades.
   */
  const [openEntry, setOpenEntry] = useState<ScanHistoryEntry | null>(null);
  /** Every set in this game, for the scanner's set picker. */
  const [allSets, setAllSets] = useState<{ id: string; name: string }[]>([]);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The cards scanned on this device, newest first.
   *
   * Read after mount rather than during render: it comes from localStorage,
   * which the server has no view of, and seeding state from it directly would
   * make the first client render disagree with the server's.
   */
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [setId, setSetId] = useState("");
  const [sort, setSort] = useState("newest");
  const [stockedOnly, setStockedOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-tcg", tcg);
    return () => document.documentElement.removeAttribute("data-tcg");
  }, [tcg]);

  /**
   * Warm the scanner's data while the page is being read.
   *
   * Nothing can be matched by picture until the fingerprint table has arrived,
   * and it only started downloading when the camera opened — so the first
   * seconds of every session were spent on the slow path, reading titles,
   * however good the light was. Fetching it here means it is usually in the
   * browser cache before the user has finished deciding to press the button.
   *
   * Deliberately unawaited and unhandled: this is a head start, not a
   * dependency. The scanner fetches these itself and copes with either missing.
   */
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  /**
   * Hold the page still behind the fullscreen scanner.
   *
   * Without this, dragging anywhere over the viewfinder scrolls the page
   * underneath it — so closing the camera drops you somewhere you never chose
   * to be, and on iOS the rubber-band drags the whole scanner around while
   * you are trying to hold a card steady.
   */
  // A pending banner must not fire after the camera has gone.
  useEffect(() => {
    if (cameraOpen) return;
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(null);
  }, [cameraOpen]);

  useEffect(() => {
    if (!cameraOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [cameraOpen]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/card-sets?tcg=${tcg}`)
      .then((r) => r.json())
      .then((d: { sets?: { id: string; name: string }[] }) => {
        if (!cancelled) setAllSets(d.sets ?? []);
      })
      .catch(() => undefined); // No picker is a fine outcome.
    return () => {
      cancelled = true;
    };
  }, [tcg]);

  useEffect(() => {
    const warm = new AbortController();
    for (const path of ["card-hashes", "card-names"]) {
      void fetch(`/api/${path}?tcg=${tcg}`, { signal: warm.signal }).catch(() => undefined);
    }
    return () => warm.abort();
  }, [tcg]);

  const runLookup = useCallback(
    async (
      text: string,
      game: TcgSlug,
      offset = 0,
      filters: {
        setId?: string; sort?: string; stocked?: boolean;
        /** A fingerprint the scanner matched outright. */
        cardHash?: string;
        /** Fingerprints it could not choose between — one artwork, several printings. */
        tiedHashes?: string[];
      } = {}
    ) => {
      const trimmed = text.trim();
      // A scan carries no search term at all — its fingerprints are the query.
      // Sending the fingerprint as `q` as well meant `submitted` held a hex
      // string, so a failed lookup left the filters and Show more searching for
      // "f7a3f31307655377". The card's real name is written back below once the
      // lookup identifies it.
      const byFingerprint = !!filters.cardHash || !!filters.tiedHashes?.length;
      if (!byFingerprint && trimmed.length < 2) return;
      if (offset > 0) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      if (!byFingerprint) setSubmitted(trimmed);
      try {
        // Filters go to the server so they apply across every printing, not
        // just the twelve already on screen. Filtering the loaded page would
        // quietly mean "of the twelve you happen to have".
        const params = buildLookupQuery({
          tcg: game,
          q: byFingerprint ? "" : trimmed,
          offset,
          sort: filters.sort,
          setId: filters.setId,
          stocked: filters.stocked,
          cardHash: filters.cardHash,
          tiedHashes: filters.tiedHashes,
        });
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
          if ((filters.cardHash || filters.tiedHashes?.length) && identified) {
            setQuery(identified);
            setSubmitted(identified);
          }

          // Recorded only for a scan, and only once the card is known. A
          // fingerprint on its own is not something anyone can read back.
          const top = next.matches[0];
          if (byFingerprint) {
            const price = top?.marketCad;
            setBanner(
              top
                ? `${top.name}${price !== null && price !== undefined ? ` · $${price.toFixed(2)}` : ""}`
                : "No match — try again or type the name"
            );
            if (bannerTimer.current) clearTimeout(bannerTimer.current);
            // Long enough to read while moving to the next card, short enough
            // not to sit over the viewfinder while that card is being framed.
            bannerTimer.current = setTimeout(() => setBanner(null), 2600);
          }
          if (byFingerprint && top) {
            setHistory(
              addToHistory({
                hash: filters.cardHash,
                hashes: filters.tiedHashes,
                query: identified,
                tcg: game,
                name: top.name,
                setName: top.setName,
                collectorNumber: top.collectorNumber,
                imageUrl: top.imageUrl,
                marketCad: top.marketCad,
                at: Date.now(),
              })
            );
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
    (text: string, cardHash?: string, tiedHashes?: string[]) => {
      // The camera stays open. The scanner reads continuously, so closing it on
      // the first hit would end the session at the exact moment somebody wants
      // to check the next card — and if the reading was wrong, it would also
      // have taken away the only way to try again.
      //
      // A card recognised by artwork arrives as a fingerprint, and the set
      // filter is dropped for it: the picture already named the printing, and
      // filtering that to a set could only ever hide it. The box is left empty
      // rather than filled with a fingerprint; `runLookup` puts the card's real
      // name there once the lookup comes back.
      const byArt = !!cardHash || !!tiedHashes?.length;
      // A banner, not a sheet. Shown before the lookup rather than after: the
      // point is to confirm the scan registered, and waiting on the network to
      // say so is the thing that made it feel unresponsive.
      setBanner("Got it — looking up…");
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      // A short buzz is the fastest possible confirmation, and the only one
      // that works while the phone is being moved to the next card. Absent on
      // iOS Safari and on desktop, hence the guard.
      try {
        navigator.vibrate?.(25);
      } catch {
        // Some browsers expose it and throw when the page is not visible.
      }
      setScanAmbiguous(!!tiedHashes?.length);
      setQuery(byArt ? "" : text);
      void runLookup(byArt ? "" : text, tcg, 0, {
        // Passed for a scan too, now that the server uses it to narrow reprint
        // ties rather than to filter results. It narrows only — a card from
        // another set still scans, because narrowing to nothing returns
        // everything rather than nothing.
        setId,
        sort,
        stocked: stockedOnly,
        cardHash,
        tiedHashes,
      });
    },
    [runLookup, setId, sort, stockedOnly, tcg]
  );

  /**
   * Re-open a card from the history.
   *
   * Re-runs the original lookup rather than replaying what was stored. The
   * stored price is a snapshot from the moment it was scanned, and a card
   * someone is coming back to is usually one they are deciding about — so it
   * gets today's number, and today's Canadian listings, not last week's.
   */
  const reopen = useCallback(
    (entry: ScanHistoryEntry) => {
      // Tapping a card in the strip is the deliberate act, so this is where the
      // detail sheet belongs — not after every scan.
      setScanSheet(true);
      setScanAmbiguous(!!entry.hashes?.length);
      setOpenEntry(entry);
      setSetId("");
      setQuery(entry.query ?? entry.name);
      void runLookup(entry.query ?? entry.name, tcg, 0, {
        sort,
        stocked: stockedOnly,
        cardHash: entry.hash,
        tiedHashes: entry.hashes,
      });
    },
    [runLookup, sort, stockedOnly, tcg]
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
            rescanKey={rescanKey}
            fullscreen
            banner={banner}
            sets={allSets}
            setId={setId}
            onSetChange={setSetId}
            footer={
              <ScanStrip
                history={history}
                onPick={reopen}
                onExport={() => {
                  if (!downloadCsv(history)) {
                    setError("Could not build the export on this browser.");
                  }
                }}
              />
            }
            onClose={() => {
              setCameraOpen(false);
              setScanSheet(false);
            }}
          />
        )}

        {cameraOpen && scanSheet && (
          <ScanSheet
            loading={loading}
            error={error}
            result={result}
            ambiguous={scanAmbiguous}
            entry={openEntry}
            onGrade={(condition) => {
              if (!openEntry) return;
              const next = setCondition(entryKey(openEntry), condition);
              setHistory(next);
              setOpenEntry({ ...openEntry, condition });
            }}
            onScanAnother={() => {
              setScanSheet(false);
              setRescanKey((n) => n + 1);
            }}
            onDone={() => {
              setCameraOpen(false);
              setScanSheet(false);
            }}
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
              {/* A scan has no search term — its fingerprints are the query —
                  so the heading names the card that was found instead. Without
                  this it read: 1 printing of “”. */}
              {total === 0
                ? result.query
                  ? `Nothing matched “${result.query}”`
                  : "That scan did not match a card"
                : result.exact
                  ? "One printing matched"
                  : `${total} printing${total === 1 ? "" : "s"} of “${
                      result.query || matches[0]?.name || "that card"
                    }”`}
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

        {history.length > 0 && (
          <section className={styles.history} aria-labelledby="scan-history-heading">
            <div className={styles.historyHead}>
              <h2 id="scan-history-heading" className={styles.historyHeading}>
                Recent scans
              </h2>
              <span className={styles.historyActions}>
                <button
                  type="button"
                  className={styles.historyClear}
                  onClick={() => {
                    // Says so rather than appearing to do nothing when the
                    // browser refuses the download.
                    if (!downloadCsv(history)) {
                      setError("Could not build the export on this browser.");
                    }
                  }}
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  className={styles.historyClear}
                  onClick={() => setHistory(clearHistory())}
                >
                  Clear
                </button>
              </span>
            </div>
            {/* Stored on this device only — no account, and nothing leaves it.
                The total says what it does not know, because roughly a fifth of
                the catalogue has no published price and a quiet sum would
                report a stack as cheaper than it is. */}
            <p className={styles.historyNote}>
              {(() => {
                const { totalCad, priced, unpriced } = historyValue(history);
                const worth =
                  priced > 0
                    ? `${priced} card${priced === 1 ? "" : "s"} worth about $${totalCad.toFixed(2)} CAD`
                    : "No market price published for any of these yet";
                const gap =
                  unpriced > 0
                    ? `, plus ${unpriced} with no published price`
                    : "";
                return `${worth}${gap}. Kept on this device; prices are from when you scanned. Tap a card to look it up again.`;
              })()}
            </p>
            <ul className={styles.historyList}>
              {history.map((entry) => (
                <li key={`${entry.at}-${entry.name}`}>
                  <button
                    type="button"
                    className={styles.historyItem}
                    onClick={() => reopen(entry)}
                  >
                    {entry.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={styles.historyArt} src={entry.imageUrl} alt="" />
                    ) : (
                      <span className={styles.historyArtEmpty} aria-hidden="true" />
                    )}
                    <span className={styles.historyBody}>
                      <span className={styles.historyName}>{entry.name}</span>
                      <span className={styles.historyMeta}>
                        {entry.setName}
                        {entry.collectorNumber ? ` · #${entry.collectorNumber}` : ""}
                        {" · "}
                        {relativeTime(entry.at)}
                      </span>
                    </span>
                    <span className={styles.historyPrice}>
                      {entry.marketCad !== null ? `$${entry.marketCad.toFixed(2)}` : "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
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

/**
 * What the scanner found, over the top of the camera.
 *
 * A phone screen is all viewfinder, and the results list sits below it. Without
 * this there was no moment where the app said "got it" — you pointed at a card
 * and nothing appeared to happen, which reads as a broken scanner even when the
 * match was perfect.
 *
 * It opens on recognition rather than on the answer, so the acknowledgement is
 * immediate and the price fills in behind it. The primary action is scanning
 * the next card, because anyone holding one card is usually holding a stack.
 */
/**
 * Recent scans along the bottom of the fullscreen scanner.
 *
 * Going through a stack means the last few cards are the ones you want to
 * glance back at, and leaving the camera to find them breaks the rhythm. Thumbnails
 * rather than rows, because this is a strip at the bottom of a viewfinder and
 * the card art is what anyone recognises at that size.
 */
function ScanStrip({
  history,
  onPick,
  onExport,
}: {
  history: ScanHistoryEntry[];
  onPick: (entry: ScanHistoryEntry) => void;
  onExport: () => void;
}) {
  const { totalCad, priced } = historyValue(history);

  return (
    <div className={styles.strip}>
      <div className={styles.stripHead}>
        {/* "Recent", not "this session": the list is kept on the device and
            survives closing the page, so calling it a session would be wrong
            the second time someone opens the scanner. */}
        <span className={styles.stripTitle}>
          Recent{history.length > 0 ? ` · ${history.length}` : ""}
        </span>
        <span className={styles.stripTotalRow}>
          {priced > 0 && (
            <span className={styles.stripTotal}>≈ ${totalCad.toFixed(2)} CAD</span>
          )}
          {/* Next to the total rather than in the top bar: the export is about
              the stack, and the stack is here. The top bar is also already
              carrying a set picker, a torch and a close at 375px wide. */}
          {history.length > 0 && (
            <button
              type="button"
              className={styles.stripExport}
              onClick={() => onExport()}
              title="Download these scans as a spreadsheet"
            >
              Export
            </button>
          )}
        </span>
      </div>
      {history.length === 0 ? (
        <p className={styles.stripEmpty}>Scanned cards collect here.</p>
      ) : (
        <div className={styles.stripRow}>
          {history.map((entry) => (
            <button
              key={`${entry.at}-${entry.name}`}
              type="button"
              className={styles.stripItem}
              onClick={() => onPick(entry)}
              title={`${entry.name} — ${entry.setName}`}
            >
              {entry.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.stripArt} src={entry.imageUrl} alt={entry.name} />
              ) : (
                <span className={styles.stripArtEmpty} aria-hidden="true" />
              )}
              {/* Rounding to whole dollars printed "$0" on a 39-cent card,
                  which reads as free rather than as cheap. Under ten dollars
                  the cents are the information. */}
              <span className={styles.stripPrice}>
                {entry.marketCad === null
                  ? "—"
                  : entry.marketCad < 10
                    ? `$${entry.marketCad.toFixed(2)}`
                    : `$${Math.round(entry.marketCad)}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ScanSheet({
  loading,
  error,
  result,
  ambiguous,
  entry,
  onGrade,
  onScanAnother,
  onDone,
}: {
  loading: boolean;
  error: string | null;
  result: LookupResponse | null;
  /** The artwork was recognised but the printing was not — a reprint. */
  ambiguous: boolean;
  /** The stored scan this sheet is showing, when opened from the strip. */
  entry: ScanHistoryEntry | null;
  onGrade: (condition: Condition) => void;
  onScanAnother: () => void;
  onDone: () => void;
}) {
  const matches = result?.matches ?? [];
  const top = matches[0] ?? null;
  const extra = Math.max(0, (result?.total ?? 0) - 1);

  // What the printings on screen are worth, for a scan that could not pick one.
  // A range is the honest summary; a single figure would be a guess wearing a
  // decimal point.
  const priced = matches
    .map((m) => m.marketCad)
    .filter((v): v is number => typeof v === "number");
  const low = priced.length ? Math.min(...priced) : null;
  const high = priced.length ? Math.max(...priced) : null;
  const unresolved = ambiguous && extra > 0;

  return (
    <div className={styles.sheet} role="dialog" aria-modal="false" aria-live="polite">
      <div className={styles.sheetInner}>
        {loading && (
          <p className={styles.sheetStatus}>
            <span className={styles.sheetSpinner} aria-hidden="true" />
            Got it — looking up the price…
          </p>
        )}

        {!loading && error && <p className={styles.sheetError}>{error}</p>}

        {!loading && !error && !top && (
          <p className={styles.sheetStatus}>
            Recognised the card but found no match. Try the name instead.
          </p>
        )}

        {!loading && top && (
          <>
            <div className={styles.sheetCard}>
              {top.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.sheetArt} src={top.imageUrl} alt={top.name} />
              ) : (
                <div className={styles.sheetArtEmpty} aria-hidden="true" />
              )}
              <div className={styles.sheetBody}>
                <h2 className={styles.sheetName}>{top.name}</h2>
                <p className={styles.sheetMeta}>
                  {unresolved
                    ? `${extra + 1} printings — check the collector number`
                    : `${top.setName}${top.collectorNumber ? ` · #${top.collectorNumber}` : ""}`}
                </p>
                <p className={styles.sheetPrice}>
                  {unresolved && low !== null && high !== null ? (
                    <>
                      <strong>
                        {low === high
                          ? `$${low.toFixed(2)} CAD`
                          : `$${low.toFixed(2)} – $${high.toFixed(2)} CAD`}
                      </strong>
                      <span className={styles.sheetPriceNote}>depends on the printing</span>
                    </>
                  ) : top.marketCad !== null ? (
                    <>
                      <strong>${top.marketCad.toFixed(2)} CAD</strong>
                      <span className={styles.sheetPriceNote}>market reference</span>
                    </>
                  ) : (
                    <span className={styles.sheetPriceNote}>No market price published</span>
                  )}
                </p>
                {/* The Canadian listing is the reason this site exists, so it
                    outranks the US reference above when there is one. */}
                {top.listings.length > 0 && (
                  <p className={styles.sheetListing}>
                    ${top.listings[0].price.toFixed(2)} at {top.listings[0].retailer}
                    {top.listings[0].inStock ? "" : " (out of stock)"}
                  </p>
                )}
              </div>
            </div>

            {/* Grading belongs here rather than in the strip: the strip is
                thumbnails at a glance, and this is the moment someone is
                actually looking at one card and deciding about it. */}
            {entry && top.marketCad !== null && (
              <div className={styles.grade}>
                <div className={styles.gradeRow} role="group" aria-label="Condition">
                  {CONDITIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={CONDITION_LABELS[c]}
                      aria-pressed={conditionOf(entry) === c}
                      className={`${styles.gradeBtn} ${
                        conditionOf(entry) === c ? styles.gradeBtnOn : ""
                      }`}
                      onClick={() => onGrade(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <p className={styles.gradeNote}>
                  {conditionOf(entry) === "NM" ? (
                    <>Market prices are for Near Mint. Grade it to adjust.</>
                  ) : (
                    <>
                      {CONDITION_LABELS[conditionOf(entry)]}:{" "}
                      <strong>${(entryValue(entry) ?? 0).toFixed(2)} CAD</strong> estimated —
                      a trade convention, not a quote.
                    </>
                  )}
                </p>
              </div>
            )}

            {extra > 0 && (
              <p className={styles.sheetMore}>
                {unresolved
                  ? "Several printings share this artwork, so the picture cannot tell them apart. The number on the card decides — all of them are listed below."
                  : `${extra} other printing${extra === 1 ? "" : "s"} below — their prices can differ by a lot.`}
              </p>
            )}
          </>
        )}

        <div className={styles.sheetActions}>
          {/* "Keep scanning", not "Scan another": scanning never stopped. The
              sheet is a detail view opened by tapping a card, so this dismisses
              it rather than restarting anything. */}
          <button type="button" className={styles.sheetPrimary} onClick={onScanAnother}>
            Keep scanning
          </button>
          <button type="button" className={styles.sheetSecondary} onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
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
