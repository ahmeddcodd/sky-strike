import type { Scene } from "@babylonjs/core/scene";
import type { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
// side-effect import: patches Scene with createPickingRay* and Ray.intersectsMesh
import { Ray } from "@babylonjs/core/Culling/ray";
import { WEAPON } from "../game/Constants";
import type { EnemyJet } from "../entities/EnemyJet";
import type { Missile } from "../entities/Missile";
import type { PowerUpPod } from "../entities/PowerUpPod";
import type { EnemyManager } from "./EnemyManager";
import type { MissileSystem } from "./MissileSystem";
import type { PowerUpSystem } from "./PowerUpSystem";

export interface ShotResult {
  enemy: EnemyJet | null;
  missile: Missile | null;
  pod: PowerUpPod | null;
  point: Vector3;
}

// Raycast shooting from the crosshair (spec §17): the hit is computed instantly
// against simplified hitboxes only — never against the visual meshes. Targets
// are enemies, hostile missiles, and power-up pods; the nearest hit wins.

export class RaycastShootingSystem {
  private scene: Scene;
  private camera: TargetCamera;
  private manager: EnemyManager;
  private missiles: MissileSystem;
  private pods: PowerUpSystem | null = null;
  private ray = new Ray(Vector3.Zero(), new Vector3(0, 0, 1), WEAPON.RANGE);
  private result: ShotResult = { enemy: null, missile: null, pod: null, point: new Vector3() };
  private closest = 0;
  private tmp = new Vector3();

  constructor(scene: Scene, camera: TargetCamera, manager: EnemyManager, missiles: MissileSystem) {
    this.scene = scene;
    this.camera = camera;
    this.manager = manager;
    this.missiles = missiles;
  }

  /** Late injection — PowerUpSystem is constructed after the weapon that owns this raycaster. */
  setPods(pods: PowerUpSystem): void {
    this.pods = pods;
  }

  /** Casts from the crosshair screen position (CSS pixels). The returned object is reused between calls. */
  shoot(screenX: number, screenY: number): ShotResult {
    // NOTE: createPickingRayToRef expects CSS/client pixels — it converts to the
    // render buffer internally (× 1/hardwareScalingLevel). Do NOT pre-convert.
    this.scene.createPickingRayToRef(screenX, screenY, null, this.ray, this.camera);
    this.ray.length = WEAPON.RANGE;

    this.closest = Number.POSITIVE_INFINITY;
    this.result.enemy = null;
    this.result.missile = null;
    this.result.pod = null;

    for (const enemy of this.manager.enemies) {
      if (!enemy.active) continue;
      for (const box of enemy.hitboxes) {
        if (this.tryHit(box)) {
          this.result.enemy = enemy;
          this.result.missile = null;
          this.result.pod = null;
        }
      }
    }
    for (const missile of this.missiles.hostileActive) {
      for (const box of missile.hitboxes) {
        if (this.tryHit(box)) {
          this.result.enemy = null;
          this.result.missile = missile;
          this.result.pod = null;
        }
      }
    }
    if (this.pods) {
      for (const pod of this.pods.activePods) {
        for (const box of pod.hitboxes) {
          if (this.tryHit(box)) {
            this.result.enemy = null;
            this.result.missile = null;
            this.result.pod = pod;
          }
        }
      }
    }

    if (!this.result.enemy && !this.result.missile && !this.result.pod) {
      this.result.point
        .copyFrom(this.ray.direction)
        .scaleInPlace(WEAPON.RANGE)
        .addInPlace(this.ray.origin);
    }
    return this.result;
  }

  /** The active enemy nearest to the crosshair ray, within the lock cone — for homing missiles. */
  nearestToRay(screenX: number, screenY: number): EnemyJet | null {
    this.scene.createPickingRayToRef(screenX, screenY, null, this.ray, this.camera);
    let best: EnemyJet | null = null;
    let bestDist = 6; // lock cone radius (world units off the ray)
    for (const enemy of this.manager.enemies) {
      if (!enemy.active) continue;
      this.tmp.copyFrom(enemy.root.position).subtractInPlace(this.ray.origin);
      const along = Vector3.Dot(this.tmp, this.ray.direction);
      if (along <= 0) continue; // behind the camera
      // perpendicular distance from the enemy to the ray
      this.tmp.copyFrom(this.ray.direction).scaleInPlace(along).addInPlace(this.ray.origin);
      const dist = Vector3.Distance(this.tmp, enemy.root.position);
      if (dist < bestDist) {
        bestDist = dist;
        best = enemy;
      }
    }
    return best;
  }

  private tryHit(box: AbstractMesh): boolean {
    box.computeWorldMatrix(true); // targets moved this frame; matrices may be stale pre-render
    const info = this.ray.intersectsMesh(box);
    if (info.hit && info.distance < this.closest && info.pickedPoint) {
      this.closest = info.distance;
      this.result.point.copyFrom(info.pickedPoint);
      return true;
    }
    return false;
  }
}
