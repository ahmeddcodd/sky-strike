// Enemy type definitions (spec §15). Gameplay values live here; the matching
// procedural models are built by JetFactory per variant.

export type EnemyTypeId = "normal" | "fast" | "armored";

export interface EnemyTypeDef {
  id: EnemyTypeId;
  health: number;
  speedScale: number;
  score: number;
  poolSize: number;
  /** deterministic sine weave (world units / rad·s⁻¹); 0 = straight flier */
  weaveAmp: number;
  weaveFreq: number;
  hitboxScale: number;
  /** on-screen health bar width in px */
  barWidth: number;
}

export const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeDef> = {
  normal: {
    id: "normal",
    health: 2,
    speedScale: 1.0,
    score: 100,
    poolSize: 6,
    weaveAmp: 0,
    weaveFreq: 0,
    hitboxScale: 1,
    barWidth: 34,
  },
  fast: {
    id: "fast",
    health: 1,
    speedScale: 1.5,
    score: 200,
    poolSize: 5,
    weaveAmp: 2.0,
    weaveFreq: 2.6,
    hitboxScale: 0.95,
    barWidth: 30,
  },
  armored: {
    id: "armored",
    health: 5,
    speedScale: 0.65,
    score: 300,
    poolSize: 4,
    weaveAmp: 0,
    weaveFreq: 0,
    hitboxScale: 1.3,
    barWidth: 46,
  },
};

export const ALL_ENEMY_TYPES: EnemyTypeId[] = ["normal", "fast", "armored"];
