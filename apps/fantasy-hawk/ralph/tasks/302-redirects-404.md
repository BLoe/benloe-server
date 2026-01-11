# Task 302: Handle redirects and 404 routes

## Objective
Implement proper redirect logic and 404 handling for invalid routes.

## Files to Modify
- `frontend/src/App.tsx` - Route definitions and redirects
- `frontend/src/components/NotFound.tsx` - Create 404 component (optional)

## Implementation Steps

### Step 1: Define redirect behavior

**Root route (/):**
- If user has leagues, could redirect to first league
- Otherwise, show league selector / connect prompt

**Invalid league route (/league/invalid-key):**
- LeagueLayout should handle this - if league data fails to load, show error or redirect

**Unknown routes (/anything-else):**
- Redirect to / or show 404 page

### Step 2: Update route configuration

```tsx
<Routes>
  {/* Root - shows league selector or connect prompt */}
  <Route path="/" element={<HomePage />} />

  {/* League routes */}
  <Route path="/league/:leagueKey" element={<LeagueLayout />}>
    <Route index element={<Navigate to="standings" replace />} />
    <Route path="standings" element={<StandingsPage />} />
    {/* ... other routes */}
  </Route>

  {/* Catch-all - redirect to home */}
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>
```

### Step 3: Handle league index route

When user navigates to `/league/:leagueKey` without a sub-route, redirect to standings:

```tsx
<Route path="/league/:leagueKey" element={<LeagueLayout />}>
  <Route index element={<Navigate to="standings" replace />} />
  {/* ... */}
</Route>
```

### Step 4: Handle invalid league in LeagueLayout

In LeagueLayout, if league data fails to load (404 from API), provide appropriate UX:

```tsx
if (error) {
  return (
    <div className="card text-center py-12">
      <ErrorMessage message={error} />
      <Link to="/" className="btn mt-4">Select Another League</Link>
    </div>
  );
}
```

### Step 5: Create HomePage component (if needed)

If the root route needs its own component instead of inline logic:

```tsx
// HomePage.tsx
export function HomePage() {
  // This is basically what was in App.tsx before
  // Show league selector if authenticated
  // Show connect button if not
}
```

### Step 6: Handle category sub-route redirects

In CategoriesLayout, default to profile view:

```tsx
<Route path="categories" element={<CategoriesLayout />}>
  <Route index element={<Navigate to="profile" replace />} />
  {/* ... */}
</Route>
```

### Step 7: Optional - Create NotFound component

For a better UX on unknown routes:

```tsx
// NotFound.tsx
import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="card text-center py-12">
      <h2 className="text-xl font-semibold text-gray-100 mb-4">Page Not Found</h2>
      <p className="text-gray-400 mb-6">The page you're looking for doesn't exist.</p>
      <Link to="/" className="btn-primary">Return Home</Link>
    </div>
  );
}
```

Then use it:
```tsx
<Route path="*" element={<NotFound />} />
```

## Implementation Notes

- Use `<Navigate replace />` for redirects to avoid polluting browser history
- Keep auth logic in App.tsx where it currently lives
- Don't over-complicate - simple redirects to / are often enough
- Error boundaries could also be useful for unexpected errors

## Verification

```bash
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build
```

Manual testing:
1. Navigate to `/` - should see league selector
2. Navigate to `/league/abc123` - should load league or show error
3. Navigate to `/league/abc123/matchup` - should show matchup
4. Navigate to `/nonsense` - should redirect to /
5. Navigate to `/league/abc123/nonsense` - should redirect to standings or 404

## Success Criteria
- [x] Root route shows appropriate content based on auth state
- [x] League index redirects to standings
- [x] Categories index redirects to profile
- [x] Unknown routes redirect to home (or show 404)
- [x] Invalid league shows error with navigation option
- [x] Build succeeds
