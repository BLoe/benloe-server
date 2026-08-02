/**
 * Player news, gathered from several places at once.
 *
 * Sleeper's own feed is good but narrow, so the player page pulls from every
 * source that will answer without a key and merges them into one timeline.
 * Every source is best-effort and independently timed out: a slow or broken
 * upstream must never hold up the page.
 */

export interface NewsItem {
  /** Where it came from, for the badge on the card. */
  source: string;
  /** Which upstream fetched it — used to dedupe and to group. */
  provider: 'sleeper' | 'espn' | 'outlook';
  title: string;
  body: string | null;
  url: string | null;
  published: number | null;
  /** A season outlook is analysis, not news; it sorts separately. */
  kind: 'news' | 'outlook';
}

const UA = 'sleeper-ui/1.0 (personal dashboard)';

/** Fetch JSON with a hard timeout. Returns null rather than throwing. */
async function tryJson(url: string, ms = 6000): Promise<any | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ESPN's public news feed tags each article with the athletes it mentions, so a
 * single wide pull can be filtered down to one player. There is no working
 * per-athlete endpoint — the documented one returns nothing.
 */
export async function espnNewsFor(playerName: string, limit = 50): Promise<NewsItem[]> {
  const data = await tryJson(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=${limit}`
  );
  if (!data?.articles) return [];

  const target = normaliseName(playerName);
  const out: NewsItem[] = [];

  for (const a of data.articles) {
    const tagged = (a.categories ?? []).some(
      (c: any) => c?.type === 'athlete' && normaliseName(c?.athlete?.description ?? '') === target
    );
    // Fall back to a headline mention when the article carries no athlete tags.
    const mentioned =
      tagged ||
      normaliseName(a.headline ?? '').includes(target) ||
      normaliseName(a.description ?? '').includes(target);
    if (!mentioned) continue;

    out.push({
      source: 'ESPN',
      provider: 'espn',
      title: a.headline ?? 'Untitled',
      body: a.description ?? null,
      url: a.links?.web?.href ?? null,
      published: a.published ? Date.parse(a.published) || null : null,
      kind: 'news',
    });
  }
  return out;
}

/** Lowercase, strip punctuation and suffixes so "A.J. Brown" matches "AJ Brown". */
export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sleeper's news feed, already fetched, mapped into the common shape. */
export function mapSleeperNews(raw: any[]): NewsItem[] {
  return (raw ?? [])
    .map((n) => ({
      source: prettySource(n.source),
      provider: 'sleeper' as const,
      title: n.metadata?.title ?? '',
      body: n.metadata?.description ?? null,
      url: n.metadata?.url ?? null,
      published: n.published ?? null,
      kind: 'news' as const,
    }))
    .filter((n) => n.title || n.body);
}

export function mapOutlook(raw: any, season: string): NewsItem | null {
  const text = raw?.metadata?.description;
  if (!text) return null;
  return {
    source: prettySource(raw.source),
    provider: 'outlook',
    title: `${season} season outlook`,
    body: text,
    url: raw?.metadata?.url ?? null,
    published: raw?.published ?? null,
    kind: 'outlook',
  };
}

/** Turn a source key like `fantasy_pros` into something printable. */
export function prettySource(key: string | null | undefined): string {
  if (!key) return 'Sleeper';
  const known: Record<string, string> = {
    rotowire: 'RotoWire',
    rotoballer: 'RotoBaller',
    fantasy_pros: 'FantasyPros',
    fantasypros: 'FantasyPros',
    nfl: 'NFL.com',
    espn: 'ESPN',
    yahoo: 'Yahoo',
  };
  return known[key.toLowerCase()] ?? key.replace(/_/g, ' ');
}

/**
 * Merge sources into one feed: newest first, near-duplicate headlines collapsed.
 *
 * Outlets syndicate each other constantly — the same play gets written up by
 * three of them within an hour — so identical-looking headlines are folded
 * together and the sources are listed on one card.
 */
export function mergeNews(items: NewsItem[], limit = 20): NewsItem[] {
  const byKey = new Map<string, NewsItem & { alsoFrom: Set<string> }>();

  for (const item of items) {
    const key = dedupeKey(item.title);
    const existing = byKey.get(key);
    if (existing) {
      existing.alsoFrom.add(item.source);
      // Keep whichever copy actually has a write-up.
      if (!existing.body && item.body) existing.body = item.body;
      if (!existing.url && item.url) existing.url = item.url;
      if ((item.published ?? 0) > (existing.published ?? 0)) existing.published = item.published;
      continue;
    }
    byKey.set(key, { ...item, alsoFrom: new Set([item.source]) });
  }

  return [...byKey.values()]
    .map(({ alsoFrom, ...item }) => ({
      ...item,
      source: [...alsoFrom].join(' · '),
    }))
    .sort((a, b) => {
      // Outlooks are evergreen analysis; they sit below the news timeline.
      if (a.kind !== b.kind) return a.kind === 'news' ? -1 : 1;
      return (b.published ?? 0) - (a.published ?? 0);
    })
    .slice(0, limit);
}

/** First few significant words — enough to catch syndicated rewrites. */
function dedupeKey(title: string): string {
  return normaliseName(title).split(' ').filter((w) => w.length > 2).slice(0, 6).join(' ');
}
