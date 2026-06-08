import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import styles from "../styles/Unsubscribe.module.css";

type State = "loading" | "success" | "error" | "missing";

export default function UnsubscribePage() {
  const router = useRouter();
  const [state,   setState]   = useState<State>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!router.isReady) return;

    const { id, type } = router.query;
    if (!id || typeof id !== "string") {
      setState("missing");
      return;
    }

    const endpoint = type === "newsletter"
      ? `/api/newsletter?id=${encodeURIComponent(id)}`
      : `/api/subscribe?id=${encodeURIComponent(id)}`;

    void fetch(endpoint, { method: "DELETE" })
      .then(async (res) => {
        if (res.ok) {
          setState("success");
        } else {
          const data = await res.json() as { error?: string };
          setState("error");
          setMessage(data.error ?? `Server error ${res.status}`);
        }
      })
      .catch((err: unknown) => {
        setState("error");
        setMessage(err instanceof Error ? err.message : "Something went wrong");
      });
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {state === "loading" && (
          <>
            <div className={styles.icon}>⏳</div>
            <h1 className={styles.title}>Unsubscribing…</h1>
            <p className={styles.body}>Just a moment.</p>
          </>
        )}

        {state === "success" && (
          <>
            <div className={styles.icon}>✓</div>
            <h1 className={styles.title}>Unsubscribed</h1>
            <p className={styles.body}>
              You won&apos;t receive any more price alerts for this product.
            </p>
            <Link href="/" className={styles.homeLink}>Back to tracker →</Link>
          </>
        )}

        {state === "error" && (
          <>
            <div className={styles.icon}>✕</div>
            <h1 className={styles.title}>Something went wrong</h1>
            <p className={styles.body}>{message || "Could not process your unsubscribe request."}</p>
            <Link href="/" className={styles.homeLink}>Back to tracker →</Link>
          </>
        )}

        {state === "missing" && (
          <>
            <div className={styles.icon}>⚠</div>
            <h1 className={styles.title}>Invalid link</h1>
            <p className={styles.body}>
              This unsubscribe link is missing a required parameter. Make sure you&apos;re
              using the full link from the email.
            </p>
            <Link href="/" className={styles.homeLink}>Back to tracker →</Link>
          </>
        )}
      </div>
    </div>
  );
}
