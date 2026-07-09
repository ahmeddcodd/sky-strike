import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { VFX } from "../game/Constants";
import { makeFlareTexture } from "../factories/MeshUtils";

// Every effect here is pooled or burst-emitted from a persistent shared particle
// system (manualEmitCount) — nothing is allocated per shot/explosion at runtime.

interface Tracer {
  mesh: Mesh;
  from: Vector3;
  to: Vector3;
  t: number;
  active: boolean;
}

interface FlashSphere {
  mesh: Mesh;
  mat: StandardMaterial;
  t: number;
  active: boolean;
}

interface MuzzleFlash {
  mesh: Mesh;
  t: number;
  active: boolean;
}

export class VFXSystem {
  private scene: Scene;
  private sparksPS!: ParticleSystem;
  private firePS!: ParticleSystem;
  private smokePS!: ParticleSystem;
  private trailPS!: ParticleSystem;
  private wingTrailPS!: ParticleSystem;
  private tracers: Tracer[] = [];
  private flashes: FlashSphere[] = [];
  private muzzles: MuzzleFlash[] = [];
  private shakeIntensity = 0;
  private tmp = new Vector3();

  constructor(scene: Scene) {
    this.scene = scene;
    const flare = makeFlareTexture(scene, "vfxFlareTex");
    this.createParticles(flare);
    this.createTracers();
    this.createFlashSpheres();
    this.createMuzzleFlashes(flare);
  }

  private makeBurstSystem(name: string, capacity: number, tex: DynamicTexture): ParticleSystem {
    const ps = new ParticleSystem(name, capacity, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(0, 0, -1000);
    ps.emitRate = 0;
    ps.manualEmitCount = 0;
    ps.minEmitBox.set(0, 0, 0);
    ps.maxEmitBox.set(0, 0, 0);
    ps.direction1.set(-1, -1, -1);
    ps.direction2.set(1, 1, 1);
    ps.start();
    return ps;
  }

  private createParticles(flare: DynamicTexture): void {
    const sparks = this.makeBurstSystem("sparks", 128, flare);
    sparks.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    sparks.color1 = new Color4(1, 0.95, 0.5, 1);
    sparks.color2 = new Color4(1, 0.6, 0.15, 1);
    sparks.colorDead = new Color4(0.6, 0.2, 0, 0);
    sparks.minSize = 0.14;
    sparks.maxSize = 0.4;
    sparks.minLifeTime = 0.12;
    sparks.maxLifeTime = 0.32;
    sparks.minEmitPower = 7;
    sparks.maxEmitPower = 16;
    sparks.gravity.set(0, -9, 0);
    this.sparksPS = sparks;

    const fire = this.makeBurstSystem("fire", 160, flare);
    fire.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    fire.color1 = new Color4(1, 0.85, 0.35, 1);
    fire.color2 = new Color4(1, 0.4, 0.08, 1);
    fire.colorDead = new Color4(0.4, 0.08, 0, 0);
    fire.minSize = 1.1;
    fire.maxSize = 2.6;
    fire.minLifeTime = 0.2;
    fire.maxLifeTime = 0.5;
    fire.minEmitPower = 4;
    fire.maxEmitPower = 13;
    fire.gravity.set(0, 2, 0);
    this.firePS = fire;

    const smoke = this.makeBurstSystem("smoke", 128, flare);
    smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    smoke.color1 = new Color4(0.28, 0.28, 0.3, 0.55);
    smoke.color2 = new Color4(0.45, 0.44, 0.45, 0.4);
    smoke.colorDead = new Color4(0.5, 0.5, 0.52, 0);
    smoke.minSize = 1.4;
    smoke.maxSize = 3.2;
    smoke.minLifeTime = 0.6;
    smoke.maxLifeTime = 1.2;
    smoke.minEmitPower = 1.5;
    smoke.maxEmitPower = 4.5;
    smoke.gravity.set(0, 3.5, 0);
    this.smokePS = smoke;

    const trail = this.makeBurstSystem("trail", 256, flare);
    trail.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    trail.color1 = new Color4(1, 1, 1, 0.32);
    trail.color2 = new Color4(0.95, 0.97, 1, 0.22);
    trail.colorDead = new Color4(1, 1, 1, 0);
    trail.minSize = 0.5;
    trail.maxSize = 1.0;
    trail.minLifeTime = 0.4;
    trail.maxLifeTime = 0.75;
    trail.minEmitPower = 0.1;
    trail.maxEmitPower = 0.4;
    this.trailPS = trail;

    // thin streamers off the player jet's wingtips — smaller/shorter than enemy contrails
    const wing = this.makeBurstSystem("wingTrail", 192, flare);
    wing.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    wing.color1 = new Color4(1, 1, 1, 0.28);
    wing.color2 = new Color4(0.9, 0.96, 1, 0.18);
    wing.colorDead = new Color4(1, 1, 1, 0);
    wing.minSize = 0.16;
    wing.maxSize = 0.3;
    wing.minLifeTime = 0.25;
    wing.maxLifeTime = 0.45;
    wing.minEmitPower = 0.05;
    wing.maxEmitPower = 0.2;
    this.wingTrailPS = wing;
  }

  private createTracers(): void {
    const mat = new StandardMaterial("tracerMat", this.scene);
    mat.emissiveColor = new Color3(1, 0.9, 0.45);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.fogEnabled = false;

    for (let i = 0; i < VFX.TRACER_POOL; i++) {
      const mesh = CreateCylinder(`tracer${i}`, { height: 1, diameter: 0.07, tessellation: 5 }, this.scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.bakeCurrentTransformIntoVertices(); // beam now extends along +Z so lookAt aims it
      mesh.scaling.z = 7;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.tracers.push({ mesh, from: new Vector3(), to: new Vector3(), t: 0, active: false });
    }
  }

  private createFlashSpheres(): void {
    for (let i = 0; i < VFX.FLASH_POOL; i++) {
      const mesh = CreateSphere(`flash${i}`, { diameter: 1, segments: 8 }, this.scene);
      const mat = new StandardMaterial(`flashMat${i}`, this.scene);
      mat.emissiveColor = new Color3(1, 0.72, 0.25);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      mat.alpha = 1;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.flashes.push({ mesh, mat, t: 0, active: false });
    }
  }

  private createMuzzleFlashes(flare: DynamicTexture): void {
    const mat = new StandardMaterial("muzzleMat", this.scene);
    mat.emissiveTexture = flare;
    mat.opacityTexture = flare;
    mat.emissiveColor = new Color3(1, 0.85, 0.4);
    mat.diffuseColor = Color3.Black();
    mat.disableLighting = true;
    mat.alphaMode = 1; // additive
    mat.fogEnabled = false;

    for (let i = 0; i < 3; i++) {
      const mesh = CreatePlane(`muzzle${i}`, { size: 1 }, this.scene);
      mesh.material = mat;
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.muzzles.push({ mesh, t: 0, active: false });
    }
  }

  // ---------- public effect triggers ----------

  hitSparks(point: Vector3): void {
    (this.sparksPS.emitter as Vector3).copyFrom(point);
    this.sparksPS.manualEmitCount += 10;
  }

  explosion(point: Vector3): void {
    (this.firePS.emitter as Vector3).copyFrom(point);
    this.firePS.manualEmitCount += 34;
    (this.smokePS.emitter as Vector3).copyFrom(point);
    this.smokePS.manualEmitCount += 14;
    (this.sparksPS.emitter as Vector3).copyFrom(point);
    this.sparksPS.manualEmitCount += 14;

    for (const flash of this.flashes) {
      if (flash.active) continue;
      flash.active = true;
      flash.t = 0;
      flash.mesh.position.copyFrom(point);
      flash.mesh.setEnabled(true);
      break;
    }
    this.addShake(VFX.EXPLOSION_SHAKE);
  }

  /** Single engine-trail puff; called on a cadence per jet, not per frame. */
  trailPuff(point: Vector3): void {
    (this.trailPS.emitter as Vector3).copyFrom(point);
    this.trailPS.manualEmitCount += 1;
  }

  /** Distant anti-air burst — war ambience, deliberately NO camera shake. */
  flakBurst(point: Vector3): void {
    (this.firePS.emitter as Vector3).copyFrom(point);
    this.firePS.manualEmitCount += 7;
    (this.smokePS.emitter as Vector3).copyFrom(point);
    this.smokePS.manualEmitCount += 4;
  }

  /** Flames licking off a burning wreck; called on a cadence while it's in view. */
  wreckFire(point: Vector3): void {
    (this.firePS.emitter as Vector3).copyFrom(point);
    this.firePS.manualEmitCount += 2;
    (this.smokePS.emitter as Vector3).copyFrom(point);
    this.smokePS.manualEmitCount += 1;
  }

  /** Tiny wingtip streamer puff for the player jet. */
  wingTrail(point: Vector3): void {
    (this.wingTrailPS.emitter as Vector3).copyFrom(point);
    this.wingTrailPS.manualEmitCount += 1;
  }

  /** Dark smoke for a damaged jet. */
  damageSmoke(point: Vector3): void {
    (this.smokePS.emitter as Vector3).copyFrom(point);
    this.smokePS.manualEmitCount += 1;
  }

  tracer(from: Vector3, to: Vector3): void {
    for (const tracer of this.tracers) {
      if (tracer.active) continue;
      tracer.active = true;
      tracer.t = 0;
      tracer.from.copyFrom(from);
      tracer.to.copyFrom(to);
      tracer.mesh.setEnabled(true);
      tracer.mesh.position.copyFrom(from);
      tracer.mesh.lookAt(to);
      break;
    }
  }

  muzzleFlash(point: Vector3): void {
    for (const muzzle of this.muzzles) {
      if (muzzle.active) continue;
      muzzle.active = true;
      muzzle.t = 0;
      muzzle.mesh.position.copyFrom(point);
      const scale = 0.5 + Math.random() * 0.4;
      muzzle.mesh.scaling.set(scale, scale, scale);
      muzzle.mesh.rotation.z = Math.random() * Math.PI;
      muzzle.mesh.setEnabled(true);
      break;
    }
  }

  addShake(amount: number): void {
    this.shakeIntensity = Math.min(this.shakeIntensity + amount, 0.5);
  }

  /** Random positional offset for the camera this frame, scaled by shake intensity. */
  getShakeOffset(out: Vector3): Vector3 {
    out.set(
      (Math.random() - 0.5) * 2 * this.shakeIntensity,
      (Math.random() - 0.5) * 2 * this.shakeIntensity,
      0,
    );
    return out;
  }

  update(dt: number): void {
    this.shakeIntensity = Math.max(0, this.shakeIntensity - 4.5 * dt);

    for (const tracer of this.tracers) {
      if (!tracer.active) continue;
      tracer.t += dt;
      const k = Math.min(1, tracer.t / VFX.TRACER_TIME);
      Vector3.LerpToRef(tracer.from, tracer.to, k, this.tmp);
      tracer.mesh.position.copyFrom(this.tmp);
      if (k >= 1) {
        tracer.active = false;
        tracer.mesh.setEnabled(false);
      }
    }

    for (const flash of this.flashes) {
      if (!flash.active) continue;
      flash.t += dt;
      const k = flash.t / 0.28;
      if (k >= 1) {
        flash.active = false;
        flash.mesh.setEnabled(false);
        continue;
      }
      const scale = 1.2 + k * 4.5;
      flash.mesh.scaling.set(scale, scale, scale);
      flash.mat.alpha = 1 - k;
    }

    for (const muzzle of this.muzzles) {
      if (!muzzle.active) continue;
      muzzle.t += dt;
      if (muzzle.t >= 0.045) {
        muzzle.active = false;
        muzzle.mesh.setEnabled(false);
      }
    }
  }
}
