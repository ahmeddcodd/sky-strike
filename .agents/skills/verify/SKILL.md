---
name: verify
description: Build, run, and drive Sky Strike 3D end-to-end in a headless browser to verify changes.
---

# Verifying Sky Strike 3D

Browser game (Babylon.js + Vite, portrait 9:16). Verification = drive it in a real browser and screenshot.

## Build / launch

- `npx tsc` — typecheck only (build runs it too).
- `npm run dev` (background) — Vite dev server; **check the reported port** (5173 may be taken; it auto-increments).
- `npm run build && npm run preview` — production bundle check.

## Drive it

Playwright is a devDependency and uses system Edge — no browser download:

- Driver scripts live in `.Codex/skills/verify/` — run from the repo root with a screenshot dir argument. They default to port 5174; set `GAME_PORT` to target another port (e.g. `vite preview`, which auto-increments from 4173):
  - `drive.mjs` — full loop: start → fire → game over → restart → persistence + console/lifecycle checks.
  - `quick.mjs` — visual check in portrait AND landscape, with a motion pair (play-A/play-B 1 s apart) to confirm the world scroll.
  - `burst.mjs` — 8 rapid screenshots while holding fire, to catch short-lived tracers/muzzle flashes.
  - `probe.mjs` — live scene interrogation: in debug builds `window.__scene` is exposed, so `page.evaluate` can inspect any mesh/material/texture (this is how the ocean CLAMP-vs-WRAP texture bug was found) and recolor meshes to locate them on screen.
  - `controls.mjs` — both control schemes: desktop mouse-follow with hidden cursor + hold-to-fire, and touch drag (crosshair moves by finger delta × `INPUT.DRAG_GAIN`, holds fire, position persists on release). Touch is dispatched via CDP `Input.dispatchTouchEvent`; runs at deviceScaleFactor 2. There is no joystick (removed at user request).
  - `playables.mjs` — YouTube Playables SDK integration. **Blocks the real `youtube.com/game_api` request** (it defines its own `window.ytgame` with `IN_PLAYABLES_ENV=false` when not embedded, which clobbers a stub) and injects a fake `ytgame` via `addInitScript` with `IN_PLAYABLES_ENV=true`. Asserts: `firstFrameReady`/`gameReady` fire once, `game.loadData` seeds the best score, `system.onPause`/`onResume` pause/resume the loop (via `window.__paused`), `system.onAudioEnabledChange` mutes (via `window.__audioMuted`), `engagement.sendScore` fires on game over, and `localStorage` stays empty.
  - `combat.mjs` — enemy return fire (hp chip), interceptable missiles, and the three power-up pods (heavy/missiles/ghost).
- Launch options that matter: `channel: "msedge"`, `headless: true`, `args: ["--enable-unsafe-swiftshader"]` (software WebGL), viewport 390×844, `hasTouch: true`.
- Load `http://localhost:<port>/?debug=1` to get the DebugSystem even in prod builds.

## Flows worth driving

- Start: `.tap-hint` visible → `page.touchscreen.tap(195, 500)` starts the game.
- Fire: `page.mouse.down()` + sweep moves = drag-aim + hold-fire; score in `.score-value`, hit/shot counts in `.debug-panel`.
- Aim: desktop = mouse-follow (no button); touch = drag anywhere (delta × DRAG_GAIN). Hold fires in both.
- Debug hotkeys (keyboard): `` ` `` toggle hitboxes/ray/danger plane · `J` spawn jet · `C` clear · `I` invincible.
- Game over: stop shooting ~30–60 s → `.over-title` appears; stats in `.stats`; restart via `pointerdown` on `.btn` (NOT `click` — the button listens to pointerdown).
- Persistence: cloud-only via the Playables SDK — there is **no localStorage**. Outside Playables (local/headless) the SDK is a no-op, so a reload resets the best; the score persists in-memory within a session only. Use `playables.mjs` (with a stubbed `ytgame`) to verify the cloud path.
- Playables lifecycle: dev console logs `[Playables] firstFrameReady` then `gameReady` once, right after first frame.

## Gotchas

- Playwright `isVisible()` is true for `.overlay.hidden` (it hides via opacity/pointer-events) — check the class, not visibility.
- Headless swiftshader runs well below 60 fps under load; the game clamps dt at 1/30 so game time slows rather than jets teleporting. Don't measure timing-sensitive behavior in headless.
- The score/hearts UI is DOM, not canvas — assert via selectors, screenshot for the 3D scene.
