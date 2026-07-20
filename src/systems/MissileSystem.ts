import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MISSILE } from "../game/Constants";
import { makeFlareTexture } from "../factories/MeshUtils";
import { Missile } from "../entities/Missile";
import type { EnemyJet } from "../entities/EnemyJet";
import type { PlayerJet } from "../entities/PlayerJet";
import type { VFXSystem } from "./VFXSystem";
import type { AssetLibrary } from "../assets/AssetLibrary";

// Owns both missile pools. Hostile missiles (armored jet → player) are the
// interception minigame: launched with a warning, ~3.5s flight, shootable via
// the crosshair raycast. Friendly missiles are the player's homing power-up.

function makeGlowMat(scene: Scene, name: string, hex: string): StandardMaterial {
  const flare = makeFlareTexture(scene, `${name}Tex`, hex);
  const mat = new StandardMaterial(name, scene);
  mat.emissiveTexture = flare;
  mat.opacityTexture = flare;
  mat.emissiveColor = Color3.Black(); // emissiveColor ADDS to the texture — tint lives in the flare
  mat.diffuseColor = Color3.Black();
  mat.disableLighting = true;
  mat.alphaMode = 1; // additive
  mat.fogEnabled = false;
  return mat;
}

export class MissileSystem {
  onLaunch: () => void = () => {};
  onPlayerHit: (point: Vector3) => void = () => {};
  onIntercepted: (missile: Missile, point: Vector3) => void = () => {};
  onEnemyHit: (enemy: EnemyJet, point: Vector3) => void = () => {};

  /** Active hostile missiles, refreshed each update — raycast targets. */
  hostileActive: Missile[] = [];

  private hostiles: Missile[] = [];
  private friendlies: Missile[] = [];
  private player: PlayerJet;
  private vfx: VFXSystem;
  private launchCooldown = 0;
  private ghost = false;
  private playerPos = new Vector3();
  private tmp = new Vector3();

  constructor(scene: Scene, vfx: VFXSystem, player: PlayerJet, assets: AssetLibrary) {
    this.vfx = vfx;
    this.player = player;
    const glowHostile = makeGlowMat(scene, "missileGlowMatH", "#ffb066");
    const glowPlayer = makeGlowMat(scene, "missileGlowMatP", "#9fe8ff");
    const srcHostile = assets.source("missile_enemy");
    const srcPlayer = assets.source("missile_player");
    for (let i = 0; i < MISSILE.ENEMY_POOL; i++) {
      this.hostiles.push(new Missile(i, scene, srcHostile, glowHostile, true, vfx));
    }
    for (let i = 0; i < MISSILE.PLAYER_POOL; i++) {
      this.friendlies.push(new Missile(i, scene, srcPlayer, glowPlayer, false, vfx));
    }
  }

  get hostileCount(): number {
    return this.hostileActive.length;
  }

  /** Launches at the player from an armored jet. Respects the cap + cooldown unless forced (debug). */
  tryLaunchAtPlayer(shooter: EnemyJet, wave: number, force = false): boolean {
    if (this.ghost) return false;
    if (!force) {
      if (this.launchCooldown > 0) return false;
      const cap = wave >= MISSILE.LATE_WAVE ? MISSILE.MAX_ACTIVE_LATE : MISSILE.MAX_ACTIVE_EARLY;
      let active = 0;
      for (const m of this.hostiles) if (m.active) active++;
      if (active >= cap) return false;
    }
    const missile = this.free(this.hostiles);
    if (!missile) return false;
    this.player.getWorldPosition(this.playerPos);
    shooter.nosePosition(this.tmp);
    missile.launch(this.tmp, this.playerPos, MISSILE.ENEMY_SPEED, MISSILE.ENEMY_TURN_RATE, null);
    this.launchCooldown = MISSILE.LAUNCH_COOLDOWN;
    this.onLaunch();
    return true;
  }

  /** Fires a player homing missile at a locked enemy. */
  launchAtEnemy(from: Vector3, target: EnemyJet): void {
    const missile = this.free(this.friendlies);
    if (!missile) return;
    missile.launch(from, target.root.position, MISSILE.PLAYER_SPEED, MISSILE.PLAYER_TURN_RATE, target);
  }

  /** The crosshair raycast hit a hostile missile — detonate it mid-air. */
  intercept(missile: Missile, point: Vector3): void {
    if (!missile.active) return;
    missile.deactivate();
    this.onIntercepted(missile, point);
  }

  setGhost(active: boolean): void {
    this.ghost = active;
    if (!active) return;
    // in-flight missiles lose the lock and visibly sail past
    for (const m of this.hostiles) if (m.active) m.dumb = true;
  }

  update(dt: number): void {
    this.launchCooldown -= dt;
    this.player.getWorldPosition(this.playerPos);

    this.hostileActive.length = 0;
    for (const m of this.hostiles) {
      if (!m.active) continue;
      const result = m.update(dt, this.playerPos);
      if (result === "hitPlayer") {
        m.deactivate();
        this.onPlayerHit(m.position);
      } else if (result === "expired") {
        m.deactivate();
      } else {
        this.hostileActive.push(m);
      }
    }

    for (const m of this.friendlies) {
      if (!m.active) continue;
      const result = m.update(dt, this.playerPos);
      if (result === "hitTarget") {
        const target = m.target!;
        m.deactivate();
        this.onEnemyHit(target, m.position);
      } else if (result === "expired") {
        m.deactivate();
      }
    }
  }

  clearAll(explode: boolean): void {
    for (const m of this.hostiles) {
      if (!m.active) continue;
      if (explode) this.vfx.explosion(m.position);
      m.deactivate();
    }
    for (const m of this.friendlies) {
      if (m.active) m.deactivate();
    }
    this.hostileActive.length = 0;
  }

  reset(): void {
    this.clearAll(false);
    this.launchCooldown = 0;
    this.ghost = false;
  }

  private free(pool: Missile[]): Missile | null {
    for (const m of pool) if (!m.active) return m;
    return null;
  }
}
