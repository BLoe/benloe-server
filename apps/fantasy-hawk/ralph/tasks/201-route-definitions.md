# Task 201: Define all routes with lazy loading

## Objective
Create the route configuration with lazy-loaded components for all features.

## Files to Modify
- `frontend/src/App.tsx` - Add route definitions

## Files to Read First
- `frontend/src/App.tsx` - Current app structure
- `frontend/src/components/Dashboard.tsx` - List of all tabs/features
- `frontend/src/components/LeagueLayout.tsx` - Layout component from Task 102

## Implementation Steps

### Step 1: Read Dashboard.tsx to get all tab types

The tabs are defined around line 221-236. Extract this list:
- standings, categories, matchup, streaming, trade, compare, waiver, punt, insights, schedule, outlook, chat, strategy, debug

### Step 2: Create lazy imports in App.tsx

Add lazy imports for all feature components:

```tsx
import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';

// Lazy load all feature components
const LeagueLayout = lazy(() => import('./components/LeagueLayout').then(m => ({ default: m.LeagueLayout })));
const StandingsPage = lazy(() => import('./components/StandingsPage').then(m => ({ default: m.StandingsPage })));
const MatchupCenter = lazy(() => import('./components/MatchupCenter').then(m => ({ default: m.MatchupCenter })));
const StreamingOptimizer = lazy(() => import('./components/StreamingOptimizer').then(m => ({ default: m.StreamingOptimizer })));
// ... etc for all components
```

### Step 3: Define route structure

```tsx
function App() {
  // Keep existing state for auth, etc.

  return (
    <HashRouter>
      <div className="min-h-screen bg-court-dark">
        <Header ... />

        <main className="container mx-auto px-4 py-6">
          <Suspense fallback={<LoadingSpinner message="Loading..." />}>
            <Routes>
              {/* Root redirect */}
              <Route path="/" element={<LeagueSelector />} />

              {/* League routes */}
              <Route path="/league/:leagueKey" element={<LeagueLayout />}>
                <Route index element={<Navigate to="standings" replace />} />
                <Route path="standings" element={<StandingsPage />} />
                <Route path="categories/*" element={<CategoriesRoutes />} />
                <Route path="matchup" element={<MatchupCenter />} />
                <Route path="streaming" element={<StreamingOptimizer />} />
                <Route path="trade" element={<TradeAnalyzer />} />
                <Route path="compare" element={<PlayerComparison />} />
                <Route path="waiver" element={<WaiverAdvisor />} />
                <Route path="punt" element={<PuntEngine />} />
                <Route path="insights" element={<LeagueInsights />} />
                <Route path="schedule" element={<SchedulePlanner />} />
                <Route path="outlook" element={<SeasonOutlook />} />
                <Route path="chat" element={<AIChat />} />
                <Route path="strategy" element={<StrategyCorner />} />
                <Route path="debug" element={<DebugPanel />} />
              </Route>

              {/* 404 */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </HashRouter>
  );
}
```

## Implementation Notes

- Keep the existing Header and auth logic - just reorganize the main content area
- Categories will have nested routes (handled in Task 203)
- The `/*` on categories path allows nested routes
- Use `<Navigate to="standings" replace />` for index route to default to standings
- Wrap Routes in Suspense with LoadingSpinner fallback
- Strategy route should still check admin role (handle in component)

## Important: Component Props

Current components receive `selectedLeague` as a prop. After migration, they'll get `leagueKey` from:
1. `useParams()` hook, or
2. `useOutletContext()` hook

This task just sets up the routes. Task 202 will handle updating components to use these hooks.

## Verification

```bash
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build
```

Note: Build may have TypeScript errors if components don't exist or have wrong props. That's expected - we're setting up structure. Focus on route definitions being correct.

## Success Criteria
- [x] Routes defined for all features
- [x] Lazy loading configured for components
- [x] Suspense wrapper with fallback
- [x] Nested route structure for league
- [x] Build succeeds (or only has expected prop-related errors)
