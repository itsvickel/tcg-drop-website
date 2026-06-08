import { useEffect, useRef, useState } from "react";
import type { Product } from "./ProductCard";
import styles from "../styles/AlertModal.module.css";

type Props = {
  product: Product;
  onClose: () => void;
};

type State = "idle" | "loading" | "success" | "error";

export default function AlertModal({ product, onClose }: Props) {
  const [email,     setEmail]     = useState("");
  const [threshold, setThreshold] = useState(
    String(Math.floor(product.price * 0.9 * 100) / 100)
  );
  const [state,  setState]  = useState<State>("idle");
  const [errMsg, setErrMsg] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    emailRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setErrMsg("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_key:    product.group_key,
          product_name: product.name,
          email:        email.trim(),
          threshold:    parseFloat(threshold),
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      setState("success");
    } catch (err) {
      setState("error");
      setErrMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} type="button" aria-label="Close">✕</button>

        <div className={styles.icon}>🔔</div>
        <h2 className={styles.title}>Price alert</h2>
        <p className={styles.productName}>{product.name}</p>

        {state === "success" ? (
          <div className={styles.successBox}>
            <p className={styles.successMsg}>
              ✓ Alert set! We&apos;ll email you when the price drops below <strong>${parseFloat(threshold).toFixed(2)} CAD</strong>.
            </p>
            <button className={styles.doneBtn} onClick={onClose} type="button">Done</button>
          </div>
        ) : (
          <form onSubmit={(e) => { void handleSubmit(e); }} className={styles.form}>
            <label className={styles.label}>
              Your email
              <input
                ref={emailRef}
                className={styles.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={state === "loading"}
              />
            </label>

            <label className={styles.label}>
              Alert me when price drops below
              <div className={styles.priceWrap}>
                <span className={styles.currency}>$</span>
                <input
                  className={styles.input}
                  type="number"
                  min="1"
                  max="9999"
                  step="0.01"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  required
                  disabled={state === "loading"}
                />
                <span className={styles.cadLabel}>CAD</span>
              </div>
              <span className={styles.hint}>
                Current best price: <strong>${product.price.toFixed(2)}</strong>
                {product.all_time_low < product.price && (
                  <> · All-time low: <strong>${product.all_time_low.toFixed(2)}</strong></>
                )}
              </span>
            </label>

            {state === "error" && (
              <p className={styles.errorMsg}>{errMsg}</p>
            )}

            <button
              className={styles.submitBtn}
              type="submit"
              disabled={state === "loading" || !email || !threshold}
            >
              {state === "loading" ? "Setting alert…" : "Set alert"}
            </button>

            <p className={styles.disclaimer}>
              You can unsubscribe at any time via the link in the email.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
