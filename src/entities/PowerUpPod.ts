import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { POWERUP } from "../game/Constants";
import { makeFlareTexture } from "../factories/MeshUtils";
import { evaluatePath, type FlightPath } from "../systems/FlightPathSystem";
import type { AssetLibrary } from "../assets/AssetLibrary";

// Glowing pickup pod drifting toward the player among the enemies — shoot it
// to collect. Spinning emissive core + ring with a pulsing halo, colored per
// power-up type. Uncollected pods fly past and despawn without penalty.

export type PowerUpType = "heavy" | "missiles" | "ghost";

const POD_HEX: Record<PowerUpType, string> = {
  heavy: "#ff9a3d",
  missiles: "#35c8e8",
  ghost: "#b06aff",
};

interface PodMaterials {
  core: StandardMaterial;
  glow: StandardMaterial;
}

const matCache = new WeakMap<Scene, Record<PowerUpType, PodMaterials>>();

function getPodMaterials(scene: Scene): Record<PowerUpType, PodMaterials> {
  let mats = matCache.get(scene);
  if (mats) return mats;
  const build = (type: PowerUpType): PodMaterials => {
    const hex = POD_HEX[type];
    const c = Color3.FromHexString(hex);
    const core = new StandardMaterial(`podCoreMat_${type}`, scene);
    core.emissiveColor = c;
    core.diffuseColor = c.scale(0.3);
    core.specularColor = Color3.Black();

    const flare = makeFlareTexture(scene, `podFlareTex_${type}`, hex);
    const glow = new StandardMaterial(`podGlowMat_${type}`, scene);
    glow.emissiveTexture = flare;
    glow.opacityTexture = flare;
    glow.emissiveColor = Color3.Black(); // emissiveColor ADDS to the texture — tint lives in the flare
    glow.diffuseColor = Color3.Black();
    glow.disableLighting = true;
    glow.alphaMode = 1; // additive
    glow.fogEnabled = false;
    return { core, glow };
  };
  mats = { heavy: build("heavy"), missiles: build("missiles"), ghost: build("ghost") };
  matCache.set(scene, mats);
  return mats;
}

export class PowerUpPod {
  root: TransformNode;
  hitboxes: Mesh[] = [];
  active = false;
  type: PowerUpType = "heavy";

  private spinner: TransformNode;
  private visuals: Record<PowerUpType, Mesh>;
  private glow: Mesh;
  private mats: Record<PowerUpType, PodMaterials>;
  private path: FlightPath | null = null;
  private progress = 0;
  private speed: number = POWERUP.DRIFT_SPEED;
  private age = 0;
  private tmp = new Vector3();

  constructor(index: number, scene: Scene, assets: AssetLibrary) {
    this.mats = getPodMaterials(scene);
    this.root = new TransformNode(`pod${index}`, scene);
    this.spinner = new TransformNode(`podSpin${index}`, scene);
    this.spinner.parent = this.root;

    this.visuals = {
      heavy: assets.clone("powerup_heavy", `podHeavy${index}`, this.spinner),
      missiles: assets.clone("powerup_missiles", `podMissiles${index}`, this.spinner),
      ghost: assets.clone("powerup_ghost", `podGhost${index}`, this.spinner),
    };
    for (const type of Object.keys(this.visuals) as PowerUpType[]) {
      this.visuals[type].setEnabled(type === "heavy");
    }

    const box = CreateBox(`podHit${index}`, { size: POWERUP.HITBOX }, scene);
    box.parent = this.root;
    box.isVisible = false;
    box.isPickable = false;
    this.hitboxes.push(box);

    // pulsing halo: world-space billboard synced per frame (billboards must not
    // be parented to rotating nodes)
    this.glow = CreatePlane(`podGlow${index}`, { size: 1 }, scene);
    this.glow.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.glow.isPickable = false;
    this.glow.setEnabled(false);

    this.root.setEnabled(false);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  spawn(type: PowerUpType, path: FlightPath, speed: number): void {
    this.type = type;
    this.path = path;
    this.speed = speed;
    this.progress = 0;
    this.age = 0;
    const mats = this.mats[type];
    for (const key of Object.keys(this.visuals) as PowerUpType[]) {
      this.visuals[key].setEnabled(key === type);
    }
    this.glow.material = mats.glow;
    this.root.position.copyFrom(path.p0);
    this.glow.position.copyFrom(path.p0);
    this.root.setEnabled(true);
    this.glow.setEnabled(true);
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
    this.root.setEnabled(false);
    this.glow.setEnabled(false);
  }

  /** Advances the drift. Returns true when the pod has flown past (despawn, no penalty). */
  update(dt: number): boolean {
    const path = this.path!;
    this.age += dt;
    this.progress += (this.speed * dt) / path.length;
    if (this.progress >= 1) return true;

    evaluatePath(path, this.progress, this.tmp);
    this.root.position.copyFrom(this.tmp);
    this.spinner.rotation.y += 1.4 * dt;
    this.spinner.rotation.x = Math.sin(this.age * 1.7) * 0.35;

    this.glow.position.copyFrom(this.tmp);
    const pulse = 2.3 + Math.sin(this.age * 4) * 0.5;
    this.glow.scaling.set(pulse, pulse, pulse);
    return false;
  }
}
