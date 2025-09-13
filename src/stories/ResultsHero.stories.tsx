import type { Meta, StoryObj } from '@storybook/react';
import { ResultsHero } from '@/components/ResultsHero';

const meta: Meta<typeof ResultsHero> = {
  title: 'Results/ResultsHero',
  component: ResultsHero,
};
export default meta;
type Story = StoryObj<typeof ResultsHero>;

export const Joint: Story = {
  args: {
    aPerPay: 500,
    aPerMonth: 1000,
    aStart: '2025-10-01',
    bPerPay: 250,
    bPerMonth: 500,
    bStart: '2025-09-25',
    fairness: { a: 0.63, b: 0.37 },
    minBalance: 11.27,
    minDate: '2026-03-24',
  },
};

