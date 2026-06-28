/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Coppia tipografica ufficiale OrderWatch: Manrope per titoli/brand,
        // IBM Plex Sans per il corpo testo. Caricati via Google Fonts in index.html.
        sans: ["IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        heading: ["Manrope", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        soft: "0 1px 2px rgba(15, 23, 42, 0.06)",
        elevated: "0 8px 20px rgba(15, 23, 42, 0.10)"
      }
    }
  },
  plugins: []
};
