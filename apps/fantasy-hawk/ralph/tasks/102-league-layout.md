# Task 102: Create LeagueLayout component with navigation

## Objective
Create a layout component that will wrap all league-specific routes and contain the tab navigation.

## Files to Create
- `frontend/src/components/LeagueLayout.tsx` - New layout component

## Files to Read First
- `frontend/src/components/Dashboard.tsx` - Understand current tab structure
- `frontend/src/App.tsx` - Understand current app structure

## Implementation Steps

### Step 1: Read Dashboard.tsx
Understand the current tab navigation structure, especially:
- The `tabs` array definition
- The tab button rendering
- How `activeTab` is used

### Step 2: Create LeagueLayout.tsx

Create a new component that:
1. Receives `leagueKey` from URL params (will be wired up later)
2. Contains the tab navigation bar (extracted from Dashboard)
3. Uses `<Outlet />` to render child routes
4. Highlights the active tab based on current route

```tsx
import { Outlet, NavLink, useParams } from 'react-router-dom';

export function LeagueLayout() {
  const { leagueKey } = useParams<{ leagueKey: string }>();

  // Tab definitions - same as Dashboard but with route paths
  const tabs = [
    { path: 'standings', label: 'Standings' },
    { path: 'categories', label: 'Categories' },
    { path: 'matchup', label: 'Matchup' },
    // ... etc
  ];

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex items-center gap-1 p-1 bg-court-base rounded-lg w-fit">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              `tab ${isActive ? 'tab-active' : ''}`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {/* Route content renders here */}
      <Outlet context={{ leagueKey }} />
    </div>
  );
}
```

### Step 3: Export from index (optional)

If there's a components index file, add the export.

## Implementation Notes

- Use `NavLink` instead of `Link` for automatic active state
- The `isActive` callback automatically detects if the route matches
- Pass `leagueKey` through Outlet context so child routes can access it
- Don't wire this up to routes yet - that's the next task
- Match existing Tailwind classes exactly from Dashboard

## Verification

```bash
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build
```

Build should succeed. Component won't be used yet, but TypeScript should validate it.

## Success Criteria
- [x] LeagueLayout.tsx created
- [x] Uses NavLink for tab navigation
- [x] Uses Outlet for child route rendering
- [x] Passes leagueKey through context
- [x] Build succeeds
