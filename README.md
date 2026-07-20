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

## Blender art pipeline

- The player fighter, three enemy airframes, friendly/hostile missiles, all three power-up pods, ocean battlefield, horizon cliffs, fortified island, rock stack, buoy, searchlight emplacement, burning wreck, and destroyer are authored as Blender assets.
- Every unique runtime GLB is validated at exactly **10,500 triangles** (the requested 10,000–11,000 medium-poly band). See `public/assets/models/asset-manifest.json` for measured counts and file sizes.
- Editable sources live in `art/blender/`; `war_environment_master.blend` is the assembled map. Runtime-ready GLBs live in `public/assets/models/` and share geometry across pooled/cloned instances.
- Rebuild the library with Blender 5.2+: `blender --background --python tools/blender/build_assets.py`. Rebuild the editable map and preview with `blender --background --python tools/blender/build_master_scene.py`.

## Tech notes

- Babylon.js glTF loading finishes before the first playable frame. Sky and cloud sprites, the scrolling ocean material, exhaust, projectiles, explosions, navigation lights, and the day/night grade remain real-time effects layered over Blender-authored geometry.
- Deterministic Bézier flight paths, raycast shooting against simplified hitboxes, object pooling throughout, frame-rate-independent logic (clamped delta time).
- Fully integrated YouTube Playables SDK (`src/systems/PlayablesSDK.ts`): honors YouTube pause/resume and mute/unmute, and persists the best score to YouTube cloud storage only — **no local storage**. Outside Playables the SDK is a no-op and the game runs standalone.
- Deploys to Vercel out of the box (`vercel.json` included): import the repo or run `npx vercel`.

## Verification

Headless end-to-end drivers (Playwright + system Edge) live in `.claude/skills/verify/` — see `SKILL.md` there for the flows they cover.
