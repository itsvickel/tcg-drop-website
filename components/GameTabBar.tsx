import Link from "next/link";
import { useWishlist } from "../hooks/useWishlist";
import type { TcgSlug } from "../lib/tcg.config";
import styles from "../styles/GameTabBar.module.css";

type Props = { tcg: TcgSlug };

export default function GameTabBar({ tcg }: Props) {
  const wishlist = useWishlist();

  return (
    <nav className={styles.tabBar} aria-label="Game navigation">
      <div className={styles.inner}>
        <div className={styles.left}>
          <span className={styles.brand}>
            TCG<span className={styles.brandDot}>.</span>Drop
          </span>
          <div className={styles.tabs} role="tablist">
            <Link
              href="/pokemon"
              role="tab"
              aria-selected={tcg === "pokemon"}
              className={`${styles.tab} ${tcg === "pokemon" ? styles.tabActivePokemon : ""}`}
            >
              <span className={styles.tabIcon}>🔴</span>
              Pokémon
            </Link>
            <Link
              href="/mtg"
              role="tab"
              aria-selected={tcg === "mtg"}
              className={`${styles.tab} ${tcg === "mtg" ? styles.tabActiveMtg : ""}`}
            >
              <span className={styles.tabIcon}>⚡</span>
              MTG
            </Link>
            <span
              role="tab"
              aria-selected={false}
              className={`${styles.tab} ${styles.tabComingSoon}`}
              title="One Piece — Coming Soon"
            >
              <span className={styles.tabIcon}>🏴‍☠️</span>
              <span className={styles.tabComingSoonLabel}>One Piece</span>
            </span>
            <span
              role="tab"
              aria-selected={false}
              className={`${styles.tab} ${styles.tabComingSoon}`}
              title="Disney Lorcana — Coming Soon"
            >
              <span className={styles.tabIcon}>✨</span>
              <span className={styles.tabComingSoonLabel}>Lorcana</span>
            </span>
          </div>
        </div>

        <div className={styles.right}>
          <Link href={`/calendar?tcg=${tcg}`} className={styles.navLink}>📅 Calendar</Link>
          <Link href={`/digest?tcg=${tcg}`} className={styles.navLink}>🔥 Digest</Link>
          <Link href="/alerts" className={styles.navLink}>🔔 Alerts</Link>
          <Link href="/health" className={styles.navLink}>⚙ Health</Link>
          {wishlist.count > 0 && (
            <Link href="/wishlist" className={styles.navLinkWishlist}>
              ♥ My List ({wishlist.count})
            </Link>
          )}
          <div className={styles.live}>
            <span className={styles.pulseDot} />
            <span className={styles.liveText}>Live</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
