import { Vector3 } from "@babylonjs/core/Maths/math.vector";

// Deterministic quadratic Bézier flight paths (spec §16): position comes from
// path progress, never from per-frame randomness, so movement is smooth, fair,
// readable, and identical at any frame rate.

export interface FlightPath {
  p0: Vector3;
  p1: Vector3;
  p2: Vector3;
  length: number; // arc-length approximation, used to convert speed → progress
}

export function makeFlightPath(spawn: Vector3, end: Vector3, lateralCurve: number, verticalCurve: number): FlightPath {
  const p1 = spawn.add(end).scaleInPlace(0.5);
  p1.x += lateralCurve;
  p1.y += verticalCurve;
  const path: FlightPath = { p0: spawn.clone(), p1, p2: end.clone(), length: 1 };
  path.length = approximateLength(path);
  return path;
}

function approximateLength(path: FlightPath): number {
  const prev = path.p0.clone();
  const point = new Vector3();
  let length = 0;
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    evaluatePath(path, i / steps, point);
    length += Vector3.Distance(prev, point);
    prev.copyFrom(point);
  }
  return Math.max(length, 0.001);
}

/** Position on the curve at t ∈ [0,1], written into `out`. */
export function evaluatePath(path: FlightPath, t: number, out: Vector3): Vector3 {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  out.x = a * path.p0.x + b * path.p1.x + c * path.p2.x;
  out.y = a * path.p0.y + b * path.p1.y + c * path.p2.y;
  out.z = a * path.p0.z + b * path.p1.z + c * path.p2.z;
  return out;
}

/** Flight direction (curve tangent, normalized) at t, written into `out`. */
export function pathTangent(path: FlightPath, t: number, out: Vector3): Vector3 {
  const u = 1 - t;
  out.x = 2 * u * (path.p1.x - path.p0.x) + 2 * t * (path.p2.x - path.p1.x);
  out.y = 2 * u * (path.p1.y - path.p0.y) + 2 * t * (path.p2.y - path.p1.y);
  out.z = 2 * u * (path.p1.z - path.p0.z) + 2 * t * (path.p2.z - path.p1.z);
  return out.normalize();
}
