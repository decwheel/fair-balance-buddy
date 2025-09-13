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
    <div className="mb-4">
      <div className="flex justify-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap overflow-x-auto px-2 -mx-2">
      {STEPS.map(({ key, label, icon: Icon }) => {
        const active = current === key;
        return (
          <button
            key={key}
            onClick={() => onNavigate(key)}
            className={`flex items-center gap-1 sm:gap-1.5 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-full border ${active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'} transition-colors whitespace-nowrap`}
          >
            <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="text-xs sm:text-sm">{label}</span>
          </button>
        );
      })}
      </div>
    </div>
  );
}
