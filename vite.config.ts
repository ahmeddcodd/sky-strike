import { defineConfig } from "vite";

// YouTube Playables serves the game from a nested sandbox path, so every asset
// reference MUST be relative (`base: "./"`) or it 404s. The game is fully
// procedural (no asset files) and makes no external network calls except the
// youtube.com SDK script, which satisfies the Playables self-contained rule.
export default defineConfig({
  base: "./",
  build: {
    // keep the SDK script untouched and emit relative, CORS-free asset tags
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 1500,
  },
});
