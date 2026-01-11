import { describe, it, expect } from 'vitest';

/**
 * Standalone projection functions for testing
 * These mirror the logic in fantasy.ts routes
 */

interface TeamStanding {
  teamKey: string;
  teamName: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  isCurrentUser: boolean;
}

interface StandingsProjection {
  teamKey: string;
  teamName: string;
  currentRank: number;
  projectedRank: number;
  currentWins: number;
  currentLosses: number;
  currentTies: number;
  projectedWins: number;
  projectedLosses: number;
  projectedTies: number;
  winPace: number;
  gamesPlayed: number;
  gamesRemaining: number;
  isCurrentUser: boolean;
  trend: 'improving' | 'stable' | 'declining';
}

function projectStandings(
  teams: TeamStanding[],
  currentWeek: number,
  totalWeeks: number
): StandingsProjection[] {
  const weeksPlayed = currentWeek - 1;
  const weeksRemaining = totalWeeks - weeksPlayed;

  const projections: StandingsProjection[] = teams.map(team => {
    const gamesPlayed = team.wins + team.losses + team.ties;
    const gamesPerWeek = gamesPlayed > 0 && weeksPlayed > 0 ? gamesPlayed / weeksPlayed : 0;

    const winRate = gamesPlayed > 0
      ? (team.wins + team.ties * 0.5) / gamesPlayed
      : 0.5;

    const gamesRemaining = Math.round(gamesPerWeek * weeksRemaining);
    const projectedAdditionalWins = Math.round(gamesRemaining * winRate);
    const projectedAdditionalLosses = Math.round(gamesRemaining * (1 - winRate));
    const winPace = weeksPlayed > 0 ? team.wins / weeksPlayed : 0;

    const avgWinRate = teams.reduce((sum, t) => {
      const g = t.wins + t.losses + t.ties;
      return sum + (g > 0 ? t.wins / g : 0.5);
    }, 0) / teams.length;

    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (winRate > avgWinRate + 0.05) trend = 'improving';
    if (winRate < avgWinRate - 0.05) trend = 'declining';

    return {
      teamKey: team.teamKey,
      teamName: team.teamName,
      currentRank: team.rank,
      projectedRank: 0,
      currentWins: team.wins,
      currentLosses: team.losses,
      currentTies: team.ties,
      projectedWins: team.wins + projectedAdditionalWins,
      projectedLosses: team.losses + projectedAdditionalLosses,
      projectedTies: team.ties,
      winPace: Math.round(winPace * 100) / 100,
      gamesPlayed,
      gamesRemaining,
      isCurrentUser: team.isCurrentUser,
      trend,
    };
  });

  const sortedByProjectedWins = [...projections].sort((a, b) => {
    if (b.projectedWins !== a.projectedWins) {
      return b.projectedWins - a.projectedWins;
    }
    return a.currentRank - b.currentRank;
  });

  sortedByProjectedWins.forEach((p, index) => {
    const original = projections.find(proj => proj.teamKey === p.teamKey);
    if (original) {
      original.projectedRank = index + 1;
    }
  });

  return projections;
}

function calculateWinPace(wins: number, weeksPlayed: number): number {
  return weeksPlayed > 0 ? Math.round((wins / weeksPlayed) * 100) / 100 : 0;
}

function calculateWinRate(wins: number, losses: number, ties: number): number {
  const total = wins + losses + ties;
  return total > 0 ? (wins + ties * 0.5) / total : 0.5;
}

describe('Season Outlook Projections', () => {
  describe('calculateWinPace', () => {
    it('should calculate correct win pace', () => {
      expect(calculateWinPace(50, 10)).toBe(5);
      expect(calculateWinPace(45, 9)).toBe(5);
      expect(calculateWinPace(33, 10)).toBe(3.3);
    });

    it('should handle zero weeks played', () => {
      expect(calculateWinPace(0, 0)).toBe(0);
    });

    it('should round to 2 decimal places', () => {
      expect(calculateWinPace(22, 7)).toBe(3.14);
    });
  });

  describe('calculateWinRate', () => {
    it('should calculate correct win rate', () => {
      expect(calculateWinRate(50, 30, 0)).toBe(0.625);
      expect(calculateWinRate(50, 50, 0)).toBe(0.5);
    });

    it('should treat ties as half wins', () => {
      // 50 wins + 10 ties (=5 wins) = 55 effective wins / 100 games
      expect(calculateWinRate(50, 40, 10)).toBe(0.55);
    });

    it('should return 0.5 for no games played', () => {
      expect(calculateWinRate(0, 0, 0)).toBe(0.5);
    });
  });

  describe('projectStandings', () => {
    const mockTeams: TeamStanding[] = [
      {
        teamKey: '428.l.123.t.1',
        teamName: 'Team Alpha',
        rank: 1,
        wins: 60,
        losses: 30,
        ties: 0,
        pointsFor: 1200,
        pointsAgainst: 900,
        isCurrentUser: true,
      },
      {
        teamKey: '428.l.123.t.2',
        teamName: 'Team Beta',
        rank: 2,
        wins: 55,
        losses: 35,
        ties: 0,
        pointsFor: 1100,
        pointsAgainst: 950,
        isCurrentUser: false,
      },
      {
        teamKey: '428.l.123.t.3',
        teamName: 'Team Gamma',
        rank: 3,
        wins: 45,
        losses: 45,
        ties: 0,
        pointsFor: 1000,
        pointsAgainst: 1000,
        isCurrentUser: false,
      },
      {
        teamKey: '428.l.123.t.4',
        teamName: 'Team Delta',
        rank: 4,
        wins: 35,
        losses: 55,
        ties: 0,
        pointsFor: 900,
        pointsAgainst: 1100,
        isCurrentUser: false,
      },
    ];

    it('should project standings correctly at mid-season', () => {
      // Week 11 of 20 total weeks (10 weeks played)
      const projections = projectStandings(mockTeams, 11, 20);

      expect(projections).toHaveLength(4);

      // Team Alpha (current #1) should project more wins
      const teamAlpha = projections.find(p => p.teamKey === '428.l.123.t.1');
      expect(teamAlpha).toBeDefined();
      expect(teamAlpha!.projectedWins).toBeGreaterThan(teamAlpha!.currentWins);
      expect(teamAlpha!.projectedRank).toBe(1); // Should maintain #1
    });

    it('should maintain relative rankings for dominant teams', () => {
      const projections = projectStandings(mockTeams, 11, 20);

      const teamAlpha = projections.find(p => p.teamKey === '428.l.123.t.1');
      const teamDelta = projections.find(p => p.teamKey === '428.l.123.t.4');

      expect(teamAlpha!.projectedWins).toBeGreaterThan(teamDelta!.projectedWins);
      expect(teamAlpha!.projectedRank).toBeLessThan(teamDelta!.projectedRank);
    });

    it('should calculate correct win pace', () => {
      const projections = projectStandings(mockTeams, 11, 20);

      // Team Alpha: 60 wins in 10 weeks = 6 wins/week
      const teamAlpha = projections.find(p => p.teamKey === '428.l.123.t.1');
      expect(teamAlpha!.winPace).toBe(6);
    });

    it('should identify trends correctly', () => {
      const projections = projectStandings(mockTeams, 11, 20);

      // Team Alpha has 66.7% win rate (above average ~48.75%)
      const teamAlpha = projections.find(p => p.teamKey === '428.l.123.t.1');
      expect(teamAlpha!.trend).toBe('improving');

      // Team Delta has 38.9% win rate (below average)
      const teamDelta = projections.find(p => p.teamKey === '428.l.123.t.4');
      expect(teamDelta!.trend).toBe('declining');
    });

    it('should handle early season with limited data', () => {
      const earlyTeams: TeamStanding[] = [
        {
          teamKey: '428.l.123.t.1',
          teamName: 'Team Alpha',
          rank: 1,
          wins: 6,
          losses: 3,
          ties: 0,
          pointsFor: 120,
          pointsAgainst: 90,
          isCurrentUser: true,
        },
        {
          teamKey: '428.l.123.t.2',
          teamName: 'Team Beta',
          rank: 2,
          wins: 5,
          losses: 4,
          ties: 0,
          pointsFor: 110,
          pointsAgainst: 95,
          isCurrentUser: false,
        },
      ];

      // Week 2 of 20 total weeks (1 week played)
      const projections = projectStandings(earlyTeams, 2, 20);

      expect(projections).toHaveLength(2);
      // Projections should exist even with limited data
      expect(projections[0].projectedWins).toBeGreaterThan(0);
    });

    it('should handle ties in win/loss record', () => {
      const teamsWithTies: TeamStanding[] = [
        {
          teamKey: '428.l.123.t.1',
          teamName: 'Team Alpha',
          rank: 1,
          wins: 50,
          losses: 30,
          ties: 10,
          pointsFor: 1200,
          pointsAgainst: 900,
          isCurrentUser: true,
        },
        {
          teamKey: '428.l.123.t.2',
          teamName: 'Team Beta',
          rank: 2,
          wins: 50,
          losses: 40,
          ties: 0,
          pointsFor: 1100,
          pointsAgainst: 950,
          isCurrentUser: false,
        },
      ];

      const projections = projectStandings(teamsWithTies, 11, 20);

      // Team Alpha with ties should have slightly better effective win rate
      const teamAlpha = projections.find(p => p.teamKey === '428.l.123.t.1');
      const teamBeta = projections.find(p => p.teamKey === '428.l.123.t.2');

      // Same raw wins but Alpha has ties counting as partial wins
      expect(teamAlpha!.projectedWins).toBeGreaterThanOrEqual(teamBeta!.projectedWins);
    });

    it('should project minimal games remaining at end of season', () => {
      // Week 21 of 20 total weeks (season is over - 20 weeks played)
      const projections = projectStandings(mockTeams, 21, 20);

      projections.forEach(p => {
        // At week 21 of 20, weeksRemaining = 20 - 20 = 0
        expect(p.gamesRemaining).toBe(0);
        expect(p.projectedWins).toBe(p.currentWins);
        expect(p.projectedLosses).toBe(p.currentLosses);
      });
    });
  });

  describe('playoff odds calculation basics', () => {
    it('should give higher odds to teams in playoff position', () => {
      const mockTeams: TeamStanding[] = [
        { teamKey: 't1', teamName: 'T1', rank: 1, wins: 60, losses: 30, ties: 0, pointsFor: 0, pointsAgainst: 0, isCurrentUser: false },
        { teamKey: 't2', teamName: 'T2', rank: 2, wins: 55, losses: 35, ties: 0, pointsFor: 0, pointsAgainst: 0, isCurrentUser: false },
        { teamKey: 't3', teamName: 'T3', rank: 3, wins: 50, losses: 40, ties: 0, pointsFor: 0, pointsAgainst: 0, isCurrentUser: false },
        { teamKey: 't4', teamName: 'T4', rank: 4, wins: 45, losses: 45, ties: 0, pointsFor: 0, pointsAgainst: 0, isCurrentUser: false },
        { teamKey: 't5', teamName: 'T5', rank: 5, wins: 40, losses: 50, ties: 0, pointsFor: 0, pointsAgainst: 0, isCurrentUser: false },
        { teamKey: 't6', teamName: 'T6', rank: 6, wins: 35, losses: 55, ties: 0, pointsFor: 0, pointsAgainst: 0, isCurrentUser: false },
      ];

      const projections = projectStandings(mockTeams, 11, 20);
      const playoffSpots = 4;

      // Teams projected in top 4 should have higher projected ranks
      const inPlayoffPosition = projections.filter(p => p.projectedRank <= playoffSpots);
      const outOfPlayoffPosition = projections.filter(p => p.projectedRank > playoffSpots);

      expect(inPlayoffPosition.length).toBe(4);
      expect(outOfPlayoffPosition.length).toBe(2);

      // Top projected teams should have higher current wins
      const avgWinsIn = inPlayoffPosition.reduce((sum, p) => sum + p.currentWins, 0) / inPlayoffPosition.length;
      const avgWinsOut = outOfPlayoffPosition.reduce((sum, p) => sum + p.currentWins, 0) / outOfPlayoffPosition.length;
      expect(avgWinsIn).toBeGreaterThan(avgWinsOut);
    });
  });
});
