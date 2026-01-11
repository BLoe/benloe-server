# Task 901: Learning Mode - Tooltip System

## Objective
Create contextual tooltip system explaining fantasy concepts.

## Design Reference
See: `/ralph/designs/11-LEARNING-MODE.md` - Tooltips section

## Context
- Helps newcomers understand fantasy basketball
- Non-intrusive - appears on hover/tap
- Explains terminology throughout the app
- Can be toggled on/off

## Acceptance Criteria
- [ ] Create `frontend/src/components/learning/Tooltip.tsx` component
- [ ] Create tooltip content definitions:
  - Category explanations (FG%, FT%, 3PM, etc.)
  - Strategy terms (punt, streaming, etc.)
  - UI element explanations
- [ ] Implement hover trigger (desktop) and tap trigger (mobile)
- [ ] Style tooltips per design system (dark, readable)
- [ ] Add tooltips to key elements across existing pages:
  - Category headers in tables
  - Strategy terms in recommendations
  - Stat abbreviations
- [ ] Create "Learning Mode" toggle in user settings
- [ ] When disabled, tooltips don't appear

## Verification
1. Frontend builds without errors
2. Visual check: Tooltips appear on hover
3. Content is helpful and accurate
4. Toggle enables/disables tooltips

## Dependencies
- None (can be added to existing pages)

## Notes
- Keep tooltip content concise
- Link to glossary for more detail
- Consider animation for polish
- Don't add tooltips to obvious elements
- Add `data-testid="tooltip"` for testing
