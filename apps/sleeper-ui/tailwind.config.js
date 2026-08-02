/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/web/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Barlow Condensed"', 'system-ui', 'sans-serif'],
        body: ['Barlow', 'system-ui', 'sans-serif'],
      },
      colors: {
        ground: '#0A0E13',
        panel: '#111820',
        raised: '#161F29',
        line: '#1E2A36',
        line2: '#2A3947',
        ink: '#E8EDF2',
        muted: '#93A2B2',
        dim: '#6E7E8D',
        win: '#3FBF7F',
        loss: '#E5484D',
        live: '#F5C518',
      },
    },
  },
  plugins: [],
};
