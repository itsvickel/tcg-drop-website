import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { rateLimit, getClientIp } from "../../lib/rateLimit";

export type RestockAlert = {
  id: string;
  group_key: string;
  product_name: string;
  email: string;
  created_at: string;
  active: boolean;
  notified_at: string | null;
};

type RestockFile = { alerts: RestockAlert[] };

const REPO      = process.env.ALERT_GITHUB_REPO ?? "itsvickel/pokemon-drop-alert";
const TOKEN     = process.env.ALERT_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
const FILE_PATH = "restock_alerts.json";
const BRANCH    = "main";
const API_BASE  = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

async function readAlerts(): Promise<{ data: RestockFile; sha: string }> {
  const raw = await fetch(API_BASE, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.raw+json" },
  });
  if (!raw.ok) {
    if (raw.status === 404) return { data: { alerts: [] }, sha: "" };
    throw new Error(`GitHub read failed: ${raw.status}`);
  }
  const text = await raw.text();
  const meta = await fetch(API_BASE, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.v3+json" },
  });
  const { sha } = await meta.json() as { sha: string };
  return { data: JSON.parse(text) as RestockFile, sha };
}

async function writeAlerts(data: RestockFile, sha: string): Promise<void> {
  const content = Buffer.from(JSON.stringify(data, null, 2) + "\n").toString("base64");
  const res = await fetch(API_BASE, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: sha ? "chore: update restock alerts" : "chore: create restock_alerts.json",
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
      const { group_key, product_name, email } = req.body as {
        group_key?: string; product_name?: string; email?: string;
      };
      if (!group_key || !product_name || !email) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Invalid email address" });
      }

      const { data, sha } = await readAlerts();
      const existing = data.alerts.find(
        (a) => a.active && a.email === email && a.group_key === group_key
      );
      if (existing) return res.status(200).json({ id: existing.id, already: true });

      const alert: RestockAlert = {
        id: randomUUID(),
        group_key,
        product_name,
        email,
        created_at: new Date().toISOString(),
        active: true,
        notified_at: null,
      };
      data.alerts.push(alert);
      await writeAlerts(data, sha);
      return res.status(201).json({ id: alert.id, message: "Restock alert created" });
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (typeof id !== "string") return res.status(400).json({ error: "Missing id" });
      const { data, sha } = await readAlerts();
      const alert = data.alerts.find((a) => a.id === id);
      if (!alert) return res.status(404).json({ error: "Alert not found" });
      alert.active = false;
      await writeAlerts(data, sha);
      return res.status(200).json({ message: "Unsubscribed" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/restock]", msg);
    return res.status(500).json({ error: msg });
  }
}
