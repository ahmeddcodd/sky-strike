// Verifies the combat/power-up layer:
//  A. enemy gunfire (wave 2+): red tracer bursts chip the player's hp
//  B. enemy missile (KeyM): warning banner, hit for 35 / interception for +150
//  C. power-up pods (KeyP): shoot to collect, pill shows the active effect,
//     replace policy, ghost translucency on the player jet
//  D. player HP UI: hearts are gone, fixed + on-jet hull bars live
import { chromium } from "playwright";

const PORT = process.env.GAME_PORT ?? "5174";
const SHOTS = process.argv[2] ?? "./verify-shots";
const W = 390, H = 844;

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });

const newRun = async () => {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err));
  await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: "load" });
  await page.waitForTimeout(2300);
  await page.mouse.click(W / 2, H * 0.6); // start
  await page.waitForTimeout(500);
  await page.keyboard.press("Backquote");
  return page;
};

const readHp = async (page) => {
  const text = await page.$eval(".debug-panel", (n) => n.textContent);
  const match = /hp\s+(\d+)\/\d+/.exec(text ?? "");
  return match ? parseInt(match[1], 10) : -1;
};
const pill = (page) => page.$eval(".powerup-pill", (n) => n.textContent);
const warningText = (page) => page.$eval(".warning", (n) => n.textContent);

// aim at the drifting pod (the .pod-label floats ~21px under it) and hold fire
const shootPod = async (page, timeoutMs = 9000) => {
  const start = Date.now();
  await page.mouse.down();
  let collected = false;
  while (Date.now() - start < timeoutMs) {
    const label = await page.$eval(".pod-label", (n) => ({
      shown: n.classList.contains("show"),
      x: parseFloat(n.style.left),
      y: parseFloat(n.style.top),
    })).catch(() => null);
    if (!label || !label.shown) {
      if ((await pill(page)) !== "") { collected = true; break; }
      await page.waitForTimeout(150);
      continue;
    }
    await page.mouse.move(label.x, label.y - 21, { steps: 3 });
    await page.waitForTimeout(180);
    if ((await pill(page)) !== "") { collected = true; break; }
  }
  await page.mouse.up();
  return collected;
};

// ---------- A: enemy gunfire chips hp ----------
console.log("=== A: enemy gunfire (wave 2) ===");
{
  const page = await newRun();
  await page.waitForTimeout(2500); // wave 1 underway
  await page.keyboard.press("KeyW"); // skip to wave 2 (gunfire unlocks)
  await page.waitForTimeout(1500);
  const hp0 = await readHp(page);
  let sawTracerShot = false;
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(2000);
    if (i === 2) {
      await page.keyboard.press("Backquote");
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${SHOTS}/combat-gunfire.png` });
      await page.keyboard.press("Backquote");
      sawTracerShot = true;
    }
  }
  const hp1 = await readHp(page);
  console.log(`hp ${hp0} -> ${hp1} over ~12s of not defending (want a decrease)`);
  console.log("hp decreased:", hp1 < hp0, "| screenshot:", sawTracerShot);
  await page.close();
}

// ---------- B1: missile hits for heavy damage ----------
console.log("=== B1: enemy missile hit ===");
{
  const page = await newRun();
  await page.keyboard.press("KeyC"); // clear wave-1 jets — isolate the missile
  await page.keyboard.press("KeyM"); // armored jet + forced launch
  let warned = false;
  for (let i = 0; i < 40 && !warned; i++) {
    await page.waitForTimeout(200);
    warned = (await warningText(page)) === "MISSILE!";
  }
  console.log("MISSILE! warning shown:", warned);
  await page.keyboard.press("Backquote");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/combat-missile.png` });
  await page.keyboard.press("Backquote");
  // watch for a single big hp drop (missile = 35; slip-past is only 15)
  let prev = await readHp(page), bigDrop = 0;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const hp = await readHp(page);
    if (prev - hp > bigDrop) bigDrop = prev - hp;
    prev = hp;
    if (bigDrop >= 30) break;
  }
  console.log("largest single hp drop:", bigDrop, "(want >= 30 — the missile connected)");
  await page.close();
}

// ---------- B2: missile interception ----------
console.log("=== B2: missile interception ===");
{
  const page = await newRun();
  await page.keyboard.press("KeyC");
  await page.keyboard.press("KeyM");
  let warned = false;
  for (let i = 0; i < 40 && !warned; i++) {
    await page.waitForTimeout(200);
    warned = (await warningText(page)) === "MISSILE!";
  }
  // the missile homes on the player jet — park the crosshair there and hold fire
  await page.mouse.move(W / 2, H * 0.6, { steps: 4 });
  await page.mouse.down();
  let intercepted = false;
  for (let i = 0; i < 80 && !intercepted; i++) {
    await page.waitForTimeout(120);
    const popups = await page.$$eval(".popup", (els) => els.map((e) => e.textContent).join("|"));
    intercepted = popups.includes("INTERCEPTED");
  }
  await page.mouse.up();
  console.log("INTERCEPTED popup:", intercepted);
  await page.close();
}

// ---------- C: pods (heavy -> missiles -> ghost) + D: hp UI ----------
console.log("=== C: power-up pods + D: hp UI ===");
{
  const page = await newRun();
  await page.keyboard.press("KeyI"); // stay alive while farming pods

  // D assertions up front
  const hearts = await page.$$eval(".heart", (els) => els.length).catch(() => 0);
  const playerBar = await page.$eval(".hpbar.player", (n) => n.style.display);
  const fixedBar = await page.$(".hpbar.fixed");
  console.log("hearts in DOM:", hearts, "(want 0) | on-jet bar display:", JSON.stringify(playerBar), "(want block) | fixed bar exists:", fixedBar !== null);

  // heavy
  await page.keyboard.press("KeyC");
  await page.keyboard.press("KeyP");
  await page.waitForTimeout(600);
  await page.keyboard.press("Backquote");
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/combat-pod.png` });
  await page.keyboard.press("Backquote");
  let ok = await shootPod(page);
  console.log("heavy collected:", ok, "| pill:", JSON.stringify(await pill(page)));

  // missiles (replaces heavy)
  await page.keyboard.press("KeyC");
  await page.keyboard.press("KeyP");
  await page.waitForTimeout(600);
  ok = await shootPod(page);
  console.log("missiles collected:", ok, "| pill:", JSON.stringify(await pill(page)));

  // ghost (replaces missiles) + translucency via the live scene
  await page.keyboard.press("KeyC");
  await page.keyboard.press("KeyP");
  await page.waitForTimeout(600);
  ok = await shootPod(page);
  await page.waitForTimeout(600); // ghost ramps in over 0.3s
  const jetVisibility = await page.evaluate(() => window.__scene?.getMeshByName("playerJetBody")?.visibility ?? -1);
  console.log("ghost collected:", ok, "| pill:", JSON.stringify(await pill(page)), "| jet visibility:", jetVisibility, "(want < 1)");
  await page.keyboard.press("Backquote");
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/combat-ghost.png` });

  await page.close();
}

await browser.close();
console.log("DONE");
