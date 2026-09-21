import type { NextApiRequest, NextApiResponse } from "next";
import { getTcgConfig } from "../../lib/tcg.config";
import { fetchGameData } from "../../lib/dataFetcher";
import { TBA_DATE, type RawCalendarResponse } from "../../lib/calendar";
import { SITE_URL } from "../../lib/siteUrl";

/**
 * Subscribable release calendar.
 *
 * The calendar page holds dates and confidence but had no way out of the
 * browser. A webcal subscription puts those dates in someone's actual calendar
 * app and keeps them there — the release moves, their calendar updates, and the
 * site stays useful without being visited.
 *
 * Confidence travels with the event rather than being dropped: an entry we are
 * unsure about says so in its title, because a calendar entry reads as a
 * commitment and most of these are not.
 */

const CRLF = "\r\n";

/** Escape per RFC 5545: backslash, semicolon, comma, and newlines. */
function esc(text: string): string {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold to 75 octets per line, as the spec requires for wide client support. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) parts.push(" " + rest);
  return parts.join(CRLF);
}

const CONFIDENCE_PREFIX: Record<string, string> = {
  confirmed: "",
  tentative: "(tentative) ",
  tba: "(date TBA) ",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const tcgParam = typeof req.query.tcg === "string" ? req.query.tcg : "pokemon";
  let config;
  try {
    config = getTcgConfig(tcgParam);
  } catch {
    return res.status(400).send("Invalid tcg parameter");
  }

  try {
    const raw = await fetchGameData<RawCalendarResponse>(config.githubDataPath, "release_calendar.json");
    const sets = (raw?.sets ?? []).filter((s) => s.release_date && s.release_date !== TBA_DATE);

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//The Mana Cafe//Release Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${esc(config.displayName)} Releases`,
      `X-WR-CALDESC:${esc(`${config.displayName} set release dates from The Mana Cafe`)}`,
      // Most clients only re-poll on their own schedule; this is a hint.
      "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
      "X-PUBLISHED-TTL:PT12H",
    ];

    for (const set of sets) {
      const date = set.release_date.replace(/-/g, "");
      const confidence = set.date_confidence ?? "confirmed";
      const prefix = CONFIDENCE_PREFIX[confidence] ?? "";
      // Stable UID so an edited date updates the existing entry rather than
      // creating a duplicate in the subscriber's calendar.
      const uid = `${config.slug}-${set.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@tcgdrop`;

      const description = [
        set.series ? `Series: ${set.series}` : "",
        `Confidence: ${confidence}`,
        set.products?.length ? `${set.products.length} products tracked` : "",
        `${SITE_URL}/calendar?tcg=${config.slug}`,
      ].filter(Boolean).join("\\n");

      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${date}T000000Z`,
        `DTSTART;VALUE=DATE:${date}`,
        fold(`SUMMARY:${esc(prefix + set.name)}`),
        fold(`DESCRIPTION:${description}`),
        fold(`URL:${SITE_URL}/calendar?tcg=${config.slug}`),
        // A tentative date should not look like a firm commitment.
        confidence === "confirmed" ? "STATUS:CONFIRMED" : "STATUS:TENTATIVE",
        "TRANSP:TRANSPARENT",
        "END:VEVENT"
      );
    }

    lines.push("END:VCALENDAR");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${config.slug}-releases.ics"`);
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(lines.join(CRLF) + CRLF);
  } catch (err) {
    console.error(`[calendar.ics] ${config.slug} failed:`, err);
    return res.status(503).send("Calendar temporarily unavailable");
  }
}
