import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useAuth } from "../hooks/useAuth";
import { useWishlist } from "../hooks/useWishlist";
import { getSavedEmail, saveEmail } from "../lib/savedEmail";
import styles from "../styles/Account.module.css";

export default function AccountPage() {
  const auth = useAuth();
  const wishlist = useWishlist();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // localStorage read must happen post-hydration to match the SSR markup
  useEffect(() => {
    setEmail((prev) => prev || getSavedEmail());
  }, []);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError("");
    const err = await auth.signIn(trimmed);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    saveEmail(trimmed);
    setSent(true);
  }

  return (
    <>
      <Head>
        <title>Account — The Mana Cafe</title>
        <meta name="robots" content="noindex" />
      </Head>

      <nav className={styles.topBar}>
        <Link href="/pokemon/sealed" className={styles.homeLink}>← The Mana Cafe</Link>
        <span className={styles.topBarTitle}>Account</span>
      </nav>

      <main className={styles.main}>
        {auth.loading ? (
          <p className={styles.muted}>Loading…</p>
        ) : !auth.enabled ? (
          <div className={styles.card}>
            <h1 className={styles.title}>Accounts not configured</h1>
            <p className={styles.muted}>
              This deployment doesn&apos;t have Supabase auth set up. Your wishlist and alerts
              still work — they&apos;re stored in this browser and by email.
            </p>
          </div>
        ) : auth.user ? (
          <div className={styles.card}>
            <h1 className={styles.title}>Signed in</h1>
            <p className={styles.email}>{auth.user.email}</p>
            <p className={styles.muted}>
              Your list syncs to this account and follows you across devices.
            </p>

            <div className={styles.rows}>
              <Link href="/wishlist" className={styles.row}>
                ♥ My List
                <span className={styles.rowValue}>{wishlist.count} saved</span>
              </Link>
              <Link
                href={`/alerts?email=${encodeURIComponent(auth.user.email)}`}
                className={styles.row}
              >
                🔔 Price alerts
                <span className={styles.rowValue}>manage</span>
              </Link>
            </div>

            <button
              className={styles.signOutBtn}
              onClick={() => void auth.signOut()}
              type="button"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className={styles.card}>
            <h1 className={styles.title}>Sign in</h1>
            <p className={styles.muted}>
              No password — we email you a magic sign-in link. Signing in syncs your wishlist and
              alerts across devices.
            </p>
            {sent ? (
              <p className={styles.sent}>
                Magic link sent to <strong>{email.trim()}</strong>. Open it on this device to
                finish signing in.
              </p>
            ) : (
              <form onSubmit={handleSignIn} className={styles.form}>
                <input
                  className={styles.input}
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-label="Email address"
                />
                {error && <span className={styles.error}>{error}</span>}
                <button className={styles.submitBtn} type="submit" disabled={busy}>
                  {busy ? "Sending…" : "Email me a sign-in link"}
                </button>
              </form>
            )}
          </div>
        )}
      </main>
    </>
  );
}
