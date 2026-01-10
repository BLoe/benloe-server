# Task 503: Punt Engine - Build Archetypes

## Objective
Create predefined build archetypes with player recommendations.

## Design Reference
See: `/ralph/designs/06-PUNT-STRATEGY-ENGINE.md` - Archetypes section

## Context
- Archetypes are template builds users can target
- Each archetype has ideal player types
- Helps users know who to target in trades/waivers
- Educational component for newer players

## Acceptance Criteria
- [ ] Create `frontend/src/components/punt/Archetypes.tsx`
- [ ] Define 4-6 common archetypes:
  - "Big Man Build" (punt FT%, AST)
  - "Guard Build" (punt REB, BLK)
  - "Punt FT%" (Shaq-style bigs)
  - "Punt AST" (scoring wings)
  - "Balanced" (no punt)
- [ ] Display archetype cards with:
  - Archetype name and description
  - Categories targeted vs punted
  - Example player types that fit
  - "How close is my team?" indicator
- [ ] Click archetype to see detailed breakdown
- [ ] Show which of user's players fit each archetype
- [ ] Integrate into Punt Engine page

## Verification
1. Frontend builds without errors
2. Visual check: Archetypes display correctly
3. Player fit indicators make sense
4. Detailed view works on click

## Dependencies
- Task 501 (punt API)
- Task 502 (page integration)

## Notes
- Archetypes are educational - explain the "why"
- Consider linking to articles about punt strategies
- Static archetype definitions are fine (don't need API)
- Add `data-testid="archetypes-panel"`
