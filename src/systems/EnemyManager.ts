import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createJetBaseMesh } from "../factories/JetFactory";
import { EnemyJet } from "../entities/EnemyJet";
import { ALL_ENEMY_TYPES, ENEMY_TYPES, type EnemyTypeId } from "../data/EnemyData";
import { makeFlightPath } from "./FlightPathSystem";
import type { VFXSystem } from "./VFXSystem";
import type { AssetLibrary } from "../assets/AssetLibrary";

export class EnemyManager {
  /** Flat list across all type pools — raycast and debug iterate this. */
  enemies: EnemyJet[] = [];

  /** Fired when a jet crosses the danger zone (player takes damage). */
  onReached: (enemy: EnemyJet) => void = () => {};

  private pools = new Map<EnemyTypeId, EnemyJet[]>();
  private vfx: VFXSystem;

  constructor(scene: Scene, vfx: VFXSystem, assets: AssetLibrary) {
    this.vfx = vfx;
    let index = 0;
    for (const type of ALL_ENEMY_TYPES) {
      const def = ENEMY_TYPES[type];
      const variant = createJetBaseMesh(assets, type);
      const pool: EnemyJet[] = [];
      for (let i = 0; i < def.poolSize; i++) {
        const jet = new EnemyJet(index++, scene, variant, def, vfx);
        pool.push(jet);
        this.enemies.push(jet);
      }
      this.pools.set(type, pool);
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const enemy of this.enemies) if (enemy.active) n++;
    return n;
  }

  /** Pulls a jet of the given type from its pool. Returns false when that pool is dry. */
  spawn(
    type: EnemyTypeId,
    spawnPos: Vector3,
    endPos: Vector3,
    lateralCurve: number,
    verticalCurve: number,
    speed: number,
  ): boolean {
    for (const enemy of this.pools.get(type)!) {
      if (enemy.active) continue;
      enemy.spawn(makeFlightPath(spawnPos, endPos, lateralCurve, verticalCurve), speed);
      return true;
    }
    return false;
  }

  update(dt: number, nightFactor: number): void {
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (enemy.update(dt, nightFactor)) {
        // reached the danger zone — it detonates against the player
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
