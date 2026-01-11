import { describe, it, expect } from 'vitest';
import {
  isNegativeCategory,
  calculateAverages,
  parseYahooPlayer,
  analyzeTeamNeeds,
  scorePlayerForNeeds,
  getOwnershipTrend,
  generateRecommendations,
  identifyDropCandidates,
  calculateLeagueAverages,
  estimateCompetition,
  getSeasonProgress,
  calculateFaabSuggestion,
  generateFaabSuggestions,
  calculateLeagueAvgFaab,
  type StatCategory,
  type PlayerStats,
  type TeamNeeds,
  type WaiverRecommendation,
  type FaabContext,
} from './waiverAnalysis';

describe('Waiver Analysis Service', () => {
  // Sample stat categories
  const sampleCategories: StatCategory[] = [
    { stat_id: '12', name: 'Points', abbr: 'PTS' },
    { stat_id: '15', name: 'Rebounds', abbr: 'REB' },
    { stat_id: '16', name: 'Assists', abbr: 'AST' },
    { stat_id: '17', name: 'Steals', abbr: 'STL' },
    { stat_id: '18', name: 'Blocks', abbr: 'BLK' },
    { stat_id: '19', name: 'Turnovers', abbr: 'TO' },
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

  describe('calculateAverages', () => {
    it('calculates per-game averages', () => {
      const stats = { '12': 500, '15': 200 };
      const gamesPlayed = 20;

      const result = calculateAverages(stats, gamesPlayed);

      expect(result['12']).toBe(25);
      expect(result['15']).toBe(10);
    });

    it('returns empty for zero games', () => {
      const stats = { '12': 100 };
      const result = calculateAverages(stats, 0);
      expect(result).toEqual({});
    });
  });

  describe('parseYahooPlayer', () => {
    it('parses Yahoo player format', () => {
      const yahooData = [
        [
          { player_key: '466.p.5482' },
          { name: { full: 'LeBron James' } },
          { display_position: 'SF,PF' },
          { editorial_team_abbr: 'LAL' },
          { percent_owned: { value: '99.5' } },
        ],
        {
          player_stats: {
            stats: [
              { stat: { stat_id: '0', value: '20' } },
              { stat: { stat_id: '12', value: '500' } },
            ],
          },
        },
      ];

      const result = parseYahooPlayer(yahooData);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('LeBron James');
      expect(result?.team).toBe('LAL');
      expect(result?.percentOwned).toBe(99.5);
      expect(result?.gamesPlayed).toBe(20);
    });

    it('returns null for null input', () => {
      expect(parseYahooPlayer(null)).toBeNull();
    });
  });

  describe('analyzeTeamNeeds', () => {
    it('identifies strong categories (10%+ above average)', () => {
      const teamStats = { '12': 1100, '15': 500 }; // 10% above league avg
      const leagueAverages = { '12': 1000, '15': 500 };
      const categories: StatCategory[] = [
        { stat_id: '12', name: 'Points', abbr: 'PTS' },
        { stat_id: '15', name: 'Rebounds', abbr: 'REB' },
      ];

      const result = analyzeTeamNeeds(teamStats, leagueAverages, categories);

      expect(result.strong).toContain('12');
    });

    it('identifies weak categories (10%+ below average)', () => {
      const teamStats = { '12': 800, '15': 500 }; // 20% below league avg
      const leagueAverages = { '12': 1000, '15': 500 };
      const categories: StatCategory[] = [
        { stat_id: '12', name: 'Points', abbr: 'PTS' },
        { stat_id: '15', name: 'Rebounds', abbr: 'REB' },
      ];

      const result = analyzeTeamNeeds(teamStats, leagueAverages, categories);

      expect(result.weak).toContain('12');
    });

    it('handles turnovers correctly (lower is better)', () => {
      const teamStats = { '19': 80 }; // 20% below avg (good for TO)
      const leagueAverages = { '19': 100 };
      const categories: StatCategory[] = [
        { stat_id: '19', name: 'Turnovers', abbr: 'TO' },
      ];

      const result = analyzeTeamNeeds(teamStats, leagueAverages, categories);

      // Less turnovers = strong
      expect(result.strong).toContain('19');
    });
  });

  describe('scorePlayerForNeeds', () => {
    it('scores player higher when filling weak categories', () => {
      const player: PlayerStats = {
        playerKey: 'p1',
        name: 'Test Player',
        position: 'PG',
        team: 'LAL',
        percentOwned: 50,
        gamesPlayed: 25,
        stats: { '12': 500, '15': 200 },
        averages: { '12': 20, '15': 8 },
      };

      const teamNeedsWeak: TeamNeeds = {
        strong: [],
        weak: ['12'], // Need points
        neutral: ['15'],
      };

      const teamNeedsStrong: TeamNeeds = {
        strong: ['12'], // Already strong in points
        weak: [],
        neutral: ['15'],
      };

      const weakResult = scorePlayerForNeeds(player, teamNeedsWeak, sampleCategories);
      const strongResult = scorePlayerForNeeds(player, teamNeedsStrong, sampleCategories);

      // Should score higher when filling a need
      expect(weakResult.score).toBeGreaterThan(strongResult.score);
    });

    it('identifies categories player helps with', () => {
      const player: PlayerStats = {
        playerKey: 'p1',
        name: 'Test Player',
        position: 'PG',
        team: 'LAL',
        percentOwned: 50,
        gamesPlayed: 25,
        stats: { '12': 500 },
        averages: { '12': 20 },
      };

      const teamNeeds: TeamNeeds = {
        strong: [],
        weak: ['12'],
        neutral: [],
      };

      const result = scorePlayerForNeeds(player, teamNeeds, sampleCategories);

      expect(result.fillsNeeds).toContain('PTS');
    });
  });

  describe('getOwnershipTrend', () => {
    it('returns stable for low ownership', () => {
      expect(getOwnershipTrend(10)).toBe('stable');
    });

    it('returns stable for high ownership', () => {
      expect(getOwnershipTrend(80)).toBe('stable');
    });
  });

  describe('generateRecommendations', () => {
    const freeAgents: PlayerStats[] = [
      {
        playerKey: 'fa1',
        name: 'Free Agent 1',
        position: 'PG',
        team: 'LAL',
        percentOwned: 20,
        gamesPlayed: 25,
        stats: { '12': 400, '15': 75 },
        averages: { '12': 16, '15': 3 },
      },
      {
        playerKey: 'fa2',
        name: 'Free Agent 2',
        position: 'C',
        team: 'BOS',
        percentOwned: 25,
        gamesPlayed: 25,
        stats: { '12': 200, '15': 300 },
        averages: { '12': 8, '15': 12 },
      },
      {
        playerKey: 'fa3',
        name: 'Injured Player',
        position: 'SF',
        team: 'MIA',
        status: 'OUT',
        percentOwned: 40,
        gamesPlayed: 10,
        stats: { '12': 200 },
        averages: { '12': 20 },
      },
    ];

    const teamNeeds: TeamNeeds = {
      strong: [],
      weak: ['15'], // Need rebounds
      neutral: ['12'],
    };

    it('ranks players who fill needs higher', () => {
      const recommendations = generateRecommendations(
        freeAgents,
        teamNeeds,
        sampleCategories,
        { LAL: 3, BOS: 4, MIA: 3 },
        10
      );

      // Center with rebounds should rank high
      const centerRec = recommendations.find(r => r.player.playerKey === 'fa2');
      const pgRec = recommendations.find(r => r.player.playerKey === 'fa1');

      expect(centerRec).toBeDefined();
      expect(pgRec).toBeDefined();
      // Rebounder should score higher when team needs rebounds (and has more games)
      expect(centerRec!.score).toBeGreaterThan(pgRec!.score);
    });

    it('filters out injured players', () => {
      const recommendations = generateRecommendations(
        freeAgents,
        teamNeeds,
        sampleCategories,
        {},
        10
      );

      const injuredRec = recommendations.find(r => r.player.playerKey === 'fa3');
      expect(injuredRec).toBeUndefined();
    });

    it('filters by position when specified', () => {
      const recommendations = generateRecommendations(
        freeAgents,
        teamNeeds,
        sampleCategories,
        {},
        10,
        'C'
      );

      expect(recommendations).toHaveLength(1);
      expect(recommendations[0].player.position).toContain('C');
    });

    it('respects limit parameter', () => {
      const recommendations = generateRecommendations(
        freeAgents,
        teamNeeds,
        sampleCategories,
        {},
        1
      );

      expect(recommendations.length).toBeLessThanOrEqual(1);
    });
  });

  describe('identifyDropCandidates', () => {
    const roster: PlayerStats[] = [
      {
        playerKey: 'r1',
        name: 'Good Player',
        position: 'PG',
        team: 'LAL',
        percentOwned: 90,
        gamesPlayed: 25,
        stats: { '12': 500, '15': 200 },
        averages: { '12': 20, '15': 8 },
      },
      {
        playerKey: 'r2',
        name: 'Low Owned Player',
        position: 'C',
        team: 'BOS',
        percentOwned: 15,
        gamesPlayed: 25,
        stats: { '12': 200, '15': 125 },
        averages: { '12': 8, '15': 5 },
      },
      {
        playerKey: 'r3',
        name: 'IL Player',
        position: 'SF',
        team: 'MIA',
        status: 'IL',
        percentOwned: 80,
        gamesPlayed: 5,
        stats: { '12': 100 },
        averages: { '12': 20 },
      },
    ];

    const teamNeeds: TeamNeeds = {
      strong: ['12'],
      weak: ['15'],
      neutral: [],
    };

    it('suggests dropping low-owned players', () => {
      const candidates = identifyDropCandidates(roster, teamNeeds, sampleCategories);

      const lowOwnedCandidate = candidates.find(c => c.player.playerKey === 'r2');
      expect(lowOwnedCandidate).toBeDefined();
    });

    it('does not suggest dropping IL players', () => {
      const candidates = identifyDropCandidates(roster, teamNeeds, sampleCategories);

      const ilCandidate = candidates.find(c => c.player.playerKey === 'r3');
      expect(ilCandidate).toBeUndefined();
    });

    it('respects limit parameter', () => {
      const candidates = identifyDropCandidates(roster, teamNeeds, sampleCategories, 1);
      expect(candidates.length).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateLeagueAverages', () => {
    it('calculates averages across teams', () => {
      const teamStats = [
        { '12': 1000, '15': 500 },
        { '12': 800, '15': 600 },
        { '12': 1200, '15': 400 },
      ];

      const result = calculateLeagueAverages(teamStats);

      expect(result['12']).toBe(1000); // (1000+800+1200)/3
      expect(result['15']).toBe(500);  // (500+600+400)/3
    });

    it('handles empty array', () => {
      const result = calculateLeagueAverages([]);
      expect(result).toEqual({});
    });
  });

  // FAAB Tests
  describe('FAAB Suggestions', () => {
    const samplePlayer: PlayerStats = {
      playerKey: 'p1',
      name: 'Test Player',
      position: 'PG',
      team: 'LAL',
      percentOwned: 40,
      gamesPlayed: 20,
      stats: { '12': 400 },
      averages: { '12': 20 },
    };

    const sampleRecommendation: WaiverRecommendation = {
      player: samplePlayer,
      score: 8,
      reason: 'Helps in PTS, AST',
      fillsNeeds: ['PTS', 'AST'],
      gamesThisWeek: 4,
      trend: 'rising',
      priority: 'high',
    };

    const sampleContext: FaabContext = {
      userFaabBalance: 67,
      totalFaabBudget: 100,
      leagueAvgFaab: 52,
      weeksRemaining: 10,
      isPlayoffs: false,
    };

    describe('estimateCompetition', () => {
      it('returns high for high priority with decent ownership', () => {
        expect(estimateCompetition(40, 'high')).toBe('high');
      });

      it('returns medium for high priority with low ownership', () => {
        expect(estimateCompetition(15, 'high')).toBe('medium');
      });

      it('returns low for low priority and low ownership', () => {
        expect(estimateCompetition(10, 'low')).toBe('low');
      });

      it('returns medium for very high ownership', () => {
        expect(estimateCompetition(60, 'medium')).toBe('medium');
      });
    });

    describe('getSeasonProgress', () => {
      it('returns 0 at start of season', () => {
        expect(getSeasonProgress(20, 20)).toBe(0);
      });

      it('returns 1 at end of season', () => {
        expect(getSeasonProgress(0, 20)).toBe(1);
      });

      it('returns 0.5 at midseason', () => {
        expect(getSeasonProgress(10, 20)).toBe(0.5);
      });

      it('clamps to 0-1 range', () => {
        expect(getSeasonProgress(25, 20)).toBe(0);
        expect(getSeasonProgress(-5, 20)).toBe(1);
      });
    });

    describe('calculateFaabSuggestion', () => {
      it('returns higher bid for high priority players', () => {
        const highPriority: WaiverRecommendation = { ...sampleRecommendation, priority: 'high' };
        const lowPriority: WaiverRecommendation = { ...sampleRecommendation, priority: 'low' };

        const highResult = calculateFaabSuggestion(highPriority, sampleContext);
        const lowResult = calculateFaabSuggestion(lowPriority, sampleContext);

        expect(highResult.suggestedBid).toBeGreaterThan(lowResult.suggestedBid);
      });

      it('respects budget constraints', () => {
        const lowBudgetContext: FaabContext = { ...sampleContext, userFaabBalance: 5 };
        const result = calculateFaabSuggestion(sampleRecommendation, lowBudgetContext);

        expect(result.suggestedBid).toBeLessThanOrEqual(5);
      });

      it('calculates percentage of budget correctly', () => {
        const result = calculateFaabSuggestion(sampleRecommendation, sampleContext);
        const expectedPercent = Math.round((result.suggestedBid / 100) * 100);

        expect(result.percentOfBudget).toBe(expectedPercent);
      });

      it('sets bid range appropriately', () => {
        const result = calculateFaabSuggestion(sampleRecommendation, sampleContext);

        expect(result.bidRangeMin).toBeLessThan(result.suggestedBid);
        expect(result.bidRangeMax).toBeGreaterThan(result.suggestedBid);
        expect(result.bidRangeMin).toBeGreaterThanOrEqual(1);
      });

      it('includes reasoning based on priority', () => {
        const result = calculateFaabSuggestion(sampleRecommendation, sampleContext);

        expect(result.reasoning).toContain('High-impact');
      });

      it('increases bid during playoffs', () => {
        const regularContext: FaabContext = { ...sampleContext, isPlayoffs: false };
        const playoffContext: FaabContext = { ...sampleContext, isPlayoffs: true };

        const regularResult = calculateFaabSuggestion(sampleRecommendation, regularContext);
        const playoffResult = calculateFaabSuggestion(sampleRecommendation, playoffContext);

        expect(playoffResult.suggestedBid).toBeGreaterThanOrEqual(regularResult.suggestedBid);
      });
    });

    describe('generateFaabSuggestions', () => {
      const recommendations: WaiverRecommendation[] = [
        { ...sampleRecommendation, priority: 'high' },
        { ...sampleRecommendation, player: { ...samplePlayer, playerKey: 'p2' }, priority: 'medium' },
        { ...sampleRecommendation, player: { ...samplePlayer, playerKey: 'p3' }, priority: 'low' },
      ];

      it('generates suggestions for all recommendations', () => {
        const suggestions = generateFaabSuggestions(recommendations, sampleContext);

        expect(suggestions).toHaveLength(3);
      });

      it('respects limit parameter', () => {
        const suggestions = generateFaabSuggestions(recommendations, sampleContext, 2);

        expect(suggestions).toHaveLength(2);
      });

      it('returns empty when no budget remaining', () => {
        const noBudgetContext: FaabContext = { ...sampleContext, userFaabBalance: 0 };
        const suggestions = generateFaabSuggestions(recommendations, noBudgetContext);

        expect(suggestions).toHaveLength(0);
      });
    });

    describe('calculateLeagueAvgFaab', () => {
      it('calculates average correctly', () => {
        const balances = [100, 50, 75, 25];
        expect(calculateLeagueAvgFaab(balances)).toBe(63); // (100+50+75+25)/4 = 62.5 → 63
      });

      it('returns 0 for empty array', () => {
        expect(calculateLeagueAvgFaab([])).toBe(0);
      });
    });
  });
});
