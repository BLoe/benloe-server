import { describe, it, expect } from 'vitest';
import {
  parseLeagueSettings,
  analyzeCategoryImportance,
  analyzePositionalValue,
  generateExploitableEdges,
  analyzeLeague,
  STANDARD_CATEGORIES,
  LeagueCategory,
} from './leagueInsights';

describe('leagueInsights', () => {
  // Standard 9-cat categories - matches STANDARD_CATEGORIES exactly
  const standardCategories: LeagueCategory[] = [
    { statId: '0', name: 'Points', displayName: 'PTS', abbr: 'PTS' },
    { statId: '1', name: 'Rebounds', displayName: 'REB', abbr: 'REB' },
    { statId: '2', name: 'Assists', displayName: 'AST', abbr: 'AST' },
    { statId: '4', name: 'Steals', displayName: 'STL', abbr: 'STL' },
    { statId: '5', name: 'Blocks', displayName: 'BLK', abbr: 'BLK' },
    { statId: '11', name: '3-Pointers Made', displayName: '3PM', abbr: '3PM' },
    { statId: '12', name: 'Field Goal Percentage', displayName: 'FG%', abbr: 'FG%' },
    { statId: '15', name: 'Free Throw Percentage', displayName: 'FT%', abbr: 'FT%' },
    { statId: '17', name: 'Turnovers', displayName: 'TO', abbr: 'TO' },
  ];

  // Non-standard categories (FGM instead of TO)
  const nonStandardCategories: LeagueCategory[] = [
    { statId: '0', name: 'Points', displayName: 'PTS', abbr: 'PTS' },
    { statId: '1', name: 'Rebounds', displayName: 'REB', abbr: 'REB' },
    { statId: '2', name: 'Assists', displayName: 'AST', abbr: 'AST' },
    { statId: '4', name: 'Steals', displayName: 'STL', abbr: 'STL' },
    { statId: '5', name: 'Blocks', displayName: 'BLK', abbr: 'BLK' },
    { statId: '11', name: '3-Pointers Made', displayName: '3PTM', abbr: '3PM' },
    { statId: '12', name: 'Field Goal Percentage', displayName: 'FG%', abbr: 'FG%' },
    { statId: '15', name: 'Free Throw Percentage', displayName: 'FT%', abbr: 'FT%' },
    { statId: '9', name: 'Field Goals Made', displayName: 'FGM', abbr: 'FGM' },
  ];

  // Categories with Double-Doubles
  const ddCategories: LeagueCategory[] = [
    ...standardCategories.slice(0, 8),
    { statId: '6', name: 'Double-Doubles', displayName: 'DD', abbr: 'DD' },
  ];

  describe('parseLeagueSettings', () => {
    it('identifies standard 9-cat league', () => {
      const result = parseLeagueSettings(standardCategories);

      expect(result.isStandard).toBe(true);
      expect(result.missingStandard).toHaveLength(0);
      expect(result.unusualCategories).toHaveLength(0);
    });

    it('identifies missing turnovers category', () => {
      const result = parseLeagueSettings(nonStandardCategories);

      expect(result.isStandard).toBe(false);
      expect(result.missingStandard).toContain('TO');
    });

    it('generates insight for FGM instead of TO', () => {
      const result = parseLeagueSettings(nonStandardCategories);

      expect(result.insights.length).toBeGreaterThan(0);
      expect(result.insights.some(i => i.category.includes('FGM'))).toBe(true);
    });

    it('identifies double-doubles category', () => {
      const result = parseLeagueSettings(ddCategories);

      expect(result.insights.some(i => i.category === 'DD')).toBe(true);
      expect(result.insights.find(i => i.category === 'DD')?.impact).toContain('big men');
    });

    it('parses head-to-head league type', () => {
      const result = parseLeagueSettings(standardCategories, 'head-to-head-one-win');

      expect(result.leagueType).toBe('head-to-head');
    });

    it('parses roto league type', () => {
      const result = parseLeagueSettings(standardCategories, 'roto');

      expect(result.leagueType).toBe('roto');
    });

    it('includes team count', () => {
      const result = parseLeagueSettings(standardCategories, 'head-to-head', 14);

      expect(result.numTeams).toBe(14);
    });
  });

  describe('analyzeCategoryImportance', () => {
    it('assigns high scarcity to blocks', () => {
      const result = analyzeCategoryImportance(standardCategories);
      const blkCategory = result.find(c => c.displayName === 'BLK');

      expect(blkCategory).toBeDefined();
      expect(blkCategory!.scarcity).toBeGreaterThan(70);
    });

    it('assigns high volatility to blocks and steals', () => {
      const result = analyzeCategoryImportance(standardCategories);
      const blkCategory = result.find(c => c.displayName === 'BLK');
      const stlCategory = result.find(c => c.displayName === 'STL');

      expect(blkCategory!.volatility).toBeGreaterThan(70);
      expect(stlCategory!.volatility).toBeGreaterThan(70);
    });

    it('assigns high streamability to points and 3PM', () => {
      const result = analyzeCategoryImportance(standardCategories);
      const ptsCategory = result.find(c => c.displayName === 'PTS');
      // 3PM category may have displayName of '3PTM' or '3PM' depending on league
      const threePmCategory = result.find(c => c.displayName === '3PTM' || c.displayName === '3PM');

      expect(ptsCategory!.streamability).toBeGreaterThan(60);
      expect(threePmCategory!.streamability).toBeGreaterThan(60);
    });

    it('assigns low streamability to percentages', () => {
      const result = analyzeCategoryImportance(standardCategories);
      const fgPctCategory = result.find(c => c.displayName === 'FG%');
      const ftPctCategory = result.find(c => c.displayName === 'FT%');

      expect(fgPctCategory!.streamability).toBeLessThan(50);
      expect(ftPctCategory!.streamability).toBeLessThan(50);
    });

    it('returns importance rating for each category', () => {
      const result = analyzeCategoryImportance(standardCategories);

      result.forEach(cat => {
        expect(['high', 'medium', 'low']).toContain(cat.importance);
      });
    });
  });

  describe('analyzePositionalValue', () => {
    it('returns all 5 positions', () => {
      const result = analyzePositionalValue(standardCategories);

      expect(result).toHaveLength(5);
      expect(result.map(p => p.position)).toEqual(['PG', 'SG', 'SF', 'PF', 'C']);
    });

    it('boosts guards when no TO category', () => {
      const result = analyzePositionalValue(nonStandardCategories);
      const pgValue = result.find(p => p.position === 'PG');

      expect(pgValue!.valueAdjustment).toBeGreaterThan(0);
    });

    it('boosts centers when DD category present', () => {
      const result = analyzePositionalValue(ddCategories);
      const cValue = result.find(p => p.position === 'C');

      expect(cValue!.valueAdjustment).toBeGreaterThan(0);
    });

    it('provides reason for adjustment', () => {
      const result = analyzePositionalValue(nonStandardCategories);

      result.forEach(pos => {
        expect(pos.reason).toBeDefined();
        expect(pos.reason.length).toBeGreaterThan(0);
      });
    });
  });

  describe('generateExploitableEdges', () => {
    it('generates edges for non-standard league', () => {
      const settings = parseLeagueSettings(nonStandardCategories);
      const edges = generateExploitableEdges(settings);

      expect(edges.length).toBeGreaterThan(0);
    });

    it('suggests targeting ball handlers when no TO', () => {
      const settings = parseLeagueSettings(nonStandardCategories);
      const edges = generateExploitableEdges(settings);

      expect(edges.some(e => e.toLowerCase().includes('ball handler') || e.toLowerCase().includes('turnover'))).toBe(true);
    });

    it('generates generic advice for standard league', () => {
      const settings = parseLeagueSettings(standardCategories);
      const edges = generateExploitableEdges(settings);

      expect(edges.some(e => e.includes('standard'))).toBe(true);
    });

    it('mentions specific players for FGM leagues', () => {
      const settings = parseLeagueSettings(nonStandardCategories);
      const edges = generateExploitableEdges(settings);

      expect(edges.some(e =>
        e.includes('Luka') || e.includes('Trae') || e.includes('Harden')
      )).toBe(true);
    });
  });

  describe('analyzeLeague', () => {
    it('returns complete analysis object', () => {
      const result = analyzeLeague(standardCategories);

      expect(result.settings).toBeDefined();
      expect(result.analysis).toBeDefined();
      expect(result.analysis.categoryImportance).toBeDefined();
      expect(result.analysis.positionalValue).toBeDefined();
      expect(result.analysis.exploitableEdges).toBeDefined();
      expect(result.analysis.recommendation).toBeDefined();
    });

    it('generates recommendation for standard league', () => {
      const result = analyzeLeague(standardCategories);

      expect(result.analysis.recommendation).toContain('standard');
    });

    it('generates recommendation for non-standard league', () => {
      const result = analyzeLeague(nonStandardCategories);

      expect(result.analysis.recommendation.length).toBeGreaterThan(20);
    });

    it('includes team count in settings', () => {
      const result = analyzeLeague(standardCategories, 'head-to-head', 10);

      expect(result.settings.numTeams).toBe(10);
    });
  });

  describe('STANDARD_CATEGORIES', () => {
    it('contains 9 categories', () => {
      expect(STANDARD_CATEGORIES).toHaveLength(9);
    });

    it('includes all expected categories', () => {
      const abbrs = STANDARD_CATEGORIES.map(c => c.abbr);

      expect(abbrs).toContain('PTS');
      expect(abbrs).toContain('REB');
      expect(abbrs).toContain('AST');
      expect(abbrs).toContain('STL');
      expect(abbrs).toContain('BLK');
      expect(abbrs).toContain('3PM');
      expect(abbrs).toContain('FG%');
      expect(abbrs).toContain('FT%');
      expect(abbrs).toContain('TO');
    });
  });
});
