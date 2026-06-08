import { useState } from "react";
import styles from "../styles/NewsletterSignup.module.css";

type State = "idle" | "loading" | "success" | "error";

export default function NewsletterSignup() {
  const [open,        setOpen]        = useState(false);
  const [email,       setEmail]       = useState("");
  const [state,       setState]       = useState<State>("idle");
  const [error,       setError]       = useState("");
  const [preorders,   setPreorders]   = useState(true);
  const [weeklyDrops, setWeeklyDrops] = useState(true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    if (!preorders && !weeklyDrops) {
      setError("Please select at least one email type.");
      setState("error");
      return;
    }
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          preferences: { preorders, weekly_drops: weeklyDrops },
        }),
      });
      const data = await res.json() as { error?: string; already?: boolean };
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`);
        setState("error");
      } else {
        setState("success");
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setState("error");
    }
  }

  function closeModal() {
    setOpen(false);
    if (state !== "success") {
      setState("idle");
      setError("");
    }
  }

  return (
    <>
      {/* Compact trigger row */}
      <div className={styles.trigger}>
        <span className={styles.triggerText}>
          🔔 Get notified — new preorders &amp; best weekly drops
        </span>
        <button
          className={styles.triggerBtn}
          type="button"
          onClick={() => setOpen(true)}
        >
          Subscribe →
        </button>
        <a href="/digest" className={styles.triggerLink}>
          Preview deals →
        </a>
      </div>

      {/* Modal */}
      {open && (
        <div className={styles.overlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button className={styles.closeBtn} onClick={closeModal} type="button" aria-label="Close">✕</button>

            {state === "success" ? (
              <div className={styles.successBox}>
                <span className={styles.successIcon}>✓</span>
                <div>
                  <p className={styles.successTitle}>You&apos;re subscribed!</p>
                  <p className={styles.successText}>
                    {preorders && weeklyDrops
                      ? "We'll email you new preorders and weekly best drops."
                      : preorders
                        ? "We'll email you when new preorders drop."
                        : "We'll send you the weekly best deals."}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <h3 className={styles.modalTitle}>🔔 Get Notified</h3>
                <p className={styles.modalDesc}>
                  New preorders &amp; best weekly drops, straight to your inbox.{" "}
                  <a href="/digest" className={styles.digestLink} onClick={closeModal}>
                    Preview this week&apos;s deals →
                  </a>
                </p>
                <form className={styles.form} onSubmit={(e) => { void handleSubmit(e); }}>
                  <input
                    className={styles.input}
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={state === "loading"}
                    aria-label="Email address"
                    autoFocus
                  />
                  <button
                    className={styles.btn}
                    type="submit"
                    disabled={state === "loading" || !email.trim()}
                  >
                    {state === "loading" ? "Subscribing…" : "Subscribe"}
                  </button>
                </form>
                <div className={styles.prefs}>
                  <label className={styles.prefCheck}>
                    <input
                      type="checkbox"
                      checked={preorders}
                      onChange={(e) => setPreorders(e.target.checked)}
                      disabled={state === "loading"}
                    />
                    New preorders
                  </label>
                  <label className={styles.prefCheck}>
                    <input
                      type="checkbox"
                      checked={weeklyDrops}
                      onChange={(e) => setWeeklyDrops(e.target.checked)}
                      disabled={state === "loading"}
                    />
                    Weekly best drops
                  </label>
                </div>
                {state === "error" && <p className={styles.errorText}>{error}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
