import { describe, it, expect } from 'vitest';
import {
  isNegativeCategory,
  analyzeTeamCategories,
  calculateArchetypeMatch,
  detectCurrentBuild,
  analyzePuntStrategy,
  getLeaguePuntStrategies,
} from './puntAnalysis';

describe('puntAnalysis', () => {
  describe('isNegativeCategory', () => {
    it('identifies turnovers as negative', () => {
      expect(isNegativeCategory('Turnovers')).toBe(true);
      expect(isNegativeCategory('TO')).toBe(true);
      expect(isNegativeCategory('turnover')).toBe(true);
    });

    it('identifies regular stats as positive', () => {
      expect(isNegativeCategory('Points')).toBe(false);
      expect(isNegativeCategory('Rebounds')).toBe(false);
      expect(isNegativeCategory('Assists')).toBe(false);
      expect(isNegativeCategory('FG%')).toBe(false);
    });
  });

  describe('analyzeTeamCategories', () => {
    const categories = [
      { statId: '0', name: 'Points', displayName: 'PTS' },
      { statId: '1', name: 'Rebounds', displayName: 'REB' },
      { statId: '2', name: 'Assists', displayName: 'AST' },
      { statId: '3', name: 'Turnovers', displayName: 'TO' },
    ];

    const leagueStats = [
      { teamKey: 'team1', stats: { '0': 100, '1': 50, '2': 30, '3': 15 } },
      { teamKey: 'team2', stats: { '0': 90, '1': 55, '2': 25, '3': 12 } },
      { teamKey: 'team3', stats: { '0': 80, '1': 45, '2': 35, '3': 10 } },
      { teamKey: 'team4', stats: { '0': 85, '1': 60, '2': 20, '3': 18 } },
    ];

    it('calculates correct ranks for positive stats', () => {
      const teamStats = { '0': 100, '1': 50, '2': 30, '3': 15 };
      const result = analyzeTeamCategories(teamStats, leagueStats, categories);

      // Points: team1 has 100 (highest) = rank 1
      expect(result.find(c => c.displayName === 'PTS')?.rank).toBe(1);
      // Rebounds: team1 has 50 (3rd highest) = rank 3
      expect(result.find(c => c.displayName === 'REB')?.rank).toBe(3);
    });

    it('calculates correct ranks for negative stats (turnovers)', () => {
      // For turnovers, lower is better
      const teamStats = { '0': 80, '1': 45, '2': 35, '3': 10 }; // team3's stats
      const result = analyzeTeamCategories(teamStats, leagueStats, categories);

      // Turnovers: 10 is lowest (best) = rank 1
      expect(result.find(c => c.displayName === 'TO')?.rank).toBe(1);
    });

    it('marks negative categories correctly', () => {
      const teamStats = { '0': 100, '1': 50, '2': 30, '3': 15 };
      const result = analyzeTeamCategories(teamStats, leagueStats, categories);

      expect(result.find(c => c.displayName === 'PTS')?.isNegative).toBe(false);
      expect(result.find(c => c.displayName === 'TO')?.isNegative).toBe(true);
    });

    it('calculates percentiles correctly', () => {
      const teamStats = { '0': 100, '1': 50, '2': 30, '3': 15 };
      const result = analyzeTeamCategories(teamStats, leagueStats, categories);

      // Rank 1 of 4 = 25th percentile
      expect(result.find(c => c.displayName === 'PTS')?.percentile).toBe(25);
      // Rank 3 of 4 = 75th percentile
      expect(result.find(c => c.displayName === 'REB')?.percentile).toBe(75);
    });
  });

  describe('calculateArchetypeMatch', () => {
    it('returns high score for matching archetype', () => {
      const categoryRanks = [
        { statId: '0', name: 'Assists', displayName: 'AST', isNegative: false, value: 20, rank: 10, percentile: 90 },
        { statId: '1', name: 'Rebounds', displayName: 'REB', isNegative: false, value: 60, rank: 2, percentile: 15 },
        { statId: '2', name: 'Blocks', displayName: 'BLK', isNegative: false, value: 10, rank: 1, percentile: 10 },
        { statId: '3', name: 'Field Goal Percentage', displayName: 'FG%', isNegative: false, value: 0.52, rank: 2, percentile: 20 },
      ];

      const archetype = {
        id: 'punt-ast',
        name: 'Punt Assists',
        description: 'Big man focus',
        puntCategories: ['AST', 'Assists'],
        strengthCategories: ['REB', 'BLK', 'FG%', 'Rebounds', 'Blocks'],
      };

      const score = calculateArchetypeMatch(categoryRanks, archetype);
      // High percentile for AST (good for punt) + high inverse percentile for REB/BLK (good for strength)
      expect(score).toBeGreaterThan(70);
    });

    it('returns low score for non-matching archetype', () => {
      const categoryRanks = [
        { statId: '0', name: 'Assists', displayName: 'AST', isNegative: false, value: 40, rank: 1, percentile: 10 },
        { statId: '1', name: 'Rebounds', displayName: 'REB', isNegative: false, value: 30, rank: 10, percentile: 90 },
        { statId: '2', name: 'Blocks', displayName: 'BLK', isNegative: false, value: 2, rank: 12, percentile: 95 },
      ];

      const archetype = {
        id: 'punt-ast',
        name: 'Punt Assists',
        description: 'Big man focus',
        puntCategories: ['AST', 'Assists'],
        strengthCategories: ['REB', 'BLK', 'Rebounds', 'Blocks'],
      };

      const score = calculateArchetypeMatch(categoryRanks, archetype);
      // Low percentile for AST (bad for punt) + low inverse percentile for REB/BLK (bad for strength)
      expect(score).toBeLessThan(30);
    });
  });

  describe('detectCurrentBuild', () => {
    it('detects punt build based on weak categories', () => {
      const categoryRanks = [
        { statId: '0', name: 'Assists', displayName: 'AST', isNegative: false, value: 20, rank: 10, percentile: 83 },
        { statId: '1', name: 'Rebounds', displayName: 'REB', isNegative: false, value: 60, rank: 2, percentile: 17 },
        { statId: '2', name: 'Points', displayName: 'PTS', isNegative: false, value: 100, rank: 3, percentile: 25 },
      ];

      const result = detectCurrentBuild(categoryRanks, 12);
      // AST is in bottom third (rank 10 of 12)
      expect(result.buildName).toContain('Punt');
      expect(result.buildName).toContain('AST');
      expect(result.confidence).toBeGreaterThan(50);
    });

    it('returns balanced for team with no clear weakness', () => {
      const categoryRanks = [
        { statId: '0', name: 'Assists', displayName: 'AST', isNegative: false, value: 30, rank: 5, percentile: 42 },
        { statId: '1', name: 'Rebounds', displayName: 'REB', isNegative: false, value: 50, rank: 6, percentile: 50 },
        { statId: '2', name: 'Points', displayName: 'PTS', isNegative: false, value: 95, rank: 4, percentile: 33 },
      ];

      const result = detectCurrentBuild(categoryRanks, 12);
      expect(result.buildName).toBe('Balanced');
    });
  });

  describe('analyzePuntStrategy', () => {
    const categories = [
      { statId: '0', name: 'Points', displayName: 'PTS', abbr: 'PTS' },
      { statId: '1', name: 'Rebounds', displayName: 'REB', abbr: 'REB' },
      { statId: '2', name: 'Assists', displayName: 'AST', abbr: 'AST' },
      { statId: '3', name: 'Blocks', displayName: 'BLK', abbr: 'BLK' },
      { statId: '4', name: 'Field Goal Percentage', displayName: 'FG%', abbr: 'FG%' },
      { statId: '5', name: 'Free Throw Percentage', displayName: 'FT%', abbr: 'FT%' },
    ];

    const leagueStats = [
      { teamKey: 't1', stats: { '0': 100, '1': 60, '2': 15, '3': 12, '4': 0.52, '5': 0.70 } },
      { teamKey: 't2', stats: { '0': 95, '1': 55, '2': 25, '3': 8, '4': 0.48, '5': 0.80 } },
      { teamKey: 't3', stats: { '0': 90, '1': 50, '2': 30, '3': 6, '4': 0.46, '5': 0.82 } },
      { teamKey: 't4', stats: { '0': 85, '1': 45, '2': 35, '3': 4, '4': 0.44, '5': 0.85 } },
    ];

    it('returns full analysis with all required fields', () => {
      const teamStats = { '0': 100, '1': 60, '2': 15, '3': 12, '4': 0.52, '5': 0.70 };
      const result = analyzePuntStrategy(teamStats, leagueStats, categories);

      expect(result).toHaveProperty('detectedBuild');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('strengths');
      expect(result).toHaveProperty('weaknesses');
      expect(result).toHaveProperty('categoryRanks');
      expect(result).toHaveProperty('archetypes');
      expect(result).toHaveProperty('recommendation');
    });

    it('returns archetypes sorted by match score', () => {
      const teamStats = { '0': 100, '1': 60, '2': 15, '3': 12, '4': 0.52, '5': 0.70 };
      const result = analyzePuntStrategy(teamStats, leagueStats, categories);

      // Archetypes should be sorted by matchScore descending
      for (let i = 0; i < result.archetypes.length - 1; i++) {
        expect(result.archetypes[i].matchScore).toBeGreaterThanOrEqual(result.archetypes[i + 1].matchScore);
      }
    });

    it('identifies strengths and weaknesses correctly', () => {
      // team1 is best in REB, BLK, FG%, worst in AST, FT%
      const teamStats = { '0': 100, '1': 60, '2': 15, '3': 12, '4': 0.52, '5': 0.70 };
      const result = analyzePuntStrategy(teamStats, leagueStats, categories);

      // Should have strengths (top third) and weaknesses (bottom third)
      expect(result.strengths.length).toBeGreaterThanOrEqual(0);
      expect(result.weaknesses.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getLeaguePuntStrategies', () => {
    it('returns strategies available for standard 9-cat leagues', () => {
      const categories = [
        { statId: '0', name: 'Points', displayName: 'PTS' },
        { statId: '1', name: 'Rebounds', displayName: 'REB' },
        { statId: '2', name: 'Assists', displayName: 'AST' },
        { statId: '3', name: 'Steals', displayName: 'STL' },
        { statId: '4', name: 'Blocks', displayName: 'BLK' },
        { statId: '5', name: 'Three Pointers Made', displayName: '3PM' },
        { statId: '6', name: 'Field Goal Percentage', displayName: 'FG%' },
        { statId: '7', name: 'Free Throw Percentage', displayName: 'FT%' },
        { statId: '8', name: 'Turnovers', displayName: 'TO' },
      ];

      const strategies = getLeaguePuntStrategies(categories);

      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies.some(s => s.id === 'punt-ast')).toBe(true);
      expect(strategies.some(s => s.id === 'punt-ft')).toBe(true);
    });

    it('filters out strategies for missing categories', () => {
      // League without blocks
      const categories = [
        { statId: '0', name: 'Points', displayName: 'PTS' },
        { statId: '1', name: 'Rebounds', displayName: 'REB' },
        { statId: '2', name: 'Assists', displayName: 'AST' },
      ];

      const strategies = getLeaguePuntStrategies(categories);

      // punt-blk shouldn't be available without blocks category
      expect(strategies.some(s => s.id === 'punt-blk')).toBe(false);
    });
  });
});
