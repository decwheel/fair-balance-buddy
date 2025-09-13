import React from 'react';
import { Calculator, TrendingUp, Lightbulb, Calendar as CalendarIcon, CheckCircle } from 'lucide-react';

const STEPS = [
  { key: 'setup', label: 'Setup', icon: Calculator },
  { key: 'bank', label: 'Bank', icon: TrendingUp },
  { key: 'energy', label: 'Electricity', icon: Lightbulb },
  { key: 'forecast', label: 'Forecast', icon: CalendarIcon },
  { key: 'results', label: 'Results', icon: CheckCircle },
] as const;

export type StepKey = typeof STEPS[number]['key'];

export function Stepper({ current, onNavigate }: { current: StepKey; onNavigate: (k: StepKey)=>void }) {
  return (
    <div className="mb-2">
      <div className="flex justify-between gap-1 px-2 w-full overflow-x-hidden">
        {STEPS.map(({ key, label, icon: Icon }) => {
          const active = current === key;
          return (
            <div key={key} className="flex-1 min-w-0 flex flex-col items-center">
              <button
                onClick={() => onNavigate(key)}
                aria-current={active}
                className={`flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full border ${active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'} transition-colors`}
              >
                <Icon className="w-4 h-4" />
              </button>
              <span className="mt-1 text-[10px] sm:text-xs text-center truncate max-w-[64px]">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
