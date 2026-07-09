import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MISSILE, POWERUP, WEAPON } from "../game/Constants";
import type { EnemyJet } from "../entities/EnemyJet";
import type { Missile } from "../entities/Missile";
import type { PowerUpPod } from "../entities/PowerUpPod";
import type { PlayerJet } from "../entities/PlayerJet";
import type { RaycastShootingSystem } from "./RaycastShootingSystem";
import type { VFXSystem } from "./VFXSystem";
import type { AudioSystem } from "./AudioSystem";

// Twin wing-root machine guns: hold to fire on a fixed cadence, alternating
// wings. The raycast decides the hit the instant the shot fires; the
// tracer/flash/recoil are simultaneous cosmetics.
//
// Power-up modes are a flat priority chain in fire(): missile ammo with a valid
// lock fires a homing missile; otherwise a bullet at ×2 damage when heavy.
// No lock in the sky → normal bullet, ammo NOT consumed.

export class WeaponSystem {
  shots = 0;
  hits = 0;

  onKill: (enemy: EnemyJet, point: Vector3) => void = () => {};
  onHitMarker: () => void = () => {};
  onMissileShot: (missile: Missile, point: Vector3) => void = () => {};
  onPodShot: (pod: PowerUpPod, point: Vector3) => void = () => {};
  onDebugShot: ((from: Vector3, to: Vector3) => void) | null = null;
  /** Injected by GameApp: locks the nearest enemy and launches. Returns false when no lock. */
  fireHomingMissile: ((x: number, y: number, muzzle: Vector3) => boolean) | null = null;

  private raycaster: RaycastShootingSystem;
  private vfx: VFXSystem;
  private audio: AudioSystem;
  private jet: PlayerJet;
  private fireTimer = 0;
  private side = 1;
  private heavy = false;
  private missileAmmoCount = 0;

  constructor(raycaster: RaycastShootingSystem, vfx: VFXSystem, audio: AudioSystem, jet: PlayerJet) {
    this.raycaster = raycaster;
    this.vfx = vfx;
    this.audio = audio;
    this.jet = jet;
  }

  get accuracy(): number {
    return this.shots === 0 ? 0 : this.hits / this.shots;
  }

  get missileAmmo(): number {
    return this.missileAmmoCount;
  }

  setHeavy(active: boolean): void {
    this.heavy = active;
  }

  setMissileAmmo(count: number): void {
    this.missileAmmoCount = count;
  }

  reset(): void {
    this.shots = 0;
    this.hits = 0;
    this.fireTimer = 0;
    this.heavy = false;
    this.missileAmmoCount = 0;
  }

  update(dt: number, firing: boolean, crosshairX: number, crosshairY: number): void {
    this.fireTimer -= dt;
    if (!firing || this.fireTimer > 0) return;
    this.fireTimer = WEAPON.FIRE_INTERVAL;
    this.fire(crosshairX, crosshairY);
  }

  private fire(crosshairX: number, crosshairY: number): void {
    this.shots++;
    this.side = -this.side;
    const muzzle = this.jet.getMuzzleWorld(this.side);

    // missile mode: homing shot when a lock exists (ammo survives empty-sky shots)
    if (this.missileAmmoCount > 0 && this.fireHomingMissile?.(crosshairX, crosshairY, muzzle)) {
      this.missileAmmoCount--;
      this.fireTimer = MISSILE.PLAYER_FIRE_INTERVAL;
      this.hits++; // homing missiles connect — counted as a hit for accuracy
      this.vfx.muzzleFlash(muzzle);
      this.vfx.addShake(WEAPON.SHOT_SHAKE * 2);
      this.jet.kick();
      this.audio.shootHeavy();
      return;
    }

    const result = this.raycaster.shoot(crosshairX, crosshairY);
    this.vfx.muzzleFlash(muzzle);
    this.vfx.tracer(muzzle, result.point, this.heavy);
    this.vfx.addShake(WEAPON.SHOT_SHAKE);
    this.jet.kick();
    if (this.heavy) this.audio.shootHeavy();
    else this.audio.shoot();
    this.onDebugShot?.(muzzle, result.point);

    if (result.missile) {
      this.hits++;
      this.audio.hit();
      this.onHitMarker();
      this.onMissileShot(result.missile, result.point);
      return;
    }
    if (result.pod) {
      this.hits++;
      this.onHitMarker();
      this.onPodShot(result.pod, result.point);
      return;
    }
    if (!result.enemy) return;
    this.hits++;
    this.audio.hit();
    this.onHitMarker();
    const damage = WEAPON.DAMAGE * (this.heavy ? POWERUP.HEAVY_MULT : 1);
    if (result.enemy.takeDamage(damage, result.point)) {
      this.onKill(result.enemy, result.point);
    }
  }
}
