# Fantasy Hawk React Router Migration - Success Criteria

## Final Verification Checklist

Before outputting `<promise>COMPLETE</promise>`, verify ALL of the following:

### 1. Build Verification
```bash
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build
cd /srv/benloe/apps/fantasy-hawk/backend && npm run build
```
Both must succeed with no errors.

### 2. E2E Test Suite
```bash
cd /srv/benloe && npx playwright test --project=fantasy-hawk
```
All tests must pass.

### 3. URL Routing Verification

Manually verify these URLs work (or verify via tests):

| URL | Expected Behavior |
|-----|-------------------|
| `/#/` | Shows league selector or connect prompt |
| `/#/league/:leagueKey` | Redirects to standings |
| `/#/league/:leagueKey/standings` | Shows standings chart |
| `/#/league/:leagueKey/categories` | Redirects to categories/profile |
| `/#/league/:leagueKey/categories/profile` | Shows team profile |
| `/#/league/:leagueKey/categories/table` | Shows enhanced table |
| `/#/league/:leagueKey/categories/trends` | Shows trend charts |
| `/#/league/:leagueKey/categories/raw` | Shows raw stats with timespan |
| `/#/league/:leagueKey/matchup` | Shows matchup center |
| `/#/league/:leagueKey/streaming` | Shows streaming optimizer |
| `/#/league/:leagueKey/trade` | Shows trade analyzer |
| `/#/league/:leagueKey/compare` | Shows player comparison |
| `/#/league/:leagueKey/waiver` | Shows waiver advisor |
| `/#/league/:leagueKey/punt` | Shows punt engine |
| `/#/league/:leagueKey/insights` | Shows league insights |
| `/#/league/:leagueKey/schedule` | Shows schedule planner |
| `/#/league/:leagueKey/outlook` | Shows season outlook |
| `/#/league/:leagueKey/chat` | Shows AI chat |
| `/#/league/:leagueKey/debug` | Shows debug panel |

### 4. Browser Navigation Verification

- [ ] Page refresh maintains current view
- [ ] Browser back button works correctly
- [ ] Browser forward button works correctly
- [ ] Direct URL navigation works (paste URL, hit enter)
- [ ] Tab navigation updates URL

### 5. Lazy Loading Verification

Check browser DevTools Network tab:
- [ ] Initial page load doesn't load all components
- [ ] Navigating to a new tab loads that component's chunk
- [ ] Components show loading state while chunk loads

### 6. Feature Parity

All existing features must still work:
- [ ] League selection and switching
- [ ] All 14 tabs render correctly
- [ ] Category sub-views work
- [ ] Data loading in each view
- [ ] Admin-only Strategy tab (only visible to admins)
- [ ] Debug tab functionality

### 7. No Console Errors

```bash
# Run app and check browser console
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run dev
```
No React errors, no routing errors, no 404s for chunks.

## Quick Verification Script

```bash
#!/bin/bash
echo "=== Fantasy Hawk Router Migration Verification ==="

echo -e "\n1. Frontend Build..."
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build
if [ $? -ne 0 ]; then echo "❌ Frontend build failed"; exit 1; fi
echo "✅ Frontend build passed"

echo -e "\n2. Backend Build..."
cd /srv/benloe/apps/fantasy-hawk/backend && npm run build
if [ $? -ne 0 ]; then echo "❌ Backend build failed"; exit 1; fi
echo "✅ Backend build passed"

echo -e "\n3. E2E Tests..."
cd /srv/benloe && npx playwright test --project=fantasy-hawk
if [ $? -ne 0 ]; then echo "❌ E2E tests failed"; exit 1; fi
echo "✅ E2E tests passed"

echo -e "\n=== All Verifications Passed ==="
```

## When Complete

Once ALL checks pass:
1. Update RALPH-TODO.md - all tasks should be COMPLETE
2. Commit final state
3. Output: `<promise>COMPLETE</promise>`
