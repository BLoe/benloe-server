/**
 * Player lookup for the entry bar.
 *
 * Ranked so the FIRST result is almost always the one meant: an exact surname
 * beats a prefix, a prefix beats a substring, and ties break on price, because
 * in an auction the expensive player of a shared surname is the one being
 * nominated. Typing "jefferson" while Justin Jefferson is on the board should
 * never surface a $1 rookie first.
 *
 * Undrafted players always outrank drafted ones, so the list stops offering
 * players who are already gone without hiding them (seeing "already gone"
 * beside a name is how a double-entry gets caught).
 */
import type { PlayerValue } from '../lib/valuation.js';

export interface Candidate {
  player: PlayerValue;
  drafted: boolean;
  score: number;
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '');

export function searchPlayers(
  query: string,
  players: PlayerValue[],
  drafted: Set<string>,
  limit = 8
): Candidate[] {
  const q = normalise(query).trim();
  if (!q) return [];

  const out: Candidate[] = [];
  for (const player of players) {
    const name = normalise(player.name);
    const parts = name.split(' ');
    const surname = parts[parts.length - 1] ?? '';

    let score = 0;
    if (surname === q) score = 100;
    else if (name === q) score = 95;
    else if (surname.startsWith(q)) score = 80;
    else if (parts.some((p) => p.startsWith(q))) score = 70;
    else if (name.startsWith(q)) score = 65;
    else if (name.includes(q)) score = 40;
    else if (normalise(`${player.team ?? ''}`) === q) score = 30;
    else continue;

    // Initials-plus-surname, the way people actually type: "jjefferson".
    if (score < 80 && parts.length > 1 && `${parts[0][0]}${surname}`.startsWith(q)) score = 78;

    out.push({ player, drafted: drafted.has(player.id), score });
  }

  out.sort((a, b) => {
    if (a.drafted !== b.drafted) return a.drafted ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    return b.player.baseValue - a.player.baseValue;
  });

  return out.slice(0, limit);
}
