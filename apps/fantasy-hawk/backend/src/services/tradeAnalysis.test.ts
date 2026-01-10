import { describe, it, expect } from 'vitest';
import {
  isNegativeCategory,
  aggregatePlayerStats,
  calculateCategoryImpact,
  calculateTradeGrade,
  analyzeTrade,
  type StatCategory,
  type PlayerData,
} from './tradeAnalysis';

describe('Trade Analysis Service', () => {
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
    });
  });

  describe('aggregatePlayerStats', () => {
    it('aggregates stats from multiple players', () => {
      const players: PlayerData[] = [
        {
          playerKey: 'p1',
          name: 'Player 1',
          stats: { '12': 20, '15': 8, '16': 5 },
        },
        {
          playerKey: 'p2',
          name: 'Player 2',
          stats: { '12': 15, '15': 10, '16': 3 },
        },
      ];

      const result = aggregatePlayerStats(players);

      expect(result['12']).toBe(35); // 20 + 15 points
      expect(result['15']).toBe(18); // 8 + 10 rebounds
      expect(result['16']).toBe(8); // 5 + 3 assists
    });

    it('handles empty player array', () => {
      const result = aggregatePlayerStats([]);
      expect(result).toEqual({});
    });

    it('handles player with no stats', () => {
      const players: PlayerData[] = [
        { playerKey: 'p1', name: 'Player 1', stats: {} },
      ];

      const result = aggregatePlayerStats(players);
      expect(result).toEqual({});
    });
  });

  describe('calculateCategoryImpact', () => {
    it('calculates positive impact when receiving more', () => {
      const giveStats = { '12': 20 }; // 20 points
      const receiveStats = { '12': 25 }; // 25 points
      const categories: StatCategory[] = [
        { stat_id: '12', name: 'Points', abbr: 'PTS' },
      ];

      const result = calculateCategoryImpact(giveStats, receiveStats, categories);

      expect(result[0].giving).toBe(20);
      expect(result[0].receiving).toBe(25);
      expect(result[0].netChange).toBe(5);
      expect(result[0].impact).toBe('positive');
    });

    it('calculates negative impact when giving more', () => {
      const giveStats = { '12': 25 };
      const receiveStats = { '12': 20 };
      const categories: StatCategory[] = [
        { stat_id: '12', name: 'Points', abbr: 'PTS' },
      ];

      const result = calculateCategoryImpact(giveStats, receiveStats, categories);

      expect(result[0].netChange).toBe(-5);
      expect(result[0].impact).toBe('negative');
    });

    it('handles turnovers correctly (negative category)', () => {
      const giveStats = { '19': 3 }; // 3 turnovers
      const receiveStats = { '19': 5 }; // 5 turnovers

      const categories: StatCategory[] = [
        { stat_id: '19', name: 'Turnovers', abbr: 'TO' },
      ];

      const result = calculateCategoryImpact(giveStats, receiveStats, categories);

      // More TOs = negative for you, so netChange of +2 should be negative impact
      expect(result[0].netChange).toBe(2);
      expect(result[0].isNegative).toBe(true);
      expect(result[0].impact).toBe('negative');
    });

    it('handles turnovers reduction correctly', () => {
      const giveStats = { '19': 5 }; // 5 turnovers
      const receiveStats = { '19': 3 }; // 3 turnovers

      const categories: StatCategory[] = [
        { stat_id: '19', name: 'Turnovers', abbr: 'TO' },
      ];

      const result = calculateCategoryImpact(giveStats, receiveStats, categories);

      // Fewer TOs = positive for you
      expect(result[0].netChange).toBe(-2);
      expect(result[0].impact).toBe('positive');
    });

    it('marks neutral for no change', () => {
      const giveStats = { '12': 20 };
      const receiveStats = { '12': 20 };
      const categories: StatCategory[] = [
        { stat_id: '12', name: 'Points', abbr: 'PTS' },
      ];

      const result = calculateCategoryImpact(giveStats, receiveStats, categories);

      expect(result[0].netChange).toBe(0);
      expect(result[0].impact).toBe('neutral');
    });
  });

  describe('calculateTradeGrade', () => {
    it('returns grade A for +3 or more categories gained', () => {
      const impacts = [
        { statId: '1', name: '', displayName: '', giving: 0, receiving: 10, netChange: 10, isNegative: false, impact: 'positive' as const },
        { statId: '2', name: '', displayName: '', giving: 0, receiving: 10, netChange: 10, isNegative: false, impact: 'positive' as const },
        { statId: '3', name: '', displayName: '', giving: 0, receiving: 10, netChange: 10, isNegative: false, impact: 'positive' as const },
        { statId: '4', name: '', displayName: '', giving: 10, receiving: 10, netChange: 0, isNegative: false, impact: 'neutral' as const },
      ];

      const result = calculateTradeGrade(impacts);

      expect(result.grade).toBe('A');
      expect(result.categoriesGained).toBe(3);
      expect(result.categoriesLost).toBe(0);
      expect(result.netCategories).toBe(3);
    });

    it('returns grade B for +1 to +2 categories', () => {
      const impacts = [
        { statId: '1', name: '', displayName: '', giving: 0, receiving: 10, netChange: 10, isNegative: false, impact: 'positive' as const },
        { statId: '2', name: '', displayName: '', giving: 10, receiving: 10, netChange: 0, isNegative: false, impact: 'neutral' as const },
      ];

      const result = calculateTradeGrade(impacts);

      expect(result.grade).toBe('B');
      expect(result.netCategories).toBe(1);
    });

    it('returns grade C for even trade', () => {
      const impacts = [
        { statId: '1', name: '', displayName: '', giving: 0, receiving: 10, netChange: 10, isNegative: false, impact: 'positive' as const },
        { statId: '2', name: '', displayName: '', giving: 10, receiving: 0, netChange: -10, isNegative: false, impact: 'negative' as const },
      ];

      const result = calculateTradeGrade(impacts);

      expect(result.grade).toBe('C');
      expect(result.netCategories).toBe(0);
    });

    it('returns grade D for -1 to -2 categories', () => {
      const impacts = [
        { statId: '1', name: '', displayName: '', giving: 10, receiving: 0, netChange: -10, isNegative: false, impact: 'negative' as const },
        { statId: '2', name: '', displayName: '', giving: 10, receiving: 10, netChange: 0, isNegative: false, impact: 'neutral' as const },
      ];

      const result = calculateTradeGrade(impacts);

      expect(result.grade).toBe('D');
      expect(result.netCategories).toBe(-1);
    });

    it('returns grade F for -3 or worse', () => {
      const impacts = [
        { statId: '1', name: '', displayName: '', giving: 10, receiving: 0, netChange: -10, isNegative: false, impact: 'negative' as const },
        { statId: '2', name: '', displayName: '', giving: 10, receiving: 0, netChange: -10, isNegative: false, impact: 'negative' as const },
        { statId: '3', name: '', displayName: '', giving: 10, receiving: 0, netChange: -10, isNegative: false, impact: 'negative' as const },
      ];

      const result = calculateTradeGrade(impacts);

      expect(result.grade).toBe('F');
      expect(result.netCategories).toBe(-3);
    });
  });

  describe('analyzeTrade', () => {
    it('performs full trade analysis', () => {
      const playersToGive: PlayerData[] = [
        {
          playerKey: 'p1',
          name: 'LeBron James',
          position: 'SF',
          team: 'LAL',
          stats: { '12': 25, '15': 8, '16': 7, '19': 4 },
        },
      ];

      const playersToReceive: PlayerData[] = [
        {
          playerKey: 'p2',
          name: 'Trae Young',
          position: 'PG',
          team: 'ATL',
          stats: { '12': 26, '15': 4, '16': 10, '19': 5 },
        },
      ];

      const result = analyzeTrade(playersToGive, playersToReceive, sampleCategories);

      expect(result.playersGiving).toHaveLength(1);
      expect(result.playersGiving[0].name).toBe('LeBron James');
      expect(result.playersReceiving).toHaveLength(1);
      expect(result.playersReceiving[0].name).toBe('Trae Young');
      expect(result.categoryImpact.length).toBe(sampleCategories.length);
      expect(result.summary).toBeDefined();
      expect(result.summary.grade).toBeDefined();
    });

    it('handles multi-player trades', () => {
      const playersToGive: PlayerData[] = [
        { playerKey: 'p1', name: 'Player A', stats: { '12': 20, '15': 10 } },
      ];

      const playersToReceive: PlayerData[] = [
        { playerKey: 'p2', name: 'Player B', stats: { '12': 12, '15': 6 } },
        { playerKey: 'p3', name: 'Player C', stats: { '12': 10, '15': 7 } },
      ];

      const categories: StatCategory[] = [
        { stat_id: '12', name: 'Points', abbr: 'PTS' },
        { stat_id: '15', name: 'Rebounds', abbr: 'REB' },
      ];

      const result = analyzeTrade(playersToGive, playersToReceive, categories);

      // Giving 20 PTS, receiving 12+10=22
      const ptsImpact = result.categoryImpact.find(c => c.statId === '12');
      expect(ptsImpact?.giving).toBe(20);
      expect(ptsImpact?.receiving).toBe(22);
      expect(ptsImpact?.netChange).toBe(2);
      expect(ptsImpact?.impact).toBe('positive');

      // Giving 10 REB, receiving 6+7=13
      const rebImpact = result.categoryImpact.find(c => c.statId === '15');
      expect(rebImpact?.giving).toBe(10);
      expect(rebImpact?.receiving).toBe(13);
      expect(rebImpact?.impact).toBe('positive');
    });

    it('handles empty trade correctly', () => {
      const result = analyzeTrade([], [], sampleCategories);

      expect(result.playersGiving).toHaveLength(0);
      expect(result.playersReceiving).toHaveLength(0);
      expect(result.summary.netCategories).toBe(0);
      expect(result.summary.grade).toBe('C');
    });

    it('calculates realistic trade scenario', () => {
      // Trading a points specialist for a rebounds/blocks specialist
      const playersToGive: PlayerData[] = [
        {
          playerKey: 'scorer',
          name: 'Elite Scorer',
          stats: {
            '12': 28, // Points - high
            '15': 4,  // Rebounds - low
            '16': 5,  // Assists
            '17': 1,  // Steals
            '18': 0,  // Blocks - low
            '19': 3,  // Turnovers
          },
        },
      ];

      const playersToReceive: PlayerData[] = [
        {
          playerKey: 'big',
          name: 'Elite Big Man',
          stats: {
            '12': 16, // Points - lower
            '15': 12, // Rebounds - high
            '16': 2,  // Assists
            '17': 1,  // Steals
            '18': 3,  // Blocks - high
            '19': 2,  // Turnovers - better
          },
        },
      ];

      const categories: StatCategory[] = [
        { stat_id: '12', name: 'Points', abbr: 'PTS' },
        { stat_id: '15', name: 'Rebounds', abbr: 'REB' },
        { stat_id: '16', name: 'Assists', abbr: 'AST' },
        { stat_id: '17', name: 'Steals', abbr: 'STL' },
        { stat_id: '18', name: 'Blocks', abbr: 'BLK' },
        { stat_id: '19', name: 'Turnovers', abbr: 'TO' },
      ];

      const result = analyzeTrade(playersToGive, playersToReceive, categories);

      // Check specific impacts
      const ptsImpact = result.categoryImpact.find(c => c.displayName === 'PTS');
      expect(ptsImpact?.impact).toBe('negative'); // Losing points

      const rebImpact = result.categoryImpact.find(c => c.displayName === 'REB');
      expect(rebImpact?.impact).toBe('positive'); // Gaining rebounds

      const blkImpact = result.categoryImpact.find(c => c.displayName === 'BLK');
      expect(blkImpact?.impact).toBe('positive'); // Gaining blocks

      const toImpact = result.categoryImpact.find(c => c.displayName === 'TO');
      expect(toImpact?.impact).toBe('positive'); // Fewer turnovers = good

      // Net: Lose PTS, AST. Gain REB, BLK, TO
      // Net = 3 - 2 = +1, should be grade B
      expect(result.summary.grade).toBe('B');
    });
  });
});
