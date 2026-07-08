// Verifies the adaptive control schemes:
//  desktop (mouse): crosshair follows the cursor with no button held, OS cursor
//    hidden over the canvas, joystick hidden, hold-to-fire works
//  touch: joystick deflection moves the crosshair (rate control) and fires;
//    using the mouse afterwards flips back to desktop mode live.
// Touch input must be dispatched via CDP (Playwright's touchscreen has no drag).
import { chromium } from "playwright";

const PORT = 5174;
const SHOTS = process.argv[2] ?? "./verify-shots";
const W = 390, H = 844;
const JOY = { x: W / 2, y: H - 112 }; // must match JOYSTICK.BOTTOM_OFFSET

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });

const crosshair = async (page) => {
  const el = await page.$(".crosshair");
  const style = await el.evaluate((n) => ({ left: n.style.left, top: n.style.top }));
  return { x: parseFloat(style.left), y: parseFloat(style.top) };
};
const joystickVisible = (page) =>
  page.$eval(".joystick", (n) => getComputedStyle(n).display !== "none");
const canvasCursor = (page) => page.$eval("#game", (n) => getComputedStyle(n).cursor);
const hint = (page) => page.$eval(".control-hint", (n) => n.textContent);

// ---------- desktop (no touch capability) ----------
console.log("=== desktop mode ===");
{
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (err) => console.log("PAGEERROR[desktop]:", err));
  await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: "load" });
  await page.waitForTimeout(2300);
  await page.mouse.move(W / 2, H / 2); // ensures mode sync from a real mouse event
  await page.waitForTimeout(200);
  console.log("hint:", await hint(page));
  console.log("joystick visible:", await joystickVisible(page), "(want false)");
  console.log("canvas cursor:", await canvasCursor(page), "(want none)");

  await page.mouse.click(W / 2, H * 0.6); // start game via overlay
  await page.waitForTimeout(600);
  await page.keyboard.press("Backquote");

  // crosshair follows the cursor WITHOUT any button held
  await page.mouse.move(300, 250, { steps: 6 });
  await page.waitForTimeout(350);
  const a = await crosshair(page);
  await page.mouse.move(90, 600, { steps: 6 });
  await page.waitForTimeout(350);
  const b = await crosshair(page);
  console.log("hover-follow:", a, "->", b, "| tracks mouse:", Math.abs(a.x - 300) < 15 && Math.abs(b.x - 90) < 15);

  // hold to fire
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  const panel = await page.$eval(".debug-panel", (n) => n.textContent);
  console.log("after hold:", JSON.stringify(panel.split("\n")[2]), "(shots > 0)");
  await page.screenshot({ path: `${SHOTS}/desktop-mode.png` });
  await page.close();
}

// ---------- touch (joystick, direct mapping) at phone DPR + live switch back to mouse ----------
console.log("=== touch mode (deviceScaleFactor 2) ===");
{
  const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: 2 });
  page.on("pageerror", (err) => console.log("PAGEERROR[touch]:", err));
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });

  await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: "load" });
  await page.waitForTimeout(2300);

  // native-DPR rendering: render buffer should be CSS × min(DPR, 2)
  const renderSize = await page.evaluate(() => {
    const engine = window.__scene.getEngine();
    return { w: engine.getRenderWidth(), h: engine.getRenderHeight() };
  });
  console.log("render buffer:", renderSize, `(want ~${W * 2}x${H * 2})`);

  await touch("touchStart", [{ x: W / 2, y: H * 0.6 }]); // start game
  await touch("touchEnd", []);
  await page.waitForTimeout(600);
  console.log("joystick visible:", await joystickVisible(page), "(want true)");

  // direct mapping: full up-right deflection → crosshair at anchor + reach·(0.707,-0.707)
  const anchor = { x: W / 2, y: H * 0.42 };
  const expectX = anchor.x + 0.707 * (W / 2 - 18);
  const expectY = anchor.y - 0.707 * (anchor.y - 18);
  await touch("touchStart", [{ x: JOY.x, y: JOY.y }]);
  await touch("touchMove", [{ x: JOY.x + 40, y: JOY.y - 40 }]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/touch-joystick.png` });
  const during = await crosshair(page);
  console.log(`direct map: got (${during.x.toFixed(0)}, ${during.y.toFixed(0)}) want (~${expectX.toFixed(0)}, ~${expectY.toFixed(0)}) |`,
    "match:", Math.abs(during.x - expectX) < 12 && Math.abs(during.y - expectY) < 12);

  // release → crosshair recenters to the anchor
  await touch("touchEnd", []);
  await page.waitForTimeout(400);
  const released = await crosshair(page);
  console.log(`recenter: got (${released.x.toFixed(0)}, ${released.y.toFixed(0)}) want (~${anchor.x}, ~${anchor.y.toFixed(0)}) |`,
    "match:", Math.abs(released.x - anchor.x) < 10 && Math.abs(released.y - anchor.y) < 10);

  // a mouse movement flips back to desktop mode
  await page.mouse.move(W / 2, 300);
  await page.waitForTimeout(200);
  console.log("after mouse move — joystick visible:", await joystickVisible(page), "(want false)");
  console.log("after mouse move — canvas cursor:", await canvasCursor(page), "(want none)");
  await page.close();
}

await browser.close();
console.log("DONE");
