// Quick visual check: portrait + landscape screenshots, plus a motion pair
// (two frames 1 s apart) to confirm the forward-flight world scroll.
import { chromium } from "playwright";

const PORT = process.env.GAME_PORT ?? "5174"; // dev server; set GAME_PORT=4173 for vite preview
const SHOTS = process.argv[2] ?? "./verify-shots";
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });

async function drive(viewport, tag, deviceScaleFactor = 1) {
  const page = await browser.newPage({ viewport, hasTouch: true, deviceScaleFactor });
  page.on("pageerror", (err) => console.log(`PAGEERROR[${tag}]:`, err));
  await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/${tag}-start.png` });
  await page.touchscreen.tap(viewport.width / 2, viewport.height * 0.6);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOTS}/${tag}-play-A.png` });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/${tag}-play-B.png` });
  // hold fire briefly near center to see tracers/muzzle from the wings
  await page.mouse.move(viewport.width / 2, viewport.height * 0.42);
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}/${tag}-firing.png` });
  await page.mouse.up();
  await page.close();
}

await drive({ width: 390, height: 844 }, "portrait", 3); // phone-like DPR — output should be sharp
await drive({ width: 1280, height: 720 }, "landscape");
await browser.close();
console.log("DONE");
