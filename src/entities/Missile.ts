import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { MISSILE } from "../game/Constants";
import type { EnemyJet } from "./EnemyJet";
import type { VFXSystem } from "../systems/VFXSystem";

// Pooled missile, dual-role: hostile (armored jet → player, shootable) or
// friendly (player → locked enemy). Homing is a velocity vector rotated toward
// the aim point at a capped turn rate — deterministic given its inputs — with a
// cosmetic sine weave on the visual child so the hitbox stays on the true path.

export type MissileUpdateResult = "flying" | "hitPlayer" | "hitTarget" | "expired";

export class Missile {
  root: TransformNode;
  hitboxes: Mesh[] = [];
  active = false;
  readonly hostile: boolean;
  target: EnemyJet | null = null;
  targetSpawnId = 0;
  /** Ghost mode strips the homing — the missile sails straight past. */
  dumb = false;

  private visual: Mesh;
  private glow: Mesh;
  private vfx: VFXSystem;
  private dir = new Vector3(0, 0, -1);
  private speed = 0;
  private turnRate = 0;
  private age = 0;
  private wobblePhase = 0;
  private smokeTimer = 0;
  private tmp = new Vector3();
  private tmp2 = new Vector3();

  constructor(index: number, scene: Scene, source: Mesh, glowMat: StandardMaterial, hostile: boolean, vfx: VFXSystem) {
    this.hostile = hostile;
    this.vfx = vfx;
    const tag = hostile ? "H" : "P";
    this.root = new TransformNode(`missile${tag}${index}`, scene);

    this.visual = source.clone(`missileVisual${tag}${index}`, this.root)!;
    this.visual.setEnabled(true);
    if (hostile) this.visual.scaling.setAll(1.6); // readability at distance

    if (hostile) {
      const box = CreateBox(`missileHit${index}`, { size: MISSILE.HITBOX }, scene);
      box.parent = this.root;
      box.isVisible = false;
      box.isPickable = false;
      this.hitboxes.push(box);
    }

    // exhaust glow: world-space billboard synced per frame (billboards must not
    // be parented to rotating nodes — Babylon mis-places them)
    this.glow = CreatePlane(`missileGlow${tag}${index}`, { size: 0.9 }, scene);
    this.glow.material = glowMat;
    this.glow.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.glow.isPickable = false;
    this.glow.setEnabled(false);

    this.root.setEnabled(false);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  launch(from: Vector3, aim: Vector3, speed: number, turnRate: number, target: EnemyJet | null): void {
    this.active = true;
    this.dumb = false;
    this.age = 0;
    this.smokeTimer = 0;
    this.speed = speed;
    this.turnRate = turnRate;
    this.target = target;
    this.targetSpawnId = target ? target.spawnId : 0;
    this.wobblePhase = Math.random() * Math.PI * 2; // launch-time randomness only
    this.root.position.copyFrom(from);
    this.dir.copyFrom(aim).subtractInPlace(from).normalize();
    this.tmp.copyFrom(from).addInPlace(this.dir);
    this.root.lookAt(this.tmp);
    this.glow.position.copyFrom(from);
    this.root.setEnabled(true);
    this.glow.setEnabled(true);
  }

  deactivate(): void {
    this.active = false;
    this.target = null;
    this.root.setEnabled(false);
    this.glow.setEnabled(false);
  }

  update(dt: number, playerPos: Vector3): MissileUpdateResult {
    this.age += dt;
    if (this.age > MISSILE.LIFETIME) return "expired";

    // pick this frame's aim point (or go dumb when the lock is gone)
    let aim: Vector3 | null = null;
    if (!this.dumb) {
      if (this.hostile) {
        aim = playerPos;
      } else if (this.target && this.target.active && this.target.spawnId === this.targetSpawnId) {
        aim = this.target.root.position;
      } else {
        this.dumb = true; // target died mid-flight — fly straight and fizzle
      }
    }

    // rotate the velocity direction toward the aim, capped at turnRate·dt
    if (aim) {
      this.tmp.copyFrom(aim).subtractInPlace(this.root.position);
      const dist = this.tmp.length();
      if (dist > 0.001) {
        this.tmp.scaleInPlace(1 / dist);
        const dot = Math.min(1, Math.max(-1, Vector3.Dot(this.dir, this.tmp)));
        const angle = Math.acos(dot);
        const k = angle < 1e-4 ? 1 : Math.min(1, (this.turnRate * dt) / angle);
        this.dir.scaleInPlace(1 - k).addInPlace(this.tmp.scaleInPlace(k)).normalize();
      }
    }

    this.tmp2.copyFrom(this.dir).scaleInPlace(this.speed * dt);
    this.root.position.addInPlace(this.tmp2);
    this.tmp.copyFrom(this.root.position).addInPlace(this.dir);
    this.root.lookAt(this.tmp);

    // cosmetic weave + spin on the visual only — the hitbox rides the true path
    this.visual.position.x = Math.sin(this.age * MISSILE.WOBBLE_FREQ + this.wobblePhase) * MISSILE.WOBBLE_AMP;
    this.visual.rotation.z = this.age * (this.hostile ? 5 : 8);

    // exhaust glow + smoke trail off the tail
    this.tmp.copyFrom(this.dir).scaleInPlace(-0.9).addInPlace(this.root.position);
    this.glow.position.copyFrom(this.tmp);
    const flicker = 0.75 + Math.random() * 0.5;
    this.glow.scaling.set(flicker, flicker, flicker);
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = MISSILE.SMOKE_CADENCE;
      this.vfx.damageSmoke(this.tmp);
    }

    if (this.hostile) {
      if (Vector3.Distance(this.root.position, playerPos) < MISSILE.PROXIMITY) return "hitPlayer";
      if (this.root.position.z < playerPos.z - 4) return "expired"; // sailed past (ghost)
    } else if (!this.dumb && this.target &&
        Vector3.Distance(this.root.position, this.target.root.position) < MISSILE.PROXIMITY * 1.4) {
      return "hitTarget";
    }
    return "flying";
  }
}
