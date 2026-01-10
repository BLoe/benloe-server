# Fantasy Hawk Design System

## Aesthetic Direction: "Court Vision"

A premium sports analytics interface that feels like an NBA broadcast control room meets a Bloomberg terminal. Dark, data-dense, with basketball-inspired energy through diagonal accents and vibrant stat callouts.

**Core Principles:**
1. **Information Density** - Pack data efficiently without clutter
2. **Live Feel** - Subtle animations suggest real-time updates
3. **Hierarchy Through Color** - Use color strategically to draw attention
4. **Athletic Energy** - Diagonal slashes, bold numbers, dynamic typography

---

## Color System

### Base Palette (CSS Variables)

```css
:root {
  /* Background Layers */
  --bg-deep: #0a0e17;        /* Deepest background */
  --bg-base: #0f1419;        /* Main background */
  --bg-elevated: #1a1f2e;    /* Cards, panels */
  --bg-surface: #252d3d;     /* Hover states, inputs */

  /* Text Hierarchy */
  --text-primary: #f0f2f5;   /* Primary text */
  --text-secondary: #8b95a5; /* Secondary text */
  --text-muted: #5a6577;     /* Disabled, hints */

  /* Accent Colors */
  --accent-primary: #ff6b35;  /* Orange - Primary actions, your team */
  --accent-secondary: #00d4aa;/* Teal - Success, positive stats */
  --accent-tertiary: #6366f1; /* Indigo - AI, insights */
  --accent-warning: #fbbf24;  /* Amber - Alerts, warnings */
  --accent-danger: #ef4444;   /* Red - Negative, losses */

  /* Stat Colors */
  --stat-excellent: #22c55e;  /* Top tier stats */
  --stat-good: #84cc16;       /* Above average */
  --stat-average: #eab308;    /* Average */
  --stat-below: #f97316;      /* Below average */
  --stat-poor: #ef4444;       /* Bottom tier */

  /* Special */
  --glass-bg: rgba(26, 31, 46, 0.8);
  --glass-border: rgba(255, 255, 255, 0.1);
  --glow-primary: rgba(255, 107, 53, 0.3);
  --glow-secondary: rgba(0, 212, 170, 0.3);
}
```

### Tailwind Extension

```javascript
// tailwind.config.js extend
colors: {
  court: {
    deep: '#0a0e17',
    base: '#0f1419',
    elevated: '#1a1f2e',
    surface: '#252d3d',
  },
  hawk: {
    orange: '#ff6b35',
    teal: '#00d4aa',
    indigo: '#6366f1',
    amber: '#fbbf24',
  }
}
```

---

## Typography

### Font Stack

```css
/* Display - Bold headlines, big numbers */
--font-display: 'Oswald', 'Impact', sans-serif;

/* UI - Interface elements, buttons */
--font-ui: 'Inter', -apple-system, sans-serif;

/* Mono - Stats, numbers, code */
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### Type Scale

| Use Case | Font | Size | Weight | Letter Spacing |
|----------|------|------|--------|----------------|
| Hero Stat | Oswald | 72px | 700 | -0.02em |
| Page Title | Oswald | 32px | 600 | 0 |
| Section Title | Inter | 20px | 600 | 0 |
| Card Title | Inter | 16px | 600 | 0 |
| Body | Inter | 14px | 400 | 0 |
| Label | Inter | 12px | 500 | 0.05em |
| Stat Number | JetBrains Mono | 14px | 500 | 0 |
| Big Stat | JetBrains Mono | 24px | 600 | -0.01em |

---

## Component Library

### Card Variants

```tsx
// Base Card
<div className="bg-court-elevated rounded-lg border border-white/5 p-4">

// Elevated Card (hover-able)
<div className="bg-court-elevated rounded-lg border border-white/5 p-4
                hover:border-hawk-orange/30 hover:shadow-lg hover:shadow-hawk-orange/5
                transition-all duration-200">

// Glass Card (overlays)
<div className="bg-court-elevated/80 backdrop-blur-xl rounded-lg
                border border-white/10 p-4">

// Stat Card (highlight)
<div className="bg-gradient-to-br from-court-elevated to-court-surface
                rounded-lg border-l-4 border-l-hawk-orange p-4">

// Alert Card
<div className="bg-hawk-amber/10 border border-hawk-amber/30 rounded-lg p-4">
```

### Button Variants

```tsx
// Primary
<button data-testid="btn-primary"
  className="bg-hawk-orange text-white font-semibold px-4 py-2 rounded-lg
             hover:bg-hawk-orange/90 active:scale-[0.98] transition-all">

// Secondary
<button data-testid="btn-secondary"
  className="bg-court-surface text-text-primary border border-white/10
             font-medium px-4 py-2 rounded-lg hover:bg-court-surface/80">

// Ghost
<button data-testid="btn-ghost"
  className="text-text-secondary hover:text-text-primary
             hover:bg-white/5 px-3 py-2 rounded-lg transition-colors">

// Icon Button
<button data-testid="btn-icon"
  className="w-10 h-10 flex items-center justify-center rounded-lg
             bg-court-surface hover:bg-court-surface/80 text-text-secondary
             hover:text-text-primary transition-all">
```

### Tabs

```tsx
<div className="flex gap-1 bg-court-deep rounded-lg p-1">
  <button
    data-testid="tab-streaming"
    className="px-4 py-2 rounded-md font-medium text-sm transition-all
               data-[active=true]:bg-hawk-orange data-[active=true]:text-white
               data-[active=false]:text-text-secondary data-[active=false]:hover:text-text-primary"
  >
    Streaming
  </button>
</div>
```

### Stat Display

```tsx
// Inline Stat
<span className="font-mono text-hawk-teal">+12.5%</span>

// Stat Pill
<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                 bg-stat-excellent/20 text-stat-excellent text-xs font-mono">
  <ArrowUp size={12} /> 1st
</span>

// Big Stat Block
<div data-testid="stat-block" className="text-center">
  <div className="font-display text-5xl text-text-primary">87.4</div>
  <div className="text-xs text-text-muted uppercase tracking-wider mt-1">FG%</div>
</div>
```

### Table Styling

```tsx
<table className="w-full">
  <thead>
    <tr className="border-b border-white/10">
      <th className="text-left text-xs font-medium text-text-muted uppercase
                     tracking-wider py-3 px-4">Player</th>
    </tr>
  </thead>
  <tbody className="divide-y divide-white/5">
    <tr className="hover:bg-white/5 transition-colors">
      <td className="py-3 px-4 font-medium">LeBron James</td>
      <td className="py-3 px-4 font-mono text-hawk-teal">24.5</td>
    </tr>
  </tbody>
</table>
```

---

## Layout Patterns

### Page Structure

```tsx
<div className="min-h-screen bg-court-deep">
  {/* Header - 64px fixed */}
  <Header />

  {/* Main Content */}
  <main className="max-w-[1600px] mx-auto px-6 py-6">
    {/* Page Title Row */}
    <div className="flex items-center justify-between mb-6">
      <h1 className="font-display text-2xl text-text-primary">Streaming Optimizer</h1>
      <div className="flex gap-2">{/* Actions */}</div>
    </div>

    {/* Content Grid */}
    <div className="grid grid-cols-12 gap-6">
      {/* Main Panel - typically 8 cols */}
      <div className="col-span-8">{/* Primary content */}</div>

      {/* Side Panel - typically 4 cols */}
      <div className="col-span-4">{/* Secondary content */}</div>
    </div>
  </main>
</div>
```

### Responsive Breakpoints

```
sm: 640px   - Mobile landscape
md: 768px   - Tablet portrait
lg: 1024px  - Tablet landscape / Small desktop
xl: 1280px  - Desktop
2xl: 1536px - Large desktop
```

---

## Motion & Animation

### Transitions

```css
/* Default transition */
.transition-default {
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Snappy (buttons, tabs) */
.transition-snappy {
  transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Smooth (modals, panels) */
.transition-smooth {
  transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Keyframe Animations

```css
/* Pulse for live indicators */
@keyframes pulse-live {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.animate-live { animation: pulse-live 2s infinite; }

/* Slide in from right (for panels) */
@keyframes slide-in-right {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.animate-slide-in-right { animation: slide-in-right 300ms ease-out; }

/* Number count up */
@keyframes count-up {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-count-up { animation: count-up 400ms ease-out; }

/* Stagger children */
.stagger-children > * {
  animation: count-up 400ms ease-out backwards;
}
.stagger-children > *:nth-child(1) { animation-delay: 0ms; }
.stagger-children > *:nth-child(2) { animation-delay: 50ms; }
.stagger-children > *:nth-child(3) { animation-delay: 100ms; }
/* ... continue pattern */
```

---

## Icons

Use **Lucide React** for consistency:

```tsx
import {
  TrendingUp,      // Positive trends
  TrendingDown,    // Negative trends
  AlertTriangle,   // Warnings
  Zap,             // Streaming/quick actions
  ArrowRightLeft,  // Trades
  Target,          // Strategy/punt
  Calendar,        // Schedule
  Users,           // Matchups
  MessageSquare,   // Chat
  HelpCircle,      // Learning/tooltips
  BarChart3,       // Stats
  Trophy,          // Playoffs/wins
} from 'lucide-react';
```

---

## Data Visualization

### Chart Theme (Recharts)

```tsx
const chartTheme = {
  colors: ['#ff6b35', '#00d4aa', '#6366f1', '#fbbf24', '#ef4444'],
  background: 'transparent',
  axis: {
    stroke: '#5a6577',
    fontSize: 12,
    fontFamily: 'Inter',
  },
  grid: {
    stroke: 'rgba(255,255,255,0.05)',
  },
  tooltip: {
    background: '#1a1f2e',
    border: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
  },
};
```

### Heatmap Colors

```tsx
// For schedule/performance heatmaps
const heatmapScale = [
  { value: 0, color: '#1a1f2e' },   // No data
  { value: 1, color: '#164e63' },   // Low
  { value: 2, color: '#0891b2' },   // Medium
  { value: 3, color: '#22d3ee' },   // High
  { value: 4, color: '#67e8f9' },   // Very High
];
```

---

## Accessibility

- Minimum contrast ratio: 4.5:1 for body text
- Focus states: `ring-2 ring-hawk-orange ring-offset-2 ring-offset-court-base`
- Screen reader labels on all interactive elements
- Keyboard navigation support for all features

---

## Data TestID Convention

All interactive elements must have `data-testid` attributes following this pattern:

```
{feature}-{component}-{action?}

Examples:
- data-testid="streaming-schedule-grid"
- data-testid="matchup-category-row-pts"
- data-testid="chat-send-button"
- data-testid="trade-player-select-give"
- data-testid="nav-tab-streaming"
```

---

## File Organization

```
frontend/src/
├── components/
│   ├── ui/                    # Base UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Tabs.tsx
│   │   ├── StatDisplay.tsx
│   │   └── ...
│   ├── features/              # Feature-specific components
│   │   ├── streaming/
│   │   ├── matchup/
│   │   ├── trade/
│   │   └── ...
│   └── layout/
│       ├── Header.tsx
│       ├── Sidebar.tsx
│       └── PageContainer.tsx
├── hooks/
├── services/
├── types/
└── styles/
    └── globals.css            # CSS variables, animations
```
