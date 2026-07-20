import type { Scene } from "@babylonjs/core/scene";
import type { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { PLAYER_JET, POWERUP } from "../game/Constants";
import { getNavMaterials } from "../factories/JetFactory";
import type { VFXSystem } from "../systems/VFXSystem";
import type { AssetLibrary } from "../assets/AssetLibrary";

// Chase-camera player fighter. The authored Blender model supplies the polished
// airframe; gameplay-driven bank, drift, recoil, exhaust and nav-light motion
// stay deterministic in code so aim/hit logic remains unchanged.

export class PlayerJet {
  private root: TransformNode;
  private muzzleL: TransformNode;
  private muzzleR: TransformNode;
  private tipL: TransformNode;
  private tipR: TransformNode;
  private flames: Mesh[] = [];
  private navLights: Mesh[] = [];
  private navAnchors: TransformNode[] = [];
  private muzzleWorld = new Vector3();
  private tmp = new Vector3();
  private vfx: VFXSystem;
  private bank = 0;
  private driftX = 0;
  private driftY = 0;
  private kickAmount = 0;
  private time = 0;
  private trailTimer = 0;
  private ghost = 0;
  private ghostMeshes: AbstractMesh[] = [];

  constructor(scene: Scene, camera: TargetCamera, vfx: VFXSystem, assets: AssetLibrary) {
    this.vfx = vfx;
    this.root = new TransformNode("playerJet", scene);
    this.root.parent = camera;
    this.root.position.set(0, PLAYER_JET.Y, PLAYER_JET.Z);
    this.root.scaling.setAll(PLAYER_JET.SCALE);

    const model = assets.clone("player_fighter", "playerJetModel", this.root);
    model.isPickable = false;
    model.rotationQuaternion = null;
    model.rotation.y = 0;
    const modelMeshes = model.getChildMeshes(false);
    if (modelMeshes[0]) modelMeshes[0].name = "playerJetBody";
    this.buildAfterburners(scene);

    this.muzzleL = this.node(scene, "muzzleL", -0.92, -0.1, 0.95);
    this.muzzleR = this.node(scene, "muzzleR", 0.92, -0.1, 0.95);
    this.tipL = this.node(scene, "tipL", -2.55, 0.02, -0.7);
    this.tipR = this.node(scene, "tipR", 2.55, 0.02, -0.7);

    const nav = getNavMaterials(scene);
    const anchors: [number, number, number][] = [[-2.55, 0.05, -0.7], [2.55, 0.05, -0.7], [0, 0.9, -1.9]];
    const mats = [nav.red, nav.green, nav.white];
    for (let i = 0; i < 3; i++) {
      this.navAnchors.push(this.node(scene, `playerNavAnchor${i}`, ...anchors[i]));
      const light = CreatePlane(`playerNav${i}`, { size: 0.4 }, scene);
      light.material = mats[i];
      light.billboardMode = Mesh.BILLBOARDMODE_ALL;
      light.isPickable = false;
      light.visibility = 0;
      this.navLights.push(light);
    }
    this.ghostMeshes = this.root.getChildMeshes();
  }

  getWorldPosition(out: Vector3): Vector3 {
    this.root.computeWorldMatrix(true);
    out.copyFrom(this.root.getAbsolutePosition());
    return out;
  }

  setGhost(fraction: number): void {
    this.ghost = fraction;
    const vis = 1 - POWERUP.GHOST_ALPHA_DROP * fraction;
    for (const mesh of this.ghostMeshes) mesh.visibility = vis;
  }

  private node(scene: Scene, name: string, x: number, y: number, z: number): TransformNode {
    const n = new TransformNode(name, scene);
    n.parent = this.root;
    n.position.set(x, y, z);
    return n;
  }

  private buildAfterburners(scene: Scene): void {
    const outerMat = new StandardMaterial("flameOuterMat", scene);
    outerMat.emissiveColor = new Color3(1, 0.55, 0.16);
    outerMat.diffuseColor = Color3.Black();
    outerMat.disableLighting = true;
    outerMat.alpha = 0.75;
    outerMat.alphaMode = 1;

    const innerMat = new StandardMaterial("flameInnerMat", scene);
    innerMat.emissiveColor = new Color3(1, 0.88, 0.55);
    innerMat.diffuseColor = Color3.Black();
    innerMat.disableLighting = true;
    innerMat.alpha = 0.9;
    innerMat.alphaMode = 1;

    const glowMat = new StandardMaterial("nozzleGlowMat", scene);
    glowMat.emissiveColor = new Color3(1, 0.8, 0.45);
    glowMat.diffuseColor = Color3.Black();
    glowMat.disableLighting = true;
    glowMat.backFaceCulling = false;
    glowMat.alpha = 0.95;
    glowMat.alphaMode = 1;

    for (const side of [-1, 1]) {
      const outer = CreateCylinder(`flameOut${side}`, { height: 1.1, diameterTop: 0.04, diameterBottom: 0.3, tessellation: 10 }, scene);
      outer.rotation.x = -Math.PI / 2;
      outer.position.set(side * 0.25, 0, -2.92);
      outer.material = outerMat;
      outer.isPickable = false;
      outer.parent = this.root;
      this.flames.push(outer);

      const inner = CreateCylinder(`flameIn${side}`, { height: 0.65, diameterTop: 0.02, diameterBottom: 0.18, tessellation: 10 }, scene);
      inner.rotation.x = -Math.PI / 2;
      inner.position.set(side * 0.25, 0, -2.72);
      inner.material = innerMat;
      inner.isPickable = false;
      inner.parent = this.root;
      this.flames.push(inner);

      const glow = CreateDisc(`nozzleGlow${side}`, { radius: 0.17, tessellation: 16 }, scene);
      glow.position.set(side * 0.25, 0, -2.60);
      glow.material = glowMat;
      glow.isPickable = false;
      glow.parent = this.root;
    }
  }

  kick(): void {
    this.kickAmount = Math.min(this.kickAmount + PLAYER_JET.KICK, 0.05);
  }

  getMuzzleWorld(side: number): Vector3 {
    const node = side < 0 ? this.muzzleL : this.muzzleR;
    this.muzzleWorld.copyFrom(node.getAbsolutePosition());
    return this.muzzleWorld;
  }

  update(dt: number, ndcX: number, ndcY: number, nightFactor: number): void {
    this.time += dt;
    const navVis = (0.1 + 0.9 * nightFactor) * (1 - 0.85 * this.ghost);
    this.navLights[0].visibility = navVis;
    this.navLights[1].visibility = navVis;
    this.navLights[2].visibility = navVis * (Math.sin(this.time * 6.5) > 0.55 ? 1 : 0.08);
    this.kickAmount = Math.max(0, this.kickAmount - PLAYER_JET.KICK_DECAY * this.kickAmount * dt);

    const bankTarget = -ndcX * PLAYER_JET.MAX_BANK;
    this.bank += (bankTarget - this.bank) * Math.min(1, PLAYER_JET.BANK_SMOOTHING * dt);
    const pitch = ndcY * PLAYER_JET.PITCH_FACTOR - this.kickAmount;
    this.root.rotation.set(pitch, 0, this.bank);

    const k = Math.min(1, PLAYER_JET.DRIFT_SMOOTHING * dt);
    this.driftX += (ndcX * PLAYER_JET.DRIFT_X - this.driftX) * k;
    this.driftY += (-ndcY * PLAYER_JET.DRIFT_Y - this.driftY) * k;
    this.root.position.set(
      this.driftX,
      PLAYER_JET.Y + this.driftY + Math.sin(this.time * PLAYER_JET.BOB_FREQ) * PLAYER_JET.BOB_AMP,
      PLAYER_JET.Z,
    );

    for (const flame of this.flames) flame.scaling.y = 0.8 + Math.random() * 0.45;

    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.045;
      this.tmp.copyFrom(this.tipL.getAbsolutePosition());
      this.vfx.wingTrail(this.tmp);
      this.tmp.copyFrom(this.tipR.getAbsolutePosition());
      this.vfx.wingTrail(this.tmp);
    }
    for (let i = 0; i < 3; i++) {
      this.navAnchors[i].computeWorldMatrix(true);
      this.navLights[i].position.copyFrom(this.navAnchors[i].getAbsolutePosition());
    }
  }
}
