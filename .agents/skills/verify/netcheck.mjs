// Certification check: the ONLY external (non-app-origin) request a Playable may
// make is the youtube.com SDK script. Drive a full session and log every request
// whose host is not localhost — any hit other than youtube.com fails Playables.
import { chromium } from "playwright";

const PORT = process.env.GAME_PORT ?? "4188";
const W = 390, H = 844;
const origin = `localhost:${PORT}`;

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });

const external = new Set();
page.on("request", (req) => {
  const url = req.url();
  if (url.startsWith("data:") || url.startsWith("blob:")) return;
  if (url.includes(origin)) return;
  external.add(new URL(url).host + " (" + req.resourceType() + ")");
});

await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.mouse.click(W / 2, H * 0.6); // start
await page.waitForTimeout(500);
await page.keyboard.press("Backquote");
await page.keyboard.press("KeyI"); // invincible
// exercise the full feature surface so any lazy asset load would fire
for (const k of ["KeyJ", "KeyJ", "KeyW", "KeyP", "KeyM", "KeyN"]) { await page.keyboard.press(k); await page.waitForTimeout(400); }
await page.mouse.move(W / 2, H * 0.4);
await page.mouse.down();
for (const [x, y] of [[W/2-60,H*0.35],[W/2+60,H*0.4],[W/2,H*0.3]]) { await page.mouse.move(x, y, { steps: 5 }); await page.waitForTimeout(700); }
await page.mouse.up();
await page.waitForTimeout(1500);

console.log("=== external (non-localhost) requests during full session ===");
const hosts = [...external].sort();
if (hosts.length === 0) console.log("(none)");
for (const h of hosts) console.log(" -", h);
const onlyYouTube = hosts.every((h) => h.startsWith("www.youtube.com") || h.startsWith("youtube.com"));
console.log("PASS (only youtube.com or nothing):", onlyYouTube);

await browser.close();
console.log("DONE");
