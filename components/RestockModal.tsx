import { useEffect, useRef, useState } from "react";
import type { Product } from "./ProductCard";
import styles from "../styles/RestockModal.module.css";

type Props = {
  product: Product;
  onClose: () => void;
  tcg?: string;
};

type State = "idle" | "loading" | "success" | "error";

export default function RestockModal({ product, onClose, tcg = "pokemon" }: Props) {
  const [email,  setEmail]  = useState("");
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
      const res = await fetch("/api/restock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_key:    product.group_key,
          product_name: product.name,
          email:        email.trim(),
          tcg,
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

        <div className={styles.icon}>📦</div>
        <h2 className={styles.title}>Restock alert</h2>
        <p className={styles.productName}>{product.name}</p>
        <p className={styles.subtitle}>This product is currently out of stock.</p>

        {state === "success" ? (
          <div className={styles.successBox}>
            <p className={styles.successMsg}>
              ✓ You&apos;re on the list! We&apos;ll email you when <strong>{product.name}</strong> is back in stock.
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

            {state === "error" && (
              <p className={styles.errorMsg}>{errMsg}</p>
            )}

            <button
              className={styles.submitBtn}
              type="submit"
              disabled={state === "loading" || !email.trim()}
            >
              {state === "loading" ? "Subscribing…" : "Notify me when back in stock"}
            </button>

            <p className={styles.disclaimer}>
              One email when it restocks. Unsubscribe anytime.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
