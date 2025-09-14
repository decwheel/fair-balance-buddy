import { useCallback, useEffect, useState } from 'react';

/**
 * IntersectionObserver-based in-view hook.
 * Returns a callback ref to attach and a boolean that becomes true once the element is in view.
 * Uses a callback ref so it works even when the element mounts later (e.g., after a step change).
 */
export function useInView<T extends HTMLElement = HTMLElement>(
  options?: IntersectionObserverInit & { once?: boolean }
): [React.RefCallback<T>, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);

  const ref = useCallback<React.RefCallback<T>>((el) => {
    setNode(el);
  }, []);

  useEffect(() => {
    if (!node) return;

    // If IO not supported, consider element in view
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    let seen = false;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          seen = true;
          setInView(true);
          if (options?.once !== false) obs.disconnect();
        } else if (!seen) {
          setInView(false);
        }
      },
      options
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [node, options?.root, options?.rootMargin, options?.threshold, options?.once]);

  return [ref, inView];
}
