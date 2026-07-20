// Verifies the wave system, enemy health bars, combo HUD, and the day→night
// war environment (debug hotkeys: W skip wave, N snap night, J spawn).
import { chromium } from "playwright";

const PORT = process.env.GAME_PORT ?? "5174";
const SHOTS = process.argv[2] ?? "./verify-shots";
const W = 390, H = 844;

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: 2 });
page.on("pageerror", (err) => console.log("PAGEERROR:", err));

const panel = async () => (await page.$eval(".debug-panel", (n) => n.textContent)) ?? "";
const visibleBars = () =>
  page.$$eval(".hpbar", (els) => els.filter((e) => e.style.display !== "none").length);

await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: "load" });
await page.waitForTimeout(2300);
await page.touchscreen.tap(W / 2, H * 0.6);
await page.waitForTimeout(600);
await page.keyboard.press("Backquote");
await page.keyboard.press("KeyI"); // invincible — the script doesn't defend, keep the run alive

console.log("=== wave 1, day ===");
await page.waitForTimeout(3500); // wave 1 spawning
console.log("wave indicator:", await page.$eval(".wave-indicator", (n) => n.textContent));
console.log("visible hp bars:", await visibleBars(), "(want > 0)");
console.log(JSON.stringify(await panel()));
await page.keyboard.press("Backquote"); // debug visuals off for a clean shot
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOTS}/war-day.png` });
await page.keyboard.press("Backquote");

console.log("=== combo attempt: spawn cluster + sweep fire ===");
for (let i = 0; i < 5; i++) await page.keyboard.press("KeyJ");
await page.waitForTimeout(1200);
await page.mouse.move(W / 2, H * 0.35);
await page.mouse.down();
for (const [x, y] of [[W/2-70, H*0.32], [W/2+70, H*0.38], [W/2, H*0.3], [W/2-50, H*0.42], [W/2+60, H*0.33]]) {
  await page.mouse.move(x, y, { steps: 6 });
  await page.waitForTimeout(650);
}
await page.mouse.up();
console.log("combo element:", JSON.stringify(await page.$eval(".combo", (n) => n.textContent)));
// combo must be on its own absolute tier and must NOT overlap the wave indicator
const comboLayout = await page.evaluate(() => {
  const c = document.querySelector(".combo");
  const w = document.querySelector(".wave-indicator");
  const pos = getComputedStyle(c).position;
  // force it visible to measure geometry even if no chain landed
  c.classList.add("show");
  if (!c.textContent) c.textContent = "×5 COMBO (10)";
  const cb = c.getBoundingClientRect();
  const wb = w.getBoundingClientRect();
  const overlap = !(cb.right < wb.left || cb.left > wb.right || cb.bottom < wb.top || cb.top > wb.bottom);
  return { pos, overlap, comboBox: { x: Math.round(cb.x), y: Math.round(cb.y), w: Math.round(cb.width) } };
});
console.log("combo position:", comboLayout.pos, "(want absolute) | overlaps wave indicator:", comboLayout.overlap, "(want false)");
console.log(JSON.stringify(await panel()));

console.log("=== night (N snap) + jets with nav lights ===");
await page.keyboard.press("KeyC"); // clear leftovers so none detonates over the screenshot
await page.keyboard.press("KeyN");
await page.waitForTimeout(400);
for (let i = 0; i < 4; i++) await page.keyboard.press("KeyJ");
await page.waitForTimeout(2000); // let jets approach + searchlights sweep
console.log(JSON.stringify(await panel()));
await page.keyboard.press("Backquote");
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOTS}/war-night.png` });
await page.keyboard.press("Backquote");

console.log("=== wave skip (W) advances waves ===");
const before = await panel();
await page.keyboard.press("KeyW");
await page.waitForTimeout(1200);
const after = await panel();
console.log("wave before:", before.split("\n")[1], "| after:", after.split("\n")[1]);

await browser.close();
console.log("DONE");
