// Temporary: interrogate the live scene about the ocean mesh.
import { chromium } from "playwright";
const SHOTS = process.argv[2] ?? "./verify-shots";
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.goto("http://localhost:5174/?debug=1", { waitUntil: "load" });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const scene = window.__scene;
  const ocean = scene.getMeshByName("ocean");
  if (!ocean) return { found: false, meshes: scene.meshes.map((m) => m.name).slice(0, 40) };
  const mat = ocean.material;
  const tex = mat.diffuseTexture;
  return {
    found: true,
    enabled: ocean.isEnabled(),
    visible: ocean.isVisible,
    position: ocean.position.asArray(),
    isReady: ocean.isReady(),
    activeInFrustum: scene.activeCamera.isInFrustum(ocean),
    matName: mat?.name,
    diffuseColor: mat?.diffuseColor?.asArray(),
    hasTexture: !!tex,
    texReady: tex ? tex.isReady() : null,
    texSize: tex ? tex.getSize() : null,
    uScale: tex?.uScale,
    vScale: tex?.vScale,
    wrapU: tex?.wrapU,
    wrapV: tex?.wrapV,
  };
});
console.log(JSON.stringify(info, null, 2));

// paint it neon to locate it on screen
await page.evaluate(() => {
  const scene = window.__scene;
  const ocean = scene.getMeshByName("ocean");
  if (ocean?.material) {
    ocean.material.emissiveColor.set(1, 0, 0.6);
  }
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/probe-neon-ocean.png` });
await browser.close();
console.log("DONE");
