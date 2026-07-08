import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { WEAPON } from "../game/Constants";
import type { EnemyJet } from "../entities/EnemyJet";
import type { PlayerJet } from "../entities/PlayerJet";
import type { RaycastShootingSystem } from "./RaycastShootingSystem";
import type { VFXSystem } from "./VFXSystem";
import type { AudioSystem } from "./AudioSystem";

// Twin wing-root machine guns: hold to fire on a fixed cadence, alternating
// wings. The raycast decides the hit the instant the shot fires; the
// tracer/flash/recoil are simultaneous cosmetics.

export class WeaponSystem {
  shots = 0;
  hits = 0;

  onKill: (enemy: EnemyJet, point: Vector3) => void = () => {};
  onHitMarker: () => void = () => {};
  onDebugShot: ((from: Vector3, to: Vector3) => void) | null = null;

  private raycaster: RaycastShootingSystem;
  private vfx: VFXSystem;
  private audio: AudioSystem;
  private jet: PlayerJet;
  private fireTimer = 0;
  private side = 1;

  constructor(raycaster: RaycastShootingSystem, vfx: VFXSystem, audio: AudioSystem, jet: PlayerJet) {
    this.raycaster = raycaster;
    this.vfx = vfx;
    this.audio = audio;
    this.jet = jet;
  }

  get accuracy(): number {
    return this.shots === 0 ? 0 : this.hits / this.shots;
  }

  reset(): void {
    this.shots = 0;
    this.hits = 0;
    this.fireTimer = 0;
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
    const result = this.raycaster.shoot(crosshairX, crosshairY);
    const muzzle = this.jet.getMuzzleWorld(this.side);

    this.vfx.muzzleFlash(muzzle);
    this.vfx.tracer(muzzle, result.point);
    this.vfx.addShake(WEAPON.SHOT_SHAKE);
    this.jet.kick();
    this.audio.shoot();
    this.onDebugShot?.(muzzle, result.point);

    if (!result.enemy) return;
    this.hits++;
    this.audio.hit();
    this.onHitMarker();
    if (result.enemy.takeDamage(WEAPON.DAMAGE, result.point)) {
      this.onKill(result.enemy, result.point);
    }
  }
}
