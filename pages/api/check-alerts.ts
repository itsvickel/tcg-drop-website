/**
 * /api/check-alerts — Vercel cron endpoint (see vercel.json).
 *
 * Reads active price alerts from Supabase `user_alerts`, compares them
 * against the latest product feed, sends trigger emails via Resend, and
 * stamps last_triggered so each alert fires at most once per cooldown.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getServiceSupabase } from "../../lib/supabase";
import { loadApiResponse } from "../../lib/serverProducts";
import { SITE_URL } from "../../lib/siteUrl";
import { createToken } from "../../lib/authToken";
import { getTcgConfig, TCG_CONFIGS } from "../../lib/tcg.config";
import { evaluateAlerts, type EvalAlert, type EvalProduct, type TriggeredAlert } from "../../lib/alertEval";

const COOLDOWN_HOURS = 24;

/**
 * A signed link, so the recipient can open their alerts without the endpoint
 * having to trust an email address supplied by whoever asks.
 */
function manageUrl(email: string, siteBase: string): string {
  const token = createToken(email);
  return `${siteBase}/alerts?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
}

// A restock is not a price alert, and a subject line that says otherwise
// trains people to ignore the ones that matter.
const SUBJECTS: Record<string, string> = {
  price: "Price alert",
  percent: "Price drop",
  restock: "Back in stock",
  any_low: "Lowest price yet",
};

async function sendAlertEmail(hit: TriggeredAlert, siteBase: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const from = process.env.RESEND_FROM ?? "The Mana Cafe <onboarding@resend.dev>";
  const { alert, product } = hit;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: alert.email,
      subject: `${SUBJECTS[alert.kind ?? "price"]}: ${product.name.slice(0, 60)} — ${product.price.toFixed(2)} CAD`,
      html: `
        <p><strong>${product.name}</strong> is <strong>${hit.reason}</strong>
        at ${product.retailer}.</p>
        <p><a href="${product.url}">Buy now at ${product.retailer}</a></p>
        <p style="color:#888;font-size:12px">
          Manage alerts: <a href="${manageUrl(alert.email, siteBase)}">${siteBase}/alerts</a>
        </p>`,
    }),
  });
  return res.ok;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const db = getServiceSupabase();
  if (!db) {
    return res.status(200).json({ skipped: "Supabase service credentials not configured" });
  }

  const { data: alertRows, error } = await db
    .from("user_alerts")
    // kind/percent/baseline_price/was_in_stock arrive with migration 004. Postgrest
    // errors on unknown columns, so a deployment running against an older schema
    // falls back to the original set and every alert behaves as a price alert.
    .select("id, tcg, group_key, product_name, email, threshold, active, last_triggered, kind, percent, baseline_price, was_in_stock")
    .eq("active", true);

  // Typed loosely because the two selects return different column sets.
  let rows: unknown[] | null = alertRows;
  if (error) {
    // Older schema without the alert-kind columns: retry with the original set
    // rather than failing the whole cron.
    const legacy = await db
      .from("user_alerts")
      .select("id, tcg, group_key, product_name, email, threshold, active, last_triggered")
      .eq("active", true);
    if (legacy.error) {
      return res.status(500).json({ error: `Supabase read failed: ${legacy.error.message}` });
    }
    console.warn("[check-alerts] alert-kind columns missing; run migration 004");
    rows = legacy.data;
  }

  const alerts = (rows ?? []) as unknown as EvalAlert[];
  if (alerts.length === 0) {
    return res.status(200).json({ checked: 0, triggered: 0 });
  }

  // Load each game's feed once
  const tcgs = Array.from(new Set(alerts.map((a) => a.tcg))).filter((t) => t in TCG_CONFIGS);
  const productsByTcg = new Map<string, Map<string, EvalProduct>>();
  for (const tcg of tcgs) {
    try {
      const feed = await loadApiResponse(getTcgConfig(tcg));
      productsByTcg.set(
        tcg,
        new Map(feed.products.map((p) => [p.group_key, {
          group_key: p.group_key,
          name: p.name,
          price: p.price,
          retailer: p.retailer,
          url: p.url,
          in_stock: p.in_stock,
          // Needed by the "lowest tracked price" kind, and by the history
          // guard that stops a three-day low being emailed as a low.
          all_time_low: p.all_time_low,
          history_days: p.history_days,
        }]))
      );
    } catch (err) {
      console.error(`[check-alerts] failed loading ${tcg} feed:`, err);
    }
  }

  const now = new Date();
  const siteBase = SITE_URL;
  let triggeredCount = 0;
  let emailFailures = 0;

  for (const [tcg, productsByKey] of productsByTcg) {
    const gameAlerts = alerts.filter((a) => a.tcg === tcg);
    const hits = evaluateAlerts(gameAlerts, productsByKey, now, COOLDOWN_HOURS);

    for (const hit of hits) {
      const sent = await sendAlertEmail(hit, siteBase);
      if (!sent) {
        emailFailures++;
        continue;
      }
      triggeredCount++;
      const { error: updateError } = await db
        .from("user_alerts")
        .update({ last_triggered: now.toISOString() })
        .eq("id", hit.alert.id);
      if (updateError) {
        console.error(`[check-alerts] failed stamping ${hit.alert.id}:`, updateError.message);
      }
    }
  }

  return res.status(200).json({
    checked: alerts.length,
    triggered: triggeredCount,
    emailFailures,
  });
}
