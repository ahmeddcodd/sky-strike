import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { ENEMY, WORLD } from "../game/Constants";
import type { EnemyTypeDef } from "../data/EnemyData";
import { getNavMaterials, type JetVariant } from "../factories/JetFactory";
import { evaluatePath, pathTangent, type FlightPath } from "../systems/FlightPathSystem";
import type { VFXSystem } from "../systems/VFXSystem";

// Pooled enemy. The root node carries flight position/orientation (and the
// hitboxes with it); the visual child carries banking roll and hit-shake so
// cosmetic motion never distorts the hitboxes (spec §16). The deterministic
// weave offsets the ROOT, so hitboxes always follow.

export class EnemyJet {
  root: TransformNode;
  visual: Mesh;
  hitboxes: Mesh[] = [];
  def: EnemyTypeDef;
  active = false;
  health: number;

  private mat: StandardMaterial;
  private vfx: VFXSystem;
  private path: FlightPath | null = null;
  private progress = 0;
  private speed: number = ENEMY.BASE_SPEED;
  private age = 0;
  private weavePhase = 0;
  private bank = 0;
  private flashTimer = 0;
  private trailTimer = 0;
  private smokeTimer = 0;
  private navLights: Mesh[] = []; // [red, green, white-strobe] — world-space, synced to anchors
  private navAnchors: TransformNode[] = [];
  private dir = new Vector3(0, 0, -1);
  private tmp = new Vector3();
  private tmp2 = new Vector3();

  constructor(index: number, scene: Scene, variant: JetVariant, def: EnemyTypeDef, vfx: VFXSystem) {
    this.vfx = vfx;
    this.def = def;
    this.health = def.health;
    this.root = new TransformNode(`enemy_${def.id}${index}`, scene);

    this.visual = variant.mesh.clone(`enemyVisual_${def.id}${index}`, this.root);
    this.visual.setEnabled(true);
    this.mat = (variant.mesh.material as StandardMaterial).clone(`enemyMat_${def.id}${index}`)!;
    this.visual.material = this.mat;
    this.visual.isPickable = false;

    // hitboxes are slightly larger than the visual mesh (mobile fairness, spec §18)
    const k = def.hitboxScale;
    const body = CreateBox(`enemyHitBody_${def.id}${index}`, {
      width: ENEMY.HITBOX_BODY.w * k,
      height: ENEMY.HITBOX_BODY.h * k,
      depth: ENEMY.HITBOX_BODY.d * k,
    }, scene);
    const wingL = CreateBox(`enemyHitWingL_${def.id}${index}`, {
      width: ENEMY.HITBOX_WING.w * k,
      height: ENEMY.HITBOX_WING.h * k,
      depth: ENEMY.HITBOX_WING.d * k,
    }, scene);
    wingL.position.set(-1.35 * k, -0.05, -0.55);
    const wingR = CreateBox(`enemyHitWingR_${def.id}${index}`, {
      width: ENEMY.HITBOX_WING.w * k,
      height: ENEMY.HITBOX_WING.h * k,
      depth: ENEMY.HITBOX_WING.d * k,
    }, scene);
    wingR.position.set(1.35 * k, -0.05, -0.55);

    for (const box of [body, wingL, wingR]) {
      box.parent = this.root;
      box.isVisible = false;
      box.isPickable = false;
      this.hitboxes.push(box);
    }

    // Navigation lights: red port, green starboard, white tail strobe.
    // Billboarded planes must NOT be parented to a rotating mesh (Babylon
    // mis-places them while the jet banks) — anchors ride the jet, the glow
    // planes stay world-space and get synced to them every frame.
    const nav = getNavMaterials(scene);
    const anchors = [variant.navLeft, variant.navRight, variant.navTail];
    const mats = [nav.red, nav.green, nav.white];
    for (let i = 0; i < 3; i++) {
      const anchor = new TransformNode(`enemyNavAnchor_${def.id}${index}_${i}`, scene);
      anchor.parent = this.visual;
      anchor.position.copyFrom(anchors[i]);
      this.navAnchors.push(anchor);

      const light = CreatePlane(`enemyNav_${def.id}${index}_${i}`, { size: 0.42 }, scene);
      light.material = mats[i];
      light.billboardMode = Mesh.BILLBOARDMODE_ALL;
      light.isPickable = false;
      light.visibility = 0;
      light.setEnabled(false);
      this.navLights.push(light);
    }

    this.root.setEnabled(false);
  }

  get healthFraction(): number {
    return Math.max(0, this.health / this.def.health);
  }

  spawn(path: FlightPath, speed: number): void {
    this.path = path;
    this.speed = speed;
    this.progress = 0;
    this.health = this.def.health;
    this.age = 0;
    this.weavePhase = Math.random() * Math.PI * 2; // spawn-time randomness only (spec §16)
    this.bank = 0;
    this.flashTimer = 0;
    this.trailTimer = 0;
    this.smokeTimer = 0;
    this.mat.emissiveColor.set(0, 0, 0);
    this.visual.position.set(0, 0, 0);
    this.root.position.copyFrom(path.p0);
    this.root.setEnabled(true);
    for (const light of this.navLights) light.setEnabled(true);
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
    this.root.setEnabled(false);
    for (const light of this.navLights) light.setEnabled(false);
  }

  /** Applies damage with hit feedback. Returns true when this hit destroyed the jet. */
  takeDamage(amount: number, hitPoint: Vector3): boolean {
    this.health -= amount;
    this.flashTimer = ENEMY.HIT_FLASH_TIME;
    this.vfx.hitSparks(hitPoint);
    return this.health <= 0;
  }

  /** Advances flight. Returns true when the jet has reached the danger zone. */
  update(dt: number, nightFactor: number): boolean {
    const path = this.path!;
    this.age += dt;
    this.progress += (this.speed * dt) / path.length;
    if (this.progress >= 1) return true;

    evaluatePath(path, this.progress, this.tmp);
    pathTangent(path, this.progress, this.dir);

    // deterministic weave applied to the root — hitboxes ride along
    let weaveVel = 0;
    if (this.def.weaveAmp > 0) {
      const phase = this.age * this.def.weaveFreq + this.weavePhase;
      this.tmp.x += Math.sin(phase) * this.def.weaveAmp;
      weaveVel = Math.cos(phase) * this.def.weaveAmp * this.def.weaveFreq;
    }

    this.root.position.copyFrom(this.tmp);
    this.tmp2.copyFrom(this.tmp).addInPlace(this.dir);
    this.root.lookAt(this.tmp2);

    // banking follows lateral velocity (path + weave), smoothed
    const bankTarget = -(this.dir.x + weaveVel * 0.05) * ENEMY.BANK_FACTOR;
    this.bank += (bankTarget - this.bank) * Math.min(1, ENEMY.BANK_SMOOTHING * dt);
    this.visual.rotation.z = this.bank;

    // hit flash + tiny cosmetic shake on the visual only
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.mat.emissiveColor.set(1, 0.45, 0.35);
      this.visual.position.set((Math.random() - 0.5) * 0.14, (Math.random() - 0.5) * 0.14, 0);
      if (this.flashTimer <= 0) {
        this.mat.emissiveColor.set(0, 0, 0);
        this.visual.position.set(0, 0, 0);
      }
    }

    // navigation lights: faint by day, glowing at night; tail strobe blinks ~1Hz.
    // synced AFTER this frame's transforms so they stay glued to the jet
    const navVis = 0.08 + 0.92 * nightFactor;
    for (let i = 0; i < 3; i++) {
      this.navAnchors[i].computeWorldMatrix(true);
      this.navLights[i].position.copyFrom(this.navAnchors[i].getAbsolutePosition());
    }
    this.navLights[0].visibility = navVis;
    this.navLights[1].visibility = navVis;
    this.navLights[2].visibility = navVis * (Math.sin(this.age * 6.5 + this.weavePhase) > 0.55 ? 1 : 0.08);

    // engine contrail puffs on a cadence (helps players spot distant jets)
    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.05;
      this.tailPosition(this.tmp2);
      this.vfx.trailPuff(this.tmp2);
    }

    // damaged jets stream dark smoke (spec §20 readable damage states)
    if (this.health < this.def.health) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.09;
        this.tailPosition(this.tmp2);
        this.vfx.damageSmoke(this.tmp2);
      }
    }

    return this.root.position.z <= WORLD.DANGER_Z;
  }

  private tailPosition(out: Vector3): void {
    out.copyFrom(this.dir).scaleInPlace(-2.3).addInPlace(this.root.position);
  }
}
