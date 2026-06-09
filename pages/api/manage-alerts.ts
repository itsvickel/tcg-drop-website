import type { NextApiRequest, NextApiResponse } from "next";
import type { Alert } from "./subscribe";
import type { Subscriber } from "./newsletter";
import type { RestockAlert } from "./restock";

const REPO  = process.env.ALERT_GITHUB_REPO ?? "itsvickel/tcg-drop-alert";
const TOKEN = process.env.ALERT_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "";

async function readFile<T>(fileName: string): Promise<T | null> {
  const url = `https://api.github.com/repos/${REPO}/contents/${fileName}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.raw+json" },
  });
  if (!res.ok) return null;
  const text = await res.text();
  return JSON.parse(text) as T;
}

export type ManageAlertsResponse = {
  price_alerts: Alert[];
  restock_alerts: RestockAlert[];
  newsletter: { subscribed: boolean; id: string | null; preferences: { preorders: boolean; weekly_drops: boolean } } | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!TOKEN) return res.status(500).json({ error: "ALERT_GITHUB_TOKEN not configured" });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { email } = req.query;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Valid email required" });
  }

  try {
    const [alertsFile, restockFile, subsFile] = await Promise.all([
      readFile<{ alerts: Alert[] }>("alerts.json"),
      readFile<{ alerts: RestockAlert[] }>("restock_alerts.json"),
      readFile<{ subscribers: Subscriber[] }>("newsletter_subscribers.json"),
    ]);

    const priceAlerts = (alertsFile?.alerts ?? []).filter(
      (a) => a.active && a.email.toLowerCase() === email.toLowerCase()
    );
    const restockAlerts = (restockFile?.alerts ?? []).filter(
      (a) => a.active && a.email.toLowerCase() === email.toLowerCase()
    );
    const sub = (subsFile?.subscribers ?? []).find(
      (s) => s.email.toLowerCase() === email.toLowerCase()
    );

    const response: ManageAlertsResponse = {
      price_alerts: priceAlerts,
      restock_alerts: restockAlerts,
      newsletter: sub
        ? {
            subscribed: sub.active,
            id: sub.id,
            preferences: sub.preferences ?? { preorders: true, weekly_drops: true },
          }
        : null,
    };

    return res.status(200).json(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
}
