# Yahoo Fantasy Sports API Documentation

This document covers the Yahoo Fantasy Sports API as it relates to **NBA Fantasy Basketball** for the Fantasy Hawk application.

## Base URL

```
https://fantasysports.yahooapis.com/fantasy/v2
```

## Authentication

Yahoo Fantasy API uses **OAuth 2.0** for authentication. Users must authorize the app to access their Yahoo Fantasy data.

- Access tokens expire (typically 1 hour)
- Refresh tokens are used to obtain new access tokens
- All API requests require `Authorization: Bearer {access_token}` header

## Key Formats

Understanding key formats is critical for constructing API calls:

| Resource | Format | Example |
|----------|--------|---------|
| Game | `{game_code}` or `{game_id}` | `nba` or `428` |
| League | `{game_key}.l.{league_id}` | `428.l.12345` |
| Team | `{game_key}.l.{league_id}.t.{team_id}` | `428.l.12345.t.1` |
| Player | `{game_key}.p.{player_id}` | `428.p.5069` |

### NBA Game Keys by Season

| Season | Game Key |
|--------|----------|
| 2024-2025 | `nba` or `428` |
| 2023-2024 | `418` |
| 2022-2023 | `410` |
| 2021-2022 | `402` |
| 2020-2021 | `395` |

*Note: Use `nba` for current season, numeric IDs for historical data*

---

## Core Resources

### 1. User Resource

Get the logged-in user's games, leagues, and teams.

```
GET /users;use_login=1/games
GET /users;use_login=1/games;game_keys=nba/leagues
GET /users;use_login=1/games;game_keys=nba/teams
```

**Use Cases:**
- Get list of leagues user is in
- Get list of teams user manages
- Discover game keys for seasons user participated in

---

### 2. Game Resource

Get metadata about a fantasy game (sport/season).

```
GET /game/{game_key}
GET /game/nba
GET /games;game_keys=nba,418
```

**Sub-resources:**
- `metadata` (default) - Game info, current week, season dates
- `stat_categories` - All available stat categories for the sport
- `position_types` - Valid roster positions
- `roster_positions` - Detailed position info

**Filters for Games Collection:**
- `is_available=1` - Only current season
- `game_codes=nba` - Filter by sport
- `seasons=2024` - Filter by year

---

### 3. League Resource

Get league configuration, standings, and matchups.

```
GET /league/{league_key}
GET /league/{league_key}/settings
GET /league/{league_key}/standings
GET /league/{league_key}/scoreboard
GET /league/{league_key}/teams
GET /league/{league_key}/players
GET /league/{league_key}/transactions
GET /league/{league_key}/draftresults
```

**Key Sub-resources:**

#### `/settings`
Contains critical league configuration:
- `stat_categories` - Which stats are scored and their display names
- `stat_modifiers` - Point values for each stat (if points league)
- `roster_positions` - Active roster slots (PG, SG, SF, PF, C, G, F, UTIL, BN, IL)
- `scoring_type` - "head" (H2H categories) or "points"
- `playoff_info` - Playoff weeks, number of teams

#### `/standings`
Team rankings with season totals:
- Win/Loss/Tie record
- Points for/against
- Category stats totals
- Rank and playoff clinch status

#### `/scoreboard`
Current or specified week's matchups:
```
GET /league/{league_key}/scoreboard
GET /league/{league_key}/scoreboard;week=10
```

Contains:
- Matchup pairings
- Team stats for the week
- Category-by-category comparison
- Win probability (if available)

---

### 4. Team Resource

Get team roster, stats, and matchups.

```
GET /team/{team_key}
GET /team/{team_key}/roster
GET /team/{team_key}/roster;week=10
GET /team/{team_key}/stats
GET /team/{team_key}/stats;type=week;week=10
GET /team/{team_key}/matchups
GET /team/{team_key}/matchups;weeks=1,2,3
```

**Key Sub-resources:**

#### `/roster`
Current roster with player details:
- Player keys and names
- Selected position vs eligible positions
- Player status (healthy, injured, DTD, O, IL)
- Acquisition type (draft, add, trade)

#### `/stats`
Team's statistical performance:
- Season totals by default
- Use `;type=week;week=N` for weekly stats

#### `/matchups`
Head-to-head matchup history:
- Opponent info
- Category wins/losses
- Final scores

---

### 5. Player Resource

Get individual player information and stats.

```
GET /player/{player_key}
GET /player/{player_key}/stats
GET /player/{player_key}/stats;type=week;week=10
GET /player/{player_key}/ownership
GET /player/{player_key}/draft_analysis
```

**Players Collection (within league context):**
```
GET /league/{league_key}/players
GET /league/{league_key}/players;status=A      # Available only
GET /league/{league_key}/players;status=FA     # Free agents
GET /league/{league_key}/players;status=W      # Waivers
GET /league/{league_key}/players;status=T      # Taken (rostered)
GET /league/{league_key}/players;position=PG   # By position
GET /league/{league_key}/players;search=lebron # Search by name
GET /league/{league_key}/players;sort=AR       # Sort by average rank
```

---

### 6. Transactions Resource

Get league transaction history.

```
GET /league/{league_key}/transactions
GET /league/{league_key}/transactions;types=add,drop
GET /league/{league_key}/transactions;types=trade
```

**Transaction Types:**
- `add` - Player added from free agency
- `drop` - Player dropped
- `add/drop` - Simultaneous add and drop
- `trade` - Trade between teams

---

## NBA-Specific Stat Categories

Common stat IDs for NBA Fantasy Basketball:

| Stat ID | Name | Abbreviation |
|---------|------|--------------|
| 0 | Games Played | GP |
| 1 | Games Started | GS |
| 2 | Minutes Played | MIN |
| 3 | Field Goals Attempted | FGA |
| 4 | Field Goals Made | FGM |
| 5 | Field Goal Percentage | FG% |
| 6 | Free Throws Attempted | FTA |
| 7 | Free Throws Made | FTM |
| 8 | Free Throw Percentage | FT% |
| 9 | 3-Pointers Attempted | 3PTA |
| 10 | 3-Pointers Made | 3PTM |
| 11 | 3-Point Percentage | 3PT% |
| 12 | Points | PTS |
| 13 | Offensive Rebounds | OREB |
| 14 | Defensive Rebounds | DREB |
| 15 | Total Rebounds | REB |
| 16 | Assists | AST |
| 17 | Steals | ST |
| 18 | Blocks | BLK |
| 19 | Turnovers | TO |
| 20 | Assist/Turnover Ratio | A/T |
| 21 | Personal Fouls | PF |
| 22 | Disqualifications | DQ |
| 23 | Technicals | TECH |
| 24 | Ejections | EJ |
| 25 | Flagrant Fouls | FF |
| 26 | Double-Doubles | DD |
| 27 | Triple-Doubles | TD |

*Note: Leagues configure which stats count. Check `/league/{key}/settings` for your league's active categories.*

---

## Query Parameters

### Common Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `use_login=1` | Get data for authenticated user | `/users;use_login=1/games` |
| `out={sub}` | Include sub-resource | `/league/{key};out=settings,standings` |
| `week={n}` | Filter by week number | `/scoreboard;week=10` |
| `type=week` | Get weekly instead of season stats | `/stats;type=week;week=5` |

### Collection Filters

| Filter | Values | Example |
|--------|--------|---------|
| `status` | A, FA, W, T | `/players;status=FA` |
| `position` | PG, SG, SF, PF, C, G, F, UTIL | `/players;position=PG` |
| `sort` | AR (avg rank), PTS, etc. | `/players;sort=AR` |
| `count` | Number of results | `/players;count=25` |
| `start` | Pagination offset | `/players;start=25` |

---

## Response Format

Yahoo returns JSON (when requested) with a consistent structure:

```json
{
  "fantasy_content": {
    "{resource}": [
      { /* metadata object with scalar properties */ },
      { /* nested resources/collections */ }
    ]
  }
}
```

### Parsing Tips

1. **League array structure:**
   - `league[0]` = metadata (name, key, week, etc.)
   - `league[1]` = sub-resources (standings, teams, etc.)

2. **Teams/Players collections:**
   - Indexed objects: `{ "0": {...}, "1": {...}, "count": 2 }`
   - Access items by numeric string keys

3. **Team data arrays:**
   - Team properties split across array elements
   - Need to merge: `[{name, key}, {logo}, {standings}]`

---

## Fantasy Hawk Endpoints

Our backend wraps these Yahoo API calls:

| Endpoint | Yahoo API | Purpose |
|----------|-----------|---------|
| `GET /api/fantasy/games` | `/users;use_login=1/games` | List user's games |
| `GET /api/fantasy/leagues` | `/users;use_login=1/games;game_keys=nba/leagues` | List user's leagues |
| `GET /api/fantasy/leagues/:key` | `/league/{key}` | League details |
| `GET /api/fantasy/leagues/:key/settings` | `/league/{key}/settings` | League settings |
| `GET /api/fantasy/leagues/:key/standings` | `/league/{key}/standings` | League standings |
| `GET /api/fantasy/leagues/:key/scoreboard` | `/league/{key}/scoreboard` | Week's matchups |
| `GET /api/fantasy/teams` | `/users;use_login=1/games;game_keys=nba/teams` | User's teams |
| `GET /api/fantasy/teams/:key/roster` | `/team/{key}/roster` | Team roster |
| `GET /api/fantasy/teams/:key/stats` | `/team/{key}/stats` | Team stats |
| `GET /api/fantasy/players/:key/stats` | `/player/{key}/stats` | Player stats |
| `GET /api/fantasy/proxy?endpoint=...` | Any endpoint | Debug/testing |

---

## Rate Limits

Yahoo doesn't publish explicit rate limits, but best practices:
- Cache responses where possible
- Batch requests using collections
- Avoid polling more than once per minute
- Use sub-resources (`out=`) to reduce calls

---

## Useful Combined Queries

### Get league with all teams and their rosters:
```
/league/{key}/teams/roster
```

### Get multiple sub-resources at once:
```
/league/{key};out=settings,standings,scoreboard
```

### Get user's teams with stats:
```
/users;use_login=1/games;game_keys=nba/teams/stats
```

---

## Debugging

Use the Debug tab in Fantasy Hawk to dump raw API responses to files for analysis. This helps understand the exact structure Yahoo returns for your specific league configuration.

---

## Detailed Endpoint Response Structures

This section documents the actual JSON response structures from the Yahoo Fantasy API, based on real API dumps from our league.

### League Metadata

```
GET /league/{league_key}
```

**Example Response:**
```json
{
  "fantasy_content": {
    "league": [
      {
        "league_key": "466.l.15701",
        "league_id": "15701",
        "name": "NWF Keeper Lge Jamboree",
        "url": "https://basketball.fantasysports.yahoo.com/nba/15701",
        "logo_url": "https://s.yimg.com/ep/cx/blendr/v2/image-y-png_1721252122724.png",
        "draft_status": "postdraft",
        "num_teams": 12,
        "edit_key": "2025-12-30",
        "weekly_deadline": "intraday",
        "roster_type": "date",
        "league_update_timestamp": "1767084724",
        "scoring_type": "headone",
        "league_type": "private",
        "renew": "454_3705",
        "felo_tier": "silver",
        "current_week": 11,
        "matchup_week": 11,
        "start_week": "1",
        "start_date": "2025-10-21",
        "end_week": "22",
        "end_date": "2026-03-29",
        "current_date": "2025-12-30",
        "game_code": "nba",
        "season": "2025"
      }
    ]
  }
}
```

**Key Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `league_key` | string | Unique identifier: `{game_key}.l.{league_id}` |
| `league_id` | string | League ID only |
| `name` | string | League display name |
| `current_week` | number | **Current matchup week** - critical for fetching current data |
| `matchup_week` | number | Same as current_week |
| `scoring_type` | string | `headone` = H2H one-win, `head` = H2H each category, `point` = points league |
| `num_teams` | number | Number of teams in league |
| `start_week` / `end_week` | string | Season week range (e.g., "1" to "22") |
| `start_date` / `end_date` | string | Season dates (YYYY-MM-DD) |
| `roster_type` | string | `date` = daily lineups, `week` = weekly |
| `weekly_deadline` | string | `intraday` = locks at game time, other values for weekly |
| `game_code` | string | Sport code (`nba`) |
| `season` | string | Season year |
| `draft_status` | string | `predraft`, `drafted`, `postdraft` |
| `league_type` | string | `private` or `public` |
| `renew` | string | Previous season's league key (for keeper leagues) |

**AI Analysis Usage:**
- Use `current_week` to know which week's scoreboard to fetch
- Use `scoring_type` to understand if it's categories or points
- Use `end_week` minus `current_week` to calculate weeks remaining
- Use `num_teams` to understand league size for trade analysis

---

### League Settings

```
GET /league/{league_key}/settings
```

This is the most critical endpoint - it defines which stats are scored and how the league is configured.

**Response Structure:**
```
fantasy_content.league[0] = league metadata (same as /league endpoint)
fantasy_content.league[1].settings[0] = settings object
```

**Key Settings Fields:**

| Field | Example | Description |
|-------|---------|-------------|
| `scoring_type` | `headone` | `headone` = H2H one-win, `head` = H2H each cat, `point` = points |
| `draft_type` | `live` | `live`, `offline`, `autopick` |
| `is_auction_draft` | `0` | `1` = auction, `0` = snake |
| `uses_playoff` | `1` | Whether league has playoffs |
| `playoff_start_week` | `20` | Week playoffs begin |
| `num_playoff_teams` | `6` | Teams making playoffs |
| `waiver_type` | `FR` | Waiver system type |
| `uses_faab` | `1` | `1` = FAAB bidding for waivers |
| `trade_end_date` | `2026-02-19` | Trade deadline |
| `trade_ratify_type` | `commish` | `commish`, `vote`, `none` |
| `max_adds` | `150` | Season acquisition limit |
| `max_weekly_adds` | `4` | Weekly acquisition limit |
| `can_trade_draft_picks` | `1` | Whether picks are tradeable |

**Roster Positions:**

Located at `settings[0].roster_positions[]`:

```json
{
  "roster_position": {
    "position": "PG",
    "position_type": "P",
    "count": 1,
    "is_starting_position": 1
  }
}
```

Example league roster (10 starters + 6 bench + 2 IL):
| Position | Count | Starting? |
|----------|-------|-----------|
| PG | 1 | Yes |
| SG | 1 | Yes |
| G | 1 | Yes (guard flex) |
| SF | 1 | Yes |
| PF | 1 | Yes |
| F | 1 | Yes (forward flex) |
| C | 2 | Yes |
| Util | 2 | Yes |
| BN | 6 | No (bench) |
| IL | 1 | No |
| IL+ | 1 | No |

**Stat Categories (CRITICAL):**

Located at `settings[0].stat_categories.stats[]`:

```json
{
  "stat": {
    "stat_id": 12,
    "enabled": "1",
    "name": "Points Scored",
    "display_name": "PTS",
    "abbr": "PTS",
    "group": "misc",
    "sort_order": "1",
    "is_only_display_stat": "1"  // <-- if present, NOT a scoring category
  }
}
```

**Identifying Scoring vs Display Categories:**
- If `is_only_display_stat` is present and `"1"` → Display only (like FGA, FTM/FTA)
- If `is_only_display_stat` is absent → **This is a scoring category**

**This League's 9 Scoring Categories:**

| stat_id | Name | Abbr | Notes |
|---------|------|------|-------|
| 4 | Field Goals Made | FGM | Counting stat |
| 5 | Field Goal Percentage | FG% | Percentage (0.000-1.000) |
| 8 | Free Throw Percentage | FT% | Percentage (0.000-1.000) |
| 10 | 3-point Shots Made | 3PTM | Counting stat |
| 12 | Points Scored | PTS | Counting stat |
| 15 | Total Rebounds | REB | Counting stat |
| 16 | Assists | AST | Counting stat |
| 17 | Steals | ST | Counting stat |
| 18 | Blocked Shots | BLK | Counting stat |

**Display-Only Stats (not scored):**
- stat_id 3: FGA (Field Goals Attempted)
- stat_id 9007006: FTM/FTA (composite display stat)

**AI Analysis Usage:**
- Parse `stat_categories.stats[]` to know which categories to analyze
- Filter out `is_only_display_stat` entries for scoring analysis
- Use `roster_positions` to understand lineup requirements
- Check `max_weekly_adds` to advise on streaming limits
- Use `playoff_start_week` to calculate weeks until playoffs

---

### League Standings

```
GET /league/{league_key}/standings
```

Returns all teams with their season stats, W/L records, and rankings.

**Response Structure:**
```
fantasy_content.league[0] = league metadata
fantasy_content.league[1].standings[0].teams = teams collection
  teams["0"], teams["1"], ... teams["11"] = individual teams
  teams.count = 12
```

**Team Array Structure (Yahoo's unusual format):**

Each team is an array of 3 elements that must be parsed:

```javascript
team[0] = Array of metadata objects (must be merged)
team[1] = { team_stats: { coverage_type, season, stats[] } }
team[2] = { team_standings: { rank, playoff_seed, outcome_totals, games_back } }
```

**team[0] - Metadata Objects to Merge:**

The first element is an array of objects, each containing different properties:

```json
[
  { "team_key": "466.l.15701.t.2" },
  { "team_id": "2" },
  { "name": "Cheeks Squad" },
  [],
  { "url": "https://basketball.fantasysports.yahoo.com/nba/15701/2" },
  { "team_logos": [...] },
  { "previous_season_team_rank": 1 },
  [],
  { "waiver_priority": 12 },
  { "faab_balance": "0" },
  { "number_of_moves": 40 },
  { "number_of_trades": 0 },
  { "roster_adds": { "coverage_type": "week", "coverage_value": 11, "value": "2" } },
  [],
  { "league_scoring_type": "headone" },
  // ... more empty arrays and objects ...
  { "managers": [...] }
]
```

**Key Team Metadata Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `team_key` | string | Unique team identifier |
| `team_id` | string | Team ID within league |
| `name` | string | Team name |
| `waiver_priority` | number | Waiver order (1 = first) |
| `faab_balance` | string | Remaining FAAB budget |
| `number_of_moves` | number | Season acquisitions |
| `number_of_trades` | number/string | Trades made |
| `roster_adds.value` | string | Adds this week |
| `is_owned_by_current_login` | number | `1` if this is the user's team |
| `managers[]` | array | Team manager(s) info |

**team[1] - Season Stats:**

```json
{
  "team_stats": {
    "coverage_type": "season",
    "season": "2025",
    "stats": [
      { "stat": { "stat_id": "4", "value": "2736" } },
      { "stat": { "stat_id": "5", "value": ".475" } },
      // ... all stat categories
    ]
  }
}
```

**Stat Value Formats:**
- Counting stats: `"2736"` (string integer)
- Percentages: `".475"` (string decimal, 0-1 scale)
- Composite display: `"1337/1700"` (FTM/FTA format)

**team[2] - Standings:**

```json
{
  "team_standings": {
    "rank": "1",
    "playoff_seed": "1",
    "outcome_totals": {
      "wins": "9",
      "losses": "1",
      "ties": 0,
      "percentage": ".900"
    },
    "games_back": "-"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `rank` | string | Current league rank (1-12) |
| `playoff_seed` | string | Playoff seeding |
| `outcome_totals.wins` | string | Matchup wins |
| `outcome_totals.losses` | string | Matchup losses |
| `outcome_totals.percentage` | string | Win percentage |
| `games_back` | string | Games behind 1st (`"-"` if first) |

**Manager Object:**

```json
{
  "manager": {
    "manager_id": "5",
    "nickname": "Ben",
    "guid": "FMAHAVPYBK7JVVGIJQ6HRDFKQE",
    "is_current_login": "1",
    "is_commissioner": "1",
    "is_comanager": "1",
    "email": "user@example.com",
    "felo_score": "615",
    "felo_tier": "silver"
  }
}
```

**Parsing JavaScript Example:**

```javascript
function parseTeamFromStandings(teamArray) {
  // Merge all objects from team[0] array
  const metadata = {};
  teamArray[0].forEach(obj => {
    if (obj && typeof obj === 'object') {
      Object.assign(metadata, obj);
    }
  });

  // Get stats from team[1]
  const stats = {};
  teamArray[1]?.team_stats?.stats?.forEach(s => {
    stats[s.stat.stat_id] = s.stat.value;
  });

  // Get standings from team[2]
  const standings = teamArray[2]?.team_standings;

  return { ...metadata, stats, standings };
}
```

**AI Analysis Usage:**
- Compare `stats` across teams to rank by category
- Use `outcome_totals` to identify playoff contenders
- Check `faab_balance` for trade/waiver analysis
- Use `roster_adds.value` to track streaming activity
- Identify user's team via `is_owned_by_current_login`

---

### Scoreboard (Weekly Matchups)

```
GET /league/{league_key}/scoreboard
GET /league/{league_key}/scoreboard;week=10
```

Returns all matchups for a given week with live category comparisons.

**Response Structure:**
```
fantasy_content.league[0] = league metadata
fantasy_content.league[1].scoreboard["0"].matchups = matchups collection
  matchups["0"], matchups["1"], ... matchups["5"] = individual matchups (6 for 12-team league)
  matchups.count = 6
scoreboard.week = 11
```

**Matchup Object:**

```json
{
  "matchup": {
    "0": {
      "teams": {
        "0": { "team": [...] },
        "1": { "team": [...] },
        "count": 2
      }
    },
    "week": "11",
    "week_start": "2025-12-29",
    "week_end": "2026-01-04",
    "status": "midevent",
    "is_playoffs": "0",
    "is_consolation": "0",
    "is_matchup_of_the_week": "0",
    "stat_winners": [...]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `week` | string | Matchup week number |
| `week_start` / `week_end` | string | Date range (YYYY-MM-DD) |
| `status` | string | `preevent`, `midevent`, `postevent` |
| `is_playoffs` | string | `"1"` if playoff matchup |
| `is_consolation` | string | `"1"` if consolation bracket |
| `is_matchup_of_the_week` | string | `"1"` if featured matchup |
| `stat_winners[]` | array | Category winners |

**Team Stats in Scoreboard (Weekly):**

Unlike standings (season stats), scoreboard has **weekly stats**:

```json
{
  "team_stats": {
    "coverage_type": "week",
    "week": "11",
    "stats": [
      { "stat": { "stat_id": "4", "value": 49 } },
      { "stat": { "stat_id": "5", "value": ".467" } },
      // ... all categories
    ]
  },
  "team_points": {
    "coverage_type": "week",
    "week": "11",
    "total": "1"
  },
  "team_remaining_games": {
    "coverage_type": "week",
    "week": "11",
    "total": {
      "remaining_games": 32,
      "live_games": 2,
      "completed_games": 11
    }
  }
}
```

**Key Scoreboard-Specific Fields:**

| Field | Description |
|-------|-------------|
| `team_points.total` | Categories won so far this week (for H2H) |
| `team_remaining_games.remaining_games` | Games left this week |
| `team_remaining_games.live_games` | Games currently in progress |
| `team_remaining_games.completed_games` | Games finished this week |

**stat_winners Array:**

Shows which team is winning each category:

```json
// Normal winner:
{
  "stat_winner": {
    "stat_id": "4",
    "winner_team_key": "466.l.15701.t.2"
  }
}

// Tied category:
{
  "stat_winner": {
    "stat_id": "18",
    "is_tied": 1
  }
}
```

**Historical Weeks (`;week=N` parameter):**

Use `/scoreboard;week=1` to get any past week's matchups. Differences from current week:
- `status`: `"postevent"` instead of `"midevent"`
- Stat values are **strings** (e.g., `"142"`) vs **numbers** for current week (Yahoo inconsistency!)
- `team_remaining_games` will show 0 remaining

**AI Analysis Usage:**
- Use `stat_winners` to quickly identify which categories to target
- Compare `remaining_games` to assess comeback potential
- Check `live_games` for real-time analysis
- Use `status` to know if matchup is complete
- Calculate category margins to prioritize streaming targets
- **Important:** Compare games remaining - opponent with more games has advantage
- Fetch multiple weeks to analyze trends and opponent patterns

---

### League Teams (Metadata Only)

```
GET /league/{league_key}/teams
```

Returns all teams with metadata but **without stats or standings**. Lighter-weight alternative to `/standings`.

**Response Structure:**
```
fantasy_content.league[0] = league metadata
fantasy_content.league[1].teams = teams collection
  teams["0"], teams["1"], ... teams["11"] = individual teams
  teams.count = 12
```

**Team Structure (Simplified):**

Unlike standings, teams only has the metadata array - no stats or standings:

```javascript
team[0] = Array of metadata objects (must be merged)
// NO team[1] (stats)
// NO team[2] (standings)
```

**Key Fields (same as standings metadata):**

| Field | Type | Description |
|-------|------|-------------|
| `team_key` | string | Unique team identifier |
| `team_id` | string | Team ID within league |
| `name` | string | Team name |
| `waiver_priority` | number | Waiver order (1 = first) |
| `faab_balance` | string | Remaining FAAB budget |
| `number_of_moves` | number | Season acquisitions |
| `number_of_trades` | number/string | Trades made |
| `roster_adds.value` | string | Adds this week |
| `is_owned_by_current_login` | number | `1` if user's team |
| `managers[]` | array | Manager info |

**When to Use:**
- Use `/teams` when you only need team names/keys (faster, less data)
- Use `/standings` when you need stats and W/L records
- Use `/teams/roster` to get teams with their rosters

---

### Teams with Rosters

```
GET /league/{league_key}/teams/roster
```

Returns all teams with their complete rosters including player details.

**Response Structure:**
```
fantasy_content.league[0] = league metadata
fantasy_content.league[1].teams = teams collection
  team[0] = metadata array (same as /teams)
  team[1].roster["0"].players = players collection
```

**Player Structure:**

Each player has Yahoo's array-of-objects format:

```javascript
player[0] = Array of player metadata objects (must be merged)
player[1] = { selected_position: [...] }
```

**Player Metadata Fields (in player[0]):**

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `player_key` | string | `"466.p.6418"` | Unique player key |
| `player_id` | string | `"6418"` | Player ID |
| `name.full` | string | `"Payton Pritchard"` | Full name |
| `name.first` / `name.last` | string | | First/last name |
| `editorial_team_abbr` | string | `"BOS"` | NBA team abbreviation |
| `editorial_team_full_name` | string | `"Boston Celtics"` | Full team name |
| `display_position` | string | `"PG"` or `"PG,SG"` | Display positions |
| `primary_position` | string | `"PG"` | Main position |
| `eligible_positions[]` | array | `[{position:"PG"},{position:"G"}]` | Slots player can fill |
| `headshot.url` | string | | Player photo URL |
| `uniform_number` | string | `"11"` | Jersey number |
| `is_undroppable` | string | `"0"` or `"1"` | Can't be dropped |
| `has_player_notes` | number | `1` | Has news/notes |

**Injury Status Fields:**

```json
{
  "status": "INJ",
  "status_full": "Injured (IL-eligible)"
}
```

| Status | Full Text | Description |
|--------|-----------|-------------|
| `"O"` | Out (short-term injury) | Out but not IL-eligible |
| `"INJ"` | Injured (IL-eligible) | Can be placed on IL |
| `"GTD"` | Game Time Decision | Questionable |
| `"DTD"` | Day-to-Day | Minor issue |
| `"NA"` | Not Active | Not playing (coach's decision, etc.) |
| (none) | - | Healthy |

**Injury Note Field:**

Some players have an additional `injury_note` field:
```json
{
  "status": "NA",
  "status_full": "Not Active",
  "injury_note": "Coach's Decision"
}
```

**Keeper League Fields:**

```json
{
  "is_keeper": {
    "status": true,
    "cost": false,
    "kept": true
  }
}
```

**Selected Position (player[1]):**

```json
{
  "selected_position": [
    { "coverage_type": "date", "date": "2025-12-30" },
    { "position": "PG" },
    { "is_flex": 0 }
  ]
}
```

| Field | Description |
|-------|-------------|
| `coverage_type` | `"date"` (daily) or `"week"` |
| `date` / `week` | When position applies |
| `position` | Roster slot: `PG`, `SG`, `G`, `SF`, `PF`, `F`, `C`, `Util`, `BN`, `IL`, `IL+` |
| `is_flex` | `1` if in flex position |

**Note:** This endpoint does NOT include player stats. Use `/player/{key}/stats` for statistics.

**AI Analysis Usage:**
- Identify injured players (`status` field) for streaming opportunities
- Check `eligible_positions` for lineup flexibility
- Use `is_keeper` to identify keeper-eligible players
- Compare rosters to find trade targets
- Check which players are on IL slots vs active roster

---

### Teams with Stats

```
GET /league/{league_key}/teams/stats
```

Returns all teams with season statistics but **without standings/rankings**.

**Response Structure:**
```
fantasy_content.league[0] = league metadata
fantasy_content.league[1].teams = teams collection
  team[0] = metadata array (same as /teams)
  team[1] = { team_stats: {...}, team_points: {...} }
```

**team_stats Object:**

```json
{
  "team_stats": {
    "coverage_type": "season",
    "season": "2025",
    "stats": [
      { "stat": { "stat_id": "4", "value": "1990" } },
      { "stat": { "stat_id": "5", "value": ".477" } },
      // ... all stat categories
    ]
  },
  "team_points": {
    "coverage_type": "season",
    "season": "2025",
    "total": ""
  }
}
```

**Comparison to Other Endpoints:**

| Endpoint | Metadata | Stats | Standings | Rosters |
|----------|----------|-------|-----------|---------|
| `/teams` | Yes | No | No | No |
| `/teams/stats` | Yes | **Season** | No | No |
| `/teams/roster` | Yes | No | No | **Yes** |
| `/standings` | Yes | **Season** | **Yes** | No |
| `/scoreboard` | Yes | **Weekly** | No | No |

**When to Use:**
- Use `/teams/stats` when you need season stats but don't need W/L records
- Use `/standings` when you also need rankings and outcome totals
- Can add `;type=week;week=N` for weekly stats instead of season

---

### Players Collection

```
GET /league/{league_key}/players
GET /league/{league_key}/players;status=T;count=25
GET /league/{league_key}/players;status=FA;count=25
GET /league/{league_key}/players;status=W;count=25
```

Returns players in the league context with various filters. Players are returned independently of teams.

**Query Parameters:**

| Parameter | Values | Description |
|-----------|--------|-------------|
| `status` | `T` | Taken (rostered by any team) |
| | `FA` | Free agents (unrostered, not on waivers) |
| | `W` | On waivers |
| | `A` | Available (FA + W combined) |
| `count` | number | Limit results (e.g., `25`, `50`) |
| `start` | number | Pagination offset |
| `position` | `PG`, `SG`, `SF`, `PF`, `C`, `G`, `F`, `Util` | Filter by position |
| `sort` | `AR` (avg rank), stat IDs | Sort order |
| `search` | string | Search by player name |

**Response Structure:**
```
fantasy_content.league[0] = league metadata
fantasy_content.league[1].players = players collection
  players["0"], players["1"], ... = individual players
  players.count = number of results
```

**Player Structure:**

Same array-of-objects format as roster endpoint:

```javascript
player[0] = Array of player metadata objects (must be merged)
// NO player[1] - no selected_position since not in team context
```

**Key Player Fields:**

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `player_key` | string | `"466.p.3704"` | Unique player key |
| `name.full` | string | `"LeBron James"` | Full name |
| `editorial_team_abbr` | string | `"LAL"` | NBA team |
| `display_position` | string | `"SF,PF"` | Eligible positions |
| `is_undroppable` | string | `"1"` | Can't be dropped (star players) |
| `has_player_notes` | number | `1` | Has news available |
| `has_recent_player_notes` | number | `1` | Has recent news |

**Note:** This endpoint does NOT include:
- Which fantasy team owns the player (use `/teams/roster`)
- Player statistics (use `/players/stats` subresource)

**AI Analysis Usage:**
- Use `status=FA` to find streaming candidates
- Use `status=W` to monitor waiver wire
- Combine with `/players/stats` for statistical analysis
- Check `is_undroppable` when suggesting drops

---

### Transactions

```
GET /league/{league_key}/transactions
GET /league/{league_key}/transactions;types=add,drop
GET /league/{league_key}/transactions;types=trade
```

Returns league transaction history (adds, drops, trades).

**Response Structure:**
```
fantasy_content.league[0] = league metadata
fantasy_content.league[1].transactions = transactions collection
  transactions["0"], transactions["1"], ... = individual transactions
  transactions.count = number of results
```

**Transaction Structure:**

```javascript
transaction[0] = transaction metadata
transaction[1].players = players involved in transaction
```

**Transaction Metadata (transaction[0]):**

```json
{
  "transaction_key": "466.l.15701.tr.358",
  "transaction_id": "358",
  "type": "add/drop",
  "status": "successful",
  "timestamp": "1767102768"
}
```

| Field | Type | Values |
|-------|------|--------|
| `type` | string | `"add"`, `"drop"`, `"add/drop"`, `"trade"` |
| `status` | string | `"successful"`, `"pending"`, `"vetoed"` |
| `timestamp` | string | Unix timestamp |

**Trade-Specific Fields:**

Trades have additional metadata:

```json
{
  "type": "trade",
  "trader_team_key": "466.l.15701.t.6",
  "trader_team_name": "KATegories",
  "tradee_team_key": "466.l.15701.t.12",
  "tradee_team_name": "Big Vic Energy",
  "picks": [
    {
      "pick": {
        "source_team_key": "466.l.15701.t.6",
        "destination_team_key": "466.l.15701.t.12",
        "round": "3",
        "original_team_key": "466.l.15701.t.6"
      }
    }
  ]
}
```

**Player Transaction Data:**

Each player has a `transaction_data` object:

```json
// Add from free agents:
{
  "type": "add",
  "source_type": "freeagents",
  "destination_type": "team",
  "destination_team_key": "466.l.15701.t.3",
  "destination_team_name": "Cats That Can Ball"
}

// Add from waivers:
{
  "type": "add",
  "source_type": "waivers",
  "destination_type": "team",
  "destination_team_key": "466.l.15701.t.2"
}

// Drop to waivers:
{
  "type": "drop",
  "source_type": "team",
  "source_team_key": "466.l.15701.t.3",
  "destination_type": "waivers"
}

// Trade:
{
  "type": "trade",
  "source_type": "team",
  "source_team_key": "466.l.15701.t.6",
  "destination_type": "team",
  "destination_team_key": "466.l.15701.t.12"
}
```

**Query Parameters:**

| Parameter | Values | Description |
|-----------|--------|-------------|
| `types` | `add`, `drop`, `add/drop`, `trade` | Filter by transaction type |
| `count` | number | Limit results |
| `start` | number | Pagination offset |

**AI Analysis Usage:**
- Track which players are being added/dropped (streaming trends)
- Identify active managers by transaction count
- Analyze trade patterns for league dynamics
- Monitor waiver wire activity

---

### Draft Results

```
GET /league/{league_key}/draftresults
```

Returns complete draft history for the league.

**Response Structure:**
```
fantasy_content.league[0] = league metadata
fantasy_content.league[1].draft_results = draft picks collection
  draft_results["0"], draft_results["1"], ... = individual picks
  draft_results.count = total picks
```

**Draft Result Object:**

```json
{
  "draft_result": {
    "pick": 1,
    "round": 1,
    "team_key": "466.l.15701.t.9",
    "player_key": "466.p.5352"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `pick` | number | Overall pick number (1, 2, 3...) |
| `round` | number | Round number |
| `team_key` | string | Team that made the pick |
| `player_key` | string | Player selected |

**Note:** Does NOT include player names - only player keys. Join with player data to get names.

**AI Analysis Usage:**
- Analyze draft positions for keeper league value
- Identify draft tendencies by manager
- Cross-reference with current rosters to track draft picks still rostered

---

### Game Metadata

```
GET /game/nba
GET /game/{game_key}
```

Returns metadata about a fantasy game (sport/season).

**Response Structure:**
```json
{
  "fantasy_content": {
    "game": [
      {
        "game_key": "466",
        "game_id": "466",
        "name": "Basketball",
        "code": "nba",
        "type": "full",
        "url": "https://basketball.fantasysports.yahoo.com/nba",
        "season": "2025",
        "is_registration_over": 0,
        "is_game_over": 0,
        "is_offseason": 0,
        "is_live_draft_lobby_active": 1
      }
    ]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `game_key` | string | Current season's game key (`466` for 2024-25) |
| `game_id` | string | Same as game_key |
| `code` | string | Sport code (`nba`) |
| `season` | string | Season year |
| `is_registration_over` | number | `1` if can't create new leagues |
| `is_game_over` | number | `1` if season is finished |
| `is_offseason` | number | `1` if in offseason |
| `is_live_draft_lobby_active` | number | `1` if drafts still happening |

**AI Analysis Usage:**
- Get current `game_key` for API calls
- Check if season is active before making recommendations
- Determine if it's offseason for keeper/dynasty advice

---

### Game Stat Categories

```
GET /game/nba/stat_categories
```

Returns all available stat categories for NBA fantasy. This is the canonical reference for stat IDs.

**Response Structure:**
```
fantasy_content.game[0] = game metadata
fantasy_content.game[1].stat_categories.stats = array of stat definitions
```

**Stat Definition Object:**

```json
{
  "stat": {
    "stat_id": 12,
    "name": "Points Scored",
    "display_name": "PTS",
    "sort_order": "1",
    "position_types": [{ "position_type": "P" }]
  }
}
```

**Composite Stat (calculated from other stats):**

```json
{
  "stat": {
    "stat_id": 5,
    "name": "Field Goal Percentage",
    "display_name": "FG%",
    "sort_order": "1",
    "is_composite_stat": 1,
    "base_stats": [
      { "base_stat": { "stat_id": "3" } },
      { "base_stat": { "stat_id": "4" } }
    ]
  }
}
```

| Field | Description |
|-------|-------------|
| `sort_order` | `"1"` = higher is better, `"0"` = lower is better |
| `is_composite_stat` | `1` if calculated from other stats |
| `base_stats` | Source stats for composite calculations |

**Complete NBA Stat ID Reference:**

| ID | Name | Abbr | Sort | Notes |
|----|------|------|------|-------|
| 0 | Games Played | GP | ↑ | |
| 1 | Games Started | GS | ↑ | |
| 2 | Minutes Played | MIN | ↑ | |
| 3 | Field Goals Attempted | FGA | ↑ | |
| 4 | Field Goals Made | FGM | ↑ | |
| 5 | Field Goal Percentage | FG% | ↑ | Composite: FGM/FGA |
| 6 | Free Throws Attempted | FTA | ↑ | |
| 7 | Free Throws Made | FTM | ↑ | |
| 8 | Free Throw Percentage | FT% | ↑ | Composite: FTM/FTA |
| 9 | 3-point Shots Attempted | 3PTA | ↑ | |
| 10 | 3-point Shots Made | 3PTM | ↑ | |
| 11 | 3-point Percentage | 3PT% | ↑ | Composite: 3PTM/3PTA |
| 12 | Points Scored | PTS | ↑ | |
| 13 | Offensive Rebounds | OREB | ↑ | |
| 14 | Defensive Rebounds | DREB | ↑ | |
| 15 | Total Rebounds | REB | ↑ | |
| 16 | Assists | AST | ↑ | |
| 17 | Steals | ST | ↑ | |
| 18 | Blocked Shots | BLK | ↑ | |
| 19 | Turnovers | TO | ↓ | Lower is better! |
| 20 | Assist/Turnover Ratio | A/T | ↑ | Composite: AST/TO |
| 21 | Personal Fouls | PF | ↓ | Lower is better |
| 22 | Times Fouled Out | DISQ | ↓ | Lower is better |
| 23 | Technical Fouls | TECH | ↓ | Lower is better |
| 24 | Ejections | EJCT | ↓ | Lower is better |
| 25 | Flagrant Fouls | FF | ↓ | Lower is better |
| 26 | Minutes Per Game | MPG | ↑ | |
| 27 | Double-Doubles | DD | ↑ | |
| 28 | Triple-Doubles | TD | ↑ | |

**Your League's 9 Scoring Categories:**
Based on league settings: FGM (4), FG% (5), FT% (8), 3PTM (10), PTS (12), REB (15), AST (16), ST (17), BLK (18)

**AI Analysis Usage:**
- Use stat IDs to map between settings and actual values
- Check `sort_order` to know if higher or lower is better
- Understand composite stats require base stats for calculations
