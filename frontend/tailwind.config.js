/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'JetBrains Mono'", "monospace"],
      },
      colors: {
        ink: {
          950: "#0a0a0f",
          900: "#111118",
          800: "#1a1a24",
          700: "#252530",
          600: "#363645",
          400: "#888899",
          300: "#aaaacc",
        },
        accent: {
          DEFAULT: "#7c6af7",
          light: "#a89cf9",
          dim: "#3d3578",
        },
        signal: "#4ade80",
        warm: "#f97316",
      },
    },
  },
  plugins: [],
};
