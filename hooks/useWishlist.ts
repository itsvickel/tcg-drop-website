import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ptcg-wishlist-v1";

export type WishlistReturn = {
  has: (key: string) => boolean;
  toggle: (key: string) => void;
  add: (key: string) => void;
  count: number;
  items: string[];
  hydrated: boolean;
};

export function useWishlist(): WishlistReturn {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setKeys(new Set(JSON.parse(raw) as string[]));
    } catch {}
    setHydrated(true);
  }, []);

  const toggle = useCallback((key: string) => {
    setKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }, []);

  const has = useCallback((key: string) => keys.has(key), [keys]);

  const add = useCallback((key: string) => {
    setKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  return { has, toggle, add, items: [...keys], count: keys.size, hydrated };
}
