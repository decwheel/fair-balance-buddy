import type { Meta, StoryObj } from '@storybook/react';
import { BillsList } from '@/components/BillsList';

const meta: Meta<typeof BillsList> = {
  title: 'Lists/BillsList',
  component: BillsList,
};
export default meta;
type Story = StoryObj<typeof BillsList>;

export const Basic: Story = {
  args: {
    rows: [
      { id: '1', dateISO: '2025-09-22', description: 'Bord Gais', amount: 120, owner: 'A', freq: 'monthly' },
      { id: '2', dateISO: '2025-09-29', description: 'Spotify', amount: 11.99, owner: 'A', freq: 'monthly' },
    ],
  },
};

