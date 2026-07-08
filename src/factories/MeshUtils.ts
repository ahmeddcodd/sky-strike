import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";

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
