import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { paint } from "./MeshUtils";

// Procedural stylized enemy fighter (~2k tris), nose pointing +Z, ~4.4 units
// long, ~4.2 wingspan. Red/orange accents for hostile readability against the
// player's blue/white jet. Parts get vertex colors, then merge into ONE mesh
// with one shared material — a single draw call per jet. Cloned by the pool.
// Hitboxes in Constants.ts are sized against these proportions (kept ≥ visual).

const BODY = "#c9d2df";
const WING = "#94a4bb";
const ACCENT = "#e0503a";
const ACCENT2 = "#f2802d";
const CANOPY = "#14283f";
const DARK = "#465468";
const NOZZLE = "#ff8a2a";

export function createJetBaseMesh(scene: Scene): Mesh {
  const parts: Mesh[] = [];
  const add = (mesh: Mesh, color: string): Mesh => {
    paint(mesh, color);
    parts.push(mesh);
    return mesh;
  };

  // fuselage — smooth multi-section body, nose pointing +Z
  const radome = add(CreateCylinder("eRadome", { height: 0.45, diameterTop: 0.03, diameterBottom: 0.24, tessellation: 12 }, scene), ACCENT);
  radome.rotation.x = Math.PI / 2;
  radome.position.z = 2.2;

  const nose = add(CreateCylinder("eNose", { height: 1.0, diameterTop: 0.24, diameterBottom: 0.52, tessellation: 12 }, scene), BODY);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.5;

  const fwd = add(CreateCylinder("eFwd", { height: 1.2, diameterTop: 0.52, diameterBottom: 0.58, tessellation: 12 }, scene), BODY);
  fwd.rotation.x = Math.PI / 2;
  fwd.position.z = 0.4;

  const mid = add(CreateCylinder("eMid", { height: 1.6, diameterTop: 0.58, diameterBottom: 0.5, tessellation: 12 }, scene), BODY);
  mid.rotation.x = Math.PI / 2;
  mid.position.z = -1.0;

  const canopy = add(CreateSphere("eCanopy", { diameter: 0.52, segments: 8 }, scene), CANOPY);
  canopy.scaling.set(0.66, 0.5, 1.6);
  canopy.position.set(0, 0.28, 0.65);

  const spine = add(CreateBox("eSpine", { width: 0.3, height: 0.16, depth: 2.0 }, scene), BODY);
  spine.position.set(0, 0.26, -0.75);

  for (const side of [-1, 1]) {
    // air intakes
    const intake = add(CreateBox(`eIntake${side}`, { width: 0.26, height: 0.3, depth: 1.05 }, scene), DARK);
    intake.position.set(side * 0.44, -0.08, 0.25);

    // layered tapered swept wings
    const inner = add(CreateBox(`eWingIn${side}`, { width: 1.4, height: 0.07, depth: 1.35 }, scene), WING);
    inner.position.set(side * 0.9, -0.05, -0.55);
    inner.rotation.y = -side * 0.5;

    const outer = add(CreateBox(`eWingOut${side}`, { width: 1.15, height: 0.055, depth: 0.85 }, scene), WING);
    outer.position.set(side * 1.6, -0.05, -0.9);
    outer.rotation.y = -side * 0.6;

    const tip = add(CreateBox(`eWingTip${side}`, { width: 0.38, height: 0.08, depth: 0.5 }, scene), ACCENT);
    tip.position.set(side * 2.05, -0.05, -1.18);
    tip.rotation.y = -side * 0.6;

    // horizontal stabilizers
    const stab = add(CreateBox(`eStab${side}`, { width: 0.8, height: 0.05, depth: 0.6 }, scene), WING);
    stab.position.set(side * 0.55, 0.0, -1.95);
    stab.rotation.y = -side * 0.5;

    // twin canted tail fins, hostile red
    const fin = add(CreateBox(`eFin${side}`, { width: 0.06, height: 0.75, depth: 0.65 }, scene), ACCENT);
    fin.position.set(side * 0.3, 0.44, -1.8);
    fin.rotation.z = -side * 0.28;
    fin.rotation.x = -0.15;

    // engine nozzles, hot orange interior
    const noz = add(CreateCylinder(`eNoz${side}`, { height: 0.45, diameterTop: 0.36, diameterBottom: 0.28, tessellation: 10 }, scene), NOZZLE);
    noz.rotation.x = Math.PI / 2;
    noz.position.set(side * 0.22, 0, -2.05);
  }

  // recognition stripe behind the canopy
  const stripe = add(CreateBox("eStripe", { width: 0.62, height: 0.14, depth: 0.28 }, scene), ACCENT2);
  stripe.position.set(0, 0.18, -0.2);

  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!merged) throw new Error("jet merge failed");
  merged.name = "jetBase";

  const mat = new StandardMaterial("jetMat", scene);
  mat.diffuseColor = Color3.White(); // multiplied by vertex colors
  mat.specularColor = new Color3(0.35, 0.35, 0.38);
  mat.specularPower = 48;
  mat.emissiveColor = Color3.Black();
  merged.material = mat;
  merged.isPickable = false;
  merged.setEnabled(false); // clone source only, never rendered itself
  return merged;
}
