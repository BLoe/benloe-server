// Recurring charge detection: the same merchant charging a similar amount about
// once a month. Pure; ../money.ts feeds it the recent non-transfer outflows.

export interface Outflow {
  id: number;
  date: string; // YYYY-MM-DD
  /** Positive dollars spent. */
  spent: number;
  merchant: string;
  category: string | null;
  account: string;
}

export interface Recurring {
  merchant: string;
  category: string | null;
  account: string;
  /** Median charge, dollars. */
  typical_amount: number;
  /** The most recent charge, dollars. */
  last_amount: number;
  cadence: 'monthly';
  occurrences: number;
  first_date: string;
  last_date: string;
  /** last_date plus the median gap between charges. */
  next_expected: string;
  /** False once a charge is more than 45 days overdue: probably cancelled. */
  active: boolean;
  annual_cost: number;
  transaction_ids: number[];
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Groups by merchant, splits each merchant's charges into clusters of similar
 * amount (within 25% or $3 of the cluster's median, so a price rise stays in
 * the cluster and a one-off purchase from the same merchant does not), and
 * keeps clusters of three or more charges whose gaps are monthly: median gap
 * 25-35 days with at least two thirds of the gaps between 21 and 40.
 */
export function detectRecurring(outflows: Outflow[], today: string): Recurring[] {
  const byMerchant = new Map<string, Outflow[]>();
  for (const o of outflows) {
    const key = o.merchant.toLowerCase();
    let list = byMerchant.get(key);
    if (!list) byMerchant.set(key, (list = []));
    list.push(o);
  }
  const out: Recurring[] = [];
  for (const list of byMerchant.values()) {
    const clusters: Outflow[][] = [];
    for (const o of [...list].sort((a, b) => a.spent - b.spent)) {
      const cluster = clusters[clusters.length - 1];
      const mid = cluster ? median(cluster.map((x) => x.spent)) : 0;
      if (cluster && Math.abs(o.spent - mid) <= Math.max(3, mid * 0.25)) cluster.push(o);
      else clusters.push([o]);
    }
    for (const cluster of clusters) {
      if (cluster.length < 3) continue;
      const items = [...cluster].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      const gaps = items.slice(1).map((x, i) => days(items[i]!.date, x.date));
      const gap = median(gaps);
      if (gap < 25 || gap > 35) continue;
      if (gaps.filter((g) => g >= 21 && g <= 40).length < Math.ceil((gaps.length * 2) / 3)) continue;
      const last = items[items.length - 1]!;
      const next = new Date(Date.parse(last.date) + Math.round(gap) * DAY).toISOString().slice(0, 10);
      const typical = r2(median(items.map((x) => x.spent)));
      out.push({
        merchant: last.merchant,
        category: last.category,
        account: last.account,
        typical_amount: typical,
        last_amount: r2(last.spent),
        cadence: 'monthly',
        occurrences: items.length,
        first_date: items[0]!.date,
        last_date: last.date,
        next_expected: next,
        active: days(next, today) <= 45,
        annual_cost: r2(typical * 12),
        transaction_ids: items.map((x) => x.id),
      });
    }
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || b.typical_amount - a.typical_amount || a.merchant.localeCompare(b.merchant));
}
