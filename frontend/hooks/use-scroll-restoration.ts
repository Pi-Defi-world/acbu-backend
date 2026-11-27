'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Saves the window scroll position to sessionStorage when navigating away,
 * and restores it once the page mounts and `ready` is true.
 *
 * @param key     Unique storage key (use the page pathname, e.g. '/activity').
 * @param ready   Set to true once list data has loaded so the page has height to scroll into.
 */
export function useScrollRestoration(key: string, ready: boolean) {
  const pathname = usePathname();
  const savedKey = `scroll:${key}`;

  // Save scroll position when navigating away from this page.
  useEffect(() => {
    const save = () => {
      if (pathname === key) {
        sessionStorage.setItem(savedKey, String(window.scrollY));
      }
    };
    window.addEventListener('beforeunload', save);
    return () => {
      save();
      window.removeEventListener('beforeunload', save);
    };
  }, [pathname, key, savedKey]);

  // Restore scroll position once data is ready.
  const restored = useRef(false);
  useEffect(() => {
    if (!ready || restored.current) return;
    const saved = sessionStorage.getItem(savedKey);
    if (saved) {
      window.scrollTo({ top: parseInt(saved, 10), behavior: 'instant' });
      sessionStorage.removeItem(savedKey);
    }
    restored.current = true;
  }, [ready, savedKey]);
}
