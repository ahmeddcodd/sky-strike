import type { Scene } from "@babylonjs/core/scene";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { POWERUP, WORLD } from "../game/Constants";
import { PowerUpPod, type PowerUpType } from "../entities/PowerUpPod";
import { makeFlightPath } from "./FlightPathSystem";
import type { PlayerJet } from "../entities/PlayerJet";
import type { WeaponSystem } from "./WeaponSystem";

// Schedules one pod per wave (from POWERUP.UNLOCK_WAVE) and owns the active
// effect. Collecting a new pod replaces the running effect — one pill, no
// stacking. Ghost interactions with enemy fire/missiles go through
// onGhostChange so this system never imports those systems.

const ALL_TYPES: PowerUpType[] = ["heavy", "missiles", "ghost"];

export class PowerUpSystem {
  onPickup: (type: PowerUpType, point: Vector3) => void = () => {};
  onExpire: (type: PowerUpType) => void = () => {};
  onGhostChange: (active: boolean) => void = () => {};

  /** Active pods, refreshed each update — raycast targets. */
  activePods: PowerUpPod[] = [];

  private pods: PowerUpPod[] = [];
  private camera: TargetCamera;
  private engine: Engine;
  private player: PlayerJet;
  private weapon: WeaponSystem;
  private podTimer = -1;
  private firstPod = true;
  private lastType: PowerUpType | null = null;
  private effect: PowerUpType | null = null;
  private effectTimer = 0;
  private ghostK = 0;
  private ghostTarget = 0;
  private debugCycle = 0;
  private spawnPos = new Vector3();
  private endPos = new Vector3();

  constructor(scene: Scene, camera: TargetCamera, engine: Engine, player: PlayerJet, weapon: WeaponSystem) {
    this.camera = camera;
    this.engine = engine;
    this.player = player;
    this.weapon = weapon;
    for (let i = 0; i < POWERUP.POOL; i++) {
      this.pods.push(new PowerUpPod(i, scene));
    }
  }

  /** The pod currently drifting on screen (for the HUD label), if any. */
  get activePod(): PowerUpPod | null {
    return this.activePods.length > 0 ? this.activePods[0] : null;
  }

  /** HUD readout for the running effect, null when none. */
  get pillText(): string | null {
    if (this.effect === "heavy") return `HEAVY ×2 · ${Math.ceil(this.effectTimer)}s`;
    if (this.effect === "missiles") return `MISSILES ×${this.weapon.missileAmmo}`;
    if (this.effect === "ghost") return `GHOST · ${Math.ceil(this.effectTimer)}s`;
    return null;
  }

  onWaveStart(wave: number): void {
    if (wave < POWERUP.UNLOCK_WAVE) return;
    this.podTimer = POWERUP.SPAWN_DELAY_MIN + Math.random() * (POWERUP.SPAWN_DELAY_MAX - POWERUP.SPAWN_DELAY_MIN);
  }

  /** Wired from WeaponSystem.onPodShot. */
  collect(pod: PowerUpPod, point: Vector3): void {
    const type = pod.type;
    pod.deactivate();
    this.apply(type);
    this.onPickup(type, point);
  }

  update(dt: number): void {
    if (this.podTimer > 0) {
      this.podTimer -= dt;
      if (this.podTimer <= 0) this.spawnPod(this.pickType());
    }

    this.activePods.length = 0;
    for (const pod of this.pods) {
      if (!pod.active) continue;
      if (pod.update(dt)) pod.deactivate();
      else this.activePods.push(pod);
    }

    if (this.effect === "heavy" || this.effect === "ghost") {
      this.effectTimer -= dt;
      if (this.effectTimer <= 0) this.clearEffect(true);
    } else if (this.effect === "missiles" && this.weapon.missileAmmo <= 0) {
      this.clearEffect(true);
    }

    // ghost translucency ramps in/out over ~0.3s
    const k = Math.min(1, dt / 0.3);
    const next = this.ghostK + (this.ghostTarget - this.ghostK) * k;
    if (Math.abs(next - this.ghostK) > 0.001) {
      this.ghostK = next;
      this.player.setGhost(this.ghostK);
    }
  }

  reset(): void {
    for (const pod of this.pods) pod.deactivate();
    this.activePods.length = 0;
    this.podTimer = -1;
    this.firstPod = true;
    this.lastType = null;
    this.clearEffect(false);
    this.ghostK = 0;
    this.ghostTarget = 0;
    this.player.setGhost(0);
  }

  /** Debug (KeyP): spawn a pod immediately, cycling heavy → missiles → ghost. */
  debugSpawn(): void {
    this.firstPod = false;
    this.spawnPod(ALL_TYPES[this.debugCycle++ % ALL_TYPES.length]);
  }

  private pickType(): PowerUpType {
    if (this.firstPod) {
      this.firstPod = false;
      return "heavy"; // the most legible effect teaches the mechanic
    }
    const options: PowerUpType[] = [];
    for (const type of ALL_TYPES) if (type !== this.lastType) options.push(type);
    return options[Math.floor(Math.random() * options.length)];
  }

  private spawnPod(type: PowerUpType): void {
    let pod: PowerUpPod | null = null;
    for (const candidate of this.pods) {
      if (!candidate.active) {
        pod = candidate;
        break;
      }
    }
    if (!pod) return;

    // frustum-fraction placement (same idea as the enemy spawner): always on screen
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const spawnZ = 90;
    const halfH = Math.tan(this.camera.fov / 2) * spawnZ;
    this.spawnPos.set(
      (Math.random() * 2 - 1) * 0.5 * halfH * aspect,
      (0.15 + Math.random() * 0.35) * halfH,
      spawnZ,
    );
    const endHalfH = Math.tan(this.camera.fov / 2) * WORLD.DANGER_Z;
    this.endPos.set(
      (Math.random() * 2 - 1) * 0.2 * endHalfH * aspect,
      0.1 * endHalfH,
      6,
    );
    const path = makeFlightPath(this.spawnPos, this.endPos, (Math.random() * 2 - 1) * 6, 0);
    pod.spawn(type, path, POWERUP.DRIFT_SPEED);
    this.lastType = type;
  }

  private apply(type: PowerUpType): void {
    this.clearEffect(false); // replace policy: new pickup swaps the running effect
    this.effect = type;
    if (type === "heavy") {
      this.weapon.setHeavy(true);
      this.effectTimer = POWERUP.HEAVY_DURATION;
    } else if (type === "missiles") {
      this.weapon.setMissileAmmo(POWERUP.MISSILE_AMMO);
    } else {
      this.effectTimer = POWERUP.GHOST_DURATION;
      this.ghostTarget = 1;
      this.onGhostChange(true);
    }
  }

  private clearEffect(notify: boolean): void {
    if (!this.effect) return;
    const type = this.effect;
    this.effect = null;
    if (type === "heavy") this.weapon.setHeavy(false);
    if (type === "missiles") this.weapon.setMissileAmmo(0);
    if (type === "ghost") {
      this.ghostTarget = 0;
      this.onGhostChange(false);
    }
    if (notify) this.onExpire(type);
  }
}
