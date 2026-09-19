import Link from "next/link";
import type { TcgSlug } from "../lib/tcg.config";
import styles from "../styles/GameSubNav.module.css";

export type GameSection = "sealed" | "singles" | "deals" | "movers" | "sets" | "scan";

type Props = {
  tcg: TcgSlug;
  active: GameSection;
  /** Product counts per category — Singles is hidden while its count is 0. */
  sealedCount?: number;
  singlesCount?: number;
};

export default function GameSubNav({ tcg, active, sealedCount, singlesCount }: Props) {
  return (
    <nav className={styles.subNav} aria-label="Section navigation">
      <div className={styles.inner}>
        <Link
          href={`/${tcg}/sealed`}
          className={`${styles.item} ${active === "sealed" ? styles.itemActive : ""}`}
          aria-current={active === "sealed" ? "page" : undefined}
        >
          📦 Sealed
          {sealedCount !== undefined && sealedCount > 0 && (
            <span className={styles.count}>{sealedCount.toLocaleString()}</span>
          )}
        </Link>
        {(singlesCount === undefined || singlesCount > 0 || active === "singles") && (
          <Link
            href={`/${tcg}/singles`}
            className={`${styles.item} ${active === "singles" ? styles.itemActive : ""}`}
            aria-current={active === "singles" ? "page" : undefined}
          >
            🃏 Singles
            {singlesCount !== undefined && singlesCount > 0 && (
              <span className={styles.count}>{singlesCount.toLocaleString()}</span>
            )}
          </Link>
        )}
        <Link
          href={`/${tcg}/deals`}
          className={`${styles.item} ${active === "deals" ? styles.itemActive : ""}`}
          aria-current={active === "deals" ? "page" : undefined}
        >
          🔥 Deals
        </Link>
        <Link
          href={`/movers?tcg=${tcg}`}
          className={`${styles.item} ${active === "movers" ? styles.itemActive : ""}`}
          aria-current={active === "movers" ? "page" : undefined}
        >
          📈 Movers
        </Link>
        <Link
          href={`/sets?tcg=${tcg}`}
          className={`${styles.item} ${active === "sets" ? styles.itemActive : ""}`}
          aria-current={active === "sets" ? "page" : undefined}
        >
          🗂️ Sets
        </Link>
        {/* Placed next to Singles: it is the singles tool, and someone who has
            just found the singles tab empty for their game is exactly who needs
            it. */}
        <Link
          href={`/scan?tcg=${tcg}`}
          className={`${styles.item} ${active === "scan" ? styles.itemActive : ""}`}
          aria-current={active === "scan" ? "page" : undefined}
        >
          🔍 Card lookup
        </Link>
        <Link href={`/drops?tcg=${tcg}`} className={styles.item}>
          📡 Drops
        </Link>
        <Link href={`/calendar?tcg=${tcg}`} className={styles.item}>
          📅 Calendar
        </Link>
        <Link href="/retailers" className={styles.item}>
          Shops
        </Link>
        <Link href="/collection" className={styles.item}>
          📦 Collection
        </Link>
        <Link href="/cart" className={styles.item}>
          🧮 Best Basket
        </Link>
      </div>
    </nav>
  );
}
