import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { ENEMY_FIRE, MISSILE } from "../game/Constants";
import type { EnemyJet } from "../entities/EnemyJet";
import type { EnemyManager } from "./EnemyManager";
import type { PlayerJet } from "../entities/PlayerJet";
import type { VFXSystem } from "./VFXSystem";
import type { AudioSystem } from "./AudioSystem";
import type { MissileSystem } from "./MissileSystem";

// All enemy offense lives here: gun bursts from normal jets and missile
// launches from armored jets — one place for every fairness limit.
//
// A burst's hit/miss is rolled ONCE when it starts (event-time randomness, no
// per-frame rolls); the damage only lands when its tracer arrives, and the
// burst dies with the shooter — killing them mid-burst visibly saves you.
// A global hit cooldown caps the player's HP drain rate no matter how many
// jets are on screen; the extra bursts still fire, but they miss.

interface Burst {
  active: boolean;
  shooter: EnemyJet | null;
  shooterSpawnId: number;
  willHit: boolean;
  missSide: number;
  fired: number;
  inFlight: number;
  nextTimer: number;
  cancelled: boolean;
}

interface FireTracer {
  mesh: Mesh;
  from: Vector3;
  to: Vector3;
  t: number;
  duration: number;
  burst: number;
  isDamage: boolean;
  active: boolean;
}

export class EnemyFireSystem {
  onPlayerGunHit: () => void = () => {};
  /** Debug (KeyM): the next armored jet launches immediately, ignoring caps. */
  debugForceMissile = false;

  private manager: EnemyManager;
  private player: PlayerJet;
  private vfx: VFXSystem;
  private audio: AudioSystem;
  private missiles: MissileSystem;
  private wave = 0;
  private ghost = false;
  private hitCooldown = 0;
  private bursts: Burst[] = [];
  private tracers: FireTracer[] = [];
  private playerPos = new Vector3();
  private tmp = new Vector3();

  constructor(scene: Scene, manager: EnemyManager, player: PlayerJet,
              vfx: VFXSystem, audio: AudioSystem, missiles: MissileSystem) {
    this.manager = manager;
    this.player = player;
    this.vfx = vfx;
    this.audio = audio;
    this.missiles = missiles;

    // own red tracer pool — these need per-shot durations and arrival events,
    // which would pollute VFXSystem's cosmetic pool
    const mat = new StandardMaterial("enemyTracerMat", scene);
    mat.emissiveColor = new Color3(1, 0.29, 0.23);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.fogEnabled = false;

    for (let i = 0; i < ENEMY_FIRE.TRACER_POOL; i++) {
      const mesh = CreateCylinder(`enemyTracer${i}`, { height: 1, diameter: 0.09, tessellation: 5 }, scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.bakeCurrentTransformIntoVertices(); // beam extends along +Z so lookAt aims it
      mesh.scaling.z = 5;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.tracers.push({
        mesh, from: new Vector3(), to: new Vector3(),
        t: 0, duration: 1, burst: -1, isDamage: false, active: false,
      });
    }

    for (let i = 0; i < 3; i++) {
      this.bursts.push({
        active: false, shooter: null, shooterSpawnId: 0, willHit: false,
        missSide: 1, fired: 0, inFlight: 0, nextTimer: 0, cancelled: false,
      });
    }
  }

  setWave(wave: number): void {
    this.wave = wave;
  }

  setGhost(active: boolean): void {
    this.ghost = active;
    if (!active) return;
    // panic button: every pending hit whiffs visibly
    for (let i = 0; i < this.bursts.length; i++) {
      if (this.bursts[i].active && !this.bursts[i].cancelled) this.cancelBurst(i);
    }
  }

  reset(): void {
    this.wave = 0;
    this.ghost = false;
    this.hitCooldown = 0;
    this.debugForceMissile = false;
    for (const burst of this.bursts) {
      burst.active = false;
      burst.shooter = null;
      burst.inFlight = 0;
    }
    for (const tracer of this.tracers) {
      tracer.active = false;
      tracer.mesh.setEnabled(false);
    }
  }

  update(dt: number): void {
    this.hitCooldown -= dt;
    this.player.getWorldPosition(this.playerPos);
    this.schedule(dt);
    this.advanceBursts(dt);
    this.advanceTracers(dt);
  }

  private maxBursts(): number {
    return this.wave >= ENEMY_FIRE.LATE_WAVE ? ENEMY_FIRE.MAX_BURSTS_LATE : ENEMY_FIRE.MAX_BURSTS_EARLY;
  }

  private schedule(dt: number): void {
    for (const enemy of this.manager.enemies) {
      if (!enemy.active) continue;
      const z = enemy.root.position.z;

      // armored jets: one interceptable missile per approach
      if (enemy.def.firesMissiles && !enemy.hasFiredMissile) {
        const inWindow = z >= MISSILE.LAUNCH_Z_MIN && z <= MISSILE.LAUNCH_Z_MAX;
        const forced = this.debugForceMissile && z <= 110;
        if ((inWindow || forced) && this.missiles.tryLaunchAtPlayer(enemy, this.wave, forced)) {
          enemy.hasFiredMissile = true;
          if (forced) this.debugForceMissile = false;
        }
      }

      // gun bursts from firing types, inside the window, from the unlock wave
      if (!enemy.def.fires || this.wave < ENEMY_FIRE.UNLOCK_WAVE) continue;
      if (z < ENEMY_FIRE.Z_MIN || z > ENEMY_FIRE.Z_MAX) continue;
      enemy.fireTimer -= dt;
      if (enemy.fireTimer > 0) continue;
      if (this.ghost) {
        enemy.fireTimer = 0.8; // hold fire while the player is ghosted
        continue;
      }
      const slot = this.freeBurst();
      if (slot < 0 || this.activeBurstCount() >= this.maxBursts()) {
        enemy.fireTimer = 0.5; // slots busy — retry shortly
        continue;
      }
      this.startBurst(slot, enemy);
      enemy.fireTimer = enemy.def.burstInterval * (0.85 + Math.random() * 0.3);
    }
  }

  private freeBurst(): number {
    for (let i = 0; i < this.bursts.length; i++) if (!this.bursts[i].active) return i;
    return -1;
  }

  private activeBurstCount(): number {
    let count = 0;
    for (const burst of this.bursts) if (burst.active) count++;
    return count;
  }

  private startBurst(index: number, shooter: EnemyJet): void {
    const burst = this.bursts[index];
    burst.active = true;
    burst.shooter = shooter;
    burst.shooterSpawnId = shooter.spawnId;
    burst.cancelled = false;
    burst.fired = 0;
    burst.inFlight = 0;
    burst.nextTimer = 0;
    burst.missSide = Math.random() > 0.5 ? 1 : -1;
    burst.willHit = this.hitCooldown <= 0 && Math.random() < ENEMY_FIRE.HIT_CHANCE;
    if (burst.willHit) {
      this.hitCooldown = Math.max(
        ENEMY_FIRE.HIT_COOLDOWN_MIN,
        ENEMY_FIRE.HIT_COOLDOWN_BASE - ENEMY_FIRE.HIT_COOLDOWN_PER_WAVE * (this.wave - ENEMY_FIRE.UNLOCK_WAVE),
      );
    }
    // the telegraph: muzzle flash at the nose + a distant crack
    shooter.nosePosition(this.tmp);
    this.vfx.muzzleFlash(this.tmp);
    this.audio.enemyFire();
  }

  private cancelBurst(index: number): void {
    const burst = this.bursts[index];
    burst.cancelled = true;
    // deflect in-flight rounds so they visibly whiff
    for (const tracer of this.tracers) {
      if (!tracer.active || tracer.burst !== index) continue;
      tracer.to.x += burst.missSide * ENEMY_FIRE.MISS_OFFSET;
      tracer.to.y += 1.2;
      tracer.isDamage = false;
    }
  }

  private advanceBursts(dt: number): void {
    for (let i = 0; i < this.bursts.length; i++) {
      const burst = this.bursts[i];
      if (!burst.active) continue;

      // the burst dies with its shooter (fairness: killing them saves you)
      if (!burst.cancelled) {
        const s = burst.shooter;
        if (!s || !s.active || s.spawnId !== burst.shooterSpawnId) this.cancelBurst(i);
      }

      if (!burst.cancelled && burst.fired < ENEMY_FIRE.BURST_TRACERS) {
        burst.nextTimer -= dt;
        if (burst.nextTimer <= 0) {
          this.emitTracer(i, burst);
          burst.fired++;
          burst.nextTimer = ENEMY_FIRE.TRACER_SPACING;
        }
      }

      // free the slot once every emitted round has landed or whiffed
      if ((burst.cancelled || burst.fired >= ENEMY_FIRE.BURST_TRACERS) && burst.inFlight === 0) {
        burst.active = false;
        burst.shooter = null;
      }
    }
  }

  private emitTracer(index: number, burst: Burst): void {
    const shooter = burst.shooter!;
    for (const tracer of this.tracers) {
      if (tracer.active) continue;
      tracer.active = true;
      tracer.burst = index;
      tracer.t = 0;
      shooter.nosePosition(tracer.from);
      tracer.to.copyFrom(this.playerPos);
      // round #2 carries the damage; the rest fan around the player
      tracer.isDamage = burst.willHit && burst.fired === 1;
      if (!tracer.isDamage) {
        const spread = burst.willHit ? 1.4 : ENEMY_FIRE.MISS_OFFSET;
        tracer.to.x += burst.missSide * spread * (0.5 + Math.random() * 0.8);
        tracer.to.y += (Math.random() - 0.35) * 2.2;
      }
      tracer.duration = Math.min(
        ENEMY_FIRE.TRACER_TIME_MAX,
        Math.max(ENEMY_FIRE.TRACER_TIME_MIN, Vector3.Distance(tracer.from, tracer.to) / ENEMY_FIRE.TRACER_SPEED),
      );
      tracer.mesh.setEnabled(true);
      tracer.mesh.position.copyFrom(tracer.from);
      tracer.mesh.lookAt(tracer.to);
      burst.inFlight++;
      return;
    }
    // pool exhausted — the round is dropped (cosmetic-only loss, favors the player)
  }

  private advanceTracers(dt: number): void {
    for (const tracer of this.tracers) {
      if (!tracer.active) continue;
      tracer.t += dt;
      const k = Math.min(1, tracer.t / tracer.duration);
      Vector3.LerpToRef(tracer.from, tracer.to, k, this.tmp);
      tracer.mesh.position.copyFrom(this.tmp);
      if (k < 1) continue;
      tracer.active = false;
      tracer.mesh.setEnabled(false);
      const burst = this.bursts[tracer.burst];
      burst.inFlight--;
      if (tracer.isDamage && !burst.cancelled) this.onPlayerGunHit();
    }
  }
}
