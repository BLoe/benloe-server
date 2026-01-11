import { describe, it, expect } from 'vitest';
import {
  isNegativeCategory,
  calculateAverages,
  findLeaders,
  comparePlayers,
  parseYahooPlayerData,
  filterPlayersByName,
  type StatCategory,
  type PlayerStats,
} from './playerComparison';

describe('Player Comparison Service', () => {
  // Sample stat categories like Yahoo Fantasy
  const sampleCategories: StatCategory[] = [
    { stat_id: '5', name: 'Field Goal Percentage', abbr: 'FG%' },
    { stat_id: '8', name: 'Free Throw Percentage', abbr: 'FT%' },
    { stat_id: '10', name: '3-Pointers Made', abbr: '3PM' },
    { stat_id: '12', name: 'Points', abbr: 'PTS' },
    { stat_id: '15', name: 'Rebounds', abbr: 'REB' },
    { stat_id: '16', name: 'Assists', abbr: 'AST' },
    { stat_id: '17', name: 'Steals', abbr: 'STL' },
    { stat_id: '18', name: 'Blocks', abbr: 'BLK' },
    { stat_id: '19', name: 'Turnovers', abbr: 'TO' },
  ];

  describe('isNegativeCategory', () => {
    it('identifies turnover category as negative', () => {
      expect(isNegativeCategory({ stat_id: '19', name: 'Turnovers', abbr: 'TO' })).toBe(true);
    });

    it('identifies turnovers by name', () => {
      expect(isNegativeCategory({ stat_id: '19', name: 'Turnover Count' })).toBe(true);
    });

    it('returns false for positive categories', () => {
      expect(isNegativeCategory({ stat_id: '12', name: 'Points', abbr: 'PTS' })).toBe(false);
      expect(isNegativeCategory({ stat_id: '15', name: 'Rebounds', abbr: 'REB' })).toBe(false);
      expect(isNegativeCategory({ stat_id: '16', name: 'Assists', abbr: 'AST' })).toBe(false);
    });
  });

  describe('calculateAverages', () => {
    it('calculates per-game averages', () => {
      const stats = { '12': 500, '15': 200, '16': 150 };
      const gamesPlayed = 20;

      const result = calculateAverages(stats, gamesPlayed);

      expect(result['12']).toBe(25); // 500 / 20
      expect(result['15']).toBe(10); // 200 / 20
      expect(result['16']).toBe(7.5); // 150 / 20
    });

    it('returns empty object for zero games', () => {
      const stats = { '12': 100 };
      const result = calculateAverages(stats, 0);
      expect(result).toEqual({});
    });

    it('handles empty stats', () => {
      const result = calculateAverages({}, 10);
      expect(result).toEqual({});
    });
  });

  describe('findLeaders', () => {
    const createPlayer = (key: string, avgPts: number): PlayerStats => ({
      playerKey: key,
      name: `Player ${key}`,
      gamesPlayed: 10,
      stats: { '12': avgPts * 10 },
      averages: { '12': avgPts },
    });

    it('finds single leader for positive stat', () => {
      const players = [
        createPlayer('p1', 25),
        createPlayer('p2', 20),
        createPlayer('p3', 22),
      ];

      const result = findLeaders(players, '12', false);

      expect(result.leaders).toEqual(['p1']);
      expect(result.isTied).toBe(false);
    });

    it('detects tied leaders for positive stat', () => {
      const players = [
        createPlayer('p1', 25),
        createPlayer('p2', 25),
        createPlayer('p3', 20),
      ];

      const result = findLeaders(players, '12', false);

      expect(result.leaders).toContain('p1');
      expect(result.leaders).toContain('p2');
      expect(result.leaders).toHaveLength(2);
      expect(result.isTied).toBe(true);
    });

    it('finds leader for negative stat (lower is better)', () => {
      const players: PlayerStats[] = [
        { playerKey: 'p1', name: 'P1', gamesPlayed: 10, stats: { '19': 40 }, averages: { '19': 4.0 } },
        { playerKey: 'p2', name: 'P2', gamesPlayed: 10, stats: { '19': 25 }, averages: { '19': 2.5 } },
        { playerKey: 'p3', name: 'P3', gamesPlayed: 10, stats: { '19': 30 }, averages: { '19': 3.0 } },
      ];

      const result = findLeaders(players, '19', true);

      expect(result.leaders).toEqual(['p2']); // Lowest turnovers wins
      expect(result.isTied).toBe(false);
    });

    it('handles empty player array', () => {
      const result = findLeaders([], '12', false);
      expect(result.leaders).toEqual([]);
      expect(result.isTied).toBe(false);
    });
  });

  describe('comparePlayers', () => {
    it('compares two players across categories', () => {
      const players: PlayerStats[] = [
        {
          playerKey: 'p1',
          name: 'LeBron James',
          position: 'SF',
          team: 'LAL',
          gamesPlayed: 20,
          stats: { '12': 500, '15': 160, '16': 140, '19': 80 },
          averages: { '12': 25, '15': 8, '16': 7, '19': 4 },
        },
        {
          playerKey: 'p2',
          name: 'Stephen Curry',
          position: 'PG',
          team: 'GSW',
          gamesPlayed: 20,
          stats: { '12': 520, '15': 100, '16': 120, '19': 60 },
          averages: { '12': 26, '15': 5, '16': 6, '19': 3 },
        },
      ];

      const categories: StatCategory[] = [
        { stat_id: '12', name: 'Points', abbr: 'PTS' },
        { stat_id: '15', name: 'Rebounds', abbr: 'REB' },
        { stat_id: '16', name: 'Assists', abbr: 'AST' },
        { stat_id: '19', name: 'Turnovers', abbr: 'TO' },
      ];

      const result = comparePlayers(players, categories);

      expect(result.players).toHaveLength(2);
      expect(result.comparisons).toHaveLength(4);

      // Check PTS - Curry leads (26 > 25)
      const ptsComp = result.comparisons.find(c => c.statId === '12');
      expect(ptsComp?.players.find(p => p.playerKey === 'p2')?.isLeader).toBe(true);
      expect(ptsComp?.players.find(p => p.playerKey === 'p1')?.isLeader).toBe(false);

      // Check REB - LeBron leads (8 > 5)
      const rebComp = result.comparisons.find(c => c.statId === '15');
      expect(rebComp?.players.find(p => p.playerKey === 'p1')?.isLeader).toBe(true);

      // Check TO - Curry leads (3 < 4, lower is better)
      const toComp = result.comparisons.find(c => c.statId === '19');
      expect(toComp?.isNegative).toBe(true);
      expect(toComp?.players.find(p => p.playerKey === 'p2')?.isLeader).toBe(true);

      // Check summary
      // Curry wins: PTS, TO = 2
      // LeBron wins: REB, AST = 2
      expect(result.summary.playerWins['p1']).toBe(2);
      expect(result.summary.playerWins['p2']).toBe(2);
      expect(result.summary.ties).toBe(0);
    });

    it('handles three-way comparison', () => {
      const players: PlayerStats[] = [
        {
          playerKey: 'p1',
          name: 'Player A',
          gamesPlayed: 10,
          stats: { '12': 250 },
          averages: { '12': 25 },
        },
        {
          playerKey: 'p2',
          name: 'Player B',
          gamesPlayed: 10,
          stats: { '12': 200 },
          averages: { '12': 20 },
        },
        {
          playerKey: 'p3',
          name: 'Player C',
          gamesPlayed: 10,
          stats: { '12': 220 },
          averages: { '12': 22 },
        },
      ];

      const categories: StatCategory[] = [
        { stat_id: '12', name: 'Points', abbr: 'PTS' },
      ];

      const result = comparePlayers(players, categories);

      expect(result.summary.playerWins['p1']).toBe(1);
      expect(result.summary.playerWins['p2']).toBe(0);
      expect(result.summary.playerWins['p3']).toBe(0);
    });

    it('tracks ties in summary', () => {
      const players: PlayerStats[] = [
        {
          playerKey: 'p1',
          name: 'Player A',
          gamesPlayed: 10,
          stats: { '12': 250 },
          averages: { '12': 25 },
        },
        {
          playerKey: 'p2',
          name: 'Player B',
          gamesPlayed: 10,
          stats: { '12': 250 },
          averages: { '12': 25 },
        },
      ];

      const categories: StatCategory[] = [
        { stat_id: '12', name: 'Points', abbr: 'PTS' },
      ];

      const result = comparePlayers(players, categories);

      expect(result.summary.ties).toBe(1);
      expect(result.summary.playerWins['p1']).toBe(0);
      expect(result.summary.playerWins['p2']).toBe(0);
    });
  });

  describe('parseYahooPlayerData', () => {
    it('parses Yahoo player array format', () => {
      const yahooData = [
        [
          { player_key: '466.p.5482' },
          { name: { full: 'LeBron James', first: 'LeBron', last: 'James' } },
          { display_position: 'SF,PF' },
          { editorial_team_abbr: 'LAL' },
          { status: 'GTD' },
          { percent_owned: { value: '99.5' } },
        ],
        {
          player_stats: {
            stats: [
              { stat: { stat_id: '0', value: '20' } },
              { stat: { stat_id: '12', value: '500' } },
              { stat: { stat_id: '15', value: '160' } },
            ],
          },
        },
      ];

      const result = parseYahooPlayerData(yahooData);

      expect(result).not.toBeNull();
      expect(result?.playerKey).toBe('466.p.5482');
      expect(result?.name).toBe('LeBron James');
      expect(result?.position).toBe('SF,PF');
      expect(result?.team).toBe('LAL');
      expect(result?.status).toBe('GTD');
      expect(result?.percentOwned).toBe(99.5);
      expect(result?.gamesPlayed).toBe(20);
      expect(result?.stats['12']).toBe(500);
      expect(result?.stats['15']).toBe(160);
      expect(result?.averages['12']).toBe(25); // 500 / 20
    });

    it('handles missing data gracefully', () => {
      const yahooData = [
        [{ player_key: '466.p.1234' }],
      ];

      const result = parseYahooPlayerData(yahooData);

      expect(result).not.toBeNull();
      expect(result?.playerKey).toBe('466.p.1234');
      expect(result?.name).toBe('Unknown');
      expect(result?.gamesPlayed).toBe(0);
    });

    it('returns null for null input', () => {
      expect(parseYahooPlayerData(null)).toBeNull();
    });
  });

  describe('filterPlayersByName', () => {
    const players = [
      { name: 'LeBron James', key: 'p1' },
      { name: 'Stephen Curry', key: 'p2' },
      { name: 'James Harden', key: 'p3' },
      { name: 'Anthony Davis', key: 'p4' },
    ];

    it('filters by partial name match', () => {
      const result = filterPlayersByName(players, 'James');
      expect(result).toHaveLength(2);
      expect(result.map(p => p.key)).toContain('p1');
      expect(result.map(p => p.key)).toContain('p3');
    });

    it('is case insensitive', () => {
      const result = filterPlayersByName(players, 'LEBRON');
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('p1');
    });

    it('returns empty for short queries', () => {
      expect(filterPlayersByName(players, 'L')).toEqual([]);
      expect(filterPlayersByName(players, '')).toEqual([]);
    });

    it('returns empty for no matches', () => {
      const result = filterPlayersByName(players, 'Giannis');
      expect(result).toHaveLength(0);
    });
  });
});
