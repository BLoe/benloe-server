# Task 203: Implement Categories nested routes

## Objective
Set up nested routes for the Categories section, which has sub-views: profile, enhanced, trends, and raw stats.

## Files to Modify/Create
- `frontend/src/components/CategoriesLayout.tsx` - New layout for category views
- `frontend/src/App.tsx` - Update route definitions if needed

## Files to Read First
- `frontend/src/components/Dashboard.tsx` - Current category view logic (lines 302-411)
- `frontend/src/components/category/index.ts` - Category component exports
- `frontend/src/components/CategoryStatsTable.tsx` - Raw stats view

## Current Category Views

From Dashboard.tsx, the Categories tab has:
1. **Profile** (`categoryView === 'profile'`) - `<TeamProfile leagueKey={selectedLeague} />`
2. **Enhanced** (`categoryView === 'enhanced'`) - `<EnhancedCategoryTable leagueKey={selectedLeague} />`
3. **Trends** (`categoryView === 'trends'`) - `<TrendCharts leagueKey={selectedLeague} />`
4. **Raw** (`categoryView === 'raw'`) - `<CategoryStatsTable ... />` with timespan selector

Each has a toggle button and the raw view has an additional timespan selector.

## Target URL Structure

```
/league/:leagueKey/categories          → Default to profile
/league/:leagueKey/categories/profile  → Team Profile
/league/:leagueKey/categories/table    → Enhanced Category Table
/league/:leagueKey/categories/trends   → Trend Charts
/league/:leagueKey/categories/raw      → Raw Stats (with timespan query param)
```

## Implementation Steps

### Step 1: Create CategoriesLayout.tsx

```tsx
import { Outlet, NavLink, useSearchParams } from 'react-router-dom';
import { useLeagueContext } from './LeagueLayout';

export function CategoriesLayout() {
  const { leagueKey, settings } = useLeagueContext();

  const views = [
    { path: 'profile', label: 'My Profile' },
    { path: 'table', label: 'League Table' },
    { path: 'trends', label: 'Trends' },
    { path: 'raw', label: 'Raw Stats' },
  ];

  return (
    <div className="space-y-6">
      {/* Header with view toggle */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-gray-100">
            Category Analysis
          </h2>
          <div className="flex items-center gap-4">
            {/* View Toggle */}
            <div className="flex gap-1 bg-court-base rounded-lg p-1" data-testid="category-view-toggle">
              {views.map((view) => (
                <NavLink
                  key={view.path}
                  to={view.path}
                  className={({ isActive }) =>
                    `px-3 py-1.5 text-xs rounded transition-colors ${
                      isActive
                        ? 'bg-hawk-orange text-white'
                        : 'text-gray-400 hover:text-gray-200'
                    }`
                  }
                  data-testid={`category-view-${view.path}`}
                >
                  {view.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* View content */}
      <Outlet context={{ leagueKey, settings }} />
    </div>
  );
}
```

### Step 2: Create individual category route components

Each category view should be a simple wrapper that uses context:

**CategoriesProfilePage.tsx:**
```tsx
import { useLeagueContext } from './LeagueLayout';
import { TeamProfile } from './category';

export function CategoriesProfilePage() {
  const { leagueKey } = useLeagueContext();
  return <TeamProfile leagueKey={leagueKey} />;
}
```

**CategoriesTablePage.tsx:**
```tsx
import { useLeagueContext } from './LeagueLayout';
import { EnhancedCategoryTable } from './category';

export function CategoriesTablePage() {
  const { leagueKey } = useLeagueContext();
  return (
    <div className="card">
      <EnhancedCategoryTable leagueKey={leagueKey} />
    </div>
  );
}
```

**CategoriesTrendsPage.tsx:**
```tsx
import { useLeagueContext } from './LeagueLayout';
import { TrendCharts } from './category';

export function CategoriesTrendsPage() {
  const { leagueKey } = useLeagueContext();
  return <TrendCharts leagueKey={leagueKey} />;
}
```

**CategoriesRawPage.tsx:**
```tsx
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLeagueContext } from './LeagueLayout';
import { CategoryStatsTable } from './CategoryStatsTable';
import { LoadingSpinner } from './LoadingSpinner';
import { api } from '../services/api';

type TimespanType = 'thisWeek' | 'last3Weeks' | 'season';

export function CategoriesRawPage() {
  const { leagueKey, settings } = useLeagueContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const timespan = (searchParams.get('timespan') as TimespanType) || 'thisWeek';
  const [categoryStatsData, setCategoryStatsData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadCategoryStats();
  }, [leagueKey, timespan]);

  async function loadCategoryStats() {
    setLoading(true);
    try {
      const data = await api.fantasy.getCategoryStats(leagueKey, timespan);
      setCategoryStatsData(data);
    } finally {
      setLoading(false);
    }
  }

  function setTimespan(value: TimespanType) {
    setSearchParams({ timespan: value });
  }

  // Get categories from settings
  const categories = settings?.stat_categories?.stats?.map((s: any) => s.stat).filter(Boolean) || [];

  // ... render with timespan selector and table
}
```

### Step 3: Update route definitions in App.tsx

```tsx
<Route path="categories" element={<CategoriesLayout />}>
  <Route index element={<Navigate to="profile" replace />} />
  <Route path="profile" element={<CategoriesProfilePage />} />
  <Route path="table" element={<CategoriesTablePage />} />
  <Route path="trends" element={<CategoriesTrendsPage />} />
  <Route path="raw" element={<CategoriesRawPage />} />
</Route>
```

### Step 4: Update test selectors

The data-testid attributes should remain the same:
- `category-view-toggle`
- `category-view-profile`
- `category-view-enhanced` → `category-view-table`
- `category-view-trends`
- `category-view-raw`

Note: Update test fixtures if selector names changed.

## Implementation Notes

- Use `useSearchParams` for the timespan in raw view - keeps it in URL
- NavLink automatically handles active state based on route
- Default to 'profile' view when navigating to /categories
- Keep same Tailwind classes for styling consistency
- Preserve data-testid attributes for e2e tests

## Verification

```bash
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build
cd /srv/benloe && npx playwright test --project=fantasy-hawk --grep "category"
```

## Success Criteria
- [x] CategoriesLayout created with view toggle navigation
- [x] All four category views have route components
- [x] Raw view uses search params for timespan
- [x] Navigation between category views works
- [x] URLs update correctly (/categories/profile, etc.)
- [x] Build succeeds
- [x] Category e2e tests pass
