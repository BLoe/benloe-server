# Fantasy Hawk React Router Migration

You are migrating Fantasy Hawk from tab-based navigation to proper React Router with hash routing. This enables URL persistence across page refreshes and proper browser history navigation.

## Your Mission

Convert the existing tab-based Dashboard navigation to React Router, implementing:
- Hash-based routing (`/#/standings`, `/#/matchup`, etc.)
- League selection in URL (`/#/league/:leagueKey/standings`)
- Lazy loading for all route components
- Nested routes for sub-views (e.g., Categories with profile/enhanced/trends/raw)

## Each Iteration

### Step 1: Read Current State
```bash
cat /srv/benloe/apps/fantasy-hawk/ralph/RALPH-TODO.md
```

Find the first task with status `NOT_STARTED` or `IN_PROGRESS`.

### Step 2: Read Task Details
```bash
cat /srv/benloe/apps/fantasy-hawk/ralph/tasks/[TASK-ID].md
```

### Step 3: Execute the Task

Follow the task ticket exactly:
1. Read any files mentioned in "Files to Modify"
2. Implement the changes as specified
3. Follow existing code patterns
4. Preserve all existing functionality

### Step 4: Run Verification

**Build verification:**
```bash
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build
```

**E2E test verification:**
```bash
cd /srv/benloe && npx playwright test --project=fantasy-hawk
```

### Step 5: Update Status

If verification passes:
1. Update `RALPH-TODO.md` - change task status to `COMPLETE`
2. Commit the changes:
```bash
cd /srv/benloe && git add -A && git commit -m "refactor(fantasy-hawk): [TASK-ID] <description>"
```

If verification fails:
1. Read the error output
2. Fix the issue
3. Re-run verification
4. Do NOT update status until verification passes

### Step 6: Check Completion

After updating status, check if all tasks are complete:
```bash
grep -c "NOT_STARTED\|IN_PROGRESS" /srv/benloe/apps/fantasy-hawk/ralph/RALPH-TODO.md
```

If result is 0 (all tasks complete):
1. Run full verification suite (see RALPH-SUCCESS.md)
2. If all pass, output: `<promise>COMPLETE</promise>`

If tasks remain, continue to next task.

## Critical Rules

1. **Preserve functionality** - This is a refactor, not a rewrite. All features must continue working.
2. **One task at a time** - Complete current task before moving to next
3. **Verify before marking complete** - Never mark a task COMPLETE without passing verification
4. **Commit after each task** - Atomic commits enable rollback
5. **Read before writing** - Always read existing code before modifying
6. **No breaking changes** - Every commit should leave the app in a working state

## Project Context

**Tech Stack:**
- Frontend: React 19, Vite, Tailwind CSS
- New: react-router-dom v7 (HashRouter)
- Testing: Playwright (e2e)

**Key Files:**
- `frontend/src/App.tsx` - Main app component, currently handles league selection
- `frontend/src/components/Dashboard.tsx` - Tab navigation, will become route outlet
- `frontend/src/components/*.tsx` - Individual feature components to become routes
- `tests/fantasy-hawk/*.spec.ts` - E2E tests that may need URL updates

**Current Architecture:**
```
App.tsx
  └── Dashboard.tsx (activeTab state)
        ├── StandingsChart (tab === 'standings')
        ├── CategoryStatsTable (tab === 'categories')
        ├── MatchupCenter (tab === 'matchup')
        └── ... (14 total tabs)
```

**Target Architecture:**
```
App.tsx (HashRouter)
  └── Routes
        ├── / → Redirect to /standings or league selector
        ├── /league/:leagueKey → LeagueLayout (Outlet)
        │     ├── /standings → StandingsPage
        │     ├── /categories → CategoriesLayout (Outlet)
        │     │     ├── /profile → TeamProfile
        │     │     ├── /enhanced → EnhancedCategoryTable
        │     │     ├── /trends → TrendCharts
        │     │     └── / → CategoryStatsTable (default)
        │     ├── /matchup → MatchupCenter
        │     ├── /streaming → StreamingOptimizer
        │     └── ... (all other features)
        └── /* → NotFound
```

## When Stuck

If you cannot complete a task after 3 attempts:
1. Document what you tried in the task ticket
2. Mark task as `BLOCKED` with reason
3. Continue to next task
4. Blocked tasks will be reviewed manually

## Remember

- The same prompt is fed every iteration
- Your progress persists in files
- Read your previous work to understand context
- The goal is working routing, not perfect code
- Test early, test often
- This is a refactor - all existing features must keep working
