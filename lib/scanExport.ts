/**
 * scanExport.ts — getting a scanned stack out of the app.
 *
 * Scanning a binder is rarely the point in itself. The point is usually selling
 * it, insuring it, or listing it somewhere, and all of those happen in a
 * spreadsheet. Without an export the scanner is a read-only curiosity: you can
 * see what the stack is worth and then you have to type it all out again.
 *
 * CSV rather than anything cleverer, because it opens in every spreadsheet and
 * imports into most marketplace tools. Both the market price and the graded
 * estimate are included as separate columns, so nobody has to guess which
 * number they are looking at or reverse a multiplier to get back to the
 * reference.
 */

import { CONDITION_MULTIPLIER, CONDITION_LABELS } from "./cardCondition";
import { conditionOf, entryValue, type ScanHistoryEntry } from "./scanHistory";

const COLUMNS = [
  "Name",
  "Set",
  "Number",
  "Game",
  "Condition",
  "Condition label",
  "Condition multiplier",
  "Market CAD",
  "Estimated CAD",
  "Scanned at",
] as const;

/**
 * One CSV field, escaped.
 *
 * Card names contain commas ("Hop's Zacian ex"), quotes, and — in Magic — the
 * `//` of split cards. A field is quoted whenever it contains anything that
 * would otherwise break the row, and embedded quotes are doubled, which is what
 * RFC 4180 asks for and what spreadsheets actually implement.
 */
function field(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** The scanned cards as CSV, newest first. */
export function toCsv(entries: ScanHistoryEntry[]): string {
  const rows = [COLUMNS.join(",")];
  for (const entry of entries) {
    const condition = conditionOf(entry);
    rows.push(
      [
        field(entry.name),
        field(entry.setName),
        field(entry.collectorNumber),
        field(entry.tcg),
        field(condition),
        field(CONDITION_LABELS[condition]),
        field(CONDITION_MULTIPLIER[condition]),
        field(entry.marketCad ?? ""),
        field(entryValue(entry) ?? ""),
        field(new Date(entry.at).toISOString()),
      ].join(",")
    );
  }
  // Trailing newline: without one, some tools drop or mangle the last row.
  return rows.join("\r\n") + "\r\n";
}

/** `tcg-drop-scans-2026-09-21.csv` */
export function csvFilename(now = new Date()): string {
  return `tcg-drop-scans-${now.toISOString().slice(0, 10)}.csv`;
}

/**
 * Hand the CSV to the browser as a download.
 *
 * Separate from `toCsv` so the formatting can be tested without a DOM, which is
 * where the escaping bugs would be. Returns false when there is nothing to
 * export or the browser will not co-operate, so the caller can say so rather
 * than appearing to do nothing.
 */
export function downloadCsv(entries: ScanHistoryEntry[], now = new Date()): boolean {
  if (entries.length === 0) return false;
  try {
    // A BOM, so Excel reads it as UTF-8. Without one it guesses the system
    // codepage and mangles every accented card name — Pokémon, Poké Ball,
    // and most of the French set names.
    const blob = new Blob(["﻿", toCsv(entries)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename(now);
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on a later tick: revoking immediately cancels the download in
    // some browsers before it has started reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}
