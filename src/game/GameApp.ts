import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { CAMERA, DIFFICULTY_CLAMP_DT, PLAYER } from "./Constants";
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
import { SaveSystem } from "../systems/SaveSystem";
import { DebugSystem } from "../systems/DebugSystem";
import type { PlayablesSDK } from "../systems/PlayablesSDK";
import { PlayerJet } from "../entities/PlayerJet";
import type { EnemyJet } from "../entities/EnemyJet";
import { HUD } from "../ui/HUD";

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
  private weapon: WeaponSystem;
  private score = new ScoreSystem();
  private health = new HealthSystem();
  private save: SaveSystem;
  private playables: PlayablesSDK;
  private debug: DebugSystem | null = null;

  private state: GameState = "ready";
  private paused = false;
  private firstFrameDone = false;
  private baseCamPos = new Vector3(0, CAMERA.POSITION_Y, 0);
  private shakeTmp = new Vector3();

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

    this.env = createEnvironment(this.scene);
    this.vfx = new VFXSystem(this.scene);
    this.save = new SaveSystem(playables);
    this.enemyManager = new EnemyManager(this.scene, this.vfx);
    this.spawner = new EnemySpawner(this.enemyManager, this.camera, this.engine);
    this.playerJet = new PlayerJet(this.scene, this.camera, this.vfx);
    const raycaster = new RaycastShootingSystem(this.scene, this.camera, this.enemyManager);
    this.weapon = new WeaponSystem(raycaster, this.vfx, this.audio, this.playerJet);
    this.input = new InputSystem(canvas);
    this.hud = new HUD(document.getElementById("hud")!);

    this.wire();

    if (import.meta.env.DEV || new URLSearchParams(location.search).has("debug")) {
      (window as { __scene?: Scene }).__scene = this.scene; // live-inspection hook for the verify driver
      this.debug = new DebugSystem(this.scene, this.engine, {
        manager: this.enemyManager,
        spawner: this.spawner,
        weapon: this.weapon,
        health: this.health,
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
    this.hud.setHealth(this.health.hp);
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
    }
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
    this.playerJet.update(dt, ndcX, ndcY);

    if (this.state === "playing") {
      this.spawner.update(dt);
      this.enemyManager.update(dt);
      this.weapon.update(dt, this.input.firing, this.input.x, this.input.y);
    }

    this.debug?.update();
  }

  private startGame(): void {
    this.score.reset();
    this.health.reset();
    this.weapon.reset();
    this.spawner.reset();
    this.enemyManager.clearAll(false);
    this.hud.setScore(0);
    this.hud.setHealth(this.health.hp);
    this.input.center();
    this.audio.unlock();
    this.audio.uiTap();
    this.state = "playing";
  }

  private onKill(enemy: EnemyJet, hitPoint: Vector3): void {
    this.vfx.explosion(enemy.root.position);
    this.audio.explosion();
    const gained = this.score.addKill();
    this.hud.setScore(this.score.score);
    const screen = this.project(hitPoint);
    this.hud.popup(screen.x, screen.y, `+${gained}`);
    enemy.deactivate();
  }

  private onEnemyReached(): void {
    this.audio.playerDamage();
    this.vfx.addShake(PLAYER.DAMAGE_SHAKE);
    this.hud.flashDamage();
    this.hud.warning("WARNING");
    const dead = this.health.damage();
    this.hud.setHealth(this.health.hp, true);
    if (dead) this.endGame();
  }

  private endGame(): void {
    this.state = "gameover";
    this.enemyManager.clearAll(true);
    this.hud.setFiring(false);
    this.audio.gameOver();
    const isNewBest = this.save.submitScore(this.score.score);
    this.hud.showGameOver({
      score: this.score.score,
      best: this.save.bestScore,
      kills: this.score.kills,
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
