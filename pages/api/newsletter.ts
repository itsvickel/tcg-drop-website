import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { rateLimit, getClientIp } from "../../lib/rateLimit";

export type Subscriber = {
  id: string;
  email: string;
  subscribed_at: string;
  active: boolean;
  preferences?: { preorders: boolean; weekly_drops: boolean };
};

type SubsFile = { subscribers: Subscriber[] };

const REPO      = process.env.ALERT_GITHUB_REPO ?? "itsvickel/tcg-drop-alert";
const TOKEN     = process.env.ALERT_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
const FILE_PATH = "newsletter_subscribers.json";
const BRANCH    = "main";
const API_BASE  = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

async function readSubs(): Promise<{ data: SubsFile; sha: string }> {
  const raw = await fetch(API_BASE, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.raw+json" },
  });
  if (!raw.ok) {
    if (raw.status === 404) return { data: { subscribers: [] }, sha: "" };
    throw new Error(`GitHub read failed: ${raw.status}`);
  }
  const text = await raw.text();
  const meta = await fetch(API_BASE, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.v3+json" },
  });
  const { sha } = await meta.json() as { sha: string };
  return { data: JSON.parse(text) as SubsFile, sha };
}

async function writeSubs(data: SubsFile, sha: string): Promise<void> {
  const content = Buffer.from(JSON.stringify(data, null, 2) + "\n").toString("base64");
  const res = await fetch(API_BASE, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: sha ? "chore: update newsletter subscribers" : "chore: create newsletter_subscribers.json",
      content,
      sha: sha || undefined,
      branch: BRANCH,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub write failed: ${res.status} — ${err.slice(0, 200)}`);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!TOKEN) return res.status(500).json({ error: "ALERT_GITHUB_TOKEN not configured" });

  const ip = getClientIp(req);
  const { allowed, retryAfterMs } = rateLimit(ip);
  if (!allowed) {
    res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
    return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  }

  try {
    if (req.method === "POST") {
      const { email, preferences } = req.body as {
        email?: string;
        preferences?: { preorders?: boolean; weekly_drops?: boolean };
      };
      if (!email) return res.status(400).json({ error: "Missing email" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Invalid email address" });
      }

      const prefs = {
        preorders:    preferences?.preorders    ?? true,
        weekly_drops: preferences?.weekly_drops ?? true,
      };

      const { data, sha } = await readSubs();
      const existing = data.subscribers.find((s) => s.email === email);
      if (existing) {
        existing.preferences = prefs;
        if (existing.active) {
          await writeSubs(data, sha);
          return res.status(200).json({ id: existing.id, already: true });
        }
        existing.active = true;
        await writeSubs(data, sha);
        return res.status(200).json({ id: existing.id, reactivated: true });
      }

      const sub: Subscriber = {
        id: randomUUID(),
        email,
        subscribed_at: new Date().toISOString(),
        active: true,
        preferences: prefs,
      };
      data.subscribers.push(sub);
      await writeSubs(data, sha);
      return res.status(201).json({ id: sub.id, message: "Subscribed" });
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (typeof id !== "string") return res.status(400).json({ error: "Missing id" });
      const { data, sha } = await readSubs();
      const sub = data.subscribers.find((s) => s.id === id);
      if (!sub) return res.status(404).json({ error: "Subscriber not found" });
      sub.active = false;
      await writeSubs(data, sha);
      return res.status(200).json({ message: "Unsubscribed" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/newsletter]", msg);
    return res.status(500).json({ error: msg });
  }
}
