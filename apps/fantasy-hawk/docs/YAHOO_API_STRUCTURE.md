# Yahoo Fantasy API Response Structure

This document describes the structure of Yahoo Fantasy API responses for NBA fantasy basketball.
The Yahoo API returns complex nested JSON that requires careful parsing.

## General Pattern

Yahoo's API responses follow this general structure:
```json
{
  "fantasy_content": {
    "xml:lang": "en-US",
    "yahoo:uri": "/fantasy/v2/...",
    // Resource data here
    "time": "...",
    "copyright": "...",
    "refresh_rate": "60"
  }
}
```

## Common Gotchas

1. **Arrays vs Objects with Count**: Sometimes Yahoo returns data as an object with numbered keys (`"0"`, `"1"`) and a `count` property. Other times it's a regular array. Always check which format you're dealing with.

2. **Nested Arrays**: Resources like `league` often come as arrays where:
   - Index 0 = metadata (name, id, settings, etc.)
   - Index 1+ = subresources (standings, teams, etc.)

3. **Single-Property Objects**: Team data comes as arrays of single-property objects that need merging:
   ```json
   [
     [{"team_key": "..."}, {"team_id": "..."}, {"name": "..."}],
     {"team_stats": {...}},
     {"team_standings": {...}}
   ]
   ```

## Endpoint Structures

### GET /league/{league_key}/settings

Returns league configuration including stat categories.

```
fantasy_content
└── league (array)
    ├── [0] League metadata object
    │   ├── league_key: "466.l.15701"
    │   ├── name: "League Name"
    │   ├── num_teams: 12
    │   ├── scoring_type: "headone" (H2H One Win) or "head" (H2H Each Category)
    │   └── ... other metadata
    │
    └── [1] Settings container object
        └── settings (array)
            └── [0] Settings object
                ├── draft_type: "live" | "offline"
                ├── scoring_type: "headone" | "head" | "roto"
                ├── roster_positions (array)
                │   └── [n] { roster_position: { position, count, is_starting_position } }
                │
                ├── stat_categories (object)
                │   ├── stats (array) - THE SCORING CATEGORIES
                │   │   └── [n] { stat: { stat_id, name, display_name, abbr, is_only_display_stat? } }
                │   └── groups (array)
                │       └── [n] { group: { group_name, group_display_name, group_abbr } }
                │
                └── ... other settings (max_adds, trade_end_date, etc.)
```

**Important for stat_categories.stats:**
- Each item is `{ stat: { ... } }` - need to extract `.stat`
- Filter out items where `is_only_display_stat === "1"` - these are display-only (like FGA, FTM/A)
- Remaining items are the actual scoring categories

**Example parsing:**
```typescript
const stats = settings.stat_categories.stats;
const scoringCategories = stats
  .map((s) => s.stat)
  .filter((stat) => !stat.is_only_display_stat);
```

### GET /league/{league_key}/standings

Returns league standings with team records.

```
fantasy_content
└── league (array)
    ├── [0] League metadata
    │
    └── [1] Standings container
        └── standings (object)
            └── "0" (object)
                └── teams (object with numbered keys + count)
                    ├── count: 12
                    ├── "0": { team: [...] }
                    ├── "1": { team: [...] }
                    └── ...
```

**Team array structure:**
```
team (array)
├── [0] Array of single-property objects (merge these)
│   ├── { team_key: "..." }
│   ├── { team_id: "..." }
│   ├── { name: "Team Name" }
│   ├── { managers: [...] }
│   └── ...
├── [1] { team_stats: { ... } }  (optional)
└── [2] { team_standings: { rank, outcome_totals: { wins, losses, ties }, ... } }
```

**Helper to merge team data:**
```typescript
function mergeYahooTeamData(teamArray: any[]): any {
  if (!Array.isArray(teamArray) || teamArray.length === 0) return null;

  const propsArray = teamArray[0];
  if (!Array.isArray(propsArray)) return null;

  const merged: any = {};
  propsArray.forEach((obj) => {
    if (obj && typeof obj === 'object') {
      Object.assign(merged, obj);
    }
  });

  if (teamArray[1]?.team_stats) merged.team_stats = teamArray[1].team_stats;
  if (teamArray[2]?.team_standings) merged.team_standings = teamArray[2].team_standings;

  return merged;
}
```

### GET /users;use_login=1/games;game_keys=nba/leagues

Returns user's leagues for NBA.

```
fantasy_content
└── users (object with numbered keys)
    └── "0" (object)
        └── user (array)
            ├── [0] User metadata
            └── [1] Games container
                └── games (object with numbered keys + count)
                    └── "0" (object)
                        └── game (array)
                            ├── [0] Game metadata (game_key, season, etc.)
                            └── [1] Leagues container
                                └── leagues (object with numbered keys + count)
                                    ├── count: N
                                    ├── "0": { league: [...] }
                                    └── ...
```

### GET /users;use_login=1/games;game_keys=nba/teams

Returns user's teams for NBA.

```
fantasy_content
└── users
    └── "0"
        └── user (array)
            ├── [0] User metadata
            └── [1] Games container
                └── games
                    └── "0"
                        └── game (array)
                            ├── [0] Game metadata
                            └── [1] Teams container
                                └── teams (object with numbered keys + count)
                                    ├── count: N
                                    ├── "0": { team: [...] }
                                    └── ...
```

## Scoring Types

- `"head"` - Head-to-Head (each category counts as win/loss)
- `"headone"` - Head-to-Head One Win (win/loss based on total categories won)
- `"roto"` - Rotisserie (cumulative stats across season)
- `"headpoint"` - Head-to-Head Points

## Common Stat IDs (NBA)

| stat_id | name | display_name |
|---------|------|--------------|
| 3 | Field Goals Attempted | FGA |
| 4 | Field Goals Made | FGM |
| 5 | Field Goal Percentage | FG% |
| 6 | Free Throws Attempted | FTA |
| 7 | Free Throws Made | FTM |
| 8 | Free Throw Percentage | FT% |
| 10 | 3-point Shots Made | 3PTM |
| 12 | Points Scored | PTS |
| 15 | Total Rebounds | REB |
| 16 | Assists | AST |
| 17 | Steals | ST |
| 18 | Blocked Shots | BLK |
| 19 | Turnovers | TO |

## Debug Endpoints

The Fantasy Hawk API includes debug endpoints:

- `GET /api/fantasy/debug/dump-settings/:league_key` - Saves raw settings response to `/var/apps/fantasy-hawk/api-dumps/`
- `GET /api/fantasy/debug/standings/:league_key` - Returns raw standings response
- `GET /api/fantasy/debug/teams` - Returns raw teams response
- `GET /api/fantasy/proxy?endpoint=...` - Generic proxy for any Yahoo API endpoint

## References

- [Yahoo Fantasy Sports API Guide](https://developer.yahoo.com/fantasysports/guide/)
- API Base URL: `https://fantasysports.yahooapis.com/fantasy/v2`
- Always append `?format=json` to get JSON instead of XML
