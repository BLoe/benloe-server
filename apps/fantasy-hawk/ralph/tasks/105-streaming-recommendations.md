# Task 105: Streaming Optimizer - Recommendations Panel

## Objective
Build the recommendations panel that suggests specific streaming moves based on user's roster and matchup.

## Design Reference
See: `/ralph/designs/03-STREAMING-OPTIMIZER.md` - Recommendations section

## Context
- Analyzes user's current roster gaps
- Suggests drops and adds to maximize games played
- Considers current matchup category needs
- This is the "smart" part of the feature

## Acceptance Criteria
- [ ] Create backend endpoint `GET /api/fantasy/leagues/:leagueKey/streaming/recommendations`
  - Analyzes user's roster for droppable players (low games remaining)
  - Identifies category needs based on current matchup
  - Suggests top 3-5 streaming targets with reasoning
  - Returns structured recommendations with confidence scores
- [ ] Create `frontend/src/components/streaming/RecommendationsPanel.tsx`
- [ ] Display recommendations as cards:
  - "Drop X, Add Y" format
  - Show games gained
  - Show category impact preview
  - Confidence indicator (high/medium/low)
- [ ] Explain reasoning (e.g., "Y has 4 games vs X's 2, strong in AST where you're losing")
- [ ] Quick action: link to Yahoo to make the move (external link)
- [ ] "Refresh" button to recalculate
- [ ] Handle case where no good streaming options exist
- [ ] Integrate into StreamingOptimizer page (replace placeholder)

## Verification
1. Backend endpoint returns structured recommendations
2. Write unit test for recommendation logic
3. Frontend displays recommendations clearly
4. Reasoning text makes sense
5. External Yahoo links work

## Dependencies
- Task 101 (schedule data)
- Task 104 (candidates data structure)
- Requires user to be authenticated and have a roster

## Notes
- Recommendation logic doesn't need to be perfect - it's advisory
- Consider players on waivers vs true free agents
- Don't recommend dropping players user likely values (stars)
- Add `data-testid="recommendations-panel"` for testing
