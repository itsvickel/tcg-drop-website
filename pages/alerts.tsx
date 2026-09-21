import { useEffect, useState } from "react";
import { ALERT_CHECK_CADENCE } from "../lib/siteFacts";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import type { ManageAlertsResponse } from "./api/manage-alerts";
import styles from "../styles/Alerts.module.css";

type State = "idle" | "loading" | "loaded" | "error" | "sent";

async function deleteAlert(type: "price" | "restock" | "newsletter", id: string): Promise<void> {
  const endpoint = type === "newsletter" ? `/api/newsletter?id=${id}` : type === "price" ? `/api/subscribe?id=${id}` : `/api/restock?id=${id}`;
  const res = await fetch(endpoint, { method: "DELETE" });
  if (!res.ok) {
    const d = await res.json() as { error?: string };
    throw new Error(d.error ?? `Error ${res.status}`);
  }
}

export default function AlertsPage() {
  const router = useRouter();
  const [email,   setEmail]   = useState("");
  const [state,   setState]   = useState<State>("idle");
  const [data,    setData]    = useState<ManageAlertsResponse | null>(null);
  const [errMsg,  setErrMsg]  = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editThreshold, setEditThreshold] = useState("");

  // Arriving from an emailed link: load straight away.
  useEffect(() => {
    if (!router.isReady) return;
    const qEmail = typeof router.query.email === "string" ? router.query.email : "";
    const qToken = typeof router.query.token === "string" ? router.query.token : "";
    if (!qEmail || !qToken) return;
    setEmail(qEmail);
    void loadWithToken(qEmail, qToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  async function loadWithToken(addr: string, token: string) {
    setState("loading");
    setErrMsg("");
    try {
      const res = await fetch(
        `/api/manage-alerts?email=${encodeURIComponent(addr)}&token=${encodeURIComponent(token)}`
      );
      const json = (await res.json()) as ManageAlertsResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      setData(json);
      setState("loaded");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  /**
   * Requests an emailed link rather than showing alerts for any address typed
   * in. The old flow returned a person's full alert state to anyone who guessed
   * their email, which made the page an enumeration tool.
   */
  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("loading");
    setErrMsg("");
    try {
      const res = await fetch("/api/request-alert-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      setState("sent");
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

  async function handleEditSave(alertItem: { id: string; group_key: string; product_name: string }) {
    const newThreshold = parseFloat(editThreshold);
    if (isNaN(newThreshold) || newThreshold <= 0) return;
    setDeleting(alertItem.id);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_key:    alertItem.group_key,
          product_name: alertItem.product_name,
          email:        email.trim(),
          threshold:    newThreshold,
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `Error ${res.status}`);
      }
      if (data) {
        setData({
          ...data,
          price_alerts: data.price_alerts.map(a =>
            a.id === alertItem.id ? { ...a, threshold: newThreshold } : a
          ),
        });
      }
      setEditingId(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to update");
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
        <title>Manage Alerts — The Mana Cafe</title>
        <meta name="description" content="View and manage your price alerts and newsletter subscriptions" />
      </Head>

      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.backLink}>← Back to tracker</Link>
          <h1 className={styles.title}>Manage Alerts</h1>
          <p className={styles.subtitle}>
            View and remove your price alerts, restock notifications, and
            newsletter subscription. Prices and stock are checked{" "}
            {ALERT_CHECK_CADENCE}.
          </p>
        </header>

        {state !== "loaded" && (
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
            {state === "loading" ? "Sending…" : "Email me a link"}
          </button>
        </form>
        )}

        {state === "sent" && (
          <p className={styles.sentMsg}>
            If that address has alerts, a link is on its way. It works for 24 hours.
          </p>
        )}

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
                            {editingId === a.id ? (
                              <div className={styles.editRow}>
                                <span className={styles.editLabel}>Notify below $</span>
                                <input
                                  className={styles.editInput}
                                  type="number"
                                  min="1"
                                  max="9999"
                                  step="0.01"
                                  value={editThreshold}
                                  onChange={(e) => setEditThreshold(e.target.value)}
                                  disabled={deleting === a.id}
                                  // eslint-disable-next-line jsx-a11y/no-autofocus
                                  autoFocus
                                />
                                <span className={styles.editCad}>CAD</span>
                              </div>
                            ) : (
                              <>
                                <span className={styles.alertDetail}>
                                  Alert when price drops below <strong>${a.threshold.toFixed(2)} CAD</strong>
                                </span>
                                {a.last_triggered && (
                                  <span className={styles.alertMeta}>
                                    Last triggered: {new Date(a.last_triggered).toLocaleDateString("en-CA")}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                          {editingId === a.id ? (
                            <div className={styles.editActions}>
                              <button
                                className={styles.saveBtn}
                                onClick={() => { void handleEditSave(a); }}
                                disabled={deleting === a.id || !editThreshold}
                                type="button"
                              >
                                {deleting === a.id ? "…" : "Save"}
                              </button>
                              <button
                                className={styles.cancelBtn}
                                onClick={() => setEditingId(null)}
                                disabled={deleting === a.id}
                                type="button"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className={styles.editActions}>
                              <button
                                className={styles.editBtn}
                                onClick={() => { setEditingId(a.id); setEditThreshold(String(a.threshold)); }}
                                disabled={!!deleting}
                                type="button"
                              >
                                Edit
                              </button>
                              <button
                                className={styles.deleteBtn}
                                onClick={() => { void handleDelete("price", a.id, a.product_name); }}
                                disabled={deleting === a.id}
                                type="button"
                              >
                                {deleting === a.id ? "…" : "Remove"}
                              </button>
                            </div>
                          )}
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
