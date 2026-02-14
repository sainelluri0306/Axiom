import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        noir: {
          bg: "#0a0a0b",
          surface: "#111113",
          border: "#1c1c1f",
          muted: "#71717a",
          "brass": "#b8860b",
          "brass-light": "#d4a84b",
          "brass-dim": "rgba(184, 134, 11, 0.4)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "gradient-noir": "linear-gradient(180deg, #0a0a0b 0%, #0d0d0f 50%, #0a0a0b 100%)",
        "gradient-matte": "linear-gradient(135deg, #111 0%, #0a0a0b 100%)",
        "gradient-title": "linear-gradient(180deg, #fafafa 0%, #d4d4d8 100%)",
      },
      boxShadow: {
        "noir-card": "0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(184,134,11,0.1)",
        "noir-card-hover": "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(184,134,11,0.18), 0 0 40px rgba(184,134,11,0.06)",
        "brass-glow": "0 0 24px rgba(184,134,11,0.2)",
        "brass-glow-strong": "0 0 32px rgba(184,134,11,0.25)",
      },
      animation: {
        "cursor-blink": "cursor-blink 1s step-end infinite",
      },
      keyframes: {
        "cursor-blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      transitionDuration: {
        300: "300ms",
      },
      borderRadius: {
        "card": "1.25rem",
        "input": "1rem",
        "pill": "9999px",
      },
    },
  },
  plugins: [],
};

export default config;
