import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { CAMERA, DIFFICULTY_CLAMP_DT, MISSILE, NIGHT, PLAYER, POWERUP, WAVE } from "./Constants";
import { createEnvironment, type Environment } from "../factories/EnvironmentFactory";
import { EnemyManager } from "../systems/EnemyManager";
import { EnemySpawner } from "../systems/EnemySpawner";
import { RaycastShootingSystem } from "../systems/RaycastShootingSystem";
import { WeaponSystem } from "../systems/WeaponSystem";
import { VFXSystem } from "../systems/VFXSystem";
import { AudioSystem } from "../systems/AudioSystem";
import { InputSystem } from "../systems/InputSystem";
import { ScoreSystem } from "../systems/ScoreSystem";
import { HealthSystem } from "../systems/HealthSystem";
import { ComboSystem } from "../systems/ComboSystem";
import { SaveSystem } from "../systems/SaveSystem";
import { DebugSystem } from "../systems/DebugSystem";
import { EnemyFireSystem } from "../systems/EnemyFireSystem";
import { MissileSystem } from "../systems/MissileSystem";
import { PowerUpSystem } from "../systems/PowerUpSystem";
import type { PlayablesSDK } from "../systems/PlayablesSDK";
import { PlayerJet } from "../entities/PlayerJet";
import type { EnemyJet } from "../entities/EnemyJet";
import type { PowerUpType } from "../entities/PowerUpPod";
import { HUD, type HpBarInfo } from "../ui/HUD";

const POWERUP_NAMES: Record<PowerUpType, string> = {
  heavy: "HEAVY BULLETS",
  missiles: "HOMING MISSILES",
  ghost: "GHOST MODE",
};

type GameState = "ready" | "playing" | "gameover";

export class GameApp {
  private engine: Engine;
  private scene: Scene;
  private camera: TargetCamera;
  private env: Environment;
  private vfx: VFXSystem;
  private audio = new AudioSystem();
  private input: InputSystem;
  private hud: HUD;
  private enemyManager: EnemyManager;
  private spawner: EnemySpawner;
  private playerJet: PlayerJet;
  private raycaster: RaycastShootingSystem;
  private weapon: WeaponSystem;
  private missiles: MissileSystem;
  private enemyFire: EnemyFireSystem;
  private powerUps: PowerUpSystem;
  private score = new ScoreSystem();
  private health = new HealthSystem();
  private combo = new ComboSystem();
  private save: SaveSystem;
  private playables: PlayablesSDK;
  private debug: DebugSystem | null = null;

  private state: GameState = "ready";
  private paused = false;
  private firstFrameDone = false;
  private baseCamPos = new Vector3(0, CAMERA.POSITION_Y, 0);
  private shakeTmp = new Vector3();
  private barAnchor = new Vector3();
  private hpBarInfos: HpBarInfo[] = [];

  constructor(canvas: HTMLCanvasElement, playables: PlayablesSDK) {
    this.playables = playables;

    this.engine = new Engine(canvas, true, {
      stencil: false,
      alpha: false,
      doNotHandleContextLost: true,
      powerPreference: "high-performance",
    });
    this.applyResolution();
    this.scene = new Scene(this.engine);
    this.scene.skipPointerMovePicking = true;

    this.camera = new TargetCamera("cam", this.baseCamPos.clone(), this.scene);
    this.camera.setTarget(new Vector3(0, 3, 100));
    this.camera.fov = CAMERA.FOV;
    this.camera.minZ = 0.3;
    this.camera.maxZ = 1500;

    this.vfx = new VFXSystem(this.scene);
    this.env = createEnvironment(this.scene, this.vfx);
    this.save = new SaveSystem(playables);
    this.enemyManager = new EnemyManager(this.scene, this.vfx);
    this.spawner = new EnemySpawner(this.enemyManager, this.camera, this.engine);
    this.playerJet = new PlayerJet(this.scene, this.camera, this.vfx);
    this.missiles = new MissileSystem(this.scene, this.vfx, this.playerJet);
    this.raycaster = new RaycastShootingSystem(this.scene, this.camera, this.enemyManager, this.missiles);
    this.weapon = new WeaponSystem(this.raycaster, this.vfx, this.audio, this.playerJet);
    this.powerUps = new PowerUpSystem(this.scene, this.camera, this.engine, this.playerJet, this.weapon);
    this.raycaster.setPods(this.powerUps); // late injection: powerUps needs weapon, weapon needs raycaster
    this.enemyFire = new EnemyFireSystem(this.scene, this.enemyManager, this.playerJet, this.vfx, this.audio, this.missiles);
    this.input = new InputSystem(canvas);
    this.hud = new HUD(document.getElementById("hud")!);

    this.wire();

    if (import.meta.env.DEV || new URLSearchParams(location.search).has("debug")) {
      // live-inspection hooks for the verify driver
      const w = window as { __scene?: Scene; __audioMuted?: boolean; __paused?: boolean; __musicOn?: boolean };
      w.__scene = this.scene;
      Object.defineProperty(w, "__audioMuted", { get: () => this.audio.isMuted, configurable: true });
      Object.defineProperty(w, "__paused", { get: () => this.paused, configurable: true });
      Object.defineProperty(w, "__musicOn", { get: () => this.audio.isMusicOn, configurable: true });
      this.debug = new DebugSystem(this.scene, this.engine, {
        manager: this.enemyManager,
        spawner: this.spawner,
        weapon: this.weapon,
        health: this.health,
        combo: this.combo,
        env: this.env,
        missiles: this.missiles,
        powerUps: this.powerUps,
        enemyFire: this.enemyFire,
        hudRoot: document.getElementById("hud")!,
      });
    }
  }

  private wire(): void {
    this.input.onPointerDown = () => this.audio.unlock();
    this.input.onModeChange = (touch) => this.hud.setTouchMode(touch);
    this.hud.onStart = () => this.startGame();
    this.hud.onRestart = () => this.startGame();
    this.weapon.onKill = (enemy, point) => this.onKill(enemy, point);
    this.weapon.onHitMarker = () => this.hud.hitMarker();
    this.enemyManager.onReached = () => this.onEnemyReached();
    this.combo.onChange = (streak, multiplier) => this.hud.setCombo(streak, multiplier);

    // shooting the special targets
    this.weapon.onMissileShot = (missile, point) => this.missiles.intercept(missile, point);
    this.weapon.onPodShot = (pod, point) => this.powerUps.collect(pod, point);
    this.weapon.fireHomingMissile = (x, y, muzzle) => {
      const target = this.raycaster.nearestToRay(x, y);
      if (!target) return false;
      this.missiles.launchAtEnemy(muzzle, target);
      return true;
    };

    // enemy offense → player hull
    this.enemyFire.onPlayerGunHit = () => this.damagePlayer(PLAYER.GUN_HIT_DAMAGE, false, 0.12);
    this.missiles.onLaunch = () => {
      this.hud.warning("MISSILE!");
      this.audio.missileAlarm();
    };
    this.missiles.onPlayerHit = (point) => {
      this.vfx.explosion(point);
      this.audio.explosion();
      this.damagePlayer(PLAYER.MISSILE_HIT_DAMAGE, true, 0.5);
    };
    this.missiles.onIntercepted = (_missile, point) => {
      this.vfx.explosion(point);
      this.audio.explosion();
      this.score.addBonus(MISSILE.INTERCEPT_SCORE);
      this.hud.setScore(this.score.score);
      const screen = this.project(point);
      this.hud.popup(screen.x, screen.y, `INTERCEPTED +${MISSILE.INTERCEPT_SCORE}`);
    };
    this.missiles.onEnemyHit = (enemy, point) => {
      if (enemy.takeDamage(MISSILE.PLAYER_DAMAGE, point)) this.onKill(enemy, point);
      else this.vfx.explosion(point);
    };

    // power-ups
    this.powerUps.onPickup = (type, point) => {
      this.audio.pickup();
      this.score.addBonus(POWERUP.COLLECT_SCORE);
      this.hud.setScore(this.score.score);
      this.hud.warning(POWERUP_NAMES[type], true);
      const screen = this.project(point);
      this.hud.popup(screen.x, screen.y, `+${POWERUP.COLLECT_SCORE}`);
    };
    this.powerUps.onExpire = () => this.audio.powerExpire();
    this.powerUps.onGhostChange = (active) => {
      this.enemyFire.setGhost(active);
      this.missiles.setGhost(active);
    };

    this.spawner.onWaveStart = (wave) => {
      this.hud.setWave(wave);
      this.hud.warning(`WAVE ${wave}`, true);
      this.audio.waveStart();
      this.audio.setMusicIntensity(wave); // music gets busier as waves climb
      this.enemyFire.setWave(wave);
      this.powerUps.onWaveStart(wave);
      // night falls as the waves progress (spec: day → dusk → night)
      const target = NIGHT.TARGETS[Math.min(wave, NIGHT.TARGETS.length - 1)];
      this.env.setNightTarget(target);
    };
    this.spawner.onWaveClear = (wave) => {
      const bonus = WAVE.CLEAR_BONUS_BASE + WAVE.CLEAR_BONUS_PER_WAVE * wave;
      this.score.addBonus(bonus);
      this.hud.setScore(this.score.score);
      this.hud.warning(`WAVE CLEAR  +${bonus}`, true);
      this.audio.waveClear();
      // breather: patch the hull up a little between waves
      this.health.heal(PLAYER.WAVE_CLEAR_HEAL);
      this.hud.setHealth(this.health.fraction);
    };

    this.playables.onPause = () => this.setPaused(true);
    this.playables.onResume = () => this.setPaused(false);
    this.playables.onAudioChange = (enabled) => this.audio.setMuted(!enabled);
    document.addEventListener("visibilitychange", () => this.setPaused(document.hidden));
    window.addEventListener("resize", () => {
      this.applyResolution(); // DPR can change (window moved between monitors)
      this.engine.resize();
    });
  }

  /** Render at native device resolution (capped at 2×) — CSS-resolution rendering
   *  is what made the game blurry and washed-out on phones with DPR 2-3. */
  private applyResolution(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.engine.setHardwareScalingLevel(1 / dpr);
  }

  start(): void {
    this.audio.setMuted(!this.playables.audioEnabled);
    this.input.center();
    this.hud.setTouchMode(this.input.touchMode);
    this.hud.setHealth(this.health.fraction);
    this.hud.showStart(this.save.bestScore);
    void this.save.load().then(() => {
      if (this.state === "ready") this.hud.showStart(this.save.bestScore);
    });
    this.engine.runRenderLoop(() => this.frame());
  }

  private frame(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, DIFFICULTY_CLAMP_DT);
    if (!this.paused) this.update(dt);
    this.scene.render();
    if (!this.firstFrameDone) {
      this.firstFrameDone = true;
      this.playables.firstFrameReady();
      this.playables.gameReady(); // start overlay is already interactive
      this.hideLoader();
    }
  }

  /** Fades out the initial loading screen once the first frame is on screen. */
  private hideLoader(): void {
    const loader = document.getElementById("loader");
    if (!loader) return;
    loader.classList.add("done");
    loader.addEventListener("transitionend", () => loader.remove(), { once: true });
  }

  private update(dt: number): void {
    this.env.update(dt);
    this.vfx.update(dt);
    this.input.update(dt);

    this.hud.setCrosshair(this.input.x, this.input.y);
    this.hud.setFiring(this.input.firing && this.state === "playing");

    this.vfx.getShakeOffset(this.shakeTmp);
    this.camera.position.copyFrom(this.baseCamPos).addInPlace(this.shakeTmp);

    // cosmetic: the player jet banks/drifts toward the crosshair (NDC space).
    // CSS-pixel based so it's independent of the render buffer's DPR scaling.
    const ndcX = (this.input.x / Math.max(1, window.innerWidth)) * 2 - 1;
    const ndcY = (this.input.y / Math.max(1, window.innerHeight)) * 2 - 1;
    this.playerJet.update(dt, ndcX, ndcY, this.env.nightFactor);

    if (this.state === "playing") {
      this.combo.update(dt);
      this.spawner.update(dt);
      this.enemyManager.update(dt, this.env.nightFactor);
      this.enemyFire.update(dt); // after enemies moved — reads fresh positions
      this.missiles.update(dt);
      this.powerUps.update(dt);
      this.weapon.update(dt, this.input.firing, this.input.x, this.input.y);
    }

    this.hud.setPowerUp(this.state === "playing" ? this.powerUps.pillText : null);
    this.updateHpBars();
    this.debug?.update();
  }

  /** Projects a health bar above every active enemy (CSS px, pooled DOM),
   *  plus the player's on-jet hull bar and the power-up pod label. */
  private updateHpBars(): void {
    this.hpBarInfos.length = 0;
    if (this.state === "playing") {
      for (const enemy of this.enemyManager.enemies) {
        if (!enemy.active) continue;
        this.barAnchor.copyFrom(enemy.root.position);
        this.barAnchor.y += 2.4 * enemy.def.hitboxScale;
        const screen = this.project(this.barAnchor);
        if (screen.z < 0 || screen.z > 1) continue; // behind the camera
        this.hpBarInfos.push({
          x: screen.x,
          y: screen.y,
          fraction: enemy.healthFraction,
          width: enemy.def.barWidth,
        });
      }

      this.playerJet.getWorldPosition(this.barAnchor);
      this.barAnchor.y -= 1.2;
      const jetScreen = this.project(this.barAnchor);
      this.hud.setPlayerBar(jetScreen.x, jetScreen.y, jetScreen.z >= 0 && jetScreen.z <= 1);

      const pod = this.powerUps.activePod;
      if (pod) {
        this.barAnchor.copyFrom(pod.position);
        this.barAnchor.y -= 1.7;
        const podScreen = this.project(this.barAnchor);
        const onScreen = podScreen.z >= 0 && podScreen.z <= 1;
        this.hud.setPodLabel(podScreen.x, podScreen.y, onScreen ? pod.type.toUpperCase() : null, pod.type);
      } else {
        this.hud.setPodLabel(0, 0, null, "");
      }
    } else {
      this.hud.setPlayerBar(0, 0, false);
      this.hud.setPodLabel(0, 0, null, "");
    }
    this.hud.updateHpBars(this.hpBarInfos);
  }

  private startGame(): void {
    this.score.reset();
    this.health.reset();
    this.weapon.reset();
    this.spawner.reset();
    this.combo.reset();
    this.enemyFire.reset();
    this.missiles.reset();
    this.powerUps.reset();
    this.env.snapNight(0); // every run starts at dawn
    this.enemyManager.clearAll(false);
    this.hud.setScore(0);
    this.hud.setWave(0);
    this.hud.setHealth(this.health.fraction);
    this.hud.setPowerUp(null);
    this.hud.setHudVisible(true);
    this.input.center();
    this.audio.unlock();
    this.audio.uiTap();
    this.audio.setMusicIntensity(1);
    this.audio.startMusic(); // cinematic bed during play; menu stays quiet
    this.state = "playing";
  }

  private onKill(enemy: EnemyJet, hitPoint: Vector3): void {
    this.vfx.explosion(enemy.root.position);
    this.audio.explosion();
    const multiplier = this.combo.kill();
    const gained = this.score.addKill(enemy.def.score, multiplier);
    this.hud.setScore(this.score.score);
    const screen = this.project(hitPoint);
    this.hud.popup(screen.x, screen.y, multiplier > 1 ? `+${gained} ×${multiplier}` : `+${gained}`);
    enemy.deactivate();
  }

  private onEnemyReached(): void {
    this.hud.warning("WARNING");
    this.damagePlayer(PLAYER.SLIP_PAST_DAMAGE, true, PLAYER.DAMAGE_SHAKE);
  }

  /** Central hull-damage path. Gun chips don't break the combo; big hits do. */
  private damagePlayer(amount: number, breakCombo: boolean, shake: number): void {
    if (this.state !== "playing") return;
    this.audio.playerDamage();
    this.vfx.addShake(shake);
    this.hud.flashDamage();
    if (breakCombo) this.combo.reset(); // heavy damage breaks the chain (spec §22)
    const dead = this.health.damage(amount);
    this.hud.setHealth(this.health.fraction, true);
    if (dead) this.endGame();
  }

  private endGame(): void {
    this.state = "gameover";
    this.enemyManager.clearAll(true);
    this.missiles.clearAll(true);
    this.powerUps.reset();
    this.hud.setFiring(false);
    this.hud.setHudVisible(false);
    this.audio.stopMusic();
    this.audio.gameOver();
    const isNewBest = this.save.submitScore(this.score.score);
    this.hud.showGameOver({
      score: this.score.score,
      best: this.save.bestScore,
      kills: this.score.kills,
      wave: this.spawner.wave,
      accuracy: this.weapon.accuracy,
      isNewBest,
    });
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.audio.suspend();
    else this.audio.resume();
  }

  /** World point → CSS-pixel screen coords (for DOM popups). */
  private project(point: Vector3): Vector3 {
    const coords = Vector3.Project(
      point,
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight()),
    );
    // Vector3.Project returns render-buffer pixels; DOM lives in CSS pixels
    const scale = this.engine.getHardwareScalingLevel();
    coords.x *= scale;
    coords.y *= scale;
    return coords;
  }
}
