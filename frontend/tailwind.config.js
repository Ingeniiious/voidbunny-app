/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: {
          bg: 'rgb(var(--panel-bg) / <alpha-value>)',
          surface: 'rgb(var(--panel-surface) / <alpha-value>)',
          border: 'rgb(var(--panel-border) / <alpha-value>)',
          text: 'rgb(var(--panel-text) / <alpha-value>)',
          muted: 'rgb(var(--panel-muted) / <alpha-value>)',
          accent: 'rgb(var(--panel-accent) / <alpha-value>)',
          danger: 'rgb(var(--panel-danger) / <alpha-value>)',
        },
      },
      fontFamily: {
        mono: ['"Fliege Mono"', '"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['Aldone', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'stats-pop': {
          '0%': { opacity: '0', transform: 'translateY(-4px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'stats-pop': 'stats-pop 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
