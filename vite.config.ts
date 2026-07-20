import { defineConfig } from "vite";

// YouTube Playables serves the game from a nested sandbox path, so every asset
// reference MUST be relative (`base: "./"`) or it 404s. Blender-authored GLBs
// live under public/assets and are copied into the self-contained build; the
// only external request is the youtube.com Playables SDK script.
export default defineConfig({
  base: "./",
  build: {
    // keep the SDK script untouched and emit relative, CORS-free asset tags
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 1500,
  },
});
