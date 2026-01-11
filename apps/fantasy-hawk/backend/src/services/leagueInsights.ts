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
