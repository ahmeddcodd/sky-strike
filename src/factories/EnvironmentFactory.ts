import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { WORLD } from "../game/Constants";
import { paint, seededRand } from "./MeshUtils";

// Clear-day ocean airspace with a constant forward-flight illusion: the ocean
// texture scrolls toward the camera, low-poly islands stream past and respawn
// ahead, and near cloud wisps blow by. Enemy gameplay speed is separate.
//
// DynamicTexture orientation note: canvas bottom maps to plane/texture TOP here,
// so vertical artwork (mountains, cloud shading) is drawn flipped.

const HORIZON = new Color3(0.72, 0.84, 0.94);
const OCEAN_SIZE = 1600;
const OCEAN_TILES = 8;

interface DriftCloud {
  mesh: Mesh;
  speed: number;
}

interface StreamItem {
  mesh: Mesh;
  speed: number; // toward the camera, world units/s
  respawnMin: number;
  respawnMax: number;
  despawnZ: number;
}

export class Environment {
  private scene: Scene;
  private distantClouds: DriftCloud[] = [];
  private streamers: StreamItem[] = [];
  private islands: Mesh[] = [];
  private oceanTex!: DynamicTexture;
  private rand = seededRand(7);

  constructor(scene: Scene) {
    this.scene = scene;
    scene.clearColor = new Color4(HORIZON.r, HORIZON.g, HORIZON.b, 1);
    scene.fogMode = 2; // Scene.FOGMODE_EXP2 (constant inlined to keep imports lean)
    scene.fogDensity = WORLD.FOG_DENSITY;
    scene.fogColor = HORIZON;

    this.createLights();
    this.createSkyDome();
    this.createSun();
    this.createOcean();
    this.createMountains();
    this.createClouds();
    this.createIslands();
  }

  private createLights(): void {
    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, -0.3), this.scene);
    hemi.intensity = 0.85;
    hemi.diffuse = new Color3(1, 1, 1);
    hemi.specular = Color3.Black(); // ambient specular washes the ocean out
    hemi.groundColor = new Color3(0.45, 0.55, 0.68);

    const sun = new DirectionalLight("sun", new Vector3(-0.35, -0.6, -0.7), this.scene);
    sun.intensity = 1.0;
    sun.diffuse = new Color3(1, 0.96, 0.88);
    sun.specular = new Color3(0.7, 0.68, 0.6);
  }

  private createSkyDome(): void {
    const tex = new DynamicTexture("skyTex", { width: 8, height: 512 }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#1d5fc0"); // zenith
    grad.addColorStop(0.38, "#4b8dda");
    grad.addColorStop(0.58, "#8fc0ea");
    grad.addColorStop(0.7, "#d3e8f7");
    grad.addColorStop(0.78, "#efe7d5"); // warm haze at the horizon
    grad.addColorStop(1, "#8fb6d8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, 512);
    // faint per-pixel noise dithers the gradient — kills banding on mobile screens
    const rand = seededRand(29);
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = `rgba(${rand() > 0.5 ? 255 : 0},${rand() > 0.5 ? 255 : 0},${rand() > 0.5 ? 255 : 0},0.012)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    tex.update(false);

    const dome = CreateSphere("sky", { diameter: 1000, segments: 12, sideOrientation: Mesh.BACKSIDE }, this.scene);
    const mat = new StandardMaterial("skyMat", this.scene);
    mat.emissiveTexture = tex;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.fogEnabled = false;
    dome.material = mat;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.freezeWorldMatrix();
  }

  private createSun(): void {
    const tex = new DynamicTexture("sunTex", { width: 256, height: 256 }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 256);
    const grad = ctx.createRadialGradient(128, 128, 6, 128, 128, 128);
    grad.addColorStop(0, "rgba(255,255,250,1)");
    grad.addColorStop(0.1, "rgba(255,250,225,0.95)");
    grad.addColorStop(0.3, "rgba(255,242,200,0.45)");
    grad.addColorStop(0.65, "rgba(255,238,195,0.14)");
    grad.addColorStop(1, "rgba(255,236,190,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    tex.update(false);
    tex.hasAlpha = true;

    // keep the glow plane well inside the sky dome (radius 500) or it clips
    const plane = CreatePlane("sunGlow", { size: 150 }, this.scene);
    const mat = new StandardMaterial("sunMat", this.scene);
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.fogEnabled = false;
    mat.alphaMode = 1; // additive
    plane.material = mat;
    plane.position.set(95, 130, 300);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    plane.applyFog = false;
  }

  private createOcean(): void {
    const tex = new DynamicTexture("oceanTex", { width: 256, height: 256 }, this.scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#1b5687";
    ctx.fillRect(0, 0, 256, 256);
    // every feature is drawn at all 9 wrap offsets so the tile is seamless
    const wrapped = (draw: (dx: number, dy: number) => void) => {
      for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) draw(dx, dy);
    };
    // broad darker swells
    for (let i = 0; i < 10; i++) {
      const x = this.rand() * 256;
      const y = this.rand() * 256;
      const rx = 26 + this.rand() * 46;
      const ry = 10 + this.rand() * 18;
      wrapped((dx, dy) => {
        ctx.fillStyle = "rgba(10,50,90,0.3)";
        ctx.beginPath();
        ctx.ellipse(x + dx, y + dy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // soft elongated wave glints
    for (let i = 0; i < 90; i++) {
      const x = this.rand() * 256;
      const y = this.rand() * 256;
      const rx = 6 + this.rand() * 20;
      const ry = 1.2 + this.rand() * 1.8;
      const light = 0.18 + this.rand() * 0.24;
      wrapped((dx, dy) => {
        ctx.fillStyle = `rgba(125,190,232,${light.toFixed(2)})`;
        ctx.beginPath();
        ctx.ellipse(x + dx, y + dy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // a few sun-catching crests
    for (let i = 0; i < 18; i++) {
      const x = this.rand() * 256;
      const y = this.rand() * 256;
      const rx = 4 + this.rand() * 9;
      wrapped((dx, dy) => {
        ctx.fillStyle = "rgba(228,244,255,0.5)";
        ctx.beginPath();
        ctx.ellipse(x + dx, y + dy, rx, 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    tex.update(false);
    tex.uScale = OCEAN_TILES;
    tex.vScale = OCEAN_TILES;
    // DynamicTexture defaults to CLAMP — tiling + scrolling need WRAP
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 8; // keep the waves readable at grazing angles
    this.oceanTex = tex;

    const ocean = CreateGround("ocean", { width: OCEAN_SIZE, height: OCEAN_SIZE }, this.scene);
    const mat = new StandardMaterial("oceanMat", this.scene);
    mat.diffuseTexture = tex;
    // hemi + sun sum to ~1.85× — damp the multiplier or the waves clip to white
    mat.diffuseColor = new Color3(0.58, 0.62, 0.68);
    mat.specularColor = new Color3(0.4, 0.4, 0.34); // sun glint band
    mat.specularPower = 300;
    ocean.material = mat;
    ocean.position.set(0, -32, 400);
    ocean.isPickable = false;
    ocean.freezeWorldMatrix();
  }

  private createMountains(): void {
    const tex = new DynamicTexture("mountainTex", { width: 1024, height: 256 }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 1024, 256);
    // Hazy ridge silhouettes on the horizon. Drawn "upside down" (see class note):
    // solid base fills from canvas y=0, peaks point down-canvas (= up on screen).
    const ridge = (baseY: number, amp: number, color: string, seed: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let x = 0; x <= 1024; x += 32) {
        const n = Math.sin(x * 0.013 + seed) + Math.sin(x * 0.031 + seed * 2.7) * 0.55;
        ctx.lineTo(x, baseY + Math.abs(n) * amp);
      }
      ctx.lineTo(1024, 0);
      ctx.closePath();
      ctx.fill();
    };
    ridge(108, 48, "rgba(145,175,208,0.85)", 1.3); // far peaks, hazier
    ridge(98, 30, "rgba(118,152,192,0.9)", 4.1); // near ridge, lower and darker
    tex.update(false);
    tex.hasAlpha = true;

    const plane = CreatePlane("mountains", { width: 700, height: 80 }, this.scene);
    const mat = new StandardMaterial("mountainMat", this.scene);
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.fogEnabled = false;
    plane.material = mat;
    plane.position.set(0, -4, 470);
    plane.isPickable = false;
    plane.freezeWorldMatrix();
  }

  private makeCloudTexture(name: string, seed: number): DynamicTexture {
    const tex = new DynamicTexture(name, { width: 256, height: 256 }, this.scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 256);
    const rand = seededRand(seed);

    // Remember: canvas-up = screen-down. The cloud's flat base sits at LOW canvas
    // y and the puffy top grows toward HIGH canvas y.
    const baseline = 55 + rand() * 15;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      // keep every puff fully inside the canvas — clipped circles read as hard box edges
      const r = 18 + rand() * 34;
      const cx = r + 8 + rand() * (240 - 2 * r);
      const cy = baseline + 12 + rand() * Math.min(70, 240 - baseline - r);
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fill();

    // shade the underside and highlight the crown, clipped to the cloud shape
    ctx.globalCompositeOperation = "source-atop";
    const shade = ctx.createLinearGradient(0, baseline - 15, 0, baseline + 95);
    shade.addColorStop(0, "rgba(148,172,202,0.55)");
    shade.addColorStop(0.45, "rgba(190,205,225,0.18)");
    shade.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 256, 256);
    const crown = ctx.createLinearGradient(0, 150, 0, 256);
    crown.addColorStop(0, "rgba(255,255,255,0)");
    crown.addColorStop(1, "rgba(255,255,255,0.5)");
    ctx.fillStyle = crown;
    ctx.fillRect(0, 0, 256, 256);
    ctx.globalCompositeOperation = "source-over";

    // crisp flat cumulus base
    ctx.clearRect(0, 0, 256, baseline - 12);

    tex.update(false);
    tex.hasAlpha = true;
    return tex;
  }

  private cloudMaterials(): StandardMaterial[] {
    return [11, 47, 83].map((seed, i) => {
      const mat = new StandardMaterial(`cloudMat${i}`, this.scene);
      const tex = this.makeCloudTexture(`cloudTex${i}`, seed);
      mat.emissiveTexture = tex;
      mat.opacityTexture = tex;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      return mat;
    });
  }

  private createClouds(): void {
    const materials = this.cloudMaterials();
    const cloudPlane = (name: string, size: number, index: number): Mesh => {
      const plane = CreatePlane(name, { size }, this.scene);
      plane.material = materials[index % materials.length];
      plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      plane.isPickable = false;
      return plane;
    };

    // big distant cumulus — slow sideways drift
    for (let i = 0; i < 7; i++) {
      const plane = cloudPlane(`cloudFar${i}`, 45 + this.rand() * 32, i);
      plane.position.set((this.rand() - 0.5) * 640, 14 + this.rand() * 58, 260 + this.rand() * 220);
      plane.visibility = 0.95;
      this.distantClouds.push({ mesh: plane, speed: 1 + this.rand() * 1.6 });
    }

    // mid-distance clouds — gentle parallax toward the camera
    for (let i = 0; i < 7; i++) {
      const plane = cloudPlane(`cloudMid${i}`, 16 + this.rand() * 16, i + 1);
      plane.position.set((this.rand() - 0.5) * 240, 5 + this.rand() * 36, 100 + this.rand() * 160);
      plane.visibility = 0.9;
      this.streamers.push({
        mesh: plane,
        speed: WORLD.FLY_SPEED * 0.35,
        respawnMin: 240,
        respawnMax: 300,
        despawnZ: 35,
      });
    }

    // near wisps — stretched, translucent, blow past the camera (main speed cue)
    for (let i = 0; i < 8; i++) {
      const plane = cloudPlane(`wisp${i}`, 5 + this.rand() * 5, i + 2);
      plane.scaling.x = 2.4;
      plane.visibility = 0.42;
      const side = this.rand() > 0.5 ? 1 : -1;
      plane.position.set(side * (5 + this.rand() * 24), -2 + this.rand() * 16, 40 + this.rand() * 200);
      this.streamers.push({
        mesh: plane,
        speed: WORLD.FLY_SPEED * 1.25,
        respawnMin: 220,
        respawnMax: 280,
        despawnZ: -6,
      });
    }
  }

  private makeIsland(index: number): Mesh {
    const rand = seededRand(101 + index * 37);
    const parts: Mesh[] = [];
    const base = 26 + rand() * 30;

    const sand = CreateCylinder(`islandBase${index}`, {
      height: 1.4,
      diameterTop: base * 0.86,
      diameterBottom: base,
      tessellation: 9,
    }, this.scene);
    paint(sand, "#d8c8a0");
    parts.push(sand);

    const peaks = 2 + Math.floor(rand() * 2);
    for (let p = 0; p < peaks; p++) {
      const height = 6 + rand() * 12;
      const cone = CreateCylinder(`islandPeak${index}_${p}`, {
        height,
        diameterTop: 0,
        diameterBottom: base * (0.3 + rand() * 0.3),
        tessellation: 7,
      }, this.scene);
      paint(cone, p === 0 ? "#4f8a52" : rand() > 0.5 ? "#6aa564" : "#8b909a");
      cone.position.set((rand() - 0.5) * base * 0.4, height / 2, (rand() - 0.5) * base * 0.4);
      parts.push(cone);
    }

    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    merged.name = `island${index}`;
    merged.isPickable = false;
    return merged;
  }

  private createIslands(): void {
    const mat = new StandardMaterial("islandMat", this.scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = Color3.Black();

    for (let i = 0; i < 5; i++) {
      const island = this.makeIsland(i);
      island.material = mat;
      const side = this.rand() > 0.5 ? 1 : -1;
      island.position.set(side * (40 + this.rand() * 240), -32, 120 + this.rand() * 580);
      const scale = 0.8 + this.rand() * 0.8;
      island.scaling.setAll(scale);
      this.islands.push(island);
    }
  }

  update(dt: number): void {
    // ocean scrolls toward the camera — pattern moves to -z as vOffset grows
    this.oceanTex.vOffset = (this.oceanTex.vOffset + dt * (WORLD.FLY_SPEED / (OCEAN_SIZE / OCEAN_TILES))) % 1;

    for (const cloud of this.distantClouds) {
      cloud.mesh.position.x += cloud.speed * dt;
      if (cloud.mesh.position.x > 340) cloud.mesh.position.x = -340;
    }

    for (const item of this.streamers) {
      item.mesh.position.z -= item.speed * dt;
      if (item.mesh.position.z < item.despawnZ) {
        item.mesh.position.z += item.respawnMin + this.rand() * (item.respawnMax - item.respawnMin);
        const side = this.rand() > 0.5 ? 1 : -1;
        item.mesh.position.x = Math.sign(item.mesh.position.x || side) * Math.abs(item.mesh.position.x);
      }
    }

    for (const island of this.islands) {
      island.position.z -= WORLD.FLY_SPEED * dt;
      if (island.position.z < -80) {
        island.position.z += 750 + this.rand() * 150;
        const side = this.rand() > 0.5 ? 1 : -1;
        island.position.x = side * (40 + this.rand() * 240);
        island.scaling.setAll(0.8 + this.rand() * 0.8);
      }
    }
  }
}

export function createEnvironment(scene: Scene): Environment {
  return new Environment(scene);
}
