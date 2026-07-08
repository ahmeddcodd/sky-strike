import type { Scene } from "@babylonjs/core/scene";
import type { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { PLAYER_JET } from "../game/Constants";
import { paint } from "../factories/MeshUtils";
import type { VFXSystem } from "../systems/VFXSystem";

// The player's fighter, seen from behind (chase cam). Purely cosmetic: banking,
// drift, recoil and afterburners react to input, but hits still come from the
// crosshair raycast. Parented to the camera so screen shake carries it.

const BODY = "#dfe6f0";
const STEEL = "#7f95b5";
const ACCENT = "#35c8e8";
const DARK = "#33404f";
const NOZZLE = "#2a3340";
const MISSILE = "#eef2f7";

export class PlayerJet {
  private root: TransformNode;
  private muzzleL: TransformNode;
  private muzzleR: TransformNode;
  private tipL: TransformNode;
  private tipR: TransformNode;
  private flames: Mesh[] = [];
  private muzzleWorld = new Vector3();
  private tmp = new Vector3();

  private vfx: VFXSystem;
  private bank = 0;
  private driftX = 0;
  private driftY = 0;
  private kickAmount = 0;
  private time = 0;
  private trailTimer = 0;

  constructor(scene: Scene, camera: TargetCamera, vfx: VFXSystem) {
    this.vfx = vfx;
    this.root = new TransformNode("playerJet", scene);
    this.root.parent = camera;
    this.root.position.set(0, PLAYER_JET.Y, PLAYER_JET.Z);
    this.root.scaling.setAll(PLAYER_JET.SCALE);

    this.buildBody(scene);
    this.buildCanopy(scene);
    this.buildAfterburners(scene);

    this.muzzleL = this.node(scene, "muzzleL", -1.05, -0.05, 1.0);
    this.muzzleR = this.node(scene, "muzzleR", 1.05, -0.05, 1.0);
    this.tipL = this.node(scene, "tipL", -2.3, -0.05, -0.95);
    this.tipR = this.node(scene, "tipR", 2.3, -0.05, -0.95);
  }

  private node(scene: Scene, name: string, x: number, y: number, z: number): TransformNode {
    const n = new TransformNode(name, scene);
    n.parent = this.root;
    n.position.set(x, y, z);
    return n;
  }

  private buildBody(scene: Scene): void {
    const parts: Mesh[] = [];
    const add = (mesh: Mesh, color: string): Mesh => {
      paint(mesh, color);
      parts.push(mesh);
      return mesh;
    };

    // fuselage — several smooth sections, nose pointing +Z
    const radome = add(CreateCylinder("pRadome", { height: 0.5, diameterTop: 0.03, diameterBottom: 0.28, tessellation: 14 }, scene), DARK);
    radome.rotation.x = Math.PI / 2;
    radome.position.z = 2.55;

    const nose = add(CreateCylinder("pNose", { height: 1.1, diameterTop: 0.28, diameterBottom: 0.55, tessellation: 14 }, scene), BODY);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 1.75;

    const fwd = add(CreateCylinder("pFwd", { height: 1.3, diameterTop: 0.55, diameterBottom: 0.62, tessellation: 14 }, scene), BODY);
    fwd.rotation.x = Math.PI / 2;
    fwd.position.z = 0.55;

    const mid = add(CreateCylinder("pMid", { height: 1.7, diameterTop: 0.62, diameterBottom: 0.55, tessellation: 14 }, scene), BODY);
    mid.rotation.x = Math.PI / 2;
    mid.position.z = -0.95;

    const tail = add(CreateCylinder("pTail", { height: 0.6, diameterTop: 0.55, diameterBottom: 0.46, tessellation: 14 }, scene), STEEL);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -2.1;

    const spine = add(CreateBox("pSpine", { width: 0.34, height: 0.18, depth: 2.2 }, scene), BODY);
    spine.position.set(0, 0.3, -0.7);

    // air intakes
    for (const side of [-1, 1]) {
      const intake = add(CreateBox(`pIntake${side}`, { width: 0.3, height: 0.34, depth: 1.2 }, scene), STEEL);
      intake.position.set(side * 0.48, -0.08, 0.35);
    }

    // layered tapered swept wings + wingtip missiles
    for (const side of [-1, 1]) {
      const inner = add(CreateBox(`pWingIn${side}`, { width: 1.5, height: 0.07, depth: 1.5 }, scene), STEEL);
      inner.position.set(side * 0.95, -0.05, -0.5);
      inner.rotation.y = -side * 0.5;

      const outer = add(CreateBox(`pWingOut${side}`, { width: 1.3, height: 0.055, depth: 0.95 }, scene), STEEL);
      outer.position.set(side * 1.75, -0.05, -0.85);
      outer.rotation.y = -side * 0.6;

      const tip = add(CreateBox(`pWingTip${side}`, { width: 0.4, height: 0.08, depth: 0.55 }, scene), ACCENT);
      tip.position.set(side * 2.25, -0.05, -1.15);
      tip.rotation.y = -side * 0.6;

      const missile = add(CreateCylinder(`pMissile${side}`, { height: 0.95, diameter: 0.11, tessellation: 8 }, scene), MISSILE);
      missile.rotation.x = Math.PI / 2;
      missile.position.set(side * 2.3, -0.12, -0.9);

      const stab = add(CreateBox(`pStab${side}`, { width: 0.9, height: 0.05, depth: 0.7 }, scene), STEEL);
      stab.position.set(side * 0.6, 0.02, -2.15);
      stab.rotation.y = -side * 0.5;

      const fin = add(CreateBox(`pFin${side}`, { width: 0.06, height: 0.85, depth: 0.7 }, scene), ACCENT);
      fin.position.set(side * 0.32, 0.5, -2.0);
      fin.rotation.z = -side * 0.26; // canted outward
      fin.rotation.x = -0.15;

      const noz = add(CreateCylinder(`pNoz${side}`, { height: 0.5, diameterTop: 0.42, diameterBottom: 0.34, tessellation: 12 }, scene), NOZZLE);
      noz.rotation.x = Math.PI / 2;
      noz.position.set(side * 0.24, 0, -2.55);
    }

    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    merged.name = "playerJetBody";
    const mat = new StandardMaterial("playerJetMat", scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = new Color3(0.4, 0.42, 0.46);
    mat.specularPower = 64;
    merged.material = mat;
    merged.isPickable = false;
    merged.parent = this.root;
  }

  private buildCanopy(scene: Scene): void {
    // separate mesh so the glass gets its own high-gloss material
    const canopy = CreateSphere("pCanopy", { diameter: 0.6, segments: 10 }, scene);
    canopy.scaling.set(0.62, 0.5, 1.7);
    canopy.position.set(0, 0.34, 0.9);
    const glass = new StandardMaterial("pCanopyMat", scene);
    glass.diffuseColor = new Color3(0.05, 0.16, 0.29);
    glass.specularColor = new Color3(0.9, 0.95, 1);
    glass.specularPower = 128;
    glass.emissiveColor = new Color3(0.03, 0.09, 0.16);
    canopy.material = glass;
    canopy.isPickable = false;
    canopy.parent = this.root;
  }

  private buildAfterburners(scene: Scene): void {
    const outerMat = new StandardMaterial("flameOuterMat", scene);
    outerMat.emissiveColor = new Color3(1, 0.55, 0.16);
    outerMat.diffuseColor = Color3.Black();
    outerMat.disableLighting = true;
    outerMat.alpha = 0.75;
    outerMat.alphaMode = 1; // additive

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
      // cones taper away from the nozzle (-Z); local Y is the length axis for flicker
      const outer = CreateCylinder(`flameOut${side}`, { height: 1.1, diameterTop: 0.04, diameterBottom: 0.3, tessellation: 8 }, scene);
      outer.rotation.x = -Math.PI / 2;
      outer.position.set(side * 0.24, 0, -3.15);
      outer.material = outerMat;
      outer.isPickable = false;
      outer.parent = this.root;
      this.flames.push(outer);

      const inner = CreateCylinder(`flameIn${side}`, { height: 0.65, diameterTop: 0.02, diameterBottom: 0.18, tessellation: 8 }, scene);
      inner.rotation.x = -Math.PI / 2;
      inner.position.set(side * 0.24, 0, -2.95);
      inner.material = innerMat;
      inner.isPickable = false;
      inner.parent = this.root;
      this.flames.push(inner);

      const glow = CreateDisc(`nozzleGlow${side}`, { radius: 0.17, tessellation: 12 }, scene);
      glow.position.set(side * 0.24, 0, -2.82);
      glow.material = glowMat;
      glow.isPickable = false;
      glow.parent = this.root;
    }
  }

  kick(): void {
    this.kickAmount = Math.min(this.kickAmount + PLAYER_JET.KICK, 0.05);
  }

  /** World position of the firing wing-root gun. side = -1 (left) or 1 (right). */
  getMuzzleWorld(side: number): Vector3 {
    const node = side < 0 ? this.muzzleL : this.muzzleR;
    this.muzzleWorld.copyFrom(node.getAbsolutePosition());
    return this.muzzleWorld;
  }

  /** ndcX/ndcY: crosshair position in [-1, 1] (y positive = down, screen convention). */
  update(dt: number, ndcX: number, ndcY: number): void {
    this.time += dt;
    this.kickAmount = Math.max(0, this.kickAmount - PLAYER_JET.KICK_DECAY * this.kickAmount * dt);

    // banking toward the crosshair, smoothed
    const bankTarget = -ndcX * PLAYER_JET.MAX_BANK;
    this.bank += (bankTarget - this.bank) * Math.min(1, PLAYER_JET.BANK_SMOOTHING * dt);

    const pitch = ndcY * PLAYER_JET.PITCH_FACTOR - this.kickAmount;
    this.root.rotation.set(pitch, 0, this.bank);

    // lagging positional drift + idle bob
    const k = Math.min(1, PLAYER_JET.DRIFT_SMOOTHING * dt);
    this.driftX += (ndcX * PLAYER_JET.DRIFT_X - this.driftX) * k;
    this.driftY += (-ndcY * PLAYER_JET.DRIFT_Y - this.driftY) * k;
    this.root.position.set(
      this.driftX,
      PLAYER_JET.Y + this.driftY + Math.sin(this.time * PLAYER_JET.BOB_FREQ) * PLAYER_JET.BOB_AMP,
      PLAYER_JET.Z,
    );

    // afterburner flicker (length axis is local Y, set before the X-rotation)
    for (const flame of this.flames) {
      flame.scaling.y = 0.8 + Math.random() * 0.45;
    }

    // wingtip contrails
    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.045;
      this.tmp.copyFrom(this.tipL.getAbsolutePosition());
      this.vfx.wingTrail(this.tmp);
      this.tmp.copyFrom(this.tipR.getAbsolutePosition());
      this.vfx.wingTrail(this.tmp);
    }
  }
}
