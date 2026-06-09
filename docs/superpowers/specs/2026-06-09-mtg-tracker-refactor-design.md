# MTG Tracker + Shared Core Refactor

**Date:** 2026-06-09
**Repos:** `tcg-drop-alert` (scraper) + `tcg-drop-website` (Next.js site)
**Approach:** Approach B — full shared core + thin game modules

---

## Goal

Add MTG sealed product tracking alongside the existing Pokemon tracker by extracting a shared `tracker_core.py` library. Both games then become thin modules that define only their scrapers and product filter. Adding future games (e.g. One Piece, Lorcana) costs ~200 lines.

---

## Architecture

```
tcg-drop-alert/
  tracker_core.py          ← new shared library (~1000 lines)
  pokemon_tracker.py       ← refactored, imports from core (~600 lines)
  mtg_tracker.py           ← new, imports from core (~400 lines)

tcg-drop-website/
  lib/tcg.config.ts        ← MTG_KNOWN_SETS ~20 → ~100 sets
  pages/api/products.ts    ← TCG-aware extractProductType(), MTG product types
```

### State files per game (in tcg-drop-alert repo root)

Each game writes into its own subdirectory:
```
pokemon/state.json
pokemon/price_history.json
pokemon/stock_changes.json
mtg/state.json
mtg/price_history.json
mtg/stock_changes.json
```

The website's API already reads from `config.githubDataPath` prefix — no changes needed there.

**State file paths:** Each tracker must run with its working directory set to its game subfolder (e.g. `cd pokemon && python ../pokemon_tracker.py`), or the GitHub Actions workflow must commit its output files into the appropriate subfolder. The `STATE_FILE = Path("state.json")` constant in the core stays relative — the working directory controls where files land. The MTG workflow job must mirror this pattern.

---

## tracker_core.py

Extracted verbatim from `pokemon_tracker.py` (no logic changes):

### State I/O
- File path constants: `STATE_FILE`, `HISTORY_FILE`, `STOCK_CHANGES_FILE`, `ALERTS_FILE`, `NEWSLETTER_SUBS_FILE`, `PREORDER_QUEUE_FILE`, `WISHLIST_FILE`
- All 7 `load_*/save_*` pairs

### Data model
- `Product` dataclass (unchanged)
- `normalize_name(name, stop_words=None, aliases=None)` — optional overrides per game
- `merge_near_duplicate_groups(products)`
- `_is_preorder(name)`

### HTTP
- `HEADERS` constant
- `get_page(url, timeout)`, `get_json(url, params, timeout)`
- `with_retry(fn, label, max_attempts, base_delay)`
- `parse_price(text)`, `verify_price_live(url, retailer)`

### FX
- `get_usd_cad_rate()` with 6h in-process cache

### Shopify scrapers (parameterized)
- `scrape_shopify(retailer, base_url, collection_path, product_filter)` — takes a `product_filter` callable
- `find_shopify_collection(base_url, search_terms)` — `search_terms` replaces hardcoded `"pokemon"` list; e.g. `["pokemon"]` or `["magic", "mtg"]`
- `scrape_shopify_auto(retailer, base_url, search_terms, product_filter)`
- `scrape_shopify_usd(retailer, base_url, collection_path, search_terms, product_filter)`

### Price history
- `update_history(history, group_key, price, retailer, name)`
- `build_history_chart(history, title)` — `title` param so chart says "MTG Price History" vs "Pokemon TCG Price History"

### Wishlist
- `load_wishlist()`, `init_wishlist(example)`, `get_wishlist_target(display_name, wishlist)`

### Notifications
- `send_alert(title, message, url)`, `fmt_price(price)`, `pct_change(old, new)`, `fmt_drop(prev, curr)`

### Email / alerts
- `_send_resend_email(to, subject, html)`
- `_alert_email_html(name, current_price, threshold, retailer, url, alert_id, site_base)`
- `check_price_alerts(best_prices)`

### Newsletter
- `queue_new_preorders(best_prices)`
- `check_preorder_newsletter(best_prices, state)`
- `check_drops_newsletter(best_prices, history)`

### Shared constants
- `SHIPPING_INFO` dict (same retailers, shared by both games)
- `LOCAL_PICKUP_PATTERNS`, `is_local_pickup_only(name)`
- `MIN_PRODUCT_PRICE = 3.0`, `HISTORY_DAYS = 90`
- All `DEAL_MIN_*`, `INSTANT_MIN_*`, `ANY_DROP_MIN_CAD`, `REASONABLE_*` thresholds
- `USD_RETAILERS`, `NO_INSTANT_ALERT_RETAILERS`

---

## pokemon_tracker.py (refactored)

Imports everything above from `tracker_core`. Keeps only:

- `CARD_KEYWORDS`, `ACCESSORY_KEYWORDS`, `PREORDER_KEYWORDS`
- `is_pokemon_card_product(name)`
- All 50 retailer scraper functions (unchanged, but pass `is_pokemon_card_product` to shared Shopify helpers)
- `SCRAPERS` list
- `send_weekly_ntfy(best_prices, history)`
- `main()`

No behavioural changes — existing Pokemon tracking is unaffected.

---

## mtg_tracker.py (new)

### Product filter

```python
MTG_CARD_KEYWORDS = [
    "booster box", "collector booster", "draft booster", "set booster",
    "play booster", "jumpstart", "commander deck", "bundle",
    "prerelease kit", "starter kit", "secret lair", "fat pack",
    "commander collection", "booster pack", "display",
]

MTG_ACCESSORY_KEYWORDS = [
    "sleeve", "playmat", "deck box", "binder", "dice", "token",
    "single", "foil single", "lot of", "graded", "psa", "cgc",
    "life counter", "storage", "card case",
]

def is_mtg_sealed_product(name: str) -> bool:
    n = name.lower()
    # Must reference MTG or a known set
    if "magic" not in n and "mtg" not in n and "the gathering" not in n:
        return False
    if any(kw in n for kw in MTG_ACCESSORY_KEYWORDS):
        return False
    if is_local_pickup_only(n):
        return False
    if not any(kw in n for kw in MTG_CARD_KEYWORDS):
        return False
    return True
```

### Retailer scrapers

Same 50 retailers, different collection paths. Most use `scrape_shopify_auto` with `search_terms=["magic", "mtg"]`. Known hardcoded paths:

| Retailer | Collection path |
|---|---|
| 401 Games | `magic-the-gathering` |
| Face to Face | `magic` |
| Meeplemart | auto |
| Magic Stronghold | `magic-the-gathering` |
| Others | auto (`["magic", "mtg"]`) |

USD stores (ABU Games, Game Nerdz, etc.) carry over with `scrape_shopify_usd`.

Big-box stores (Best Buy, Walmart, Amazon, Pokemon Center, EB Games) — skipped in V1, as they don't meaningfully sell MTG sealed in Canada. Can be added in Phase 2.

### main()

Identical flow to Pokemon's main:
1. Scan all retailers → collect products
2. `merge_near_duplicate_groups()`
3. Update price history
4. Compute best prices per group
5. Check price alerts
6. Check preorder newsletter
7. Save state

---

## tcg-drop-website changes

### lib/tcg.config.ts — MTG_KNOWN_SETS

Expand from ~20 to ~100 sets. Coverage:

- **Standard** (last 3 years): Foundations, Duskmourn, Bloomburrow, Outlaws of Thunder Junction, Murders at Karlov Manor, Lost Caverns of Ixalan, Wilds of Eldraine, March of the Machine, Aftermath, Phyrexia: All Will Be One, Brothers War, Dominaria United
- **Pioneer staples**: Streets of New Capenna, Kamigawa: Neon Dynasty, Innistrad: Crimson Vow, Innistrad: Midnight Hunt, Adventures in the Forgotten Realms, Strixhaven, Kaldheim, Zendikar Rising, Throne of Eldraine, War of the Spark, Ravnica Allegiance, Guilds of Ravnica
- **Modern/Remastered**: Modern Horizons 3, Modern Horizons 2, Ravnica Remastered, Dominaria Remastered, Double Masters 2022
- **Commander/Masters**: Commander Masters, March of the Machine Commander, Phyrexia Commander, The Lord of the Rings, Universes Beyond
- **Patterns**: `knownSetPatterns` for `Commander \d{4}`, `Secret Lair`

### pages/api/products.ts — extractProductType

`extractProductType(name, config)` becomes TCG-aware. When `config.slug === "mtg"`, MTG patterns run first:

```
Collector Booster   → /collector.{0,5}booster/i
Play Booster        → /play.{0,5}booster/i
Draft Booster       → /draft.{0,5}booster/i
Set Booster         → /set.{0,5}booster/i
Jumpstart Booster   → /jumpstart/i
Booster Box         → /booster.{0,5}box/i
Commander Deck      → /commander.{0,5}deck/i
Bundle              → /\bbundle\b/i
Prerelease Kit      → /prerelease/i
Starter Kit         → /starter.{0,5}kit/i
Secret Lair         → /secret.{0,5}lair/i
```

Pokemon patterns are unchanged and only run for `config.slug === "pokemon"`.

`toApiResponse()` and `extractProductType()` already receive `config` — just thread it through.

---

## Out of scope (Phase 2)

- MTG-specific retailers (Hareruya, Card Kingdom, SCG, etc.)
- Foil / non-foil variant splitting
- Commander format price tracking
- MTG calendar updater
- Weekly ntfy digest for MTG
