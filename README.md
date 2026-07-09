# Sky Strike 3D ✈️

A fast, mobile-first 3D arcade jet shooter built with [Babylon.js](https://www.babylonjs.com/), TypeScript, and Vite — designed for **YouTube Playables** (portrait 9:16) and playable in any browser.

Fly your fighter jet over the ocean and shoot down incoming enemy jets before they reach you. Build your score, survive as the waves speed up, and beat your best.

## Controls

| Platform | Aim | Fire |
|---|---|---|
| Mobile | Virtual joystick (bottom) or drag anywhere | Hold |
| Desktop | Move the mouse (cursor becomes the crosshair) | Hold any mouse button |

## Development

```bash
npm install
npm run dev      # dev server with HMR
npm run build    # typecheck + production bundle in dist/
npm run preview  # serve the production bundle locally
npm run package  # build + zip an uploadable YouTube Playables bundle
```

## YouTube Playables package

`npm run package` produces **`sky-strike-playables.zip`** — the file you upload in the YouTube Playables developer portal. It builds with relative asset paths (`base: "./"`), strips `crossorigin`, puts `index.html` at the zip root, and prints a size report. The bundle is fully self-contained: the only external request is the youtube.com SDK script. Well within the limits (zip ≤ 200 MB, initial load < 30 MB, no file > 30 MB) — this game is ~0.4 MB zipped.

Append `?debug=1` to the URL for debug tools: `` ` `` toggles hitboxes/raycast/danger-zone visuals · `J` spawns a jet · `C` clears enemies · `I` toggles invincibility.

## Tech notes

- **Everything is procedural** — jets, sky, clouds, ocean, islands, and all sound effects are generated in code. No 3D model, texture, or audio files; the whole game ships at ~260 KB gzipped.
- Deterministic Bézier flight paths, raycast shooting against simplified hitboxes, object pooling throughout, frame-rate-independent logic (clamped delta time).
- Fully integrated YouTube Playables SDK (`src/systems/PlayablesSDK.ts`): honors YouTube pause/resume and mute/unmute, and persists the best score to YouTube cloud storage only — **no local storage**. Outside Playables the SDK is a no-op and the game runs standalone.
- Deploys to Vercel out of the box (`vercel.json` included): import the repo or run `npx vercel`.

## Verification

Headless end-to-end drivers (Playwright + system Edge) live in `.claude/skills/verify/` — see `SKILL.md` there for the flows they cover.
