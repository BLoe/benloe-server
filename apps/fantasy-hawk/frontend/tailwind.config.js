/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Court Vision Design System
        court: {
          deep: '#0a0e17',      // Deepest background
          base: '#0f1419',      // Main background
          elevated: '#1a1f2e',  // Cards, panels
          surface: '#252d3d',   // Hover states, inputs
        },
        hawk: {
          orange: '#ff6b35',    // Primary actions, your team
          teal: '#00d4aa',      // Success, positive stats
          indigo: '#6366f1',    // AI, insights
          amber: '#fbbf24',     // Alerts, warnings
          red: '#ef4444',       // Negative, losses
        },
        stat: {
          excellent: '#22c55e', // Top tier
          good: '#84cc16',      // Above average
          average: '#eab308',   // Average
          below: '#f97316',     // Below average
          poor: '#ef4444',      // Bottom tier
        },
        // Keep primary for backwards compatibility during migration
        primary: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#ff6b35',       // Now maps to hawk-orange
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
      },
      fontFamily: {
        display: ['Oswald', 'Impact', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-live': 'pulse-live 2s infinite',
        'slide-in-right': 'slide-in-right 300ms ease-out',
        'count-up': 'count-up 400ms ease-out',
      },
      keyframes: {
        'pulse-live': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'count-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
