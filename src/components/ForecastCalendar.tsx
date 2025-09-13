import React from 'react';
import { Calendar as DayPicker } from '@/components/ui/calendar';

export function ForecastCalendar({ events }: { events: Array<{ dateISO: string; label: string; delta: number }> }) {
  const eventsByDate = React.useMemo(()=>{
    const m = new Map<string, number>();
    for (const e of events) m.set(e.dateISO, (m.get(e.dateISO)||0) + e.delta);
    return m;
  }, [events]);
  const selected = events[0]?.dateISO ? new Date(events[0].dateISO+'T00:00:00') : undefined;
  return (
    <div className="mx-auto">
      <div className="text-sm mb-2">Legend: <span className="inline-block w-2 h-2 rounded-full bg-success mr-1" /> deposit <span className="inline-block w-2 h-2 rounded-full bg-muted ml-2 mr-1" /> no change</div>
      <DayPicker
        mode="single"
        selected={selected}
        components={{
          DayContent: (props: any) => {
            const iso = props.date.toISOString().slice(0,10);
            const delta = eventsByDate.get(iso) || 0;
            return (
              <div className="flex flex-col items-center justify-center">
                <span>{props.date.getDate()}</span>
                <span className="text-[10px] text-muted-foreground">{delta===0? '': (delta>0? '+'+Math.round(delta): Math.round(delta))}</span>
              </div>
            );
          }
        }}
      />
    </div>
  );
}
