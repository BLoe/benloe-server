# Task 101: Install react-router-dom and configure HashRouter

## Objective
Set up the React Router infrastructure with HashRouter for URL-based navigation.

## Why HashRouter?
- Works without server-side configuration (no catch-all route needed)
- URLs like `/#/league/123/standings` work with any static file server
- Caddy doesn't need any changes

## Files to Modify
- `frontend/package.json` - Add dependency
- `frontend/src/App.tsx` - Wrap app in HashRouter

## Implementation Steps

### Step 1: Install react-router-dom
```bash
cd /srv/benloe/apps/fantasy-hawk/frontend && npm install react-router-dom
```

### Step 2: Read current App.tsx
```bash
cat /srv/benloe/apps/fantasy-hawk/frontend/src/App.tsx
```

### Step 3: Update App.tsx

Wrap the entire app content in `HashRouter`:

```tsx
import { HashRouter } from 'react-router-dom';

function App() {
  return (
    <HashRouter>
      {/* existing app content */}
    </HashRouter>
  );
}
```

**Important:**
- Keep ALL existing functionality working
- The HashRouter just wraps everything - don't change component structure yet
- League selection and Dashboard should still work exactly as before

## Verification

```bash
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build
```

Build should succeed with no errors. The app should function identically to before.

## Success Criteria
- [x] react-router-dom is installed
- [x] App.tsx imports and uses HashRouter
- [x] Build succeeds
- [x] App functions normally (no visible changes yet)
