/**
 * Build a LeagueConfig from a platform's own settings.
 *
 * Seeding from the platform rather than from typed-in notes is not a
 * convenience — it is the correctness step. The roster shape and the scoring
 * table are the two inputs the whole value model rests on, and both are
 * available authoritatively. The one thing that still has to be entered by hand
 * is keepers, because no platform exposes a keeper's auction salary reliably.
 */
import type { LeagueConfig, RosterSlots, Scoring } from './league.js';
import type { SleeperLeague } from '../sources/sleeper.js';

const EMPTY_SLOTS: RosterSlots = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0, K: 0, FLEX: 0, BN: 0, IR: 0 };

/**
 * Sleeper describes a roster as an ordered list of slot names, one entry per
 * slot. `SUPER_FLEX` and the IDP slots are mapped to nothing on purpose —
 * neither of these leagues has them, and silently treating an unknown slot as a
 * bench spot would quietly change the money math.
 */
export function slotsFromRosterPositions(positions: string[]): RosterSlots {
  const slots: RosterSlots = { ...EMPTY_SLOTS };
  for (const raw of positions) {
    switch (raw) {
      case 'QB':
        slots.QB += 1;
        break;
      case 'RB':
        slots.RB += 1;
        break;
      case 'WR':
        slots.WR += 1;
        break;
      case 'TE':
        slots.TE += 1;
        break;
      case 'DEF':
      case 'DST':
        slots.DEF += 1;
        break;
      case 'K':
        slots.K += 1;
        break;
      case 'FLEX':
      case 'WRRB_FLEX':
      case 'REC_FLEX':
        slots.FLEX += 1;
        break;
      case 'BN':
        slots.BN += 1;
        break;
      default:
        // IR / TAXI / anything unrecognised: not a draftable slot.
        break;
    }
  }
  return slots;
}

export function leagueFromSleeper(
  league: SleeperLeague,
  draftSettings: Record<string, number> | null,
  id: string
): LeagueConfig {
  const slots = slotsFromRosterPositions(league.roster_positions ?? []);
  slots.IR = Number(league.settings?.reserve_slots ?? 0);

  return {
    id,
    name: league.name,
    platform: 'sleeper',
    platformLeagueId: league.league_id,
    season: league.season,
    teams: Number(league.settings?.num_teams ?? league.total_rosters ?? 12),
    budget: Number(draftSettings?.budget ?? 200),
    minBid: 1,
    slots,
    scoring: (league.scoring_settings ?? {}) as Scoring,
  };
}
