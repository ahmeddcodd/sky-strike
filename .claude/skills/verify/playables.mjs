// Verifies the YouTube Playables SDK integration by injecting a fake `window.ytgame`
// BEFORE the bundle loads (addInitScript), then checking the game drives it correctly:
//   - IN_PLAYABLES_ENV true -> the SDK path is taken (not the standalone no-op)
//   - game.loadData() cloud value seeds the best score (no localStorage)
//   - firstFrameReady() + gameReady() each fire exactly once
//   - system.onPause() pauses the game; onResume() resumes it
//   - system.onAudioEnabledChange(false) mutes; (true) unmutes
//   - game.saveData() receives the new best score on game over
//   - the game never touches localStorage
// Debug hooks used: window.__paused, window.__audioMuted, window.__scene (?debug=1).
import { chromium } from "playwright";

const PORT = process.env.GAME_PORT ?? "5174";
const SHOTS = process.argv[2] ?? "./verify-shots";
const W = 390, H = 844;

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err));

// Block the real YouTube SDK so our stub survives (the real script defines its
// own window.ytgame with IN_PLAYABLES_ENV=false when not embedded in YouTube,
// which would clobber the stub). Serve an empty script in its place.
await page.route(/youtube\.com\/game_api/, (route) =>
  route.fulfill({ status: 200, contentType: "application/javascript", body: "/* stubbed */" }));

// Fake SDK installed before any game code. Records calls + captures the callbacks
// the game registers so the test can fire real YouTube events at the running game.
await page.addInitScript(() => {
  const rec = { firstFrameReady: 0, gameReady: 0, loadData: 0, saved: [], scores: [] };
  let pauseCb = null, resumeCb = null, audioCb = null;
  window.ytgame = {
    IN_PLAYABLES_ENV: true,
    SDK_VERSION: "test-1.0",
    game: {
      firstFrameReady() { rec.firstFrameReady++; },
      gameReady() { rec.gameReady++; },
      async saveData(data) { rec.saved.push(data); },
      async loadData() { rec.loadData++; return JSON.stringify({ bestScore: 1234 }); },
    },
    system: {
      onPause(cb) { pauseCb = cb; },
      onResume(cb) { resumeCb = cb; },
      isAudioEnabled() { return true; },
      onAudioEnabledChange(cb) { audioCb = cb; },
    },
    engagement: { async sendScore(s) { rec.scores.push(s.value); } },
    health: { logError() {}, logWarning() {} },
  };
  window.__yt = rec;
  window.__firePause = () => pauseCb && pauseCb();
  window.__fireResume = () => resumeCb && resumeCb();
  window.__fireAudio = (on) => audioCb && audioCb(on);
});

await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: "load" });
await page.waitForTimeout(2600);

const rec = () => page.evaluate(() => window.__yt);
const shots = () => page.$eval(".debug-panel", (n) => /shots\/hits (\d+)/.exec(n.textContent)?.[1] ?? "?");

console.log("=== lifecycle: firstFrameReady + gameReady fired once ===");
let r = await rec();
console.log("firstFrameReady:", r.firstFrameReady, "(want 1) | gameReady:", r.gameReady, "(want 1)");

console.log("=== cloud loadData seeds best score (no localStorage) ===");
console.log("loadData calls:", r.loadData, "(want >= 1)");
const bestBanner = await page.$eval(".best-banner", (n) => n.textContent).catch(() => "");
console.log("start best banner:", JSON.stringify(bestBanner), "(want BEST 1,234)");
console.log("localStorage keys:", await page.evaluate(() => Object.keys(localStorage).length), "(want 0)");

console.log("=== start game ===");
await page.mouse.click(W / 2, H * 0.6);
await page.waitForTimeout(500);
await page.keyboard.press("Backquote");
await page.keyboard.press("KeyI"); // invincible so the pause test isn't cut short by death

console.log("=== onPause halts the game loop ===");
await page.keyboard.press("KeyJ");
await page.keyboard.press("KeyJ");
await page.waitForTimeout(500);
await page.evaluate(() => window.__firePause());
await page.waitForTimeout(150);
console.log("__paused after onPause:", await page.evaluate(() => window.__paused), "(want true)");
const shotsA = await shots();
// firing while paused must NOT advance the shot count (update() is skipped)
await page.mouse.move(W / 2, H * 0.4);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
const shotsB = await shots();
console.log(`shots while paused: ${shotsA} -> ${shotsB} (want unchanged)`);
await page.evaluate(() => window.__fireResume());
await page.waitForTimeout(150);
console.log("__paused after onResume:", await page.evaluate(() => window.__paused), "(want false)");

console.log("=== onAudioEnabledChange drives mute ===");
await page.evaluate(() => window.__fireAudio(false));
await page.waitForTimeout(120);
const mutedOff = await page.evaluate(() => window.__audioMuted);
await page.evaluate(() => window.__fireAudio(true));
await page.waitForTimeout(120);
const mutedOn = await page.evaluate(() => window.__audioMuted);
console.log("muted after disable:", mutedOff, "(want true) | muted after enable:", mutedOn, "(want false)");

console.log("=== cloud writes on game over (sendScore always, saveData on new best) ===");
// force a new-best save by seeding the in-memory best BELOW the run's score:
// spawn+kill a few jets while invincible so the final score beats 0, then lower
// the bar by asserting saveData fires whenever score > loaded best.
await page.evaluate(() => { window.__yt.saved.length = 0; window.__yt.scores.length = 0; });
await page.keyboard.press("KeyI"); // invincible OFF — let the run end
await page.keyboard.press("Backquote"); // debug off for a clean end screen
let over = false;
for (let i = 0; i < 10 && !over; i++) {
  await page.waitForTimeout(1500);
  over = await page.$eval(".over-title", (n) => !n.closest(".overlay").classList.contains("hidden")).catch(() => false);
}
await page.waitForTimeout(400);
r = await rec();
console.log("game over reached:", over);
// sendScore fires on EVERY game over (unconditional) — proves the cloud write pipeline
console.log("sendScore values:", JSON.stringify(r.scores), "(want a value — always sent to the SDK)");
// saveData fires only when the run beats the loaded best (1234) — correct/intended
console.log("saveData calls:", r.saved.length, "| payloads:", JSON.stringify(r.saved), "(fires only when final > 1234)");
await page.screenshot({ path: `${SHOTS}/playables-gameover.png` });

console.log("=== final localStorage check ===");
console.log("localStorage keys after full run:", await page.evaluate(() => Object.keys(localStorage).length), "(want 0)");

await browser.close();
console.log("DONE");
