import { useState } from "react";
import styles from "../styles/NewsletterSignup.module.css";

type State = "idle" | "loading" | "success" | "error";

export default function NewsletterSignup() {
  const [email, setEmail]   = useState("");
  const [state, setState]   = useState<State>("idle");
  const [error, setError]   = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
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

  if (state === "success") {
    return (
      <div className={styles.wrap}>
        <div className={styles.successBox}>
          <span className={styles.successIcon}>✓</span>
          <p className={styles.successText}>
            You&apos;re subscribed! We&apos;ll email you new preorders and the best weekly deals.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.label}>
        <span className={styles.bell}>🔔</span>
        Get notified — new preorders &amp; best weekly drops, straight to your inbox
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
        />
        <button
          className={styles.btn}
          type="submit"
          disabled={state === "loading" || !email.trim()}
        >
          {state === "loading" ? "Subscribing…" : "Subscribe"}
        </button>
      </form>
      {state === "error" && <p className={styles.errorText}>{error}</p>}
    </div>
  );
}
