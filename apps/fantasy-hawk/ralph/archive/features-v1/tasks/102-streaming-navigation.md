# Task 102: Streaming Optimizer - Navigation & Page Shell

## Objective
Add the Streaming Optimizer as a new navigation tab and create the page shell/layout structure.

## Design Reference
See: `/ralph/designs/03-STREAMING-OPTIMIZER.md` - Layout and navigation sections
See: `/ralph/designs/00-DESIGN-SYSTEM.md` - Navigation patterns and tab styling

## Context
- This establishes the navigation pattern for all new features
- Current app has tabs in Dashboard.tsx - extend this pattern
- The streaming page will contain: schedule grid, candidates table, recommendations panel
- Page should work even before child components are built (show placeholders)

## Acceptance Criteria
- [ ] Add "Streaming" tab to the main navigation (after existing tabs)
- [ ] Create `frontend/src/components/StreamingOptimizer.tsx` page component
- [ ] Implement three-panel layout per design spec:
  - Left: Schedule grid area (placeholder for now)
  - Center: Candidates table area (placeholder for now)
  - Right: Recommendations panel area (placeholder for now)
- [ ] Add route handling for the new tab
- [ ] Page header with title "Streaming Optimizer" and brief description
- [ ] Loading state while data fetches
- [ ] Empty state when no league selected
- [ ] Follow design system: use `.card` classes, proper spacing, dark theme colors

## Verification
1. Frontend builds: `cd /srv/benloe/apps/fantasy-hawk/frontend && npm run build`
2. Visual check: Navigate to app, see new "Streaming" tab
3. Click tab, see page shell with placeholder panels
4. Verify dark theme styling matches design system

## Dependencies
- Task 101 (API endpoints should exist, but page can render without data)

## Notes
- Use the existing tab pattern from Dashboard - don't reinvent
- Placeholders should say what will go there (e.g., "Schedule Grid - Coming Soon")
- Consider responsive layout - panels may stack on mobile
- Add `data-testid` attributes for E2E testing: `streaming-tab`, `streaming-page`
