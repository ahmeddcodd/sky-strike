import type { Engine } from "@babylonjs/core/Engines/engine";
import type { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ENEMY, SPAWN, WORLD } from "../game/Constants";
import type { EnemyManager } from "./EnemyManager";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

// Spawn positions are picked as fractions of the camera frustum at each depth,
// so jets always appear on screen regardless of device aspect ratio.

export class EnemySpawner {
  private manager: EnemyManager;
  private camera: TargetCamera;
  private engine: Engine;
  private timer: number = SPAWN.FIRST_DELAY;
  private elapsed = 0;
  private spawnPos = new Vector3();
  private endPos = new Vector3();

  constructor(manager: EnemyManager, camera: TargetCamera, engine: Engine) {
    this.manager = manager;
    this.camera = camera;
    this.engine = engine;
  }

  reset(): void {
    this.timer = SPAWN.FIRST_DELAY;
    this.elapsed = 0;
  }

  /** 0 → 1 difficulty over SPAWN.RAMP_TIME seconds. */
  get rampT(): number {
    return Math.min(1, this.elapsed / SPAWN.RAMP_TIME);
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.manager.activeCount < ENEMY.MAX_ACTIVE) this.spawnOne();
      this.timer = lerp(SPAWN.INTERVAL_START, SPAWN.INTERVAL_END, this.rampT);
    }
  }

  private halfHeightAt(z: number): number {
    return Math.tan(this.camera.fov / 2) * z;
  }

  private aspect(): number {
    return this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
  }

  spawnOne(): void {
    const aspect = this.aspect();

    const spawnZ = rand(WORLD.SPAWN_Z_MIN, WORLD.SPAWN_Z_MAX);
    const spawnHalfH = this.halfHeightAt(spawnZ);
    const spawnHalfW = spawnHalfH * aspect;
    this.spawnPos.set(
      rand(-1, 1) * ENEMY.SPAWN_X_SPREAD * spawnHalfW,
      lerp(ENEMY.SPAWN_Y_MIN, ENEMY.SPAWN_Y_MAX, Math.random()) * spawnHalfH,
      spawnZ,
    );

    // endpoint sits inside the frustum at the danger plane so the jet visibly
    // flies through the danger zone toward the camera
    const endHalfH = this.halfHeightAt(WORLD.DANGER_Z);
    const endHalfW = endHalfH * aspect;
    this.endPos.set(
      rand(-1, 1) * ENEMY.END_X_SPREAD * endHalfW,
      rand(ENEMY.END_Y_MIN, ENEMY.END_Y_MAX) * endHalfH,
      WORLD.PATH_END_Z,
    );

    const midHalfH = this.halfHeightAt((spawnZ + WORLD.DANGER_Z) / 2);
    const lateralCurve = rand(-1, 1) * 0.35 * midHalfH * aspect;
    const verticalCurve = rand(-0.5, 0.5) * 0.25 * midHalfH;

    const speedScale = lerp(SPAWN.SPEED_SCALE_START, SPAWN.SPEED_SCALE_END, this.rampT);
    const speed = ENEMY.BASE_SPEED * speedScale * rand(0.9, 1.1);

    this.manager.spawn(this.spawnPos, this.endPos, lateralCurve, verticalCurve, speed);
  }
}
