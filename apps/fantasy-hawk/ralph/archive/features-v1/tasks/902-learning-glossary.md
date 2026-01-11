# Task 902: Learning Mode - Glossary Panel

## Objective
Create a searchable glossary of fantasy basketball terms.

## Design Reference
See: `/ralph/designs/11-LEARNING-MODE.md` - Glossary section

## Context
- Comprehensive reference for fantasy terms
- Searchable and browsable
- Links from tooltips
- Educational resource for all skill levels

## Acceptance Criteria
- [ ] Create `frontend/src/components/learning/Glossary.tsx`
- [ ] Define glossary entries:
  - Stat categories (FG%, FT%, REB, AST, etc.)
  - Strategy terms (punt, streaming, stash, etc.)
  - Yahoo-specific terms (IL, IR, NA, etc.)
  - Fantasy concepts (FAAB, waiver priority, etc.)
- [ ] Search functionality:
  - Filter terms as user types
  - Highlight matching text
- [ ] Browse by category:
  - Stats, Strategies, Platform, General
- [ ] Each entry includes:
  - Term name
  - Definition
  - Example (when helpful)
- [ ] Accessible from help menu or dedicated tab
- [ ] Deep linking to specific terms

## Verification
1. Frontend builds without errors
2. Visual check: Glossary displays and is searchable
3. All major terms are defined
4. Links from tooltips work

## Dependencies
- Task 901 (tooltip integration)

## Notes
- Write for beginners - assume no prior knowledge
- Keep definitions concise but complete
- Consider adding related terms suggestions
- Add `data-testid="glossary"`, `data-testid="glossary-search"`
