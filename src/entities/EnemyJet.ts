import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { ENEMY, WORLD } from "../game/Constants";
import { evaluatePath, pathTangent, type FlightPath } from "../systems/FlightPathSystem";
import type { VFXSystem } from "../systems/VFXSystem";

// Pooled enemy. The root node carries flight position/orientation (and the
// hitboxes with it); the visual child carries banking roll and hit-shake so
// cosmetic motion never distorts the hitboxes (spec §16).

export class EnemyJet {
  root: TransformNode;
  visual: Mesh;
  hitboxes: Mesh[] = [];
  active = false;
  health = ENEMY.HEALTH;

  private mat: StandardMaterial;
  private vfx: VFXSystem;
  private path: FlightPath | null = null;
  private progress = 0;
  private speed: number = ENEMY.BASE_SPEED;
  private bank = 0;
  private flashTimer = 0;
  private trailTimer = 0;
  private smokeTimer = 0;
  private dir = new Vector3(0, 0, -1);
  private tmp = new Vector3();
  private tmp2 = new Vector3();

  constructor(index: number, scene: Scene, baseMesh: Mesh, vfx: VFXSystem) {
    this.vfx = vfx;
    this.root = new TransformNode(`enemy${index}`, scene);

    this.visual = baseMesh.clone(`enemyVisual${index}`, this.root);
    this.visual.setEnabled(true);
    this.mat = (baseMesh.material as StandardMaterial).clone(`enemyMat${index}`)!;
    this.visual.material = this.mat;
    this.visual.isPickable = false;

    // hitboxes are slightly larger than the visual mesh (mobile fairness, spec §18)
    const body = CreateBox(`enemyHitBody${index}`, {
      width: ENEMY.HITBOX_BODY.w,
      height: ENEMY.HITBOX_BODY.h,
      depth: ENEMY.HITBOX_BODY.d,
    }, scene);
    const wingL = CreateBox(`enemyHitWingL${index}`, {
      width: ENEMY.HITBOX_WING.w,
      height: ENEMY.HITBOX_WING.h,
      depth: ENEMY.HITBOX_WING.d,
    }, scene);
    wingL.position.set(-1.35, -0.05, -0.55);
    const wingR = CreateBox(`enemyHitWingR${index}`, {
      width: ENEMY.HITBOX_WING.w,
      height: ENEMY.HITBOX_WING.h,
      depth: ENEMY.HITBOX_WING.d,
    }, scene);
    wingR.position.set(1.35, -0.05, -0.55);

    for (const box of [body, wingL, wingR]) {
      box.parent = this.root;
      box.isVisible = false;
      box.isPickable = false;
      this.hitboxes.push(box);
    }

    this.root.setEnabled(false);
  }

  spawn(path: FlightPath, speed: number): void {
    this.path = path;
    this.speed = speed;
    this.progress = 0;
    this.health = ENEMY.HEALTH;
    this.bank = 0;
    this.flashTimer = 0;
    this.trailTimer = 0;
    this.smokeTimer = 0;
    this.mat.emissiveColor.set(0, 0, 0);
    this.visual.position.set(0, 0, 0);
    this.root.position.copyFrom(path.p0);
    this.root.setEnabled(true);
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
    this.root.setEnabled(false);
  }

  /** Applies damage with hit feedback. Returns true when this hit destroyed the jet. */
  takeDamage(amount: number, hitPoint: Vector3): boolean {
    this.health -= amount;
    this.flashTimer = ENEMY.HIT_FLASH_TIME;
    this.vfx.hitSparks(hitPoint);
    return this.health <= 0;
  }

  /** Advances flight. Returns true when the jet has reached the danger zone. */
  update(dt: number): boolean {
    const path = this.path!;
    this.progress += (this.speed * dt) / path.length;
    if (this.progress >= 1) return true;

    evaluatePath(path, this.progress, this.tmp);
    pathTangent(path, this.progress, this.dir);
    this.root.position.copyFrom(this.tmp);
    this.tmp2.copyFrom(this.tmp).addInPlace(this.dir);
    this.root.lookAt(this.tmp2);

    // banking follows lateral velocity, smoothed (sign tuned for a natural lean-in)
    const bankTarget = -this.dir.x * ENEMY.BANK_FACTOR;
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

    // engine contrail puffs on a cadence (helps players spot distant jets)
    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.05;
      this.tailPosition(this.tmp2);
      this.vfx.trailPuff(this.tmp2);
    }

    // damaged jets stream dark smoke (spec §20 readable damage states)
    if (this.health < ENEMY.HEALTH) {
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
