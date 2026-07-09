import type { Engine } from "@babylonjs/core/Engines/engine";
import type { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ENEMY, WAVE, WORLD } from "../game/Constants";
import { ENEMY_TYPES, type EnemyTypeId } from "../data/EnemyData";
import type { EnemyManager } from "./EnemyManager";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

// Endless escalating waves (spec §28-29): each wave spawns a growing, faster,
// nastier mix; clearing it pays a bonus and starts a short lull. Spawn positions
// are picked as fractions of the camera frustum at each depth, so jets always
// appear on screen regardless of device aspect ratio.

type Phase = "lull" | "spawning" | "clearing";

export class EnemySpawner {
  wave = 0;

  onWaveStart: (wave: number) => void = () => {};
  onWaveClear: (wave: number) => void = () => {};

  private manager: EnemyManager;
  private camera: TargetCamera;
  private engine: Engine;
  private phase: Phase = "lull";
  private timer: number = WAVE.FIRST_DELAY;
  private toSpawn = 0;
  private spawnInterval: number = WAVE.INTERVAL_START;
  private spawnPos = new Vector3();
  private endPos = new Vector3();

  constructor(manager: EnemyManager, camera: TargetCamera, engine: Engine) {
    this.manager = manager;
    this.camera = camera;
    this.engine = engine;
  }

  reset(): void {
    this.wave = 0;
    this.phase = "lull";
    this.timer = WAVE.FIRST_DELAY;
    this.toSpawn = 0;
  }

  /** Debug: end the current wave immediately (no clear bonus). */
  skipWave(): void {
    this.manager.clearAll(false);
    this.phase = "lull";
    this.timer = 0.3;
  }

  update(dt: number): void {
    this.timer -= dt;
    switch (this.phase) {
      case "lull":
        if (this.timer <= 0) this.startWave();
        break;
      case "spawning":
        if (this.timer <= 0 && this.manager.activeCount < ENEMY.MAX_ACTIVE) {
          this.spawnOne(this.pickType());
          this.toSpawn--;
          this.timer = this.spawnInterval * rand(0.75, 1.15);
          if (this.toSpawn <= 0) this.phase = "clearing";
        }
        break;
      case "clearing":
        if (this.manager.activeCount === 0) {
          this.onWaveClear(this.wave);
          this.phase = "lull";
          this.timer = WAVE.LULL;
        }
        break;
    }
  }

  private startWave(): void {
    this.wave++;
    this.toSpawn = Math.min(WAVE.BASE_COUNT + WAVE.COUNT_PER_WAVE * this.wave, WAVE.COUNT_CAP);
    const rampT = Math.min(1, (this.wave - 1) / WAVE.INTERVAL_RAMP_WAVES);
    this.spawnInterval = lerp(WAVE.INTERVAL_START, WAVE.INTERVAL_END, rampT);
    this.phase = "spawning";
    this.timer = 0.4;
    this.onWaveStart(this.wave);
  }

  private waveSpeedScale(): number {
    return Math.min(1 + (this.wave - 1) * WAVE.SPEED_PER_WAVE, WAVE.SPEED_CAP);
  }

  private pickType(): EnemyTypeId {
    const roll = Math.random();
    if (this.wave >= WAVE.ARMORED_UNLOCK && roll < Math.min(0.12 + 0.02 * this.wave, 0.3)) return "armored";
    if (this.wave >= WAVE.FAST_UNLOCK && roll > 1 - Math.min(0.16 + 0.03 * this.wave, 0.4)) return "fast";
    return "normal";
  }

  private halfHeightAt(z: number): number {
    return Math.tan(this.camera.fov / 2) * z;
  }

  private aspect(): number {
    return this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
  }

  spawnOne(type: EnemyTypeId = "normal"): void {
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

    const def = ENEMY_TYPES[type];
    const speed = ENEMY.BASE_SPEED * this.waveSpeedScale() * def.speedScale * rand(0.92, 1.08);

    this.manager.spawn(type, this.spawnPos, this.endPos, lateralCurve, verticalCurve, speed);
  }
}
