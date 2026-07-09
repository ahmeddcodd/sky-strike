import type { Scene } from "@babylonjs/core/scene";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { PLAYER, WORLD } from "../game/Constants";
import type { EnemyManager } from "./EnemyManager";
import type { EnemySpawner } from "./EnemySpawner";
import type { WeaponSystem } from "./WeaponSystem";
import type { HealthSystem } from "./HealthSystem";
import type { ComboSystem } from "./ComboSystem";
import type { MissileSystem } from "./MissileSystem";
import type { PowerUpSystem } from "./PowerUpSystem";
import type { EnemyFireSystem } from "./EnemyFireSystem";
import type { Environment } from "../factories/EnvironmentFactory";

// Tuning tools (spec §45). Only constructed in dev builds or with ?debug=1.
// Hotkeys: ` visuals · J spawn jet · C clear · I invincible · W skip wave
//          N night toggle · P spawn power-up pod · M force an enemy missile.

interface DebugDeps {
  manager: EnemyManager;
  spawner: EnemySpawner;
  weapon: WeaponSystem;
  health: HealthSystem;
  combo: ComboSystem;
  env: Environment;
  missiles: MissileSystem;
  powerUps: PowerUpSystem;
  enemyFire: EnemyFireSystem;
  hudRoot: HTMLElement;
}

export class DebugSystem {
  private visible = false;
  private engine: Engine;
  private deps: DebugDeps;
  private panel: HTMLDivElement;
  private dangerPlane: Mesh;
  private rayLine: LinesMesh;
  private rayPoints = [new Vector3(0, -1, 2), new Vector3(0, 0, 60)];
  private hitboxMat: StandardMaterial;

  constructor(scene: Scene, engine: Engine, deps: DebugDeps) {
    this.engine = engine;
    this.deps = deps;

    this.hitboxMat = new StandardMaterial("debugHitboxMat", scene);
    this.hitboxMat.wireframe = true;
    this.hitboxMat.emissiveColor = new Color3(0.2, 1, 0.4);
    this.hitboxMat.disableLighting = true;

    // a band (not full-frustum) so it reads as a plane sitting at z = DANGER_Z
    this.dangerPlane = CreatePlane("debugDangerPlane", { width: 20, height: 7 }, scene);
    const dangerMat = new StandardMaterial("debugDangerMat", scene);
    dangerMat.emissiveColor = new Color3(1, 0.15, 0.15);
    dangerMat.diffuseColor = Color3.Black();
    dangerMat.disableLighting = true;
    dangerMat.alpha = 0.22;
    dangerMat.backFaceCulling = false;
    this.dangerPlane.material = dangerMat;
    this.dangerPlane.position.z = WORLD.DANGER_Z;
    this.dangerPlane.isPickable = false;
    this.dangerPlane.setEnabled(false);

    this.rayLine = CreateLines("debugRay", { points: this.rayPoints, updatable: true }, scene);
    this.rayLine.color = new Color3(1, 0.95, 0.2);
    this.rayLine.isPickable = false;
    this.rayLine.setEnabled(false);

    deps.weapon.onDebugShot = (from, to) => {
      if (!this.visible) return;
      this.rayPoints[0].copyFrom(from);
      this.rayPoints[1].copyFrom(to);
      CreateLines("debugRay", { points: this.rayPoints, instance: this.rayLine });
    };

    this.panel = document.createElement("div");
    this.panel.className = "debug-panel";
    this.panel.style.display = "none";
    deps.hudRoot.appendChild(this.panel);

    window.addEventListener("keydown", (e) => {
      switch (e.code) {
        case "Backquote":
          this.toggle();
          break;
        case "KeyJ":
          deps.spawner.spawnOne();
          break;
        case "KeyC":
          deps.manager.clearAll(false);
          break;
        case "KeyI":
          deps.health.invincible = !deps.health.invincible;
          break;
        case "KeyW":
          deps.spawner.skipWave();
          break;
        case "KeyN":
          deps.env.snapNight(deps.env.nightFactor > 0.5 ? 0 : 1);
          break;
        case "KeyP":
          deps.powerUps.debugSpawn();
          break;
        case "KeyM":
          deps.enemyFire.debugForceMissile = true;
          deps.spawner.spawnOne("armored");
          break;
      }
    });
  }

  private toggle(): void {
    this.visible = !this.visible;
    this.dangerPlane.setEnabled(this.visible);
    this.rayLine.setEnabled(this.visible);
    this.panel.style.display = this.visible ? "block" : "none";
    for (const enemy of this.deps.manager.enemies) {
      for (const box of enemy.hitboxes) {
        box.isVisible = this.visible;
        if (!box.material) box.material = this.hitboxMat;
      }
    }
  }

  update(): void {
    if (!this.visible) return;
    this.panel.textContent =
      `FPS        ${this.engine.getFps().toFixed(0)}\n` +
      `wave       ${this.deps.spawner.wave}\n` +
      `enemies    ${this.deps.manager.activeCount}\n` +
      `shots/hits ${this.deps.weapon.shots}/${this.deps.weapon.hits}\n` +
      `combo      ${this.deps.combo.streak} (×${this.deps.combo.multiplier})\n` +
      `hp         ${this.deps.health.hp}/${PLAYER.MAX_HEALTH}\n` +
      `missiles   ${this.deps.missiles.hostileCount}\n` +
      `power      ${this.deps.powerUps.pillText ?? "-"}\n` +
      `night      ${this.deps.env.nightFactor.toFixed(2)}\n` +
      `invincible ${this.deps.health.invincible ? "ON" : "off"}\n` +
      `keys: \` boxes · J spawn · C clear · I invinc · W wave · N night · P pod · M missile`;
  }
}
