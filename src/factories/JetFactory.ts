import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import type { EnemyTypeId } from "../data/EnemyData";
import { paint, makeFlareTexture } from "./MeshUtils";

// Procedural stylized enemy fighters (~2k tris each), nose pointing +Z.
// Three variants with distinct silhouettes and palettes (spec §15); parts get
// vertex colors and merge into ONE mesh — a single draw call per jet.

export interface JetVariant {
  mesh: Mesh;
  /** local-space anchors for the red/green/white navigation lights */
  navLeft: Vector3;
  navRight: Vector3;
  navTail: Vector3;
}

interface VariantSpec {
  girth: number; // fuselage diameter multiplier
  span: number; // wing span multiplier
  noseLen: number;
  finHeight: number;
  plates: boolean; // armored hull plates
  body: string;
  wing: string;
  accent: string;
  canopy: string;
  dark: string;
  nozzle: string;
}

const VARIANTS: Record<EnemyTypeId, VariantSpec> = {
  normal: {
    girth: 1, span: 1, noseLen: 1.0, finHeight: 0.75, plates: false,
    body: "#c9d2df", wing: "#94a4bb", accent: "#e0503a", canopy: "#14283f", dark: "#465468", nozzle: "#ff8a2a",
  },
  fast: {
    girth: 0.78, span: 0.85, noseLen: 1.45, finHeight: 0.6, plates: false,
    body: "#ddd3c6", wing: "#c9703f", accent: "#ff9a3d", canopy: "#301d12", dark: "#6b5340", nozzle: "#ffb04a",
  },
  armored: {
    girth: 1.4, span: 1.15, noseLen: 0.85, finHeight: 0.9, plates: true,
    body: "#6d7683", wing: "#525c6b", accent: "#8f2f24", canopy: "#0c161f", dark: "#39424f", nozzle: "#ff7a24",
  },
};

export function createJetBaseMesh(scene: Scene, type: EnemyTypeId): JetVariant {
  const v = VARIANTS[type];
  const parts: Mesh[] = [];
  const add = (mesh: Mesh, color: string): Mesh => {
    paint(mesh, color);
    parts.push(mesh);
    return mesh;
  };
  const g = v.girth;
  const s = v.span;

  // fuselage — smooth multi-section body, nose pointing +Z
  const radome = add(CreateCylinder(`${type}Radome`, { height: 0.45 * v.noseLen, diameterTop: 0.03, diameterBottom: 0.24 * g, tessellation: 12 }, scene), v.accent);
  radome.rotation.x = Math.PI / 2;
  radome.position.z = 2.0 + 0.45 * v.noseLen * 0.5;

  const nose = add(CreateCylinder(`${type}Nose`, { height: 1.0, diameterTop: 0.24 * g, diameterBottom: 0.52 * g, tessellation: 12 }, scene), v.body);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.5;

  const fwd = add(CreateCylinder(`${type}Fwd`, { height: 1.2, diameterTop: 0.52 * g, diameterBottom: 0.58 * g, tessellation: 12 }, scene), v.body);
  fwd.rotation.x = Math.PI / 2;
  fwd.position.z = 0.4;

  const mid = add(CreateCylinder(`${type}Mid`, { height: 1.6, diameterTop: 0.58 * g, diameterBottom: 0.5 * g, tessellation: 12 }, scene), v.body);
  mid.rotation.x = Math.PI / 2;
  mid.position.z = -1.0;

  const canopy = add(CreateSphere(`${type}Canopy`, { diameter: 0.52, segments: 8 }, scene), v.canopy);
  canopy.scaling.set(0.66 * g, 0.5, 1.6);
  canopy.position.set(0, 0.28 * g, 0.65);

  const spine = add(CreateBox(`${type}Spine`, { width: 0.3 * g, height: 0.16, depth: 2.0 }, scene), v.body);
  spine.position.set(0, 0.26 * g, -0.75);

  if (v.plates) {
    // armored hull plating — chunky slabs along the fuselage and wing roots
    const topPlate = add(CreateBox(`${type}PlateTop`, { width: 0.66, height: 0.1, depth: 1.7 }, scene), v.dark);
    topPlate.position.set(0, 0.38, -0.2);
    for (const side of [-1, 1]) {
      const sidePlate = add(CreateBox(`${type}PlateSide${side}`, { width: 0.12, height: 0.42, depth: 1.9 }, scene), v.dark);
      sidePlate.position.set(side * 0.45, 0.02, -0.3);
      const wingPlate = add(CreateBox(`${type}PlateWing${side}`, { width: 0.85, height: 0.12, depth: 0.8 }, scene), v.dark);
      wingPlate.position.set(side * 0.95, 0.03, -0.55);
      wingPlate.rotation.y = -side * 0.5;
    }
  }

  for (const side of [-1, 1]) {
    const intake = add(CreateBox(`${type}Intake${side}`, { width: 0.26 * g, height: 0.3 * g, depth: 1.05 }, scene), v.dark);
    intake.position.set(side * 0.44 * g, -0.08, 0.25);

    // layered tapered swept wings
    const inner = add(CreateBox(`${type}WingIn${side}`, { width: 1.4 * s, height: v.plates ? 0.11 : 0.07, depth: 1.35 }, scene), v.wing);
    inner.position.set(side * 0.9 * s, -0.05, -0.55);
    inner.rotation.y = -side * 0.5;

    const outer = add(CreateBox(`${type}WingOut${side}`, { width: 1.15 * s, height: v.plates ? 0.09 : 0.055, depth: 0.85 }, scene), v.wing);
    outer.position.set(side * 1.6 * s, -0.05, -0.9);
    outer.rotation.y = -side * 0.6;

    const tip = add(CreateBox(`${type}WingTip${side}`, { width: 0.38, height: 0.08, depth: 0.5 }, scene), v.accent);
    tip.position.set(side * 2.05 * s, -0.05, -1.18);
    tip.rotation.y = -side * 0.6;

    const stab = add(CreateBox(`${type}Stab${side}`, { width: 0.8 * s, height: 0.05, depth: 0.6 }, scene), v.wing);
    stab.position.set(side * 0.55 * s, 0.0, -1.95);
    stab.rotation.y = -side * 0.5;

    const fin = add(CreateBox(`${type}Fin${side}`, { width: 0.06, height: v.finHeight, depth: 0.65 }, scene), v.accent);
    fin.position.set(side * 0.3 * g, 0.3 + v.finHeight * 0.35, -1.8);
    fin.rotation.z = -side * 0.28;
    fin.rotation.x = -0.15;

    const noz = add(CreateCylinder(`${type}Noz${side}`, { height: 0.45, diameterTop: 0.36 * g, diameterBottom: 0.28 * g, tessellation: 10 }, scene), v.nozzle);
    noz.rotation.x = Math.PI / 2;
    noz.position.set(side * 0.22 * g, 0, -2.05);
  }

  // recognition stripe behind the canopy
  const stripe = add(CreateBox(`${type}Stripe`, { width: 0.62 * g, height: 0.14, depth: 0.28 }, scene), v.accent);
  stripe.position.set(0, 0.18 * g, -0.2);

  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!merged) throw new Error("jet merge failed");
  merged.name = `jetBase_${type}`;

  const mat = new StandardMaterial(`jetMat_${type}`, scene);
  mat.diffuseColor = Color3.White(); // multiplied by vertex colors
  mat.specularColor = new Color3(0.35, 0.35, 0.38);
  mat.specularPower = 48;
  mat.emissiveColor = Color3.Black();
  merged.material = mat;
  merged.isPickable = false;
  merged.setEnabled(false); // clone source only, never rendered itself

  return {
    mesh: merged,
    navLeft: new Vector3(-2.05 * s, -0.05, -1.18),
    navRight: new Vector3(2.05 * s, -0.05, -1.18),
    navTail: new Vector3(0, 0.3 + v.finHeight * 0.7, -1.85),
  };
}

// ---------- navigation-light materials (shared per scene) ----------

export interface NavMaterials {
  red: StandardMaterial;
  green: StandardMaterial;
  white: StandardMaterial;
}

const navCache = new WeakMap<Scene, NavMaterials>();

export function getNavMaterials(scene: Scene): NavMaterials {
  const cached = navCache.get(scene);
  if (cached) return cached;

  const make = (name: string, hex: string): StandardMaterial => {
    const flare = makeFlareTexture(scene, `${name}Tex`, hex); // tinted in the texture (see MeshUtils note)
    const mat = new StandardMaterial(name, scene);
    mat.emissiveTexture = flare;
    mat.opacityTexture = flare;
    mat.emissiveColor = Color3.Black();
    mat.diffuseColor = Color3.Black();
    mat.disableLighting = true;
    mat.alphaMode = 1; // additive
    mat.fogEnabled = false; // real aircraft lights punch through haze — also a gameplay aid
    return mat;
  };
  const mats: NavMaterials = {
    red: make("navRedMat", "#ff2a1e"),
    green: make("navGreenMat", "#2aff5e"),
    white: make("navWhiteMat", "#ffffff"),
  };
  navCache.set(scene, mats);
  return mats;
}
