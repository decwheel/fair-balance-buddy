import React, { useRef, useState, useLayoutEffect, useCallback } from 'react';

type VirtualListProps<T> = {
  items: T[];
  itemHeight: number;
  overscan?: number;
  className?: string;
  render: (item: T, index: number) => React.ReactNode;
};

export function VirtualList<T>({ items, itemHeight, overscan = 8, className, render }: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  const onScroll = useCallback(() => {
    if (!containerRef.current) return;
    setScrollTop(containerRef.current.scrollTop);
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const total = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(items.length - 1, Math.ceil((scrollTop + height) / itemHeight) + overscan);
  const top = startIndex * itemHeight;

  const visible = [] as React.ReactNode[];
  for (let i = startIndex; i <= endIndex; i++) {
    const it = items[i];
    if (it === undefined) continue;
    visible.push(
      <div key={i} style={{ height: itemHeight }} className="overflow-hidden">
        {render(it, i)}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className} onScroll={onScroll}>
      <div style={{ height: total, position: 'relative' }}>
        <div style={{ position: 'absolute', top, left: 0, right: 0 }}>
          {visible}
        </div>
      </div>
    </div>
  );
}

