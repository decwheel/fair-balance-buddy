import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function ScrollToTop({ behavior = 'auto' as ScrollBehavior }: { behavior?: ScrollBehavior }) {
  const { pathname } = useLocation();
  useEffect(() => {
    try {
      window.scrollTo({ top: 0, left: 0, behavior });
    } catch {
      // Fallback for older browsers
      window.scrollTo(0, 0);
    }
  }, [pathname, behavior]);
  return null;
}

