import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { EnemyTypeId } from "../data/EnemyData";
import type { AssetId, AssetLibrary } from "../assets/AssetLibrary";
import { makeFlareTexture } from "./MeshUtils";

// Blender-authored enemy fighters (10.5k tris each), nose pointing +Z after
// glTF coordinate conversion. Pool clones share the source vertex buffers.

export interface JetVariant {
  mesh: Mesh;
  navLeft: Vector3;
  navRight: Vector3;
  navTail: Vector3;
}

const ASSET_IDS: Record<EnemyTypeId, AssetId> = {
  normal: "enemy_fighter",
  fast: "enemy_interceptor",
  armored: "enemy_bomber",
};

export function createJetBaseMesh(assets: AssetLibrary, type: EnemyTypeId): JetVariant {
  const span = type === "fast" ? 0.88 : type === "armored" ? 1.14 : 0.96;
  const finHeight = type === "armored" ? 0.95 : 0.8;
  return {
    mesh: assets.source(ASSET_IDS[type]),
    navLeft: new Vector3(-2.55 * span, 0.05, -0.7),
    navRight: new Vector3(2.55 * span, 0.05, -0.7),
    navTail: new Vector3(0, finHeight, -1.85),
  };
}

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
    const flare = makeFlareTexture(scene, `${name}Tex`, hex);
    const mat = new StandardMaterial(name, scene);
    mat.emissiveTexture = flare;
    mat.opacityTexture = flare;
    mat.emissiveColor = Color3.Black();
    mat.diffuseColor = Color3.Black();
    mat.disableLighting = true;
    mat.alphaMode = 1;
    mat.fogEnabled = false;
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
