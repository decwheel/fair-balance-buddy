const CLEAN_REGEX = /(POS\s+\d+|OP\s+\d+|NEWT|CARD\s+\d+|REF\s*[:#]?\s*\w+|SEPA\s+DD|DIRECT\s+DEBIT)/gi;

const MAP: Record<string, { name: string; category: string; avatar?: string }> = {
  'BORD GAIS': { name: 'Bord Gáis', category: 'Utilities' },
  'ELECTRIC IRELAND': { name: 'Electric Ireland', category: 'Utilities' },
  'SSE': { name: 'SSE Airtricity', category: 'Utilities' },
  'PINERGY': { name: 'Pinergy', category: 'Utilities' },
  'ENERGIA': { name: 'Energia', category: 'Utilities' },
  'TESCO': { name: 'Tesco', category: 'Groceries' },
  'LIDL': { name: 'Lidl', category: 'Groceries' },
  'ALDI': { name: 'Aldi', category: 'Groceries' },
  'SPOTIFY': { name: 'Spotify', category: 'Subscriptions' },
  'NETFLIX': { name: 'Netflix', category: 'Subscriptions' },
  'EIR': { name: 'eir', category: 'Telecoms' },
  'VODAFONE': { name: 'Vodafone', category: 'Telecoms' },
};

export type Normalized = { clean: string; name: string; category?: string };

export function normalizeMerchant(raw: string): Normalized {
  const clean = (raw || '').replace(CLEAN_REGEX, '').replace(/\s{2,}/g, ' ').trim();
  const key = clean.toUpperCase();
  for (const k of Object.keys(MAP)) {
    if (key.includes(k)) {
      const { name, category } = MAP[k];
      return { clean, name, category };
    }
  }
  // Title case fallback
  const name = clean.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
  return { clean, name };
}

