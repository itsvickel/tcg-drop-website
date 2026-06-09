import { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import type { ManageAlertsResponse } from "./api/manage-alerts";
import styles from "../styles/Alerts.module.css";

type State = "idle" | "loading" | "loaded" | "error";

async function deleteAlert(type: "price" | "restock" | "newsletter", id: string): Promise<void> {
  const endpoint = type === "newsletter" ? `/api/newsletter?id=${id}` : type === "price" ? `/api/subscribe?id=${id}` : `/api/restock?id=${id}`;
  const res = await fetch(endpoint, { method: "DELETE" });
  if (!res.ok) {
    const d = await res.json() as { error?: string };
    throw new Error(d.error ?? `Error ${res.status}`);
  }
}

export default function AlertsPage() {
  const [email,   setEmail]   = useState("");
  const [state,   setState]   = useState<State>("idle");
  const [data,    setData]    = useState<ManageAlertsResponse | null>(null);
  const [errMsg,  setErrMsg]  = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("loading");
    setErrMsg("");
    try {
      const res = await fetch(`/api/manage-alerts?email=${encodeURIComponent(email.trim())}`);
      const json = await res.json() as ManageAlertsResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      setData(json);
      setState("loaded");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  async function handleDelete(type: "price" | "restock" | "newsletter", id: string, label: string) {
    if (!confirm(`Remove alert for "${label}"?`)) return;
    setDeleting(id);
    try {
      await deleteAlert(type, id);
      if (data) {
        if (type === "price") {
          setData({ ...data, price_alerts: data.price_alerts.filter((a) => a.id !== id) });
        } else if (type === "restock") {
          setData({ ...data, restock_alerts: data.restock_alerts.filter((a) => a.id !== id) });
        } else {
          setData({ ...data, newsletter: data.newsletter ? { ...data.newsletter, subscribed: false } : null });
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(null);
    }
  }

  const totalAlerts = data
    ? data.price_alerts.length + data.restock_alerts.length + (data.newsletter?.subscribed ? 1 : 0)
    : 0;

  return (
    <>
      <Head>
        <title>Manage Alerts — TCG Drop</title>
        <meta name="description" content="View and manage your price alerts and newsletter subscriptions" />
      </Head>

      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.backLink}>← Back to tracker</Link>
          <h1 className={styles.title}>Manage Alerts</h1>
          <p className={styles.subtitle}>View and remove your price alerts, restock notifications, and newsletter subscription</p>
        </header>

        <form className={styles.lookupForm} onSubmit={(e) => { void handleLookup(e); }}>
          <input
            className={styles.emailInput}
            type="email"
            placeholder="Enter your email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={state === "loading"}
            aria-label="Email address"
          />
          <button
            className={styles.lookupBtn}
            type="submit"
            disabled={state === "loading" || !email.trim()}
          >
            {state === "loading" ? "Looking up…" : "Look up alerts"}
          </button>
        </form>

        {state === "error" && <p className={styles.errMsg}>{errMsg}</p>}

        {state === "loaded" && data && (
          <div className={styles.results}>
            {totalAlerts === 0 ? (
              <div className={styles.emptyState}>
                <p className={styles.emptyTitle}>No active alerts</p>
                <p className={styles.emptyHint}>No price alerts, restock alerts, or newsletter subscription found for {email}.</p>
              </div>
            ) : (
              <>
                {data.price_alerts.length > 0 && (
                  <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>Price Alerts ({data.price_alerts.length})</h2>
                    <div className={styles.alertList}>
                      {data.price_alerts.map((a) => (
                        <div key={a.id} className={styles.alertRow}>
                          <div className={styles.alertInfo}>
                            <span className={styles.alertName}>{a.product_name}</span>
                            <span className={styles.alertDetail}>
                              Alert when price drops below <strong>${a.threshold.toFixed(2)} CAD</strong>
                            </span>
                            {a.last_triggered && (
                              <span className={styles.alertMeta}>
                                Last triggered: {new Date(a.last_triggered).toLocaleDateString("en-CA")}
                              </span>
                            )}
                          </div>
                          <button
                            className={styles.deleteBtn}
                            onClick={() => { void handleDelete("price", a.id, a.product_name); }}
                            disabled={deleting === a.id}
                            type="button"
                          >
                            {deleting === a.id ? "…" : "Remove"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {data.restock_alerts.length > 0 && (
                  <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>Restock Alerts ({data.restock_alerts.length})</h2>
                    <div className={styles.alertList}>
                      {data.restock_alerts.map((a) => (
                        <div key={a.id} className={styles.alertRow}>
                          <div className={styles.alertInfo}>
                            <span className={styles.alertName}>{a.product_name}</span>
                            <span className={styles.alertDetail}>Notify when back in stock</span>
                            <span className={styles.alertMeta}>
                              Set on {new Date(a.created_at).toLocaleDateString("en-CA")}
                            </span>
                          </div>
                          <button
                            className={styles.deleteBtn}
                            onClick={() => { void handleDelete("restock", a.id, a.product_name); }}
                            disabled={deleting === a.id}
                            type="button"
                          >
                            {deleting === a.id ? "…" : "Remove"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {data.newsletter && (
                  <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>Newsletter</h2>
                    <div className={styles.alertRow}>
                      <div className={styles.alertInfo}>
                        {data.newsletter.subscribed ? (
                          <>
                            <span className={styles.alertName}>Subscribed</span>
                            <span className={styles.alertDetail}>
                              {data.newsletter.preferences.preorders && data.newsletter.preferences.weekly_drops
                                ? "New preorders + weekly best drops"
                                : data.newsletter.preferences.preorders
                                  ? "New preorders only"
                                  : "Weekly best drops only"}
                            </span>
                          </>
                        ) : (
                          <span className={styles.alertName} style={{ color: "#6e7681" }}>Unsubscribed</span>
                        )}
                      </div>
                      {data.newsletter.subscribed && data.newsletter.id && (
                        <button
                          className={styles.deleteBtn}
                          onClick={() => { void handleDelete("newsletter", data.newsletter!.id!, "newsletter"); }}
                          disabled={deleting === data.newsletter.id}
                          type="button"
                        >
                          {deleting === data.newsletter.id ? "…" : "Unsubscribe"}
                        </button>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
