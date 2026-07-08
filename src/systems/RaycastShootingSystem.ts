import type { Scene } from "@babylonjs/core/scene";
import type { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
// side-effect import: patches Scene with createPickingRay* and Ray.intersectsMesh
import { Ray } from "@babylonjs/core/Culling/ray";
import { WEAPON } from "../game/Constants";
import type { EnemyJet } from "../entities/EnemyJet";
import type { EnemyManager } from "./EnemyManager";

export interface ShotResult {
  enemy: EnemyJet | null;
  point: Vector3;
}

// Raycast shooting from the crosshair (spec §17): the hit is computed instantly
// against simplified hitboxes only — never against the visual meshes.

export class RaycastShootingSystem {
  private scene: Scene;
  private camera: TargetCamera;
  private manager: EnemyManager;
  private ray = new Ray(Vector3.Zero(), new Vector3(0, 0, 1), WEAPON.RANGE);
  private result: ShotResult = { enemy: null, point: new Vector3() };

  constructor(scene: Scene, camera: TargetCamera, manager: EnemyManager) {
    this.scene = scene;
    this.camera = camera;
    this.manager = manager;
  }

  /** Casts from the crosshair screen position. The returned object is reused between calls. */
  shoot(screenX: number, screenY: number): ShotResult {
    this.scene.createPickingRayToRef(screenX, screenY, null, this.ray, this.camera);
    this.ray.length = WEAPON.RANGE;

    let closest = Number.POSITIVE_INFINITY;
    this.result.enemy = null;

    for (const enemy of this.manager.enemies) {
      if (!enemy.active) continue;
      for (const box of this.hitboxesOf(enemy)) {
        box.computeWorldMatrix(true); // enemy moved this frame; matrices may be stale pre-render
        const info = this.ray.intersectsMesh(box);
        if (info.hit && info.distance < closest && info.pickedPoint) {
          closest = info.distance;
          this.result.enemy = enemy;
          this.result.point.copyFrom(info.pickedPoint);
        }
      }
    }

    if (!this.result.enemy) {
      this.result.point
        .copyFrom(this.ray.direction)
        .scaleInPlace(WEAPON.RANGE)
        .addInPlace(this.ray.origin);
    }
    return this.result;
  }

  private hitboxesOf(enemy: EnemyJet) {
    return enemy.hitboxes;
  }
}
