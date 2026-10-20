/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#effaf6',
          100: '#d8f3e8',
          500: '#1f9d74',
          600: '#17805e',
          700: '#13664c',
        },
      },
    },
  },
  plugins: [],
}
