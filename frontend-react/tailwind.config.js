/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#090a0c",
        foreground: "#f4f4f5",
        border: "rgba(255, 255, 255, 0.08)",
        muted: {
          DEFAULT: "#18191d",
          foreground: "#71717a",
        },
        card: {
          DEFAULT: "#0f1013",
          foreground: "#ffffff",
        },
        brand: {
          DEFAULT: "#bef264",
          text: "#14532d",
        },
      },
      fontFamily: {
        sans: ["Geist", "Geist Sans", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
