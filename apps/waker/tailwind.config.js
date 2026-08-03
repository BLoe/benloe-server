/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/web/**/*.{ts,tsx,html}'],
  // Colours and type live in index.css as CSS custom properties, so the design
  // pass can change the identity in one file. Tailwind only maps names to them.
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        figure: ['var(--font-figure)', 'ui-monospace', 'monospace'],
      },
      colors: {
        ground: 'var(--ground)',
        panel: 'var(--panel)',
        raised: 'var(--raised)',
        rule: 'var(--rule)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        dim: 'var(--dim)',
        urgent: 'var(--urgent)',
        good: 'var(--good)',
        bad: 'var(--bad)',
      },
    },
  },
  plugins: [],
};
