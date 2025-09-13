import type { Meta, StoryObj } from '@storybook/react';
import { WagesCard } from '@/components/WagesCard';

const meta: Meta<typeof WagesCard> = {
  title: 'Cards/WagesCard',
  component: WagesCard,
};
export default meta;
type Story = StoryObj<typeof WagesCard>;

export const PersonA: Story = {
  args: {
    person: 'A',
    salaries: [{ amount: 2500, freq: 'monthly', description: 'ACME PAYROLL', firstSeen: '2025-08-01' }],
  },
};

