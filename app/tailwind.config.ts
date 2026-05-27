import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Vault — deeper, warmer than the previous ocean palette.
        vault: "#08182e",      // page background, near-black with blue cast
        slate: "#0e2747",      // first layer up
        marine: "#143055",     // mid-blue, used for surfaces
        deep: "#1b3f6e",       // accent blue
        // Metals
        brass: "#c8a661",      // primary accent, real brass
        gild: "#9d7a3b",       // brass shadow / pressed
        copper: "#a86b3d",     // alternate accent (used sparingly)
        // Paper & ink
        cream: "#f4efe1",      // headings, warm off-white
        mist: "#c7d1dd",       // body text, cool blue-gray
        sky: "#7e95b3",        // muted, captions
        // Stay-the-same blue accent (rarely used now)
        aqua: "#4d8ac1",
      },
      fontFamily: {
        display: [
          '"Roboto Slab"',
          '"Newsreader"',
          "Georgia",
          "serif",
        ],
        serif: ['"Newsreader"', "Georgia", "serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tight: "-0.018em",
        tighter: "-0.028em",
        widest: "0.22em",
      },
      maxWidth: {
        prose: "62ch",
        page: "1200px",
      },
      keyframes: {
        revolve: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        revealUp: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0px)" },
        },
      },
      animation: {
        revolve: "revolve 120s linear infinite",
        "reveal-up": "revealUp 0.8s cubic-bezier(0.2,0.6,0.2,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
