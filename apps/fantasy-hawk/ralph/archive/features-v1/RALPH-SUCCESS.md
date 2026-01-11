# Ralph Loop Success Criteria

## Completion Promise

Output `<promise>COMPLETE</promise>` when ALL conditions below are satisfied.

## Success Conditions

### 1. Task Completion
- ALL tasks in `RALPH-TODO.md` have status `COMPLETE`
- No tasks remain with status `NOT_STARTED` or `IN_PROGRESS`

### 2. Build Verification
- `cd /srv/benloe/apps/fantasy-hawk/backend && npm run build` succeeds with exit code 0
- `cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build` succeeds with exit code 0

### 3. Test Verification
- `cd /srv/benloe/apps/fantasy-hawk/backend && npm test` passes all tests
- `cd /srv/benloe && npx playwright test --project=fantasy-hawk` passes all tests

### 4. Runtime Verification
- The Fantasy Hawk app is accessible at https://fantasyhawk.benloe.com
- No critical JavaScript errors in browser console
- All new features render without visual errors

## Verification Commands

Run these in sequence to verify completion:

```bash
# 1. Backend build
cd /srv/benloe/apps/fantasy-hawk/backend && npm run build

# 2. Frontend build
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build

# 3. Backend tests
cd /srv/benloe/apps/fantasy-hawk/backend && npm test

# 4. E2E tests
cd /srv/benloe && npx playwright test --project=fantasy-hawk

# 5. Deploy and verify
pm2 restart fantasy-hawk-api
curl -s -o /dev/null -w "%{http_code}" https://fantasyhawk.benloe.com/
```

## Failure Handling

If verification fails:
1. Read the error output carefully
2. Identify the root cause
3. Fix the issue
4. Re-run verification
5. Do NOT mark task as COMPLETE until verification passes

## Blocked Task Handling

If a task is blocked and cannot be completed:
1. Document the blocker in the task ticket
2. Create a new task to resolve the blocker if possible
3. If truly unresolvable, mark task as `BLOCKED` with explanation
4. Continue to next task
5. Only output completion promise if blocked tasks are non-critical

## Git Discipline

After each completed task:
```bash
cd /srv/benloe && git add -A && git commit -m "feat(fantasy-hawk): [TASK-XXX] <brief description>"
```

This provides:
- Rollback capability if later tasks break things
- Progress visibility through git log
- Atomic changes that can be cherry-picked if needed
