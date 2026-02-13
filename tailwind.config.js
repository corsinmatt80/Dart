/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1e40af',
        accent: '#f59e0b',
        success: '#10b981',
        danger: '#ef4444',
        dark: '#0f172a',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-soft': 'bounce 2s infinite',
      }
    },
  },
  plugins: [],
}
