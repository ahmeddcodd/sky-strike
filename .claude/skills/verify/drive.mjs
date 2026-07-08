// Full end-to-end loop: start → fire → game over → restart → persistence.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const PORT = process.env.GAME_PORT ?? "5174"; // dev server; set GAME_PORT=4173 for vite preview
const BASE = `http://localhost:${PORT}/?debug=1`;
const SHOTS = process.argv[2] ?? "./verify-shots";
mkdirSync(SHOTS, { recursive: true });

const consoleLogs = [];
const pageErrors = [];

const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});
const page = await context.newPage();
page.on("console", (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => pageErrors.push(String(err)));

const step = (name) => console.log(`\n=== ${name} ===`);
const shot = async (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const text = async (sel) => {
  const el = await page.$(sel);
  return el ? (await el.textContent())?.trim() : null;
};

step("load");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2800);
await shot("01-start");
console.log("tap hint:", await text(".tap-hint"));
console.log("title:", await text(".game-title"));

step("start game");
await page.touchscreen.tap(195, 500);
await page.waitForTimeout(4200);
await shot("02-gameplay");

step("debug overlay + spawn");
await page.keyboard.press("Backquote");
await page.keyboard.press("KeyJ");
await page.keyboard.press("KeyJ");
await page.waitForTimeout(900);
await shot("03-debug");
console.log("debug panel:", JSON.stringify(await text(".debug-panel")));

step("hold fire 6s (crosshair sweeps center)");
await page.mouse.move(195, 420);
await page.mouse.down();
const sweep = [
  [195, 380], [230, 360], [160, 400], [195, 340], [250, 420], [140, 360], [195, 390],
];
for (const [x, y] of sweep) {
  await page.mouse.move(x, y, { steps: 8 });
  await page.waitForTimeout(820);
}
await shot("04-firing");
await page.mouse.up();
console.log("score after firing:", await text(".score-value"));
console.log("debug panel:", JSON.stringify(await text(".debug-panel")));

step("debug off, wait for game over (stop shooting)");
await page.keyboard.press("Backquote");
const overTitle = page.locator(".over-title");
try {
  await overTitle.waitFor({ state: "visible", timeout: 75000 });
  console.log("game over reached");
} catch {
  console.log("GAME OVER NOT REACHED IN 75s");
}
await page.waitForTimeout(600);
await shot("05-gameover");
console.log("stats:", JSON.stringify(await text(".stats")));
console.log("best banner:", JSON.stringify(await text(".overlay:not(.hidden) .best-banner")));

step("restart");
await page.locator(".btn").dispatchEvent("pointerdown");
await page.waitForTimeout(1500);
await shot("06-restarted");
console.log("score after restart:", await text(".score-value"));
console.log("gameover hidden:", await page.locator(".over-title").isVisible().then((v) => !v));

step("reload — best score persisted?");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2200);
await shot("07-reload-best");
console.log("start best banner:", JSON.stringify(await text(".best-banner")));

step("console + errors");
console.log("playables logs:", consoleLogs.filter((l) => l.includes("[Playables]")));
console.log("errors/warnings:", consoleLogs.filter((l) => l.startsWith("[error]") || l.startsWith("[warning]")));
console.log("pageErrors:", pageErrors);

await browser.close();
console.log("\nDONE");
