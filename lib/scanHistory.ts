/**
 * scanHistory.ts — the cards you have scanned, kept on the device.
 *
 * Scanning is not a one-card activity. People go through a stack, and until now
 * each result replaced the last with no way back: notice afterwards that the
 * third card was the valuable one and your only option was to find it again and
 * re-scan it.
 *
 * Kept in localStorage rather than on a server, because it is a per-viewer
 * convenience and nothing here is worth an account. That means it can be
 * absent, full, or throw outright — a private window, blocked site data, a
 * quota that is already spent — so every access is guarded and every failure
 * degrades to "no history" rather than to a broken page.
 *
 * Entries carry enough to redraw the row without asking the server anything,
 * and enough to re-run the lookup when one is tapped. Prices are a snapshot
 * from when the scan happened and are labelled as such in the UI; re-running
 * the lookup is what refreshes them.
 */

export type ScanHistoryEntry = {
  /** The fingerprint that matched, when the artwork identified one printing. */
  hash?: string;
  /** The tied fingerprints, when it identified the artwork but not the printing. */
  hashes?: string[];
  /** What to search for when neither is available — an OCR reading. */
  query?: string;
  tcg: string;
  name: string;
  setName: string;
  collectorNumber: string;
  imageUrl: string;
  /** Market reference in CAD at the time of the scan, if there was one. */
  marketCad: number | null;
  /** Epoch milliseconds. */
  at: number;
};

const KEY = "tcgdrop.scanHistory.v1";

/**
 * How many scans to keep.
 *
 * Enough to cover a sitting with a binder, small enough that the whole list
 * stays cheap to parse on every page load and cannot grow into the storage
 * quota — each entry is a few hundred bytes, so this is well under 50KB.
 */
export const MAX_HISTORY = 60;

/** A stable identity for a scan, so the same card does not stack up. */
export function entryKey(entry: ScanHistoryEntry): string {
  return entry.hash ?? entry.hashes?.join(",") ?? `${entry.tcg}:${entry.query ?? entry.name}`;
}

function isEntry(value: unknown): value is ScanHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.tcg === "string" &&
    typeof e.name === "string" &&
    typeof e.at === "number" &&
    Number.isFinite(e.at)
  );
}

/**
 * Everything stored, newest first.
 *
 * Anything unreadable is treated as an empty history rather than repaired.
 * This is a convenience list; there is nothing here worth risking a crash on a
 * page whose actual job is to price a card.
 */
export function loadHistory(storage?: Storage): ScanHistoryEntry[] {
  const store = storage ?? safeStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

/**
 * Add a scan, and return the list as it now stands.
 *
 * Re-scanning a card moves it to the top rather than adding a second row —
 * going over the same card twice is how people check they read it right, and
 * two identical rows would be noise. The returned list is what the caller
 * should render, so a failed write still leaves the UI correct for this
 * session even when nothing was persisted.
 */
export function addToHistory(
  entry: ScanHistoryEntry,
  storage?: Storage
): ScanHistoryEntry[] {
  const store = storage ?? safeStorage();
  const key = entryKey(entry);
  const next = [entry, ...loadHistory(store ?? undefined).filter((e) => entryKey(e) !== key)]
    .slice(0, MAX_HISTORY);

  if (store) {
    try {
      store.setItem(KEY, JSON.stringify(next));
    } catch {
      // Quota, or storage disabled mid-session. The list is still correct in
      // memory for this session, which is the part the user can see.
    }
  }
  return next;
}

/** Forget everything. Returns the empty list, for symmetry with addToHistory. */
export function clearHistory(storage?: Storage): ScanHistoryEntry[] {
  const store = storage ?? safeStorage();
  if (store) {
    try {
      store.removeItem(KEY);
    } catch {
      // Nothing to do; the caller renders the empty list either way.
    }
  }
  return [];
}

/**
 * localStorage, or null where it cannot be used.
 *
 * Accessing it can throw rather than return null — Safari in private mode is
 * the classic, and any browser with site data blocked will do it — so even
 * reaching for the object is wrapped.
 */
function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** "just now", "6 min ago", "3 h ago", "2 d ago". */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
