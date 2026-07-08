// Verifies the two control schemes:
//  desktop (mouse): crosshair follows the cursor with no button held, OS cursor
//    hidden over the canvas, hold-to-fire works
//  touch: drag anywhere moves the crosshair by the finger delta (×DRAG_GAIN),
//    holding fires; there is NO joystick element; mouse use flips back live.
// Touch input must be dispatched via CDP (Playwright's touchscreen has no drag).
import { chromium } from "playwright";

const PORT = process.env.GAME_PORT ?? "5174";
const SHOTS = process.argv[2] ?? "./verify-shots";
const W = 390, H = 844;

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });

const crosshair = async (page) => {
  const el = await page.$(".crosshair");
  const style = await el.evaluate((n) => ({ left: n.style.left, top: n.style.top }));
  return { x: parseFloat(style.left), y: parseFloat(style.top) };
};
const canvasCursor = (page) => page.$eval("#game", (n) => getComputedStyle(n).cursor);
const hint = (page) => page.$eval(".control-hint", (n) => n.textContent);

// ---------- desktop (no touch capability) ----------
console.log("=== desktop mode ===");
{
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (err) => console.log("PAGEERROR[desktop]:", err));
  await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: "load" });
  await page.waitForTimeout(2300);
  await page.mouse.move(W / 2, H / 2);
  await page.waitForTimeout(200);
  console.log("hint:", await hint(page));
  console.log("joystick element exists:", (await page.$(".joystick")) !== null, "(want false)");
  console.log("canvas cursor:", await canvasCursor(page), "(want none)");

  await page.mouse.click(W / 2, H * 0.6); // start game via overlay
  await page.waitForTimeout(600);
  await page.keyboard.press("Backquote");

  await page.mouse.move(300, 250, { steps: 6 });
  await page.waitForTimeout(350);
  const a = await crosshair(page);
  console.log("hover-follow to (300,250):", a, "| tracks:", Math.abs(a.x - 300) < 15 && Math.abs(a.y - 250) < 15);

  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  const panel = await page.$eval(".debug-panel", (n) => n.textContent);
  console.log("after hold:", JSON.stringify(panel.split("\n")[2]), "(shots > 0)");
  await page.close();
}

// ---------- touch drag at phone DPR ----------
console.log("=== touch drag (deviceScaleFactor 2) ===");
{
  const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: 2 });
  page.on("pageerror", (err) => console.log("PAGEERROR[touch]:", err));
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });

  await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: "load" });
  await page.waitForTimeout(2300);
  await touch("touchStart", [{ x: W / 2, y: H * 0.6 }]); // start game
  await touch("touchEnd", []);
  await page.waitForTimeout(600);
  await page.keyboard.press("Backquote");
  console.log("joystick element exists:", (await page.$(".joystick")) !== null, "(want false)");

  // drag 100px right, 80px up → crosshair moves by delta × DRAG_GAIN (1.15)
  const before = await crosshair(page);
  await touch("touchStart", [{ x: 100, y: 500 }]);
  await touch("touchMove", [{ x: 150, y: 460 }]);
  await touch("touchMove", [{ x: 200, y: 420 }]);
  await page.waitForTimeout(500);
  const during = await crosshair(page);
  const expectX = before.x + 100 * 1.15;
  const expectY = before.y - 80 * 1.15;
  console.log(`drag: (${before.x.toFixed(0)},${before.y.toFixed(0)}) -> (${during.x.toFixed(0)},${during.y.toFixed(0)})`,
    `want (~${expectX.toFixed(0)}, ~${expectY.toFixed(0)}) | match:`,
    Math.abs(during.x - expectX) < 12 && Math.abs(during.y - expectY) < 12);

  // holding the drag fires
  await page.waitForTimeout(400);
  const panel = await page.$eval(".debug-panel", (n) => n.textContent);
  console.log("while holding:", JSON.stringify(panel.split("\n")[2]), "(shots > 0)");
  await touch("touchEnd", []);
  await page.screenshot({ path: `${SHOTS}/touch-drag.png` });

  // crosshair stays where released (drag does NOT recenter)
  await page.waitForTimeout(300);
  const released = await crosshair(page);
  console.log("stays after release:", Math.abs(released.x - during.x) < 8 && Math.abs(released.y - during.y) < 8);

  // a mouse movement flips to desktop mode
  await page.mouse.move(W / 2, 300);
  await page.waitForTimeout(200);
  console.log("after mouse move — canvas cursor:", await canvasCursor(page), "(want none)");
  await page.close();
}

await browser.close();
console.log("DONE");
