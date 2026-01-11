# Task 202: Migrate Dashboard to route-based rendering

## Objective
Convert Dashboard.tsx from tab-based state management to route-based rendering, updating all feature components to receive leagueKey from router context.

## Files to Modify
- `frontend/src/components/Dashboard.tsx` - Major refactor or removal
- `frontend/src/components/LeagueLayout.tsx` - May need updates
- Multiple feature components - Update to use `useOutletContext` or `useParams`

## Files to Read First
- `frontend/src/components/Dashboard.tsx` - Current implementation
- `frontend/src/components/LeagueLayout.tsx` - Layout component
- `frontend/src/App.tsx` - Route definitions

## Current State Analysis

Dashboard.tsx currently:
1. Receives `selectedLeague` as prop
2. Manages `activeTab` state
3. Loads league data (standings, settings)
4. Conditionally renders feature components based on activeTab
5. Has category-specific state (timespan, categoryView, categoryStatsData)

## Implementation Steps

### Step 1: Understand what Dashboard does

Key responsibilities:
- League data loading (standings, settings) - move to LeagueLayout or keep
- Tab navigation - already moved to LeagueLayout
- Category state management - move to Categories routes
- Conditional rendering - replaced by Routes

### Step 2: Move data loading to LeagueLayout

The league data loading should happen in LeagueLayout since it's needed by all child routes:

```tsx
// LeagueLayout.tsx
export function LeagueLayout() {
  const { leagueKey } = useParams<{ leagueKey: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [standings, setStandings] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    if (leagueKey) {
      loadLeagueData(leagueKey);
    }
  }, [leagueKey]);

  // ... data loading functions from Dashboard

  if (!leagueKey) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return <LoadingSpinner message="Loading league data..." />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      ...

      {/* Pass data to children via context */}
      <Outlet context={{ leagueKey, standings, settings }} />
    </div>
  );
}

// Type for outlet context
export interface LeagueContextType {
  leagueKey: string;
  standings: any[];
  settings: any;
}

export function useLeagueContext() {
  return useOutletContext<LeagueContextType>();
}
```

### Step 3: Update feature components

Each feature component needs to use the context instead of props:

**Before:**
```tsx
export function MatchupCenter({ selectedLeague }: { selectedLeague: string | null }) {
  if (!selectedLeague) return <NoLeague />;
  // ...
}
```

**After:**
```tsx
import { useLeagueContext } from './LeagueLayout';

export function MatchupCenter() {
  const { leagueKey } = useLeagueContext();
  // leagueKey is always defined because LeagueLayout validates it
  // ...
}
```

### Step 4: Create wrapper components for standings

StandingsPage needs the standings data from context:

```tsx
// StandingsPage.tsx (new file or in Dashboard.tsx)
import { useLeagueContext } from './LeagueLayout';
import { StandingsChart } from './StandingsChart';

export function StandingsPage() {
  const { standings } = useLeagueContext();

  return (
    <div className="card">
      <h2 className="font-display text-xl font-semibold text-gray-100 mb-6">
        League Standings
      </h2>
      {standings.length > 0 ? (
        <StandingsChart standings={standings} />
      ) : (
        <p className="text-gray-400">No standings data available</p>
      )}
    </div>
  );
}
```

### Step 5: Handle admin-only Strategy route

The Strategy route should check user role. Either:
1. Pass userRole through context, or
2. Check in the component and redirect

### Step 6: Remove or repurpose Dashboard.tsx

After migration, Dashboard.tsx may not be needed. Either:
- Delete it entirely
- Keep it as a redirect component
- Keep helper functions if still useful

## Implementation Notes

- Move helper functions like `parseStandingsFromResponse` to a utils file or keep in LeagueLayout
- The category-specific state (timespan, categoryView) moves to the Categories routes (Task 203)
- Don't break existing functionality - each component should work after this change
- Test each component as you migrate it

## Verification

```bash
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build
cd /srv/benloe && npx playwright test --project=fantasy-hawk --grep "standings"
```

App should build and basic navigation should work.

## Success Criteria
- [x] LeagueLayout loads league data
- [x] Context provides leagueKey, standings, settings to children
- [x] Feature components use useLeagueContext() instead of props
- [x] StandingsPage renders correctly
- [x] Navigation between tabs works
- [x] Build succeeds
- [x] Basic e2e tests pass
