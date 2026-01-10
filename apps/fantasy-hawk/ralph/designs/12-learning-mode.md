# Learning & Education Mode - Design Specification

## Overview

Help new fantasy basketball players learn concepts, terminology, and strategy through contextual education tied to their own team.

**Primary Use Case**: "What is punting? Why is my FG% so low?"

---

## Components

### 1. Tooltip System

**Component**: `LearnableTooltip`
**Test ID**: `data-testid="tooltip-{term}"`

Replaces standard tooltips with rich, educational content.

```tsx
interface LearnableTooltip {
  term: string;
  shortDef: string;        // One-liner for quick hover
  longDef: string;         // Expanded definition
  example?: string;        // Contextual example from user's data
  learnMoreLink?: string;  // Link to glossary entry
}
```

**Trigger**: Hover/tap on terms marked with dotted underline + (?) icon

**Visual Design**:
```
┌──────────────────────────────────────┐
│ Punt Strategy                    [×] │
│                                      │
│ Deliberately abandoning one or more  │
│ categories to strengthen others.     │
│                                      │
│ YOUR EXAMPLE:                        │
│ You're 11th in FT% - this is a      │
│ natural punt candidate for you.      │
│                                      │
│ [Learn More in Glossary →]           │
└──────────────────────────────────────┘
```

**Data TestIDs**:
- `tooltip-{term}`
- `tooltip-content-{term}`
- `tooltip-example-{term}`
- `tooltip-learn-more-{term}`

---

### 2. Glossary Modal

**Component**: `GlossaryModal`
**Test ID**: `data-testid="glossary-modal"`

Searchable dictionary of fantasy basketball terms.

```
┌─────────────────────────────────────────────────────────────────┐
│ Fantasy Basketball Glossary                                [×]  │
├─────────────────────────────────────────────────────────────────┤
│ Search: [_______________________]                               │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ CATEGORIES: A B C D E F G H I J K L M N O P Q R S T U V W  ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ Assists (AST)                                               ││
│ │ A pass that directly leads to a teammate scoring. In        ││
│ │ fantasy, guards typically lead in assists.                  ││
│ │                                                             ││
│ │ Your AST: 498 (10th in league)                              ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ FAAB (Free Agent Acquisition Budget)                        ││
│ │ A fixed dollar amount ($100 typical) used to bid on waiver  ││
│ │ wire players. Higher bids win the player.                   ││
│ │                                                             ││
│ │ Your FAAB: $67 remaining                                    ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│ ...                                                             │
└─────────────────────────────────────────────────────────────────┘
```

**Categories**:
- Basic Terms (FG%, AST, REB, etc.)
- Scoring Types (H2H, Roto, Points)
- Strategy (Punting, Streaming, FAAB)
- Advanced (Usage Rate, Per-36, etc.)

**Data TestIDs**:
- `glossary-modal`
- `glossary-search`
- `glossary-category-{letter}`
- `glossary-entry-{term}`

---

### 3. Decision Walkthrough Panel

**Component**: `DecisionWalkthrough`
**Test ID**: `data-testid="decision-walkthrough"`

Appears alongside recommendations to explain reasoning.

```
┌─────────────────────────────────────────────────────────────────┐
│ 💡 WHY THIS RECOMMENDATION?                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ We suggest adding Jordan Poole because:                         │
│                                                                 │
│ 1. Games Remaining                                              │
│    He has 4 games left this week vs your current player's 2.   │
│    More games = more counting stats.                           │
│                                                                 │
│ 2. Category Fit                                                 │
│    Poole is strong in 3PM (2.1/game). You're currently 6th     │
│    in 3PM - adding him could move you to 4th or 5th.           │
│                                                                 │
│ 3. Schedule Alignment                                           │
│    He plays Tuesday and Thursday - days where you currently    │
│    have roster gaps.                                            │
│                                                                 │
│ [Dismiss] [Got it, make this move]                              │
└─────────────────────────────────────────────────────────────────┘
```

**Data TestIDs**:
- `decision-walkthrough`
- `decision-walkthrough-reason-{index}`
- `decision-walkthrough-dismiss`
- `decision-walkthrough-accept`

---

### 4. Contextual Help Button

**Component**: `ContextualHelpButton`
**Test ID**: `data-testid="help-{context}"`

Small (?) button near complex features that opens explainer.

```tsx
<HelpButton context="streaming">
  <p>Streaming is the strategy of...</p>
</HelpButton>
```

**Visual**: Small circular button with "?" icon, opens popover or modal.

---

### 5. Learning Mode Toggle

**Component**: `LearningModeToggle`
**Test ID**: `data-testid="learning-mode-toggle"`

Global toggle in header that enables/disables educational features.

**When ON**:
- All learnable terms get dotted underlines
- Decision walkthroughs appear automatically
- Extra context shown in tooltips

**When OFF**:
- Standard tooltips only
- Experienced user flow

---

## Glossary Terms Database

```typescript
const glossaryTerms: GlossaryTerm[] = [
  {
    term: 'Punt Strategy',
    shortDef: 'Deliberately abandoning categories to strengthen others',
    longDef: 'A punt strategy involves intentionally ignoring one or more statistical categories to dominate the remaining categories. Common punts include FT%, AST, and 3PM.',
    category: 'strategy',
    relatedTerms: ['Build', 'Category League'],
  },
  {
    term: 'Streaming',
    shortDef: 'Adding/dropping players to maximize games played',
    longDef: 'Streaming involves using your weekly transaction limit to pick up players with favorable schedules, then dropping them when their games are done.',
    category: 'strategy',
    relatedTerms: ['Add/Drop', 'Schedule'],
  },
  {
    term: 'FAAB',
    shortDef: 'Free Agent Acquisition Budget',
    longDef: 'A fixed dollar amount (typically $100) used to bid on waiver wire players. The highest bid wins the player.',
    category: 'transactions',
    relatedTerms: ['Waiver Wire', 'Waiver Priority'],
  },
  // ... more terms
];
```

---

## Integration Points

These education components integrate throughout the app:

1. **Streaming Optimizer**: Tooltips on "streaming", "games remaining", walkthrough on recommendations
2. **Matchup Center**: Tooltips on "swing categories", "H2H"
3. **Trade Analyzer**: Walkthrough explaining category impact
4. **Punt Engine**: Extensive tooltips on build archetypes
5. **Category Analysis**: Tooltips on each category abbreviation

---

## Responsive Behavior

**Mobile**:
- Tooltips become tap-to-open modals
- Glossary becomes full-screen
- Decision walkthroughs slide up from bottom

---

## Data TestIDs Summary

- `tooltip-{term}`, `tooltip-content-{term}`
- `glossary-modal`, `glossary-search`, `glossary-entry-{term}`
- `decision-walkthrough`, `decision-walkthrough-reason-{index}`
- `help-{context}`
- `learning-mode-toggle`
