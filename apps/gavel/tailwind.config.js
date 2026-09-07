/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/web/**/*.{ts,tsx,html}'],
  // Colour and type live in index.css as custom properties so the identity can
  // be changed in one file. Tailwind only maps names onto them.
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        fig: ['var(--font-fig)', 'ui-monospace', 'monospace'],
      },
      colors: {
        ground: 'var(--ground)',
        panel: 'var(--panel)',
        raised: 'var(--raised)',
        rule: 'var(--rule)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        dim: 'var(--dim)',
        brass: 'var(--brass)',
        live: 'var(--live)',
        good: 'var(--good)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
        qb: 'var(--qb)',
        rb: 'var(--rb)',
        wr: 'var(--wr)',
        te: 'var(--te)',
        def: 'var(--def)',
      },
    },
  },
  plugins: [],
};
