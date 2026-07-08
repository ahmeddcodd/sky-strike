import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createJetBaseMesh } from "../factories/JetFactory";
import { EnemyJet } from "../entities/EnemyJet";
import { makeFlightPath } from "./FlightPathSystem";
import { ENEMY } from "../game/Constants";
import type { VFXSystem } from "./VFXSystem";

export class EnemyManager {
  enemies: EnemyJet[] = [];

  /** Fired when a jet crosses the danger zone (player takes damage). */
  onReached: (enemy: EnemyJet) => void = () => {};

  private vfx: VFXSystem;

  constructor(scene: Scene, vfx: VFXSystem) {
    this.vfx = vfx;
    const base = createJetBaseMesh(scene);
    for (let i = 0; i < ENEMY.POOL_SIZE; i++) {
      this.enemies.push(new EnemyJet(i, scene, base, vfx));
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const enemy of this.enemies) if (enemy.active) n++;
    return n;
  }

  /** Pulls a jet from the pool and launches it on a path. Returns false when the pool is dry. */
  spawn(spawnPos: Vector3, endPos: Vector3, lateralCurve: number, verticalCurve: number, speed: number): boolean {
    for (const enemy of this.enemies) {
      if (enemy.active) continue;
      enemy.spawn(makeFlightPath(spawnPos, endPos, lateralCurve, verticalCurve), speed);
      return true;
    }
    return false;
  }

  update(dt: number): void {
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (enemy.update(dt)) {
        // reached the danger zone — it detonates against the defense line
        this.vfx.explosion(enemy.root.position);
        enemy.deactivate();
        this.onReached(enemy);
      }
    }
  }

  clearAll(explode: boolean): void {
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (explode) this.vfx.explosion(enemy.root.position);
      enemy.deactivate();
    }
  }
}
