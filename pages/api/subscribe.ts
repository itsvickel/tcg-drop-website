import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { rateLimit, getClientIp } from "../../lib/rateLimit";

export type Alert = {
  id: string;
  group_key: string;
  product_name: string;
  email: string;
  threshold: number;
  created_at: string;
  last_triggered: string | null;
  active: boolean;
};

type AlertsFile = { alerts: Alert[] };

const REPO       = process.env.ALERT_GITHUB_REPO ?? "itsvickel/pokemon-drop-alert";
const TOKEN      = process.env.ALERT_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
const FILE_PATH  = "alerts.json";
const BRANCH     = "main";
const API_BASE   = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

async function readAlerts(): Promise<{ data: AlertsFile; sha: string }> {
  const res = await fetch(API_BASE, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.raw+json" },
  });
  if (!res.ok) {
    if (res.status === 404) return { data: { alerts: [] }, sha: "" };
    throw new Error(`GitHub read failed: ${res.status}`);
  }
  // raw+json returns the file content directly when Accept header is set
  const text = await res.text();
  // We need the SHA — fetch again without raw to get metadata
  const meta = await fetch(API_BASE, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.v3+json" },
  });
  const metaJson = await meta.json() as { sha: string };
  return { data: JSON.parse(text) as AlertsFile, sha: metaJson.sha };
}

async function writeAlerts(data: AlertsFile, sha: string): Promise<void> {
  const content = Buffer.from(JSON.stringify(data, null, 2) + "\n").toString("base64");
  const res = await fetch(API_BASE, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: sha ? "chore: update alerts" : "chore: create alerts.json",
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
  if (!TOKEN) {
    return res.status(500).json({ error: "ALERT_GITHUB_TOKEN not configured" });
  }

  const ip = getClientIp(req);
  const { allowed, retryAfterMs } = rateLimit(ip);
  if (!allowed) {
    res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
    return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  }

  // POST — subscribe
  if (req.method === "POST") {
    const { group_key, product_name, email, threshold } = req.body as {
      group_key?: string; product_name?: string; email?: string; threshold?: number;
    };

    if (!group_key || !product_name || !email || threshold == null) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    if (threshold <= 0 || threshold > 10_000) {
      return res.status(400).json({ error: "Invalid threshold" });
    }

    const { data, sha } = await readAlerts();

    // Prevent duplicate subscriptions for same email+product
    const duplicate = data.alerts.find(
      (a) => a.active && a.email === email && a.group_key === group_key
    );
    if (duplicate) {
      // Update threshold instead of creating a new alert
      duplicate.threshold = threshold;
      await writeAlerts(data, sha);
      return res.status(200).json({ id: duplicate.id, updated: true });
    }

    const alert: Alert = {
      id: randomUUID(),
      group_key,
      product_name,
      email,
      threshold,
      created_at: new Date().toISOString(),
      last_triggered: null,
      active: true,
    };

    data.alerts.push(alert);
    await writeAlerts(data, sha);
    return res.status(201).json({ id: alert.id, message: "Alert created" });
  }

  // DELETE — unsubscribe by id
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
}
