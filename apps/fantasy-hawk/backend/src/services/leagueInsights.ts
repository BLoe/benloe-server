/**
 * League Insights Service
 *
 * Analyzes league settings to identify non-standard configurations,
 * category importance, and player value adjustments based on league format.
 */

// Standard 9-cat Yahoo league categories
export const STANDARD_CATEGORIES = [
  { statId: '0', abbr: 'PTS', name: 'Points' },
  { statId: '1', abbr: 'REB', name: 'Rebounds' },
  { statId: '2', abbr: 'AST', name: 'Assists' },
  { statId: '4', abbr: 'STL', name: 'Steals' },
  { statId: '5', abbr: 'BLK', name: 'Blocks' },
  { statId: '11', abbr: '3PM', name: '3-Pointers Made' },
  { statId: '12', abbr: 'FG%', name: 'Field Goal Percentage' },
  { statId: '15', abbr: 'FT%', name: 'Free Throw Percentage' },
  { statId: '17', abbr: 'TO', name: 'Turnovers' },
];

// Alternative categories some leagues use
export const ALTERNATIVE_CATEGORIES = [
  { statId: '9', abbr: 'FGM', name: 'Field Goals Made' },
  { statId: '10', abbr: 'FGA', name: 'Field Goals Attempted' },
  { statId: '13', abbr: 'FTM', name: 'Free Throws Made' },
  { statId: '14', abbr: 'FTA', name: 'Free Throws Attempted' },
  { statId: '3', abbr: 'OREB', name: 'Offensive Rebounds' },
  { statId: '6', abbr: 'DD', name: 'Double-Doubles' },
  { statId: '7', abbr: 'TD', name: 'Triple-Doubles' },
  { statId: '8', abbr: 'A/T', name: 'Assist/Turnover Ratio' },
];

export interface LeagueCategory {
  statId: string;
  name: string;
  displayName: string;
  abbr?: string;
}

export interface SettingsInsight {
  type: 'missing' | 'unusual' | 'alternative';
  category: string;
  description: string;
  impact: string;
}

export interface LeagueSettingsSummary {
  leagueType: 'head-to-head' | 'roto' | 'points' | 'unknown';
  numTeams: number;
  categories: LeagueCategory[];
  isStandard: boolean;
  insights: SettingsInsight[];
  missingStandard: string[];
  unusualCategories: string[];
}

export interface CategoryImportance {
  statId: string;
  name: string;
  displayName: string;
  scarcity: number; // How rare is excellence in this category (0-100)
  volatility: number; // How much does this category swing week to week (0-100)
  streamability: number; // How easy is it to stream for this category (0-100)
  importance: 'high' | 'medium' | 'low';
}

export interface PositionalValue {
  position: string;
  valueAdjustment: number; // Percentage change from standard (-20 to +20)
  reason: string;
}

export interface LeagueAnalysis {
  categoryImportance: CategoryImportance[];
  positionalValue: PositionalValue[];
  exploitableEdges: string[];
  recommendation: string;
}

/**
 * Parse and summarize league settings
 */
export function parseLeagueSettings(
  categories: LeagueCategory[],
  leagueType: string = 'head-to-head-one-win',
  numTeams: number = 12
): LeagueSettingsSummary {
  const categoryAbbrs = categories.map(c =>
    c.abbr?.toUpperCase() || c.displayName?.toUpperCase() || c.name?.toUpperCase() || ''
  );

  const standardAbbrs = STANDARD_CATEGORIES.map(c => c.abbr);
  const alternativeAbbrs = ALTERNATIVE_CATEGORIES.map(c => c.abbr);

  // Helper to check if two abbreviations match (handles variations like 3PM/3PTM)
  const matchesAbbr = (categoryAbbr: string, standardAbbr: string): boolean => {
    const ca = categoryAbbr.toUpperCase().replace('%', '').replace(/[^A-Z0-9]/g, '');
    const sa = standardAbbr.toUpperCase().replace('%', '').replace(/[^A-Z0-9]/g, '');

    // Exact match
    if (ca === sa) return true;

    // Special handling for 3-pointers (3PM, 3PTM, 3P)
    if ((ca === '3PM' || ca === '3PTM' || ca === '3P') &&
        (sa === '3PM' || sa === '3PTM' || sa === '3P')) {
      return true;
    }

    // Don't match partial overlaps like REB/OREB or FG/FGM - these are different categories
    return false;
  };

  // Find missing standard categories
  const missingStandard = standardAbbrs.filter(
    abbr => !categoryAbbrs.some(ca => matchesAbbr(ca, abbr))
  );

  // Find unusual categories (non-standard)
  const unusualCategories = categoryAbbrs.filter(abbr => {
    const isStandard = standardAbbrs.some(sa => matchesAbbr(abbr, sa));
    const isAlternative = alternativeAbbrs.some(aa => matchesAbbr(abbr, aa));
    return !isStandard && !isAlternative && abbr !== '';
  });

  // Check if alternative categories are used
  const alternativesUsed = categoryAbbrs.filter(abbr =>
    alternativeAbbrs.some(aa => matchesAbbr(abbr, aa))
  );

  // Build insights
  const insights: SettingsInsight[] = [];

  // Turnovers check - very impactful
  if (missingStandard.includes('TO') && categoryAbbrs.some(c => c.includes('FGM'))) {
    insights.push({
      type: 'alternative',
      category: 'FGM instead of TO',
      description: 'Your league uses Field Goals Made instead of Turnovers',
      impact: 'High-volume scorers gain value. Turnover-prone stars like Luka/Trae are more valuable.',
    });
  } else if (missingStandard.includes('TO')) {
    insights.push({
      type: 'missing',
      category: 'TO',
      description: 'Turnovers are not counted',
      impact: 'High-usage ball handlers gain significant value without turnover penalties.',
    });
  }

  // 3PM check
  if (missingStandard.includes('3PM')) {
    insights.push({
      type: 'missing',
      category: '3PM',
      description: '3-Pointers Made is not a category',
      impact: 'Elite shooters lose value. Traditional bigs and slashers gain value.',
    });
  }

  // Double-doubles or triple-doubles
  if (categoryAbbrs.some(c => c.includes('DD'))) {
    insights.push({
      type: 'alternative',
      category: 'DD',
      description: 'Double-Doubles is a scoring category',
      impact: 'Versatile big men (Jokic, Doncic, AD) gain significant value.',
    });
  }

  if (categoryAbbrs.some(c => c.includes('TD'))) {
    insights.push({
      type: 'alternative',
      category: 'TD',
      description: 'Triple-Doubles is a scoring category',
      impact: 'Triple-double machines (Jokic, Doncic, Westbrook) are extremely valuable.',
    });
  }

  // FGM/FGA instead of FG%
  if (categoryAbbrs.some(c => c.includes('FGM')) && missingStandard.includes('FG%')) {
    insights.push({
      type: 'alternative',
      category: 'FGM',
      description: 'Uses Field Goals Made instead of FG%',
      impact: 'Volume shooters preferred over efficiency. Guards gain value over bigs.',
    });
  }

  // A/T Ratio
  if (categoryAbbrs.some(c => c.includes('A/T'))) {
    insights.push({
      type: 'alternative',
      category: 'A/T',
      description: 'Assist-to-Turnover Ratio is tracked',
      impact: 'Careful point guards (Chris Paul type) gain value. High-usage stars hurt.',
    });
  }

  // Determine league type
  let parsedLeagueType: 'head-to-head' | 'roto' | 'points' | 'unknown' = 'unknown';
  if (leagueType.includes('head-to-head')) {
    parsedLeagueType = 'head-to-head';
  } else if (leagueType.includes('roto')) {
    parsedLeagueType = 'roto';
  } else if (leagueType.includes('point')) {
    parsedLeagueType = 'points';
  }

  const isStandard = missingStandard.length === 0 && alternativesUsed.length === 0 && unusualCategories.length === 0;

  return {
    leagueType: parsedLeagueType,
    numTeams,
    categories,
    isStandard,
    insights,
    missingStandard,
    unusualCategories,
  };
}

/**
 * Analyze category importance based on league settings
 */
export function analyzeCategoryImportance(
  categories: LeagueCategory[]
): CategoryImportance[] {
  const categoryImportance: CategoryImportance[] = [];

  for (const cat of categories) {
    const abbr = (cat.abbr || cat.displayName || cat.name || '').toUpperCase();
    let scarcity = 50;
    let volatility = 50;
    let streamability = 50;

    // Scarcity: How rare is excellence
    if (abbr.includes('BLK')) {
      scarcity = 85; // Very scarce - only a few elite shot blockers
    } else if (abbr.includes('STL')) {
      scarcity = 75; // Scarce - steals hard to find
    } else if (abbr.includes('AST')) {
      scarcity = 70; // Somewhat scarce - concentrated in PGs
    } else if (abbr.includes('3PM') || abbr.includes('3P')) {
      scarcity = 40; // Common - many shooters available
    } else if (abbr.includes('PTS')) {
      scarcity = 35; // Common - many scorers
    } else if (abbr.includes('REB')) {
      scarcity = 55; // Moderate - position dependent
    } else if (abbr.includes('FG%')) {
      scarcity = 60; // Moderate - bigs have advantage
    } else if (abbr.includes('FT%')) {
      scarcity = 45; // Common among guards
    } else if (abbr.includes('TO')) {
      scarcity = 65; // Somewhat scarce - hard to find low-TO production
    } else if (abbr.includes('DD')) {
      scarcity = 80; // Very scarce - only versatile stars
    } else if (abbr.includes('TD')) {
      scarcity = 95; // Extremely scarce
    }

    // Volatility: How much does it swing week to week
    if (abbr.includes('BLK')) {
      volatility = 85; // Very volatile
    } else if (abbr.includes('STL')) {
      volatility = 80; // Very volatile
    } else if (abbr.includes('3PM') || abbr.includes('3P')) {
      volatility = 70; // Somewhat volatile
    } else if (abbr.includes('FG%')) {
      volatility = 65; // Moderate
    } else if (abbr.includes('FT%')) {
      volatility = 60; // Moderate
    } else if (abbr.includes('PTS')) {
      volatility = 40; // Stable
    } else if (abbr.includes('REB')) {
      volatility = 45; // Fairly stable
    } else if (abbr.includes('AST')) {
      volatility = 50; // Moderate
    } else if (abbr.includes('TO')) {
      volatility = 55; // Moderate
    } else if (abbr.includes('DD') || abbr.includes('TD')) {
      volatility = 90; // Very volatile
    }

    // Streamability: How easy to stream for gains
    if (abbr.includes('PTS')) {
      streamability = 70; // Easy to stream scorers
    } else if (abbr.includes('3PM') || abbr.includes('3P')) {
      streamability = 75; // Easy to find shooters
    } else if (abbr.includes('REB')) {
      streamability = 65; // Moderate - need bigs
    } else if (abbr.includes('BLK')) {
      streamability = 45; // Hard - need specific players
    } else if (abbr.includes('STL')) {
      streamability = 55; // Moderate
    } else if (abbr.includes('AST')) {
      streamability = 40; // Hard - need ball handlers
    } else if (abbr.includes('FG%')) {
      streamability = 30; // Hard - can hurt team
    } else if (abbr.includes('FT%')) {
      streamability = 35; // Hard - can hurt team
    } else if (abbr.includes('TO')) {
      streamability = 25; // Very hard - streamers often turn it over
    } else if (abbr.includes('DD') || abbr.includes('TD')) {
      streamability = 15; // Nearly impossible
    }

    // Determine importance
    const avgScore = (scarcity + (100 - volatility) + (100 - streamability)) / 3;
    let importance: 'high' | 'medium' | 'low' = 'medium';
    if (avgScore >= 60) {
      importance = 'high';
    } else if (avgScore <= 40) {
      importance = 'low';
    }

    categoryImportance.push({
      statId: cat.statId,
      name: cat.name,
      displayName: cat.displayName || cat.name,
      scarcity,
      volatility,
      streamability,
      importance,
    });
  }

  return categoryImportance;
}

/**
 * Analyze positional value based on league categories
 */
export function analyzePositionalValue(
  categories: LeagueCategory[]
): PositionalValue[] {
  const categoryAbbrs = categories.map(c =>
    (c.abbr || c.displayName || c.name || '').toUpperCase()
  );

  // Start with baseline adjustments
  const positions: PositionalValue[] = [
    { position: 'PG', valueAdjustment: 0, reason: 'Baseline' },
    { position: 'SG', valueAdjustment: 0, reason: 'Baseline' },
    { position: 'SF', valueAdjustment: 0, reason: 'Baseline' },
    { position: 'PF', valueAdjustment: 0, reason: 'Baseline' },
    { position: 'C', valueAdjustment: 0, reason: 'Baseline' },
  ];

  // Adjust based on categories
  const hasTO = categoryAbbrs.some(c => c.includes('TO'));
  const has3PM = categoryAbbrs.some(c => c.includes('3PM') || c.includes('3P'));
  const hasFGM = categoryAbbrs.some(c => c.includes('FGM'));
  const hasBLK = categoryAbbrs.some(c => c.includes('BLK'));
  const hasAST = categoryAbbrs.some(c => c.includes('AST'));
  const hasDD = categoryAbbrs.some(c => c.includes('DD'));
  const hasTD = categoryAbbrs.some(c => c.includes('TD'));
  const hasFGPct = categoryAbbrs.some(c => c.includes('FG%'));
  const hasATRatio = categoryAbbrs.some(c => c.includes('A/T'));

  // No turnovers - benefits high-usage guards
  if (!hasTO) {
    positions[0].valueAdjustment += 8; // PG
    positions[1].valueAdjustment += 5; // SG
    positions[0].reason = 'No TO penalty benefits ball handlers';
    positions[1].reason = 'No TO penalty benefits guards';
  }

  // FGM instead of efficiency - benefits volume scorers
  if (hasFGM && !hasFGPct) {
    positions[0].valueAdjustment += 6;
    positions[1].valueAdjustment += 8;
    positions[4].valueAdjustment -= 5; // C
    positions[1].reason = 'FGM rewards volume shooting';
    positions[4].reason = 'FGM over FG% hurts efficient bigs';
  }

  // DD or TD - benefits versatile players
  if (hasDD) {
    positions[3].valueAdjustment += 5; // PF
    positions[4].valueAdjustment += 8; // C
    positions[3].reason = 'DD category benefits versatile bigs';
    positions[4].reason = 'DD category benefits rebounding centers';
  }

  if (hasTD) {
    positions[0].valueAdjustment += 10; // PG
    positions[3].valueAdjustment += 8; // PF
    positions[0].reason = 'TD category heavily favors elite PGs';
  }

  // No 3PM - hurts shooters, helps bigs
  if (!has3PM) {
    positions[1].valueAdjustment -= 8; // SG
    positions[4].valueAdjustment += 5; // C
    positions[1].reason = 'No 3PM hurts shooting guards';
    positions[4].reason = 'No 3PM benefits traditional centers';
  }

  // Blocks - helps centers
  if (hasBLK) {
    positions[4].valueAdjustment += 5;
    if (positions[4].reason === 'Baseline') {
      positions[4].reason = 'BLK category benefits rim protectors';
    }
  }

  // A/T Ratio - helps careful passers
  if (hasATRatio) {
    positions[0].valueAdjustment += 5; // Careful PGs
    positions[0].reason = positions[0].reason === 'Baseline' ? 'A/T ratio benefits careful passers' : positions[0].reason;
  }

  return positions;
}

/**
 * Generate exploitable edges based on league format
 */
export function generateExploitableEdges(
  settings: LeagueSettingsSummary
): string[] {
  const edges: string[] = [];

  // Based on missing categories
  if (settings.missingStandard.includes('TO')) {
    edges.push('Target high-usage ball handlers that others avoid due to "turnover concerns"');
    edges.push('Stars like Luka, Trae Young, and Harden are undervalued by standard rankings');
  }

  if (settings.missingStandard.includes('3PM')) {
    edges.push('Traditional bigs and slashers are more valuable than shooters');
    edges.push('Trade away elite 3-point specialists for rebounders/shot blockers');
  }

  if (settings.missingStandard.includes('FG%')) {
    edges.push('Volume shooters are preferred over efficient role players');
    edges.push('High-usage stars provide more value even with average efficiency');
  }

  // Based on insights
  for (const insight of settings.insights) {
    if (insight.type === 'alternative' && insight.category.includes('DD')) {
      edges.push('Big men who regularly flirt with double-doubles gain significant value');
    }
    if (insight.type === 'alternative' && insight.category.includes('TD')) {
      edges.push('Triple-double capable players are extremely valuable - prioritize Jokic, Luka, Westbrook types');
    }
    if (insight.type === 'alternative' && insight.category.includes('FGM')) {
      edges.push('Target high-volume guards who take many shots');
      edges.push('Efficient low-usage players lose value - trade them away');
    }
    if (insight.type === 'alternative' && insight.category.includes('A/T')) {
      edges.push('Careful point guards like Chris Paul gain value');
      edges.push('Turnover-prone playmakers lose some appeal');
    }
  }

  // If league is standard, provide generic advice
  if (settings.isStandard && edges.length === 0) {
    edges.push('Your league uses standard settings - focus on balanced roster construction');
    edges.push('Category-based punt strategies work well in standard formats');
    edges.push('Target undervalued specialists when opponents punt their strong categories');
  }

  return edges;
}

export interface RankedPlayer {
  playerId: string;
  name: string;
  team: string;
  position: string;
  leagueRank: number;
  standardRank: number;
  rankDifference: number; // positive = undervalued in standard, negative = overvalued
  categoryScores: Record<string, number>;
  overallScore: number;
}

export interface PlayerRankings {
  players: RankedPlayer[];
  lastUpdated: string;
  leagueCategories: string[];
}

// Mock player data for generating rankings
// In production, this would come from BDL or Yahoo API
const MOCK_PLAYERS = [
  { id: '1', name: 'Nikola Jokic', team: 'DEN', position: 'C', pts: 95, reb: 98, ast: 95, stl: 70, blk: 55, threepm: 45, fgpct: 92, ftpct: 82, to: 40, fgm: 80 },
  { id: '2', name: 'Shai Gilgeous-Alexander', team: 'OKC', position: 'PG', pts: 98, reb: 50, ast: 75, stl: 85, blk: 40, threepm: 55, fgpct: 85, ftpct: 92, to: 35, fgm: 95 },
  { id: '3', name: 'Luka Doncic', team: 'DAL', position: 'PG', pts: 96, reb: 75, ast: 92, stl: 60, blk: 35, threepm: 70, fgpct: 60, ftpct: 70, to: 20, fgm: 88 },
  { id: '4', name: 'Giannis Antetokounmpo', team: 'MIL', position: 'PF', pts: 94, reb: 92, ast: 72, stl: 55, blk: 75, threepm: 25, fgpct: 88, ftpct: 55, to: 30, fgm: 82 },
  { id: '5', name: 'Anthony Edwards', team: 'MIN', position: 'SG', pts: 93, reb: 52, ast: 58, stl: 65, blk: 42, threepm: 75, fgpct: 58, ftpct: 85, to: 40, fgm: 90 },
  { id: '6', name: 'Jayson Tatum', team: 'BOS', position: 'SF', pts: 92, reb: 72, ast: 62, stl: 58, blk: 48, threepm: 82, fgpct: 60, ftpct: 85, to: 42, fgm: 78 },
  { id: '7', name: 'Joel Embiid', team: 'PHI', position: 'C', pts: 95, reb: 85, ast: 48, stl: 50, blk: 72, threepm: 42, fgpct: 75, ftpct: 92, to: 35, fgm: 72 },
  { id: '8', name: 'Anthony Davis', team: 'LAL', position: 'PF', pts: 88, reb: 90, ast: 45, stl: 62, blk: 95, threepm: 35, fgpct: 78, ftpct: 80, to: 50, fgm: 68 },
  { id: '9', name: 'Kevin Durant', team: 'PHX', position: 'SF', pts: 94, reb: 60, ast: 58, stl: 48, blk: 52, threepm: 65, fgpct: 88, ftpct: 92, to: 55, fgm: 75 },
  { id: '10', name: 'Tyrese Haliburton', team: 'IND', position: 'PG', pts: 78, reb: 40, ast: 98, stl: 82, blk: 32, threepm: 78, fgpct: 65, ftpct: 88, to: 52, fgm: 62 },
  { id: '11', name: 'Trae Young', team: 'ATL', position: 'PG', pts: 90, reb: 35, ast: 95, stl: 62, blk: 25, threepm: 72, fgpct: 55, ftpct: 90, to: 15, fgm: 85 },
  { id: '12', name: 'Donovan Mitchell', team: 'CLE', position: 'SG', pts: 92, reb: 42, ast: 55, stl: 75, blk: 35, threepm: 80, fgpct: 58, ftpct: 88, to: 48, fgm: 82 },
  { id: '13', name: 'Domantas Sabonis', team: 'SAC', position: 'C', pts: 78, reb: 95, ast: 78, stl: 55, blk: 35, threepm: 35, fgpct: 85, ftpct: 72, to: 45, fgm: 65 },
  { id: '14', name: 'LeBron James', team: 'LAL', position: 'SF', pts: 88, reb: 68, ast: 85, stl: 55, blk: 45, threepm: 55, fgpct: 72, ftpct: 75, to: 35, fgm: 70 },
  { id: '15', name: 'Devin Booker', team: 'PHX', position: 'SG', pts: 90, reb: 42, ast: 72, stl: 52, blk: 30, threepm: 72, fgpct: 68, ftpct: 92, to: 45, fgm: 78 },
  { id: '16', name: 'Jimmy Butler', team: 'MIA', position: 'SF', pts: 82, reb: 58, ast: 68, stl: 85, blk: 38, threepm: 32, fgpct: 78, ftpct: 88, to: 55, fgm: 55 },
  { id: '17', name: 'Stephen Curry', team: 'GSW', position: 'PG', pts: 88, reb: 45, ast: 72, stl: 58, blk: 28, threepm: 98, fgpct: 65, ftpct: 95, to: 42, fgm: 72 },
  { id: '18', name: 'Damian Lillard', team: 'MIL', position: 'PG', pts: 88, reb: 38, ast: 78, stl: 52, blk: 25, threepm: 85, fgpct: 60, ftpct: 95, to: 40, fgm: 75 },
  { id: '19', name: 'Kawhi Leonard', team: 'LAC', position: 'SF', pts: 82, reb: 62, ast: 48, stl: 88, blk: 42, threepm: 62, fgpct: 78, ftpct: 90, to: 58, fgm: 62 },
  { id: '20', name: 'Jaren Jackson Jr.', team: 'MEM', position: 'PF', pts: 75, reb: 58, ast: 25, stl: 52, blk: 98, threepm: 55, fgpct: 62, ftpct: 78, to: 60, fgm: 55 },
  { id: '21', name: 'Rudy Gobert', team: 'MIN', position: 'C', pts: 45, reb: 92, ast: 20, stl: 40, blk: 92, threepm: 5, fgpct: 95, ftpct: 55, to: 65, fgm: 35 },
  { id: '22', name: 'Draymond Green', team: 'GSW', position: 'PF', pts: 38, reb: 65, ast: 72, stl: 70, blk: 58, threepm: 28, fgpct: 55, ftpct: 68, to: 40, fgm: 25 },
  { id: '23', name: 'Brook Lopez', team: 'MIL', position: 'C', pts: 52, reb: 52, ast: 18, stl: 35, blk: 88, threepm: 65, fgpct: 68, ftpct: 82, to: 68, fgm: 42 },
  { id: '24', name: 'De\'Aaron Fox', team: 'SAC', position: 'PG', pts: 88, reb: 40, ast: 72, stl: 78, blk: 32, threepm: 48, fgpct: 60, ftpct: 75, to: 30, fgm: 82 },
  { id: '25', name: 'Jalen Brunson', team: 'NYK', position: 'PG', pts: 88, reb: 35, ast: 78, stl: 48, blk: 25, threepm: 58, fgpct: 65, ftpct: 88, to: 50, fgm: 78 },
  { id: '26', name: 'Karl-Anthony Towns', team: 'MIN', position: 'C', pts: 82, reb: 82, ast: 42, stl: 48, blk: 52, threepm: 68, fgpct: 72, ftpct: 90, to: 42, fgm: 62 },
  { id: '27', name: 'Pascal Siakam', team: 'IND', position: 'PF', pts: 78, reb: 68, ast: 52, stl: 55, blk: 42, threepm: 42, fgpct: 70, ftpct: 78, to: 48, fgm: 62 },
  { id: '28', name: 'Bam Adebayo', team: 'MIA', position: 'C', pts: 72, reb: 80, ast: 55, stl: 65, blk: 55, threepm: 15, fgpct: 78, ftpct: 72, to: 48, fgm: 52 },
  { id: '29', name: 'Fred VanVleet', team: 'HOU', position: 'PG', pts: 70, reb: 38, ast: 75, stl: 85, blk: 25, threepm: 72, fgpct: 52, ftpct: 88, to: 48, fgm: 62 },
  { id: '30', name: 'LaMelo Ball', team: 'CHA', position: 'PG', pts: 78, reb: 55, ast: 82, stl: 72, blk: 32, threepm: 65, fgpct: 52, ftpct: 85, to: 25, fgm: 72 },
  { id: '31', name: 'Chet Holmgren', team: 'OKC', position: 'C', pts: 72, reb: 72, ast: 38, stl: 55, blk: 90, threepm: 55, fgpct: 75, ftpct: 85, to: 55, fgm: 52 },
  { id: '32', name: 'Victor Wembanyama', team: 'SAS', position: 'C', pts: 78, reb: 78, ast: 42, stl: 58, blk: 95, threepm: 48, fgpct: 58, ftpct: 82, to: 38, fgm: 55 },
  { id: '33', name: 'Paolo Banchero', team: 'ORL', position: 'PF', pts: 78, reb: 62, ast: 52, stl: 48, blk: 42, threepm: 42, fgpct: 58, ftpct: 78, to: 40, fgm: 62 },
  { id: '34', name: 'Scottie Barnes', team: 'TOR', position: 'SF', pts: 72, reb: 68, ast: 65, stl: 62, blk: 55, threepm: 35, fgpct: 62, ftpct: 75, to: 42, fgm: 52 },
  { id: '35', name: 'Zion Williamson', team: 'NOP', position: 'PF', pts: 85, reb: 62, ast: 52, stl: 55, blk: 45, threepm: 18, fgpct: 92, ftpct: 68, to: 35, fgm: 72 },
  { id: '36', name: 'Ja Morant', team: 'MEM', position: 'PG', pts: 88, reb: 48, ast: 82, stl: 58, blk: 38, threepm: 48, fgpct: 58, ftpct: 75, to: 22, fgm: 78 },
  { id: '37', name: 'Kyrie Irving', team: 'DAL', position: 'PG', pts: 85, reb: 42, ast: 68, stl: 62, blk: 32, threepm: 68, fgpct: 72, ftpct: 92, to: 48, fgm: 72 },
  { id: '38', name: 'Paul George', team: 'PHI', position: 'SF', pts: 78, reb: 52, ast: 52, stl: 75, blk: 35, threepm: 72, fgpct: 58, ftpct: 88, to: 50, fgm: 62 },
  { id: '39', name: 'Lauri Markkanen', team: 'UTA', position: 'PF', pts: 82, reb: 72, ast: 38, stl: 42, blk: 45, threepm: 72, fgpct: 72, ftpct: 92, to: 55, fgm: 62 },
  { id: '40', name: 'Jaylen Brown', team: 'BOS', position: 'SG', pts: 85, reb: 52, ast: 42, stl: 62, blk: 35, threepm: 62, fgpct: 65, ftpct: 75, to: 42, fgm: 72 },
  { id: '41', name: 'Myles Turner', team: 'IND', position: 'C', pts: 62, reb: 62, ast: 25, stl: 42, blk: 92, threepm: 58, fgpct: 72, ftpct: 78, to: 60, fgm: 45 },
  { id: '42', name: 'Mikal Bridges', team: 'NYK', position: 'SF', pts: 72, reb: 42, ast: 42, stl: 72, blk: 38, threepm: 62, fgpct: 68, ftpct: 85, to: 58, fgm: 55 },
  { id: '43', name: 'Nikola Vucevic', team: 'CHI', position: 'C', pts: 72, reb: 85, ast: 42, stl: 42, blk: 52, threepm: 45, fgpct: 72, ftpct: 80, to: 55, fgm: 52 },
  { id: '44', name: 'Jalen Williams', team: 'OKC', position: 'SF', pts: 78, reb: 52, ast: 52, stl: 68, blk: 45, threepm: 52, fgpct: 72, ftpct: 82, to: 52, fgm: 62 },
  { id: '45', name: 'Alperen Sengun', team: 'HOU', position: 'C', pts: 72, reb: 78, ast: 62, stl: 55, blk: 58, threepm: 25, fgpct: 78, ftpct: 75, to: 35, fgm: 52 },
  { id: '46', name: 'James Harden', team: 'LAC', position: 'PG', pts: 78, reb: 48, ast: 88, stl: 58, blk: 25, threepm: 62, fgpct: 55, ftpct: 92, to: 28, fgm: 68 },
  { id: '47', name: 'DeMar DeRozan', team: 'SAC', position: 'SF', pts: 82, reb: 42, ast: 55, stl: 52, blk: 28, threepm: 28, fgpct: 72, ftpct: 92, to: 52, fgm: 68 },
  { id: '48', name: 'Cade Cunningham', team: 'DET', position: 'PG', pts: 78, reb: 48, ast: 78, stl: 58, blk: 32, threepm: 55, fgpct: 55, ftpct: 85, to: 30, fgm: 70 },
  { id: '49', name: 'Evan Mobley', team: 'CLE', position: 'PF', pts: 62, reb: 75, ast: 42, stl: 52, blk: 78, threepm: 32, fgpct: 72, ftpct: 72, to: 55, fgm: 48 },
  { id: '50', name: 'Desmond Bane', team: 'MEM', position: 'SG', pts: 78, reb: 42, ast: 48, stl: 52, blk: 28, threepm: 82, fgpct: 62, ftpct: 88, to: 52, fgm: 68 },
];

// Standard ranking weights (used for comparison)
const STANDARD_WEIGHTS: Record<string, number> = {
  pts: 1.0,
  reb: 1.0,
  ast: 1.0,
  stl: 1.5, // Scarce
  blk: 1.5, // Scarce
  threepm: 1.0,
  fgpct: 1.0,
  ftpct: 1.0,
  to: -1.0, // Negative category
};

/**
 * Calculate player ranking score based on league categories
 */
export function calculatePlayerScore(
  player: typeof MOCK_PLAYERS[0],
  categories: LeagueCategory[],
  weights: Record<string, number>
): { score: number; categoryScores: Record<string, number> } {
  const categoryScores: Record<string, number> = {};
  let totalScore = 0;
  let catCount = 0;

  for (const cat of categories) {
    const abbr = (cat.abbr || cat.displayName || cat.name || '').toUpperCase();
    let statKey = '';
    let weight = 1.0;

    // Map category abbreviation to player stat key
    if (abbr.includes('PTS')) { statKey = 'pts'; weight = weights.pts || 1.0; }
    else if (abbr.includes('REB') && !abbr.includes('OREB')) { statKey = 'reb'; weight = weights.reb || 1.0; }
    else if (abbr.includes('AST')) { statKey = 'ast'; weight = weights.ast || 1.0; }
    else if (abbr.includes('STL')) { statKey = 'stl'; weight = weights.stl || 1.5; }
    else if (abbr.includes('BLK')) { statKey = 'blk'; weight = weights.blk || 1.5; }
    else if (abbr.includes('3PM') || abbr.includes('3P')) { statKey = 'threepm'; weight = weights.threepm || 1.0; }
    else if (abbr.includes('FG%')) { statKey = 'fgpct'; weight = weights.fgpct || 1.0; }
    else if (abbr.includes('FT%')) { statKey = 'ftpct'; weight = weights.ftpct || 1.0; }
    else if (abbr.includes('TO') && !abbr.includes('A/T')) { statKey = 'to'; weight = weights.to || -1.0; }
    else if (abbr.includes('FGM')) { statKey = 'fgm'; weight = weights.fgm || 1.0; }

    if (statKey && (player as any)[statKey] !== undefined) {
      const rawScore = (player as any)[statKey] as number;
      const weightedScore = rawScore * weight;
      categoryScores[abbr] = rawScore;
      totalScore += weightedScore;
      catCount++;
    }
  }

  return {
    score: catCount > 0 ? totalScore / catCount : 0,
    categoryScores,
  };
}

/**
 * Generate custom rankings based on league settings
 */
export function generateCustomRankings(
  categories: LeagueCategory[],
  settings: LeagueSettingsSummary
): PlayerRankings {
  // Adjust weights based on league settings
  const leagueWeights: Record<string, number> = { ...STANDARD_WEIGHTS };

  // If no TO category, remove penalty
  if (settings.missingStandard.includes('TO')) {
    leagueWeights.to = 0; // No impact
  }

  // If has FGM, add weight for it
  const hasFGM = categories.some(c => (c.abbr || c.displayName || '').toUpperCase().includes('FGM'));
  if (hasFGM) {
    leagueWeights.fgm = 1.2; // Volume matters
  }

  // Calculate league-specific scores
  const leagueRankedPlayers = MOCK_PLAYERS.map(player => {
    const { score, categoryScores } = calculatePlayerScore(player, categories, leagueWeights);
    return { player, score, categoryScores };
  }).sort((a, b) => b.score - a.score);

  // Calculate standard scores for comparison
  const standardCategories: LeagueCategory[] = STANDARD_CATEGORIES.map(c => ({
    statId: c.statId,
    name: c.name,
    displayName: c.abbr,
    abbr: c.abbr,
  }));

  const standardRankedPlayers = MOCK_PLAYERS.map(player => {
    const { score } = calculatePlayerScore(player, standardCategories, STANDARD_WEIGHTS);
    return { player, score };
  }).sort((a, b) => b.score - a.score);

  // Build player ID to standard rank map
  const standardRankMap = new Map<string, number>();
  standardRankedPlayers.forEach((p, index) => {
    standardRankMap.set(p.player.id, index + 1);
  });

  // Build final rankings
  const players: RankedPlayer[] = leagueRankedPlayers.map((p, index) => {
    const leagueRank = index + 1;
    const standardRank = standardRankMap.get(p.player.id) || 50;
    return {
      playerId: p.player.id,
      name: p.player.name,
      team: p.player.team,
      position: p.player.position,
      leagueRank,
      standardRank,
      rankDifference: standardRank - leagueRank, // Positive = better in this league
      categoryScores: p.categoryScores,
      overallScore: Math.round(p.score * 10) / 10,
    };
  });

  return {
    players,
    lastUpdated: new Date().toISOString(),
    leagueCategories: categories.map(c => c.abbr || c.displayName || c.name),
  };
}

/**
 * Full league analysis combining all insights
 */
export function analyzeLeague(
  categories: LeagueCategory[],
  leagueType: string = 'head-to-head',
  numTeams: number = 12
): { settings: LeagueSettingsSummary; analysis: LeagueAnalysis } {
  const settings = parseLeagueSettings(categories, leagueType, numTeams);
  const categoryImportance = analyzeCategoryImportance(categories);
  const positionalValue = analyzePositionalValue(categories);
  const exploitableEdges = generateExploitableEdges(settings);

  // Generate overall recommendation
  let recommendation = '';
  if (settings.isStandard) {
    recommendation = 'Your league uses standard 9-category settings. Focus on balanced roster construction and consider strategic category punting.';
  } else if (settings.insights.length > 0) {
    const mainInsight = settings.insights[0];
    recommendation = `Your league has unique settings: ${mainInsight.description}. ${mainInsight.impact}`;
  } else if (settings.missingStandard.length > 0) {
    recommendation = `Your league is missing ${settings.missingStandard.join(', ')} from standard categories. Adjust player valuations accordingly.`;
  }

  return {
    settings,
    analysis: {
      categoryImportance,
      positionalValue,
      exploitableEdges,
      recommendation,
    },
  };
}
