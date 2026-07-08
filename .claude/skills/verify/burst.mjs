// Temporary: rapid screenshot burst while holding fire, to catch a tracer frame.
import { chromium } from "playwright";
const SHOTS = process.argv[2] ?? "./verify-shots";
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.goto("http://localhost:5174/", { waitUntil: "load" });
await page.waitForTimeout(2200);
await page.touchscreen.tap(195, 500);
await page.waitForTimeout(2500);
await page.mouse.move(195, 340);
await page.mouse.down();
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(45);
  await page.screenshot({ path: `${SHOTS}/burst-${i}.png` });
}
await page.mouse.up();
await browser.close();
console.log("DONE");
