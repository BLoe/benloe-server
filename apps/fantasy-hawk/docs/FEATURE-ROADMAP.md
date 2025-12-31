# Fantasy Hawk Feature Roadmap

This document outlines potential features for Fantasy Hawk, a fantasy basketball analytics tool. Each feature describes the concept, required data sources, UI considerations, and where AI analysis adds value.

---

## Table of Contents

1. [Category Analysis](#1-category-analysis)
2. [Matchup Center](#2-matchup-center)
3. [Streaming Optimizer](#3-streaming-optimizer)
4. [Trade Analyzer](#4-trade-analyzer)
5. [Waiver & FAAB Advisor](#5-waiver--faab-advisor)
6. [Punt Strategy Engine](#6-punt-strategy-engine)
7. [League-Specific Insights](#7-league-specific-insights)
8. [Schedule Planner](#8-schedule-planner)
9. [Player Comparison Tool](#9-player-comparison-tool)
10. [Season Outlook & Playoffs](#10-season-outlook--playoffs)
11. [Learning & Education Mode](#11-learning--education-mode)
12. [AI Strategy Chat](#12-ai-strategy-chat)

---

## Data Sources Available

| Source | Data | Refresh Rate |
|--------|------|--------------|
| Yahoo Fantasy API | League settings, rosters, standings, matchups, transactions, players | Real-time |
| Ball Don't Lie API | NBA game schedule, team info, player stats | Daily |
| Claude API | Natural language analysis, strategic recommendations | On-demand |

---

## 1. Category Analysis

### Concept
Show where your team ranks in each scoring category compared to the rest of the league. Identify strengths to leverage and weaknesses to address (or punt).

### Data Required
- League standings with season stat totals (Yahoo: `/league/{key}/standings`)
- League settings for scoring categories (Yahoo: `/league/{key}/settings`)
- Weekly scoreboard data for recent trends (Yahoo: `/league/{key}/scoreboard;week=N`)

### UI Elements
- **Category Strength Table** (already built)
  - All teams × all categories grid
  - Your rank (1st-12th) in each category
  - Percent above/below league average
  - Color-coded cells (green = strong, red = weak)

- **Team Profile Card** (new)
  - Radar chart showing your category shape
  - "Identity" label: "Punt FT% Build", "Balanced", "Big Man Build", etc.
  - Trend arrows showing if you're improving/declining in each category

- **Category Trends** (new)
  - Line chart showing your category ranks over time (week by week)
  - Identify categories that are slipping or improving

### AI Analysis Value
- Generate a narrative summary: "Your team excels in blocks and rebounds but struggles with 3-pointers and assists. This suggests a big-man heavy build..."
- Identify category correlations: "Players who boost your rebounds often help FG% but hurt FT%"
- Suggest strategic pivots: "You're 6th in steals - close to top 4. Adding one steals specialist could lock this category."

---

## 2. Matchup Center

### Concept
Deep analysis of your current (or upcoming) weekly matchup. Project outcomes, identify swing categories, and suggest tactical moves.

### Data Required
- Current scoreboard with live stats (Yahoo: `/league/{key}/scoreboard`)
- NBA schedule for remaining games this week (Ball Don't Lie)
- Your roster and opponent's roster (Yahoo: `/league/{key}/teams/roster`)
- Historical matchup data (Yahoo: `/team/{key}/matchups`)

### UI Elements
- **Live Matchup Dashboard**
  - Side-by-side category comparison (you vs opponent)
  - Current score (e.g., "4-3-2" in categories)
  - Projected final based on remaining games
  - "Danger" indicators for categories that could flip

- **Games Remaining Comparison**
  - Your remaining games vs opponent's
  - By day: show which days each team has more players active
  - Highlight advantage/disadvantage

- **Swing Category Alerts**
  - Categories within 5% margin
  - "You're down 2 steals with 8 games left vs their 5 - winnable"
  - Suggested streaming targets to flip specific categories

- **Historical H2H Record**
  - Your record against this opponent
  - Which categories you typically win/lose against them
  - Their team tendencies (do they stream? punt anything?)

### AI Analysis Value
- Pre-matchup preview: "Your opponent punts assists and 3PM. Focus on winning the other 7 categories."
- Mid-week tactical advice: "You're losing FG% by 0.8%. Benching low-efficiency players today could flip this."
- Post-matchup recap: "You lost 4-5. The difference was free throw percentage where you shot 71% vs their 82%."

---

## 3. Streaming Optimizer

### Concept
Maximize games played by strategically adding/dropping players throughout the week. Account for roster slot limits and schedule conflicts.

### Data Required
- NBA schedule for current and upcoming weeks (Ball Don't Lie)
- Your roster with player teams (Yahoo: `/team/{key}/roster`)
- Free agent pool (Yahoo: `/league/{key}/players;status=FA`)
- League settings for roster positions and add limits (Yahoo: `/league/{key}/settings`)
- Your remaining weekly adds (from team metadata)

### UI Elements
- **Weekly Schedule Grid**
  - Calendar view: Mon-Sun columns
  - Your players as rows
  - Cells show: game (home/away opponent) or off day
  - Highlight conflicts: days with more players than starting slots
  - Highlight gaps: days with fewer players than optimal

- **Streaming Candidates Table**
  - Free agents sorted by games remaining this week
  - Columns: Player, Team, Position, Games Left, Game Dates, Key Stats
  - Filter by position (need a PG? SG?)
  - Filter by category strength (need assists? rebounds?)

- **Add/Drop Recommendations**
  - "Drop X (2 games left, struggling) for Y (4 games left, hot)"
  - Show net games gained
  - Show category impact projection

- **Roster Slot Optimizer**
  - For each day, show optimal lineup
  - Flag days where bench players have games (wasted stats)
  - Suggest roster moves to maximize active games

### AI Analysis Value
- Daily streaming picks: "Today's best streaming option is Player X - he has 4 games this week, plays tonight, and your roster has a SG slot open."
- End-of-week cleanup: "Drop your streamers before Sunday to prepare for next week's waiver priority."
- Category-aware streaming: "You're losing 3PM by 4. Player X has 3 games left and averages 2.5 3PM/game - he could flip this category."

---

## 4. Trade Analyzer

### Concept
Evaluate proposed trades by projecting category impact, considering team needs, and accounting for schedule/playoff implications.

### Data Required
- All team rosters (Yahoo: `/league/{key}/teams/roster`)
- Player season stats (Yahoo: player stats or standings data)
- League standings and playoff picture (Yahoo: `/league/{key}/standings`)
- Your punt strategy (derived from category analysis)
- Remaining schedule strength (Ball Don't Lie - games in playoff weeks)

### UI Elements
- **Trade Builder**
  - Select players to give and receive
  - Multi-team trade support
  - Include draft picks if applicable

- **Category Impact Projection**
  - Before/after comparison for each category
  - Show rank change: "Rebounds: 3rd → 5th"
  - Net category wins/losses
  - Highlight impact on punted categories (less important)

- **Schedule Consideration**
  - Games remaining in regular season for each player
  - Playoff schedule comparison (crucial for playoff-bound teams)
  - Bye weeks and rest patterns

- **Trade Fairness Meter**
  - Based on standard player valuations
  - Adjusted for YOUR team's needs
  - "This trade hurts you overall but perfectly fits your punt build"

- **League Context**
  - Does this trade help a rival more than you?
  - Are you trading with a playoff competitor?

### AI Analysis Value
- Trade narrative: "This trade sacrifices assists (which you're punting anyway) to gain elite rebounding and blocks. It strengthens your build identity."
- Counter-proposal suggestions: "If they decline, try offering Player Y instead - similar value but better category fit for them."
- Risk assessment: "Player X has injury history - factor in that you may lose these stats for 2-3 weeks."

---

## 5. Waiver & FAAB Advisor

### Concept
Decide when to use waiver priority or FAAB budget vs. waiting for free agency. Identify which pickups are worth the investment.

### Data Required
- Waiver wire players (Yahoo: `/league/{key}/players;status=W`)
- Free agents (Yahoo: `/league/{key}/players;status=FA`)
- Your FAAB balance and waiver priority (from team metadata)
- League transaction history (Yahoo: `/league/{key}/transactions`)
- Player recent performance and news

### UI Elements
- **Waiver Priority Dashboard**
  - Your current waiver position
  - FAAB balance and league average remaining
  - Upcoming waiver processing time

- **Pickup Recommendations**
  - Tiered list: "Must Claim", "Strong Add", "Speculative"
  - For each player: projected category contribution
  - Suggested FAAB bid amount
  - "Wait for FA" indicator for players not worth the cost

- **League Activity Monitor**
  - What are other teams adding/dropping?
  - Who's active (streaming) vs passive?
  - Predict competition for hot pickups

- **Historical FAAB Tracker**
  - How much have players gone for historically?
  - Your bid history and win rate
  - League spending patterns

### AI Analysis Value
- Bid recommendations: "Player X is worth $15-20 based on production. League average remaining FAAB is $45, so $18 should win."
- Opportunity cost analysis: "Save your #1 waiver for a true difference-maker. This player will likely clear to FA."
- Injury replacement urgency: "Your starting PG is out 3 weeks. Claim a replacement now even if it costs priority."

---

## 6. Punt Strategy Engine

### Concept
Formalize and optimize a punt strategy. Identify which categories to abandon and how to maximize the remaining categories.

### Data Required
- Your roster and their category contributions
- League standings by category
- Historical category correlations (which stats come together)
- Player pool filtered by punt-friendly profiles

### UI Elements
- **Punt Analyzer**
  - Current implicit punt detection: "Your team is 10th, 11th, 12th in FT%, AST, 3PM"
  - Recommended punt: "Formalizing a punt-FT% build would strengthen your other 8 categories"
  - What-if simulator: toggle punting different categories

- **Punt Build Archetypes**
  - Common builds: "Punt AST", "Punt FT%", "Punt 3PM/PTS"
  - Which build best fits your current roster?
  - Target players for each archetype

- **Category Correlation Matrix**
  - Show which categories tend to come together
  - FG% correlates with REB, BLK (bigs)
  - 3PM correlates with PTS, FT% (guards)
  - Helps understand trade-offs

- **Roster Optimization Suggestions**
  - Players on your roster who don't fit your build
  - Trade targets who would strengthen your punt strategy
  - "Sell high" candidates in punted categories

### AI Analysis Value
- Build diagnosis: "Your roster is 70% aligned with a punt-assists build. These 3 players are outliers..."
- Strategy evolution: "Early season you can experiment. By week 15, commit to a build for playoffs."
- Matchup implications: "Punt-AST builds struggle against balanced teams but dominate other punt builds."

---

## 7. League-Specific Insights

### Concept
Analyze how your league's unique settings affect player values and strategy. Your league uses FGM instead of TO - this changes everything.

### Data Required
- League settings (scoring categories, roster positions)
- Standard player rankings
- Category-specific player stats

### UI Elements
- **League Settings Summary**
  - Your 9 categories listed with explanations
  - Comparison to "standard" 9-cat
  - Key differences highlighted: "FGM instead of TO favors high-usage players"

- **League-Adjusted Player Rankings**
  - Re-rank players based on YOUR categories
  - Show "Standard Rank" vs "League Rank"
  - Biggest risers: players undervalued in standard rankings
  - Biggest fallers: players overvalued in standard rankings

- **Positional Value Analysis**
  - Which positions are most valuable in your format?
  - "Guards gain value with FGM category (more shot attempts)"
  - "Centers lose relative value without TO punishment"
  - Scarcity analysis: which positions have fewer elite options?

- **Exploitable Edges**
  - If your leaguemates use standard rankings, these players are undervalued
  - Draft/trade targets based on league-specific value

### AI Analysis Value
- Format explanation: "Your league's FGM category means high-volume scorers like X and Y gain significant value compared to standard formats."
- Draft strategy: "In your format, waiting on centers is viable because their TO immunity doesn't matter."
- Trade opportunities: "Offer standard value for players who are secretly more valuable in your format."

---

## 8. Schedule Planner

### Concept
Look ahead at the NBA schedule to plan roster moves, identify busy/light weeks, and prepare for playoffs.

### Data Required
- Full NBA season schedule (Ball Don't Lie)
- Playoff schedule specifically (weeks 20-22 or whatever your league uses)
- Your roster with player teams

### UI Elements
- **Season Schedule Overview**
  - Week-by-week games per NBA team
  - Highlight your players' teams
  - Identify "4-game weeks" vs "2-game weeks"

- **Playoff Schedule Analysis**
  - Games per team during playoff weeks
  - Rank your roster by playoff schedule strength
  - "Player X has only 2 games in the championship week"
  - Trade targets with strong playoff schedules

- **Weekly Planning View**
  - Next 4 weeks lookahead
  - Your projected games per week
  - Streaming opportunities in light weeks
  - Heavy weeks where you might need to sit players

- **Back-to-Back Tracker**
  - Which players have B2B games (rest risk)
  - Veteran players who sit B2Bs
  - Impact on weekly projections

### AI Analysis Value
- Playoff prep: "3 of your starters have weak playoff schedules. Consider trading for players on teams X, Y, Z who have 4-4-4 games in weeks 20-22."
- Weekly planning: "Next week is light (23 total games for your roster). This is a good streaming week."
- Rest predictions: "Player X is 35+ years old on a B2B - 30% chance he rests the second game."

---

## 9. Player Comparison Tool

### Concept
Compare two or more players head-to-head across all relevant metrics to inform roster and trade decisions.

### Data Required
- Player season stats (per-game averages)
- Player game logs (recent performance)
- Player team schedule
- Player injury history and status

### UI Elements
- **Side-by-Side Comparison**
  - Select 2-4 players
  - Show all category stats
  - Highlight which player wins each category
  - Show games remaining this week/season

- **Trend Comparison**
  - Last 7/14/30 day averages
  - Who's trending up vs down?
  - Visualize with sparklines or mini-charts

- **Roster Fit Analysis**
  - Given your current roster, which player helps more?
  - Category impact on your team specifically
  - Position eligibility comparison

- **Schedule Comparison**
  - Games this week/month/playoffs
  - Which player has the better schedule?

### AI Analysis Value
- Contextual comparison: "Player A has better raw stats, but Player B fits your punt-AST build better."
- Buy-low/sell-high: "Player A is underperforming his season average. Good buy-low candidate."
- Risk assessment: "Player B has played 82 games each of the last 3 seasons. Player A averages 62 games."

---

## 10. Season Outlook & Playoffs

### Concept
Track your playoff odds, clinching scenarios, and optimal strategies based on standings position.

### Data Required
- Current standings with records (Yahoo)
- Remaining schedule for all teams
- Head-to-head tiebreaker info
- Playoff format (number of teams, weeks)

### UI Elements
- **Standings Dashboard**
  - Current standings with playoff line highlighted
  - Games back from playoff spot
  - Games ahead of elimination

- **Playoff Odds**
  - Simulated playoff probability
  - Scenarios: "Win next 2 matchups = 95% playoff odds"
  - Magic number to clinch

- **Playoff Bracket Preview**
  - Projected seeding and matchups
  - Historical record vs likely opponents
  - Category matchup preview

- **Strategy Mode Toggle**
  - "Competing" mode: maximize current week
  - "Rebuilding" mode: focus on keeper value
  - "Locked in" mode: rest players, prep for playoffs

### AI Analysis Value
- Playoff narrative: "You're currently 5th seed. Winning this week guarantees a top-4 seed and home-court advantage."
- Opponent scouting: "Your likely first-round opponent punts FT% and assists. You should win 6-3 in a typical week."
- Strategic pivots: "If you lose this week, consider selling veterans for draft picks and planning for next year."

---

## 11. Learning & Education Mode

### Concept
Help new fantasy basketball players learn concepts, terminology, and strategy through contextual education tied to their own team.

### Data Required
- All of the above (used as teaching examples)
- User's stated experience level

### UI Elements
- **Concept Explainers**
  - Tooltips and info icons throughout the app
  - "What is punting?" → explanation with examples from their roster
  - "What is streaming?" → show how it works with their schedule

- **Strategy Lessons**
  - "Fantasy Basketball 101" guided tour
  - Lessons tied to their current situation
  - "Your team appears to be a punt-FT% build. Here's what that means..."

- **Decision Walkthroughs**
  - When making a roster move, explain the reasoning
  - "Why is this player a good add? Because..."
  - Show the analysis behind recommendations

- **Glossary**
  - Fantasy terms: FAAB, streaming, punting, category leagues, etc.
  - Basketball terms: usage rate, efficiency, per-36, etc.

### AI Analysis Value
- Personalized teaching: "I notice you're new to fantasy basketball. Let me explain why your team's FG% is low and what you can do about it."
- Answer questions: "What's a good FT% to target?" → "League average is 78%. You're at 72%, which is below average. Here's why..."
- Explain recommendations: "I'm suggesting this trade because it aligns with your punt strategy. Here's the concept of punt strategies..."

---

## 12. AI Strategy Chat

### Concept
A conversational interface where users can ask any fantasy basketball question and get personalized answers based on their team, league, and situation.

### Data Required
- All available data as context
- Conversation history for follow-ups

### UI Elements
- **Chat Interface**
  - Text input for questions
  - Streaming responses from Claude
  - Suggested questions / quick actions

- **Context Panel**
  - Show what data Claude can see
  - Current roster, matchup, standings
  - Allow user to focus context: "Ask about my matchup" vs "Ask about trades"

- **Action Integration**
  - Claude can suggest specific moves
  - "Click here to view this trade" → opens trade analyzer
  - "Click here to add this player" → opens add/drop flow

### Example Questions
- "Should I trade Jokic for 3 mid-tier players?"
- "Who should I stream tomorrow?"
- "Am I making the playoffs?"
- "What's wrong with my team?"
- "How do I beat my opponent this week?"
- "Explain my league's scoring to me"
- "Which categories should I punt?"
- "Is Player X a good buy-low target?"

### AI Analysis Value
This IS the AI analysis. The entire feature is Claude providing personalized strategic advice with full context of the user's situation.

Key capabilities:
- Synthesize multiple data sources into coherent advice
- Explain reasoning in natural language
- Handle follow-up questions
- Remember context within a session
- Provide actionable, specific recommendations

---

## Implementation Priority Suggestions

### Phase 1: Foundation (Core Value)
1. Streaming Optimizer - immediate weekly value
2. Matchup Center - weekly decision-making
3. AI Strategy Chat - flexible, high-engagement

### Phase 2: Strategic Depth
4. Trade Analyzer - significant decisions
5. Punt Strategy Engine - build identity
6. League-Specific Insights - competitive edge

### Phase 3: Planning & Education
7. Schedule Planner - playoff preparation
8. Season Outlook - big picture
9. Learning Mode - onboarding, retention

### Phase 4: Polish & Power Features
10. Player Comparison - utility tool
11. Waiver/FAAB Advisor - specialized optimization
12. Category Analysis enhancements - deeper trends

---

## Technical Considerations

### Data Freshness
- Yahoo data: Cache for 5-10 minutes, allow manual refresh
- NBA schedule: Cache for 24 hours (changes rarely)
- AI responses: No caching (personalized)

### API Rate Limits
- Yahoo: Unknown limits, implement backoff
- Ball Don't Lie: Check plan limits
- Claude: Token-based pricing, optimize context size

### Performance
- Pre-compute rankings and aggregations server-side
- Lazy-load detailed views
- Background refresh for standings/scores during games

---

## Success Metrics

- **Engagement**: Time in app, features used, return visits
- **Decisions Made**: Trades proposed, players added/dropped
- **Learning**: Questions asked, concepts explored
- **Outcomes**: Win rate, playoff appearances (long-term)

---

*This document is a living spec. Features will be refined based on user feedback and technical feasibility.*
