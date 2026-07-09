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

// sky gradient keyframes — identical stop positions so colors lerp cleanly.
// "DAY" is a warm tropical sunset (top mauve → pink → salmon → orange → hot
// yellow band → warm horizon); DUSK deepens it as the sun sinks with the waves.
const SKY_STOPS = [0, 0.38, 0.58, 0.7, 0.78, 1];
const SKY_DAY = ["#4a3d6e", "#7d5688", "#c07575", "#ec9a58", "#ffd98a", "#ffbe86"];
const SKY_DUSK = ["#2a1e48", "#5a3566", "#a85566", "#d5703e", "#e8863f", "#5a3a5c"];
// moonlit navy — bright enough that jets and ocean stay readable
const SKY_NIGHT = ["#0b1530", "#142448", "#1e3560", "#2a4878", "#345381", "#182a4d"];

// warm dusk haze so distance melts into the sunset instead of turning blue
const FOG_DAY = new Color3(0.86, 0.62, 0.5);
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
  private sunReflect!: Mesh;
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

    // warm horizon bloom around the sun (canvas y is high near the horizon);
    // fades out as the sun sets into night
    const glow = Math.max(0, 1 - n * 1.3);
    if (glow > 0.01) {
      const band = ctx.createLinearGradient(0, 300, 0, 470);
      band.addColorStop(0, "rgba(255,240,205,0)");
      band.addColorStop(0.55, `rgba(255,236,196,${(0.5 * glow).toFixed(3)})`);
      band.addColorStop(1, `rgba(255,214,150,${(0.15 * glow).toFixed(3)})`);
      ctx.fillStyle = band;
      ctx.fillRect(0, 300, 8, 170);
    }

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
    // n=0 is warm sunset (not neutral day); it lerps toward cool moonlight
    this.hemi.intensity = 0.85 - 0.41 * n;
    this.hemi.diffuse = Color3.Lerp(new Color3(1.0, 0.86, 0.78), new Color3(0.66, 0.74, 0.9), n);
    this.hemi.groundColor = Color3.Lerp(new Color3(0.5, 0.42, 0.44), new Color3(0.14, 0.19, 0.3), n);
    this.sun.intensity = 1.0 - 0.64 * n;
    this.sun.diffuse = Color3.Lerp(new Color3(1.0, 0.72, 0.45), new Color3(0.72, 0.8, 0.94), n);

    const fog = Color3.Lerp(FOG_DAY, FOG_NIGHT, n);
    this.scene.fogColor.copyFrom(fog);
    this.scene.clearColor.set(fog.r, fog.g, fog.b, 1);

    // sunset ocean picks up warm sky at n=0 and cools to moonlit blue at night
    this.oceanMat.diffuseColor = Color3.Lerp(new Color3(0.62, 0.5, 0.52), new Color3(0.44, 0.52, 0.66), n);
    this.oceanMat.specularColor = Color3.Lerp(new Color3(0.7, 0.5, 0.3), new Color3(0.5, 0.56, 0.68), n);

    this.sunPlane.visibility = Math.max(0, 1 - n * 1.6);
    this.sunReflect.visibility = Math.max(0, 1 - n * 1.7); // fades as the sun sets
    this.sunReflect.setEnabled(n < 0.6);
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
    // key light rakes low from the sun's direction so lit faces catch warm rim
    // light and the ocean glints back toward the camera
    this.sun = new DirectionalLight("sun", new Vector3(-0.15, -0.35, -0.9), this.scene);
    this.sun.specular = new Color3(0.85, 0.6, 0.35); // warm gold glint
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

    // low sun near the horizon: a contained warm disc with a soft bloom halo
    // (a small bright core, not a blown-out flash)
    this.sunPlane = glow("sunGlow", [
      [0, "rgba(255,250,235,1)"],
      [0.12, "rgba(255,238,198,0.9)"],
      [0.2, "rgba(255,214,150,0.4)"],
      [0.4, "rgba(255,186,128,0.16)"],
      [0.7, "rgba(255,172,112,0.05)"],
      [1, "rgba(255,168,108,0)"],
    ]);
    this.sunPlane.scaling.setAll(0.82); // ~123 across — a contained orb
    this.sunPlane.position.set(30, 10, 300);

    this.createSunReflection();

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

  // The sun's shimmering reflection column on the water — a tall warm streak
  // that stays vertical (billboarded around Y only) below the sun.
  private createSunReflection(): void {
    const W = 96, H = 256;
    const tex = new DynamicTexture("sunReflectTex", { width: W, height: H }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    const rand = seededRand(555);
    // Build the streak from many soft horizontal dashes of glimmer — brightest
    // and widest near the top (the horizon under the sun), scattering and dimming
    // downward. Reads as broken light on water, not a solid bar/ladder.
    for (let y = 0; y < H; y += 2) {
      const t = y / H;
      const rows = 3 + Math.floor(rand() * 3);
      for (let r = 0; r < rows; r++) {
        const spread = 8 + t * 34; // wider spread of glints lower down
        const cx = W / 2 + (rand() - 0.5) * spread * 2;
        const halfLen = (10 + rand() * 22) * (1 - t * 0.5);
        const a = (0.5 + rand() * 0.5) * Math.pow(1 - t, 1.4); // fade downward
        const g = ctx.createLinearGradient(cx - halfLen, 0, cx + halfLen, 0);
        g.addColorStop(0, "rgba(255,224,168,0)");
        g.addColorStop(0.5, `rgba(255,232,186,${a.toFixed(3)})`);
        g.addColorStop(1, "rgba(255,224,168,0)");
        ctx.fillStyle = g;
        ctx.fillRect(cx - halfLen, y, halfLen * 2, 1.6 + rand() * 1.6);
      }
    }
    // a soft bright core right at the top where it meets the sun
    const core = ctx.createRadialGradient(W / 2, 6, 2, W / 2, 6, 40);
    core.addColorStop(0, "rgba(255,244,210,0.85)");
    core.addColorStop(1, "rgba(255,240,200,0)");
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, W, 60);
    tex.update(false);
    tex.hasAlpha = true;

    const plane = CreatePlane("sunReflect", { width: 34, height: 115 }, this.scene);
    const mat = new StandardMaterial("sunReflectMat", this.scene);
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.fogEnabled = false;
    mat.alphaMode = 1; // additive
    plane.material = mat;
    plane.billboardMode = Mesh.BILLBOARDMODE_Y; // yaw to face camera, stays vertical
    plane.isPickable = false;
    plane.applyFog = false;
    // top of the column meets the horizon under the sun; hangs down onto the water
    plane.position.set(30, -30, 285);
    this.sunReflect = plane;
  }

  private createOcean(): void {
    const tex = new DynamicTexture("oceanTex", { width: 256, height: 256 }, this.scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#2a4368"; // duskier teal-purple base (warm light tints it at sunset)
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
        ctx.fillStyle = "rgba(22,28,58,0.32)";
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
      const light = 0.16 + this.rand() * 0.2;
      // warm-tinted wavelets so the water reads as sunset-lit, not blue
      wrapped((dx, dy) => {
        ctx.fillStyle = `rgba(232,196,168,${light.toFixed(2)})`;
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
        ctx.fillStyle = "rgba(255,238,208,0.5)";
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
    // dark warm silhouette ridges against the sunset (hazier = a touch lighter)
    ridge(108, 48, "rgba(92,72,96,0.75)", 1.3); // far peaks, atmospheric haze
    ridge(98, 30, "rgba(52,40,58,0.92)", 4.1); // near ridge, darker
    tex.update(false);
    tex.hasAlpha = true;

    const plane = CreatePlane("mountains", { width: 700, height: 80 }, this.scene);
    const mat = new StandardMaterial("mountainMat", this.scene);
    // lit (not emissive) so the ridges darken naturally with the day/night lights
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveColor = new Color3(0.1, 0.08, 0.12);
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

  // A palm tree, near-silhouette: a thin leaning trunk topped with a fan of
  // drooping fronds. All parts appended to `parts` for merging into the island.
  private makePalm(parts: Mesh[], rand: () => number, x: number, z: number, scale: number, tag: string): void {
    const trunkH = (7 + rand() * 4) * scale;
    const lean = (rand() - 0.5) * 0.5;
    const trunk = CreateCylinder(`palmTrunk${tag}`, { height: trunkH, diameterTop: 0.28 * scale, diameterBottom: 0.55 * scale, tessellation: 6 }, this.scene);
    paint(trunk, "#241c18");
    trunk.rotation.z = lean;
    // place so the base sits on the island top, offset by the lean
    trunk.position.set(x + Math.sin(lean) * trunkH * 0.5, trunkH / 2, z);
    parts.push(trunk);

    const topX = x + Math.sin(lean) * trunkH;
    const topY = trunkH * Math.cos(lean);
    const fronds = 5 + Math.floor(rand() * 3);
    for (let f = 0; f < fronds; f++) {
      const ang = (f / fronds) * Math.PI * 2 + rand() * 0.4;
      const len = (3.2 + rand() * 1.8) * scale;
      const frond = CreateBox(`palmFrond${tag}_${f}`, { width: len, height: 0.12 * scale, depth: 0.9 * scale }, this.scene);
      paint(frond, "#1b2a1a");
      // fan out and droop downward
      frond.position.set(topX + Math.cos(ang) * len * 0.4, topY - 0.4 * scale, z + Math.sin(ang) * len * 0.4);
      frond.rotation.y = ang;
      frond.rotation.z = 0.5 + rand() * 0.3; // droop
      parts.push(frond);
    }
  }

  // Dark jagged rock spires (Ha Long Bay style) with a few palms — reads as a
  // backlit silhouette against the sunset. Merged into one mesh/draw call.
  private makeIsland(index: number): Mesh {
    const rand = seededRand(101 + index * 37);
    const parts: Mesh[] = [];
    const base = 20 + rand() * 22;

    // low dark rocky base
    const foot = CreateCylinder(`islandBase${index}`, { height: 2.2, diameterTop: base * 0.8, diameterBottom: base, tessellation: 8 }, this.scene);
    paint(foot, "#241d2a");
    parts.push(foot);

    // cluster of tall tilted rock spires of varying height
    const spires = 3 + Math.floor(rand() * 4);
    for (let s = 0; s < spires; s++) {
      const height = 12 + rand() * 22;
      const girth = base * (0.22 + rand() * 0.28);
      const rock = CreateCylinder(`islandSpire${index}_${s}`, { height, diameterTop: girth * (0.05 + rand() * 0.2), diameterBottom: girth, tessellation: 6 }, this.scene);
      const shade = rand() > 0.5 ? "#1c1622" : "#2a2230";
      paint(rock, shade);
      const off = base * 0.34;
      rock.position.set((rand() - 0.5) * off, height / 2 + 1, (rand() - 0.5) * off);
      rock.rotation.z = (rand() - 0.5) * 0.35; // craggy lean
      rock.rotation.x = (rand() - 0.5) * 0.25;
      parts.push(rock);
    }

    // 1–3 palms clinging to the rock
    const palms = 1 + Math.floor(rand() * 3);
    for (let p = 0; p < palms; p++) {
      this.makePalm(parts, rand, (rand() - 0.5) * base * 0.5, (rand() - 0.5) * base * 0.5, 0.8 + rand() * 0.5, `${index}_${p}`);
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

    for (let i = 0; i < 7; i++) {
      const island = this.makeIsland(i);
      island.material = mat;
      const side = this.rand() > 0.5 ? 1 : -1;
      // spread across the mid-to-far distance, some closer to frame the sunset
      island.position.set(side * (55 + this.rand() * 210), -32, 120 + this.rand() * 560);
      island.scaling.setAll(0.85 + this.rand() * 0.85);
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

    // gentle shimmer on the sun's water reflection
    if (this.sunReflect.isEnabled()) {
      this.sunReflect.scaling.x = 1 + Math.sin(this.time * 2.3) * 0.12;
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
