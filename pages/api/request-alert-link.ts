import type { NextApiRequest, NextApiResponse } from "next";
import { createToken, tokensConfigured } from "../../lib/authToken";
import { SITE_URL } from "../../lib/siteUrl";
import { rateLimit } from "../../lib/rateLimit";

/**
 * Emails a short-lived signed link for managing your own alerts.
 *
 * Replaces "type any email, see its alerts". The reply is deliberately
 * identical whether or not the address is registered, and the link is only ever
 * delivered by email — so this endpoint cannot be used to discover who has an
 * account.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same wording on every path, so nothing distinguishes a hit from a miss.
const NEUTRAL = { ok: true, message: "If that address has alerts, a link is on its way." };

async function sendLink(email: string, url: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const from = process.env.RESEND_FROM ?? "The Mana Cafe <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: email,
      subject: "Your The Mana Cafe alerts link",
      html: `
        <p>Here is your link to view and manage your The Mana Cafe alerts:</p>
        <p><a href="${url}">Manage my alerts</a></p>
        <p style="color:#6e7681;font-size:13px">
          This link works for 24 hours and only for ${email}.
          If you didn't ask for it, you can ignore this email — nothing has changed.
        </p>`,
    }),
  });
  return res.ok;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!tokensConfigured()) {
    console.error("[request-alert-link] ALERT_TOKEN_SECRET is not configured");
    return res.status(500).json({ error: "Alert links are not configured" });
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Valid email required" });

  // Keyed on the address rather than the caller's IP, so this cannot be used to
  // mailbomb someone from many sources. A throttled request still gets NEUTRAL,
  // because a distinct "slow down" reply would itself confirm the address.
  if (!rateLimit(`alert-link:${email.toLowerCase()}`).allowed) {
    return res.status(200).json(NEUTRAL);
  }

  const token = createToken(email);
  const url = `${SITE_URL}/alerts?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

  try {
    const sent = await sendLink(email, url);
    if (!sent) console.error("[request-alert-link] send failed for a request");
  } catch (err) {
    console.error("[request-alert-link] send threw:", err);
  }

  // Always the same reply: a failure here must not reveal anything either.
  return res.status(200).json(NEUTRAL);
}
