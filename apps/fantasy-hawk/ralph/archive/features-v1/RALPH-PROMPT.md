# Fantasy Hawk Ralph Loop Prompt

You are implementing features for Fantasy Hawk, a fantasy basketball analytics application. This prompt will be fed to you repeatedly until all tasks are complete.

## Your Mission

Build all 12 features defined in the Fantasy Hawk roadmap by completing tasks sequentially from the TODO list.

## Each Iteration

### Step 1: Read Current State
```bash
cat /srv/benloe/apps/fantasy-hawk/ralph/RALPH-TODO.md
```

Find the first task with status `NOT_STARTED` or `IN_PROGRESS`.

### Step 2: Read Task Details
Read the task ticket file indicated in the TODO:
```bash
cat /srv/benloe/apps/fantasy-hawk/ralph/tasks/[TASK-ID].md
```

### Step 3: Execute the Task

Follow the task ticket exactly:
1. Read any files mentioned in "Files to Modify"
2. Implement the changes as specified
3. Follow the patterns in "Implementation Notes"
4. Add data-testid attributes as specified for testing

### Step 4: Run Verification

Execute the verification steps from the task ticket. Common patterns:

**For API tasks:**
```bash
cd /srv/benloe/apps/fantasy-hawk/backend && npm run build && npm test
```

**For UI tasks:**
```bash
cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build
cd /srv/benloe && npx playwright test --project=fantasy-hawk --grep "[test pattern]"
```

### Step 5: Update Status

If verification passes:
1. Update `RALPH-TODO.md` - change task status to `COMPLETE`
2. Commit the changes:
```bash
cd /srv/benloe && git add -A && git commit -m "feat(fantasy-hawk): [TASK-ID] <description>"
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

1. **One task at a time** - Complete current task before moving to next
2. **Verify before marking complete** - Never mark a task COMPLETE without passing verification
3. **Follow the design specs** - UI implementations must match designs in `/ralph/designs/`
4. **Use data-testid** - All interactive elements need testable selectors
5. **Don't skip tests** - Every task has verification steps; run them
6. **Commit after each task** - Atomic commits enable rollback
7. **Read before writing** - Always read existing code before modifying

## Project Context

**Tech Stack:**
- Backend: Node.js, Express, TypeScript
- Frontend: React 19, Vite, Tailwind CSS, Recharts
- Testing: Vitest (backend), Playwright (e2e)
- Database: SQLite for OAuth tokens
- External APIs: Yahoo Fantasy Sports, Ball Don't Lie (NBA data)

**Key Directories:**
- Backend: `/srv/benloe/apps/fantasy-hawk/backend/src/`
- Frontend: `/srv/benloe/apps/fantasy-hawk/frontend/src/`
- Tests: `/srv/benloe/tests/fantasy-hawk/`
- Designs: `/srv/benloe/apps/fantasy-hawk/ralph/designs/`

**Existing Patterns:**
- API routes in `backend/src/routes/`
- React components in `frontend/src/components/`
- API service in `frontend/src/services/api.ts`
- Yahoo data parsing helpers exist - reuse them

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
- The goal is working features, not perfect code
- Test early, test often
