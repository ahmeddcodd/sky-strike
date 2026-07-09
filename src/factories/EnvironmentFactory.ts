import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { NIGHT, STARS, WORLD } from "../game/Constants";
import { paint, seededRand, makeFlareTexture, lerpColor } from "./MeshUtils";
import type { VFXSystem } from "../systems/VFXSystem";

// Ocean war airspace with a forward-flight illusion (scrolling ocean, islands,
// wisps) and a day → dusk → night cycle: the sky gradient is re-keyed, the scene
// lights dim to moonlight (the whole lit world darkens with them), the sun hands
// over to a moon, stars appear, searchlights sweep, and flak pops in the distance.
//
// DynamicTexture orientation note: canvas bottom maps to plane/texture TOP here,
// so vertical artwork (mountains, cloud shading) is drawn flipped.

const OCEAN_SIZE = 1600;
const OCEAN_TILES = 8;

// sky gradient keyframes — identical stop positions so colors lerp cleanly
const SKY_STOPS = [0, 0.38, 0.58, 0.7, 0.78, 1];
const SKY_DAY = ["#1d5fc0", "#4b8dda", "#8fc0ea", "#d3e8f7", "#efe7d5", "#8fb6d8"];
const SKY_DUSK = ["#1c2b5e", "#4b4a8e", "#b06a7e", "#e89a63", "#f7bd68", "#6f5a78"];
// moonlit navy — bright enough that jets and ocean stay readable
const SKY_NIGHT = ["#0b1530", "#142448", "#1e3560", "#2a4878", "#345381", "#182a4d"];

const FOG_DAY = new Color3(0.66, 0.8, 0.92);
const FOG_NIGHT = new Color3(0.1, 0.16, 0.27);

interface DriftCloud {
  mesh: Mesh;
  speed: number;
}

interface StreamItem {
  mesh: Mesh;
  speed: number;
  respawnMin: number;
  respawnMax: number;
  despawnZ: number;
}

interface SetPiece {
  root: Mesh;
  burning: boolean;
  lights: Mesh[];
  fireTimer: number;
  glow: Mesh | null;
}

export class Environment {
  /** 0 = full day, 1 = full night. Read by jets for their nav lights. */
  nightFactor = 0;

  private scene: Scene;
  private vfx: VFXSystem;
  private nightTarget = 0;
  private lastApplied = -1;

  private hemi!: HemisphericLight;
  private sun!: DirectionalLight;
  private skyTex!: DynamicTexture;
  private starDome!: Mesh;
  private oceanTex!: DynamicTexture;
  private oceanMat!: StandardMaterial;
  private sunPlane!: Mesh;
  private moonPlane!: Mesh;
  private searchlights: { pivot: TransformNode; beam: Mesh; phase: number }[] = [];
  private setPieces: SetPiece[] = [];
  private distantClouds: DriftCloud[] = [];
  private streamers: StreamItem[] = [];
  private islands: Mesh[] = [];
  private flakTimer = 3;
  private time = 0;
  private rand = seededRand(7);
  private flakPos = new Vector3();

  constructor(scene: Scene, vfx: VFXSystem) {
    this.scene = scene;
    this.vfx = vfx;
    scene.clearColor = new Color4(FOG_DAY.r, FOG_DAY.g, FOG_DAY.b, 1);
    scene.fogMode = 2; // Scene.FOGMODE_EXP2 (constant inlined to keep imports lean)
    scene.fogDensity = WORLD.FOG_DENSITY;
    scene.fogColor = FOG_DAY.clone();

    // Global color grade (applies to every StandardMaterial — no PBR here).
    // Adds contrast + vibrance so the scene reads richer, most noticeably on
    // high-DPR phones where the flat StandardMaterial output looked washed out.
    const ip = scene.imageProcessingConfiguration;
    ip.contrast = 1.35;
    ip.exposure = 1.05;
    ip.colorCurvesEnabled = true;
    const curves = new ColorCurves();
    curves.globalSaturation = 18; // vibrance (~-100..100)
    ip.colorCurves = curves;

    this.createLights();
    this.createSkyDome();
    this.createStars();
    this.createSunAndMoon();
    this.createOcean();
    this.createMountains();
    this.createClouds();
    this.createIslands();
    this.createSearchlights();
    this.createSetPieces();
    this.applyNight(0);
  }

  // ---------- day/night ----------

  setNightTarget(n: number): void {
    this.nightTarget = Math.min(1, Math.max(0, n));
  }

  /** Instantly jump the cycle (restart to day, debug toggle). */
  snapNight(n: number): void {
    this.nightTarget = Math.min(1, Math.max(0, n));
    this.nightFactor = this.nightTarget;
    this.applyNight(this.nightFactor);
  }

  private skyColorAt(index: number, n: number): Color3 {
    return n <= 0.5
      ? lerpColor(SKY_DAY[index], SKY_DUSK[index], n * 2)
      : lerpColor(SKY_DUSK[index], SKY_NIGHT[index], (n - 0.5) * 2);
  }

  private redrawSky(n: number): void {
    const ctx = this.skyTex.getContext() as CanvasRenderingContext2D;
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    for (let i = 0; i < SKY_STOPS.length; i++) {
      grad.addColorStop(SKY_STOPS[i], this.skyColorAt(i, n).toHexString());
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, 512);

    // faint noise dithers the gradient — kills banding on mobile screens
    const rand = seededRand(29);
    for (let y = 0; y < 512; y += 2) {
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = `rgba(${rand() > 0.5 ? 255 : 0},${rand() > 0.5 ? 255 : 0},${rand() > 0.5 ? 255 : 0},0.012)`;
        ctx.fillRect(x, y, 1, 2);
      }
    }
    this.skyTex.update(false);
  }

  private applyNight(n: number): void {
    this.lastApplied = n;
    this.redrawSky(n);

    // the lights drive the whole lit world's brightness — a generous moonlight
    // floor keeps the night readable (playtest: full 0.3/0.18 was too dark)
    this.hemi.intensity = 0.85 - 0.41 * n;
    this.hemi.diffuse = Color3.Lerp(new Color3(1, 1, 1), new Color3(0.66, 0.74, 0.9), n);
    this.hemi.groundColor = Color3.Lerp(new Color3(0.45, 0.55, 0.68), new Color3(0.14, 0.19, 0.3), n);
    this.sun.intensity = 1.0 - 0.64 * n;
    this.sun.diffuse = Color3.Lerp(new Color3(1, 0.96, 0.88), new Color3(0.72, 0.8, 0.94), n);

    const fog = Color3.Lerp(FOG_DAY, FOG_NIGHT, n);
    this.scene.fogColor.copyFrom(fog);
    this.scene.clearColor.set(fog.r, fog.g, fog.b, 1);

    this.oceanMat.diffuseColor = Color3.Lerp(new Color3(0.58, 0.62, 0.68), new Color3(0.44, 0.52, 0.66), n);
    this.oceanMat.specularColor = Color3.Lerp(new Color3(0.4, 0.4, 0.34), new Color3(0.5, 0.56, 0.68), n);

    this.sunPlane.visibility = Math.max(0, 1 - n * 1.6);
    this.moonPlane.visibility = Math.max(0, (n - 0.35) / 0.65);
    const starVis = Math.max(0, (n - STARS.FADE_START) / (1 - STARS.FADE_START));
    this.starDome.visibility = starVis;
    this.starDome.setEnabled(starVis > 0); // zero cost by day

    for (const light of this.searchlights) light.beam.visibility = 0.85 * Math.max(0, (n - 0.45) / 0.55);
    for (const piece of this.setPieces) {
      for (const l of piece.lights) l.visibility = Math.max(0, (n - 0.3) / 0.7);
    }
  }

  // ---------- construction ----------

  private createLights(): void {
    this.hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, -0.3), this.scene);
    this.hemi.specular = Color3.Black(); // ambient specular washes the ocean out
    this.sun = new DirectionalLight("sun", new Vector3(-0.35, -0.6, -0.7), this.scene);
    this.sun.specular = new Color3(0.7, 0.68, 0.6);
  }

  private createSkyDome(): void {
    this.skyTex = new DynamicTexture("skyTex", { width: 8, height: 512 }, this.scene, false);
    const dome = CreateSphere("sky", { diameter: 1000, segments: 12, sideOrientation: Mesh.BACKSIDE }, this.scene);
    const mat = new StandardMaterial("skyMat", this.scene);
    mat.emissiveTexture = this.skyTex;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.fogEnabled = false;
    dome.material = mat;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.freezeWorldMatrix();
  }

  // Stars live on their own dome: the gradient texture is only 8px wide, so any
  // star pixel drawn there smears into a full white ring around the sky.
  private createStars(): void {
    const tex = new DynamicTexture("starTex", { width: STARS.TEX_W, height: STARS.TEX_H }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, STARS.TEX_W, STARS.TEX_H);
    const rand = seededRand(4242);
    for (let i = 0; i < STARS.COUNT; i++) {
      const x = rand() * STARS.TEX_W;
      const y = rand() * STARS.TEX_H * 0.55; // upper sky only (canvas y=0 is the zenith)
      const big = rand() > 0.88;
      const r = big ? 1.1 + rand() * 0.6 : 0.55 + rand() * 0.5;
      const a = 0.3 + rand() * 0.7;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
      grad.addColorStop(0, `rgba(255,255,255,${a.toFixed(2)})`);
      grad.addColorStop(0.45, `rgba(225,235,255,${(a * 0.3).toFixed(2)})`);
      grad.addColorStop(1, "rgba(225,235,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
    }
    tex.update(false);
    tex.hasAlpha = true;

    const dome = CreateSphere("stars", { diameter: 990, segments: 12, sideOrientation: Mesh.BACKSIDE }, this.scene);
    const mat = new StandardMaterial("starMat", this.scene);
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.fogEnabled = false;
    mat.alphaMode = 1; // additive
    dome.material = mat;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.freezeWorldMatrix();
    this.starDome = dome;
  }

  private createSunAndMoon(): void {
    const glow = (name: string, stops: [number, string][]) => {
      const tex = new DynamicTexture(`${name}Tex`, { width: 256, height: 256 }, this.scene, false);
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, 256, 256);
      const grad = ctx.createRadialGradient(128, 128, 6, 128, 128, 128);
      for (const [pos, color] of stops) grad.addColorStop(pos, color);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      tex.update(false);
      tex.hasAlpha = true;

      const plane = CreatePlane(name, { size: 150 }, this.scene);
      const mat = new StandardMaterial(`${name}Mat`, this.scene);
      mat.emissiveTexture = tex;
      mat.opacityTexture = tex;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      mat.fogEnabled = false;
      mat.alphaMode = 1; // additive
      plane.material = mat;
      plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      plane.isPickable = false;
      plane.applyFog = false;
      return plane;
    };

    // keep glow planes well inside the sky dome (radius 500) or they clip
    this.sunPlane = glow("sunGlow", [
      [0, "rgba(255,255,250,1)"],
      [0.1, "rgba(255,250,225,0.95)"],
      [0.3, "rgba(255,242,200,0.45)"],
      [0.65, "rgba(255,238,195,0.14)"],
      [1, "rgba(255,236,190,0)"],
    ]);
    this.sunPlane.position.set(95, 130, 300);

    this.moonPlane = glow("moonGlow", [
      [0, "rgba(235,242,255,1)"],
      [0.16, "rgba(220,232,252,0.9)"],
      [0.2, "rgba(190,208,238,0.35)"],
      [0.55, "rgba(170,195,235,0.12)"],
      [1, "rgba(160,185,230,0)"],
    ]);
    // must sit inside the narrow portrait frustum to be seen on phones
    this.moonPlane.position.set(-48, 150, 320);
    this.moonPlane.visibility = 0;
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
    this.oceanMat = new StandardMaterial("oceanMat", this.scene);
    this.oceanMat.diffuseTexture = tex;
    // hemi + sun sum to ~1.85× — damp the multiplier or the waves clip to white
    this.oceanMat.diffuseColor = new Color3(0.58, 0.62, 0.68);
    this.oceanMat.specularColor = new Color3(0.4, 0.4, 0.34); // sun glint band
    this.oceanMat.specularPower = 300;
    ocean.material = this.oceanMat;
    ocean.position.set(0, -32, 400);
    ocean.isPickable = false;
    ocean.freezeWorldMatrix();
  }

  private createMountains(): void {
    const tex = new DynamicTexture("mountainTex", { width: 1024, height: 256 }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 1024, 256);
    // Ridge silhouettes on the horizon, drawn "upside down" (see class note):
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
    ridge(108, 48, "rgba(200,216,235,0.85)", 1.3); // far peaks, hazier
    ridge(98, 30, "rgba(165,185,212,0.9)", 4.1); // near ridge, lower and darker
    tex.update(false);
    tex.hasAlpha = true;

    const plane = CreatePlane("mountains", { width: 700, height: 80 }, this.scene);
    const mat = new StandardMaterial("mountainMat", this.scene);
    // lit (not emissive) so the ridges darken naturally with the day/night lights
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveColor = new Color3(0.14, 0.17, 0.22);
    mat.specularColor = Color3.Black();
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

    // canvas-up = screen-down: flat base at LOW canvas y, puffy top toward HIGH y
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

    ctx.clearRect(0, 0, 256, baseline - 12);
    tex.update(false);
    tex.hasAlpha = true;
    return tex;
  }

  private cloudMaterials(): StandardMaterial[] {
    return [11, 47, 83].map((seed, i) => {
      const mat = new StandardMaterial(`cloudMat${i}`, this.scene);
      const tex = this.makeCloudTexture(`cloudTex${i}`, seed);
      // lit clouds — they darken with the night lights; small emissive keeps
      // them faintly visible against the night sky
      mat.diffuseTexture = tex;
      mat.opacityTexture = tex;
      mat.emissiveColor = new Color3(0.1, 0.11, 0.14); // faint self-glow so night clouds don't vanish
      mat.specularColor = Color3.Black();
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

    for (let i = 0; i < 7; i++) {
      const plane = cloudPlane(`cloudFar${i}`, 45 + this.rand() * 32, i);
      plane.position.set((this.rand() - 0.5) * 640, 14 + this.rand() * 58, 260 + this.rand() * 220);
      plane.visibility = 0.95;
      this.distantClouds.push({ mesh: plane, speed: 1 + this.rand() * 1.6 });
    }

    for (let i = 0; i < 7; i++) {
      const plane = cloudPlane(`cloudMid${i}`, 16 + this.rand() * 16, i + 1);
      plane.position.set((this.rand() - 0.5) * 240, 5 + this.rand() * 36, 100 + this.rand() * 160);
      plane.visibility = 0.9;
      this.streamers.push({ mesh: plane, speed: WORLD.FLY_SPEED * 0.35, respawnMin: 240, respawnMax: 300, despawnZ: 35 });
    }

    for (let i = 0; i < 8; i++) {
      const plane = cloudPlane(`wisp${i}`, 5 + this.rand() * 5, i + 2);
      plane.scaling.x = 2.4;
      plane.visibility = 0.42;
      const side = this.rand() > 0.5 ? 1 : -1;
      plane.position.set(side * (5 + this.rand() * 24), -2 + this.rand() * 16, 40 + this.rand() * 200);
      this.streamers.push({ mesh: plane, speed: WORLD.FLY_SPEED * 1.25, respawnMin: 220, respawnMax: 280, despawnZ: -6 });
    }
  }

  private makeIsland(index: number): Mesh {
    const rand = seededRand(101 + index * 37);
    const parts: Mesh[] = [];
    const base = 26 + rand() * 30;

    const sand = CreateCylinder(`islandBase${index}`, { height: 1.4, diameterTop: base * 0.86, diameterBottom: base, tessellation: 9 }, this.scene);
    paint(sand, "#d8c8a0");
    parts.push(sand);

    const peaks = 2 + Math.floor(rand() * 2);
    for (let p = 0; p < peaks; p++) {
      const height = 6 + rand() * 12;
      const cone = CreateCylinder(`islandPeak${index}_${p}`, { height, diameterTop: 0, diameterBottom: base * (0.3 + rand() * 0.3), tessellation: 7 }, this.scene);
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
      island.scaling.setAll(0.8 + this.rand() * 0.8);
      this.islands.push(island);
    }
  }

  private createSearchlights(): void {
    // thin, faint pencil beams far off to the sides — distant AA searchlights,
    // not stage lighting (playtest: wide bright cones crossing mid-screen read
    // as concert beams)
    const mat = new StandardMaterial("searchlightMat", this.scene);
    mat.emissiveColor = new Color3(0.55, 0.65, 0.85);
    mat.diffuseColor = Color3.Black();
    mat.disableLighting = true;
    mat.alpha = 0.06;
    mat.alphaMode = 1; // additive
    mat.fogEnabled = false;
    mat.backFaceCulling = false;

    const configs = [
      { x: -220, z: 420, phase: 0, tilt: 0.1, lean: -0.22 },
      { x: 250, z: 470, phase: 2.1, tilt: -0.08, lean: 0.26 },
    ];
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      const pivot = new TransformNode(`searchlightPivot${i}`, this.scene);
      pivot.position.set(cfg.x, -31, cfg.z);
      pivot.metadata = { lean: cfg.lean };
      const beam = CreateCylinder(`searchlight${i}`, { height: 190, diameterTop: 6, diameterBottom: 1, tessellation: 8 }, this.scene);
      beam.material = mat;
      beam.parent = pivot;
      beam.position.y = 95;
      beam.isPickable = false;
      beam.visibility = 0;
      pivot.rotation.x = cfg.tilt;
      this.searchlights.push({ pivot, beam, phase: cfg.phase });
    }
  }

  private makeSetPieceMaterial(): StandardMaterial {
    const mat = new StandardMaterial("setPieceMat", this.scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = Color3.Black();
    return mat;
  }

  private createSetPieces(): void {
    const mat = this.makeSetPieceMaterial();

    const fireFlare = makeFlareTexture(this.scene, "wreckFireTex", "#ff7a22"); // tinted in-texture
    const fireGlowMat = new StandardMaterial("wreckGlowMat", this.scene);
    fireGlowMat.emissiveTexture = fireFlare;
    fireGlowMat.opacityTexture = fireFlare;
    fireGlowMat.emissiveColor = Color3.Black();
    fireGlowMat.diffuseColor = Color3.Black();
    fireGlowMat.disableLighting = true;
    fireGlowMat.alphaMode = 1;
    fireGlowMat.fogEnabled = false;

    const warmFlare = makeFlareTexture(this.scene, "shipLightTex", "#ffe2a8");
    const shipLightMat = new StandardMaterial("shipLightMat", this.scene);
    shipLightMat.emissiveTexture = warmFlare;
    shipLightMat.opacityTexture = warmFlare;
    shipLightMat.emissiveColor = Color3.Black();
    shipLightMat.diffuseColor = Color3.Black();
    shipLightMat.disableLighting = true;
    shipLightMat.alphaMode = 1;
    shipLightMat.fogEnabled = false;

    // burning wreck — a listing, broken hull with a flickering fire glow
    {
      const parts: Mesh[] = [];
      const hull = CreateBox("wreckHull", { width: 13, height: 3, depth: 4.5 }, this.scene);
      paint(hull, "#20262f");
      parts.push(hull);
      const bow = CreateBox("wreckBow", { width: 5, height: 2.6, depth: 4 }, this.scene);
      paint(bow, "#181d24");
      bow.position.set(-8, 1.2, 0.5);
      bow.rotation.z = 0.5;
      parts.push(bow);
      const mast = CreateCylinder("wreckMast", { height: 6, diameter: 0.5, tessellation: 6 }, this.scene);
      paint(mast, "#14181e");
      mast.position.set(3, 3.5, 0);
      mast.rotation.z = -0.55;
      parts.push(mast);
      const wreck = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
      wreck.material = mat;
      wreck.rotation.z = 0.14;
      wreck.position.set(-85, -30.5, 260);
      wreck.isPickable = false;

      const glow = CreatePlane("wreckGlow", { size: 9 }, this.scene);
      glow.material = fireGlowMat;
      glow.billboardMode = Mesh.BILLBOARDMODE_ALL;
      glow.parent = wreck;
      glow.position.set(2, 3.2, 0);
      glow.isPickable = false;

      this.setPieces.push({ root: wreck, burning: true, lights: [], fireTimer: 0, glow });
    }

    // warship silhouette — hull, superstructure, forward gun; lights at night
    {
      const parts: Mesh[] = [];
      const hull = CreateBox("shipHull", { width: 20, height: 2.6, depth: 5.5 }, this.scene);
      paint(hull, "#39434f");
      parts.push(hull);
      const deck = CreateBox("shipDeck", { width: 8, height: 2.2, depth: 3.6 }, this.scene);
      paint(deck, "#46515e");
      deck.position.set(1.5, 2.2, 0);
      parts.push(deck);
      const bridge = CreateBox("shipBridge", { width: 3.4, height: 2.4, depth: 2.6 }, this.scene);
      paint(bridge, "#525d6a");
      bridge.position.set(2.5, 4.2, 0);
      parts.push(bridge);
      const turret = CreateBox("shipTurret", { width: 2.6, height: 1.2, depth: 2.2 }, this.scene);
      paint(turret, "#2f3843");
      turret.position.set(-6.5, 2, 0);
      parts.push(turret);
      const barrel = CreateCylinder("shipBarrel", { height: 4.4, diameter: 0.4, tessellation: 6 }, this.scene);
      paint(barrel, "#262e38");
      barrel.rotation.z = Math.PI / 2 - 0.12;
      barrel.position.set(-9.5, 2.6, 0);
      parts.push(barrel);
      const ship = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
      ship.material = mat;
      ship.position.set(105, -30.8, 520);
      ship.isPickable = false;

      const lights: Mesh[] = [];
      for (const [lx, ly] of [[2.5, 5.8], [-8, 3.4]] as const) {
        const light = CreatePlane(`shipLight${lx}`, { size: 1.6 }, this.scene);
        light.material = shipLightMat;
        light.billboardMode = Mesh.BILLBOARDMODE_ALL;
        light.parent = ship;
        light.position.set(lx, ly, 0);
        light.isPickable = false;
        light.visibility = 0;
        lights.push(light);
      }

      this.setPieces.push({ root: ship, burning: false, lights, fireTimer: 0, glow: null });
    }
  }

  // ---------- per-frame ----------

  update(dt: number): void {
    this.time += dt;

    // ease the day/night cycle and re-apply looks when it moved enough
    if (this.nightFactor !== this.nightTarget) {
      const step = NIGHT.EASE * dt;
      this.nightFactor =
        this.nightFactor < this.nightTarget
          ? Math.min(this.nightTarget, this.nightFactor + step)
          : Math.max(this.nightTarget, this.nightFactor - step);
    }
    if (Math.abs(this.nightFactor - this.lastApplied) > 0.02 || (this.nightFactor === this.nightTarget && this.lastApplied !== this.nightFactor)) {
      this.applyNight(this.nightFactor);
    }

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

    // war set pieces scroll past and respawn far ahead
    for (const piece of this.setPieces) {
      piece.root.position.z -= WORLD.FLY_SPEED * dt;
      if (piece.root.position.z < -80) {
        piece.root.position.z += 800 + this.rand() * 200;
        const side = this.rand() > 0.5 ? 1 : -1;
        piece.root.position.x = side * (55 + this.rand() * 170);
      }
      if (piece.burning) {
        if (piece.glow) {
          const flicker = 0.8 + Math.random() * 0.4;
          piece.glow.scaling.set(flicker, flicker, flicker);
        }
        piece.fireTimer -= dt;
        if (piece.fireTimer <= 0 && piece.root.position.z < 330 && piece.root.position.z > 10) {
          piece.fireTimer = 0.13;
          this.flakPos.copyFrom(piece.root.position);
          this.flakPos.y += 3.5 + Math.random() * 1.5;
          this.flakPos.x += (Math.random() - 0.5) * 4;
          this.vfx.wreckFire(this.flakPos);
        }
      }
    }

    // sweeping searchlights (visible at night via applyNight) — slow sweep
    // around an outward lean so the beams never converge over the player
    for (const light of this.searchlights) {
      const lean = (light.pivot.metadata as { lean: number }).lean;
      light.pivot.rotation.z = lean + Math.sin(this.time * 0.16 + light.phase) * 0.24;
    }

    // distant flak bursts — war ambience
    this.flakTimer -= dt;
    if (this.flakTimer <= 0) {
      this.flakTimer = 2.5 + Math.random() * 2;
      this.flakPos.set(
        (Math.random() - 0.5) * 200,
        18 + Math.random() * 55,
        230 + Math.random() * 150,
      );
      this.vfx.flakBurst(this.flakPos);
    }
  }
}

export function createEnvironment(scene: Scene, vfx: VFXSystem): Environment {
  return new Environment(scene, vfx);
}
