# Task 301: Update navigation components to use Links

## Objective
Ensure all navigation in the app uses React Router's Link/NavLink components instead of onClick handlers that set state.

## Files to Review/Modify
- `frontend/src/components/LeagueLayout.tsx` - Main tab navigation (should already use NavLink)
- `frontend/src/components/Header.tsx` - Any navigation links
- `frontend/src/App.tsx` - League selector navigation
- Any component that navigates between tabs

## Files to Read First
- `frontend/src/components/Header.tsx`
- `frontend/src/App.tsx`

## Implementation Steps

### Step 1: Review Header.tsx

Check if Header has any navigation that needs updating. It may have:
- Logo link to home
- League name display
- Any breadcrumb-style navigation

Update any navigation to use `<Link to="...">` instead of `window.location` or state changes.

### Step 2: Update league selection navigation

When a user selects a league from the dropdown, navigate to that league's route:

```tsx
import { useNavigate } from 'react-router-dom';

function LeagueSelector() {
  const navigate = useNavigate();

  function handleLeagueChange(leagueKey: string) {
    navigate(`/league/${leagueKey}/standings`);
  }

  // ...
}
```

### Step 3: Handle "no league selected" state

The root route (/) should show the league selector or prompt to connect to Yahoo.

If user is at `/league/:leagueKey` but that league doesn't exist or user doesn't have access, redirect to `/`.

### Step 4: Ensure LeagueLayout navigation is correct

Verify LeagueLayout uses relative paths for tab navigation:

```tsx
// Good - relative path
<NavLink to="standings">Standings</NavLink>

// Also works - absolute path (but more verbose)
<NavLink to={`/league/${leagueKey}/standings`}>Standings</NavLink>
```

Relative paths are preferred as they work within the nested route context.

### Step 5: Add navigation to error states

When components show error states, consider adding a "Go back" or "Return home" link:

```tsx
<Link to="/" className="btn">Return to Home</Link>
```

## Implementation Notes

- Use `useNavigate()` for programmatic navigation (e.g., after form submit)
- Use `<Link>` or `<NavLink>` for clickable navigation elements
- `NavLink` is preferred for navigation menus (auto-active state)
- `Link` is fine for one-off links
- Relative paths work within nested routes

## Verification

```bash
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build
```

Manual verification:
1. Select a league - URL should change to `/league/:leagueKey/standings`
2. Click tabs - URL should update
3. Browser back/forward should work
4. Refresh on any page should stay on that page

## Success Criteria
- [x] All navigation uses React Router components
- [x] League selection navigates to league route
- [x] Tab navigation uses relative NavLinks
- [x] Browser history works correctly
- [x] Build succeeds
