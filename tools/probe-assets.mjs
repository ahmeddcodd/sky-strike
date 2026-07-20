import { chromium } from "playwright";

const port = process.env.GAME_PORT ?? "5173";
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.goto(`http://localhost:${port}/?debug=1`, { waitUntil: "load" });
await page.waitForTimeout(3000);
const result = await page.evaluate(() => {
  const scene = window.__scene;
  const names = ["playerJetModel", "enemyVisual_normal0", "ocean", "horizonCliffs"];
  return names.map((name) => {
    const mesh = scene.getMeshByName(name);
    if (!mesh) return { name, found: false };
    const children = mesh.getChildMeshes(false);
    return {
      name,
      found: true,
      enabled: mesh.isEnabled(),
      rotation: mesh.rotation.asArray(),
      rotationQuaternion: mesh.rotationQuaternion?.asArray() ?? null,
      scaling: mesh.scaling.asArray(),
      children: children.map((child) => ({
        name: child.name,
        rotation: child.rotation.asArray(),
        rotationQuaternion: child.rotationQuaternion?.asArray() ?? null,
        scaling: child.scaling.asArray(),
        min: child.getBoundingInfo().boundingBox.minimum.asArray(),
        max: child.getBoundingInfo().boundingBox.maximum.asArray(),
      })),
    };
  });
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
