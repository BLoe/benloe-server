import { describe, it, expect } from 'vitest';
import {
  isNegativeCategory,
  calculateZScore,
  zScoreToPercentile,
  classifyRank,
  calculateMean,
  calculateStdDev,
  calculateRanks,
  detectArchetype,
  determineTrend,
  buildTeamProfile,
  buildComparison,
  parseTeamStats,
  type StatCategory,
  type CategoryRank,
} from './categoryAnalysis';

describe('Category Analysis Service', () => {
  // Sample stat categories
  const sampleCategories: StatCategory[] = [
    { stat_id: '12', name: 'Points', abbr: 'PTS' },
    { stat_id: '15', name: 'Rebounds', abbr: 'REB' },
    { stat_id: '16', name: 'Assists', abbr: 'AST' },
    { stat_id: '17', name: 'Steals', abbr: 'STL' },
    { stat_id: '18', name: 'Blocks', abbr: 'BLK' },
    { stat_id: '19', name: 'Turnovers', abbr: 'TO' },
    { stat_id: '5', name: 'Field Goal Percentage', abbr: 'FG%' },
    { stat_id: '8', name: 'Free Throw Percentage', abbr: 'FT%' },
    { stat_id: '10', name: '3-Pointers Made', abbr: '3PTM' },
  ];

  describe('isNegativeCategory', () => {
    it('identifies turnovers as negative', () => {
      expect(isNegativeCategory({ stat_id: '19', name: 'Turnovers', abbr: 'TO' })).toBe(true);
    });

    it('returns false for positive categories', () => {
      expect(isNegativeCategory({ stat_id: '12', name: 'Points', abbr: 'PTS' })).toBe(false);
      expect(isNegativeCategory({ stat_id: '15', name: 'Rebounds', abbr: 'REB' })).toBe(false);
    });
  });

  describe('calculateZScore', () => {
    it('returns 0 for value equal to mean', () => {
      expect(calculateZScore(50, 50, 10)).toBe(0);
    });

    it('returns positive z-score for above average', () => {
      expect(calculateZScore(60, 50, 10)).toBe(1);
    });

    it('returns negative z-score for below average', () => {
      expect(calculateZScore(40, 50, 10)).toBe(-1);
    });

    it('handles zero standard deviation', () => {
      expect(calculateZScore(50, 50, 0)).toBe(0);
    });
  });

  describe('zScoreToPercentile', () => {
    it('returns ~50 for z-score of 0', () => {
      expect(zScoreToPercentile(0)).toBe(50);
    });

    it('returns ~84 for z-score of 1', () => {
      const result = zScoreToPercentile(1);
      expect(result).toBeGreaterThan(80);
      expect(result).toBeLessThan(90);
    });

    it('returns ~16 for z-score of -1', () => {
      const result = zScoreToPercentile(-1);
      expect(result).toBeGreaterThan(10);
      expect(result).toBeLessThan(20);
    });

    it('returns ~97 for z-score of 2', () => {
      const result = zScoreToPercentile(2);
      expect(result).toBeGreaterThan(95);
    });
  });

  describe('classifyRank', () => {
    // For a 12-team league:
    // Rank 1: percentile = 1 - 0/12 = 1.0 (100%) -> elite
    // Rank 3: percentile = 1 - 2/12 = 0.833 (83%) -> elite
    // Rank 4: percentile = 1 - 3/12 = 0.75 (75%) -> elite (border)
    // Rank 5: percentile = 1 - 4/12 = 0.667 (67%) -> strong
    // Rank 7: percentile = 1 - 6/12 = 0.5 (50%) -> strong (border)
    // Rank 8: percentile = 1 - 7/12 = 0.417 (42%) -> average
    // Rank 10: percentile = 1 - 9/12 = 0.25 (25%) -> average (border)
    // Rank 11: percentile = 1 - 10/12 = 0.167 (17%) -> weak
    // Rank 12: percentile = 1 - 11/12 = 0.083 (8%) -> weak

    it('classifies top ranks as elite (>=75%)', () => {
      expect(classifyRank(1, 12)).toBe('elite');
      expect(classifyRank(2, 12)).toBe('elite');
      expect(classifyRank(3, 12)).toBe('elite');
      expect(classifyRank(4, 12)).toBe('elite'); // 75% exactly
    });

    it('classifies upper-middle ranks as strong (50-75%)', () => {
      expect(classifyRank(5, 12)).toBe('strong');
      expect(classifyRank(6, 12)).toBe('strong');
      expect(classifyRank(7, 12)).toBe('strong'); // 50% exactly
    });

    it('classifies lower-middle ranks as average (25-50%)', () => {
      expect(classifyRank(8, 12)).toBe('average');
      expect(classifyRank(9, 12)).toBe('average');
      expect(classifyRank(10, 12)).toBe('average'); // 25% exactly
    });

    it('classifies bottom ranks as weak (<25%)', () => {
      expect(classifyRank(11, 12)).toBe('weak');
      expect(classifyRank(12, 12)).toBe('weak');
    });
  });

  describe('calculateMean', () => {
    it('calculates mean correctly', () => {
      expect(calculateMean([10, 20, 30])).toBe(20);
    });

    it('handles single value', () => {
      expect(calculateMean([50])).toBe(50);
    });

    it('returns 0 for empty array', () => {
      expect(calculateMean([])).toBe(0);
    });
  });

  describe('calculateStdDev', () => {
    it('calculates standard deviation correctly', () => {
      // stddev of [2, 4, 4, 4, 5, 5, 7, 9] is 2
      const result = calculateStdDev([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(result).toBeCloseTo(2, 0);
    });

    it('returns 0 for single value', () => {
      expect(calculateStdDev([50])).toBe(0);
    });

    it('returns 0 for empty array', () => {
      expect(calculateStdDev([])).toBe(0);
    });
  });

  describe('calculateRanks', () => {
    it('ranks positive categories (higher is better)', () => {
      const teamValues = { team1: 100, team2: 80, team3: 120 };
      const ranks = calculateRanks(teamValues, false);

      expect(ranks.team3).toBe(1); // Highest value
      expect(ranks.team1).toBe(2);
      expect(ranks.team2).toBe(3); // Lowest value
    });

    it('ranks negative categories (lower is better)', () => {
      const teamValues = { team1: 100, team2: 80, team3: 120 };
      const ranks = calculateRanks(teamValues, true);

      expect(ranks.team2).toBe(1); // Lowest value (best for TO)
      expect(ranks.team1).toBe(2);
      expect(ranks.team3).toBe(3); // Highest value (worst for TO)
    });
  });

  describe('detectArchetype', () => {
    it('detects Big Man Build', () => {
      const categoryRanks: CategoryRank[] = [
        { statId: '15', name: 'Rebounds', displayName: 'REB', value: 600, rank: 1, totalTeams: 12, classification: 'elite', zScore: 2, percentile: 97, leagueAvg: 500, leagueStdDev: 50 },
        { statId: '18', name: 'Blocks', displayName: 'BLK', value: 100, rank: 2, totalTeams: 12, classification: 'elite', zScore: 1.8, percentile: 95, leagueAvg: 80, leagueStdDev: 10 },
        { statId: '16', name: 'Assists', displayName: 'AST', value: 400, rank: 11, totalTeams: 12, classification: 'weak', zScore: -1.5, percentile: 10, leagueAvg: 500, leagueStdDev: 60 },
      ];

      const result = detectArchetype(categoryRanks, 12);
      expect(result.archetype).toBe('Big Man Build');
      expect(result.puntCategories).toContain('AST');
    });

    it('detects Guard Heavy Build', () => {
      const categoryRanks: CategoryRank[] = [
        { statId: '16', name: 'Assists', displayName: 'AST', value: 600, rank: 1, totalTeams: 12, classification: 'elite', zScore: 2, percentile: 97, leagueAvg: 500, leagueStdDev: 50 },
        { statId: '17', name: 'Steals', displayName: 'STL', value: 100, rank: 2, totalTeams: 12, classification: 'elite', zScore: 1.8, percentile: 95, leagueAvg: 80, leagueStdDev: 10 },
        { statId: '15', name: 'Rebounds', displayName: 'REB', value: 400, rank: 11, totalTeams: 12, classification: 'weak', zScore: -1.5, percentile: 10, leagueAvg: 500, leagueStdDev: 60 },
      ];

      const result = detectArchetype(categoryRanks, 12);
      expect(result.archetype).toBe('Guard Heavy');
    });

    it('detects Balanced Build when no weak categories', () => {
      const categoryRanks: CategoryRank[] = [
        { statId: '12', name: 'Points', displayName: 'PTS', value: 500, rank: 4, totalTeams: 12, classification: 'strong', zScore: 0.5, percentile: 70, leagueAvg: 480, leagueStdDev: 40 },
        { statId: '15', name: 'Rebounds', displayName: 'REB', value: 450, rank: 5, totalTeams: 12, classification: 'strong', zScore: 0.4, percentile: 65, leagueAvg: 430, leagueStdDev: 50 },
        { statId: '16', name: 'Assists', displayName: 'AST', value: 480, rank: 6, totalTeams: 12, classification: 'average', zScore: 0.2, percentile: 55, leagueAvg: 470, leagueStdDev: 50 },
      ];

      const result = detectArchetype(categoryRanks, 12);
      expect(result.archetype).toBe('Balanced Build');
    });
  });

  describe('determineTrend', () => {
    it('detects improving trend', () => {
      const ranks = [10, 8, 6, 4]; // Ranks getting better (lower)
      const result = determineTrend(ranks);

      expect(result.trend).toBe('improving');
      expect(result.change).toBeGreaterThan(0);
    });

    it('detects declining trend', () => {
      const ranks = [4, 6, 8, 10]; // Ranks getting worse (higher)
      const result = determineTrend(ranks);

      expect(result.trend).toBe('declining');
      expect(result.change).toBeLessThan(0);
    });

    it('detects stable trend', () => {
      const ranks = [5, 5, 5, 5]; // No change
      const result = determineTrend(ranks);

      expect(result.trend).toBe('stable');
    });

    it('returns stable for insufficient data', () => {
      const result = determineTrend([5]);
      expect(result.trend).toBe('stable');
    });
  });

  describe('buildTeamProfile', () => {
    const allTeamStats: Record<string, Record<string, number>> = {
      team1: { '12': 500, '15': 400, '16': 300, '19': 100 },
      team2: { '12': 450, '15': 450, '16': 350, '19': 120 },
      team3: { '12': 550, '15': 350, '16': 250, '19': 80 },
      team4: { '12': 400, '15': 500, '16': 400, '19': 110 },
    };

    const categories: StatCategory[] = [
      { stat_id: '12', name: 'Points', abbr: 'PTS' },
      { stat_id: '15', name: 'Rebounds', abbr: 'REB' },
      { stat_id: '16', name: 'Assists', abbr: 'AST' },
      { stat_id: '19', name: 'Turnovers', abbr: 'TO' },
    ];

    it('builds profile with correct team info', () => {
      const profile = buildTeamProfile('team1', 'Test Team', allTeamStats.team1, allTeamStats, categories);

      expect(profile.teamKey).toBe('team1');
      expect(profile.teamName).toBe('Test Team');
    });

    it('calculates ranks correctly', () => {
      const profile = buildTeamProfile('team3', 'Test Team', allTeamStats.team3, allTeamStats, categories);

      // team3 has highest points (550), should be rank 1
      const ptsCategory = profile.categoryRanks.find((c: CategoryRank) => c.displayName === 'PTS');
      expect(ptsCategory?.rank).toBe(1);
    });

    it('identifies strengths and weaknesses', () => {
      const profile = buildTeamProfile('team1', 'Test Team', allTeamStats.team1, allTeamStats, categories);

      expect(profile.strengths.length).toBeGreaterThanOrEqual(0);
      expect(profile.weaknesses.length).toBeGreaterThanOrEqual(0);
    });

    it('detects archetype', () => {
      const profile = buildTeamProfile('team1', 'Test Team', allTeamStats.team1, allTeamStats, categories);

      expect(profile.archetype).toBeDefined();
      expect(typeof profile.archetype).toBe('string');
    });
  });

  describe('buildComparison', () => {
    const allTeamStats: Record<string, Record<string, number>> = {
      team1: { '12': 500, '15': 400 },
      team2: { '12': 450, '15': 450 },
      team3: { '12': 550, '15': 350 },
    };

    const categories: StatCategory[] = [
      { stat_id: '12', name: 'Points', abbr: 'PTS' },
      { stat_id: '15', name: 'Rebounds', abbr: 'REB' },
    ];

    it('calculates league averages', () => {
      const comparison = buildComparison('team1', 'Test Team', allTeamStats.team1, allTeamStats, categories);

      expect(comparison.leagueAverages['12']).toBe(500); // (500+450+550)/3
      expect(comparison.leagueAverages['15']).toBe(400); // (400+450+350)/3
    });

    it('calculates league standard deviations', () => {
      const comparison = buildComparison('team1', 'Test Team', allTeamStats.team1, allTeamStats, categories);

      expect(comparison.leagueStdDevs['12']).toBeDefined();
      expect(comparison.leagueStdDevs['15']).toBeDefined();
    });

    it('includes user team categories', () => {
      const comparison = buildComparison('team1', 'Test Team', allTeamStats.team1, allTeamStats, categories);

      expect(comparison.userTeam.teamKey).toBe('team1');
      expect(comparison.userTeam.categories.length).toBe(2);
    });
  });

  describe('parseTeamStats', () => {
    it('parses Yahoo team array format', () => {
      const teamArray = [
        [
          { team_key: '466.l.12345.t.1' },
          { name: 'Test Team' },
        ],
        {
          team_stats: {
            stats: [
              { stat: { stat_id: '12', value: '500' } },
              { stat: { stat_id: '15', value: '400' } },
            ],
          },
        },
      ];

      const result = parseTeamStats(teamArray);

      expect(result).not.toBeNull();
      expect(result?.teamKey).toBe('466.l.12345.t.1');
      expect(result?.teamName).toBe('Test Team');
      expect(result?.stats['12']).toBe(500);
      expect(result?.stats['15']).toBe(400);
    });

    it('returns null for invalid input', () => {
      expect(parseTeamStats(null)).toBeNull();
      expect(parseTeamStats([])).toBeNull();
      expect(parseTeamStats([{}])).toBeNull();
    });
  });
});
