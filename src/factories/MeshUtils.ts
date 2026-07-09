import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";

/** Fills a mesh's vertex colors with one flat color — parts painted this way can
 *  merge into a single mesh/material and still keep distinct colors. */
export function paint(mesh: Mesh, hex: string): void {
  const c = Color3.FromHexString(hex);
  const count = mesh.getTotalVertices();
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = c.r;
    data[i * 4 + 1] = c.g;
    data[i * 4 + 2] = c.b;
    data[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, data);
}

/** Deterministic PRNG so procedural scenery is identical every run. */
export function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Soft radial flare sprite. NOTE: tint via the texture itself — emissiveColor
 *  ADDS to emissiveTexture in StandardMaterial, so tinting there washes to white. */
export function makeFlareTexture(scene: Scene, name: string, hex = "#ffffff"): DynamicTexture {
  const c = Color3.FromHexString(hex);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  const tex = new DynamicTexture(name, { width: 128, height: 128 }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 128);
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(0.35, `rgba(${rgb},0.6)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  tex.update(false);
  tex.hasAlpha = true;
  return tex;
}

/** Interpolate two hex colors → Color3. */
export function lerpColor(a: string, b: string, t: number): Color3 {
  const ca = Color3.FromHexString(a);
  const cb = Color3.FromHexString(b);
  return Color3.Lerp(ca, cb, t);
}
