/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        kidSky: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          400: '#38bdf8',
          500: '#0284c7',
          600: '#0369a1',
        },
        kidYellow: {
          300: '#fde047',
          400: '#facc15',
          500: '#eab308',
        },
        kidGreen: {
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
        },
        kidPink: {
          400: '#f472b6',
          500: '#ec4899',
        },
        kidPurple: {
          400: '#c084fc',
          500: '#a855f7',
        }
      },
      fontFamily: {
        sans: ['Nunito', 'Fredoka', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'kid': '0 6px 0 0 rgba(0,0,0,0.15)',
        'kid-lg': '0 8px 0 0 rgba(0,0,0,0.18)',
        'kid-pressed': '0 2px 0 0 rgba(0,0,0,0.15)',
      }
    },
  },
  plugins: [],
}
