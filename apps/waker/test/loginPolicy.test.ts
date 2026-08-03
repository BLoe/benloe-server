import { describe, it, expect } from 'vitest';
import { mayConnectSleeper, parseAllowList } from '../src/server/loginPolicy.js';

// The real dynasty league roster, which is what production is configured with.
const LEAGUE = parseAllowList(
  'anhunter,benloe,bluehozer,dannyshones,jamiem312,kevinzuk,pws209,ryanreal,sashaivanov,skolloki9z,tumbles,tylermcnutt'
);

describe('parseAllowList', () => {
  it('splits, trims and lowercases', () => {
    expect(parseAllowList(' BenLoe , Tumbles ')).toEqual(['benloe', 'tumbles']);
  });

  it('drops empty entries from sloppy input', () => {
    expect(parseAllowList('benloe,,  ,tumbles,')).toEqual(['benloe', 'tumbles']);
  });

  it('treats undefined and empty as no list', () => {
    expect(parseAllowList(undefined)).toEqual([]);
    expect(parseAllowList('')).toEqual([]);
    expect(parseAllowList('   ')).toEqual([]);
  });

  it('parses the full league roster', () => {
    expect(LEAGUE).toHaveLength(12);
    expect(LEAGUE).toContain('benloe');
  });
});

describe('mayConnectSleeper', () => {
  const policy = { enabled: true, allow: LEAGUE };

  it('allows every manager in the league', () => {
    for (const name of LEAGUE) {
      expect(mayConnectSleeper(name, policy)).toBe(true);
    }
  });

  it('is case-insensitive, since Sleeper handles are', () => {
    expect(mayConnectSleeper('BenLoe', policy)).toBe(true);
    expect(mayConnectSleeper('BENLOE', policy)).toBe(true);
    expect(mayConnectSleeper('  BenLoe  ', policy)).toBe(true);
  });

  it('refuses anyone outside the league', () => {
    for (const name of ['sleeperuser', 'stranger', 'peteypabs09']) {
      expect(mayConnectSleeper(name, policy)).toBe(false);
    }
  });

  it('matches exactly — no prefix, suffix or substring slippage', () => {
    for (const near of ['benlo', 'benloe2', 'xbenloe', 'ben loe', 'benloe ', '*']) {
      const allowed = mayConnectSleeper(near, policy);
      // Only a trailing-space variant should survive, via trimming.
      expect(allowed).toBe(near.trim() === 'benloe');
    }
  });

  it('refuses an empty or whitespace username', () => {
    expect(mayConnectSleeper('', policy)).toBe(false);
    expect(mayConnectSleeper('   ', policy)).toBe(false);
  });

  it('the master switch overrides the allowlist', () => {
    expect(mayConnectSleeper('benloe', { enabled: false, allow: LEAGUE })).toBe(false);
    expect(mayConnectSleeper('benloe', { enabled: false, allow: [] })).toBe(false);
  });

  it('an empty allowlist means everyone, which is why the league list matters', () => {
    expect(mayConnectSleeper('a-total-stranger', { enabled: true, allow: [] })).toBe(true);
  });
});
