// All gameplay tuning lives here. Distances are world units, times are seconds.
// Coordinate system: camera at origin looking down +Z; enemies fly toward z = 0.

export const CAMERA = {
  FOV: 0.9, // vertical FOV (rad) — portrait screens get a tall view of the sky
  POSITION_Y: 0.4, // chase cam sits slightly above the player jet's slipstream
  MAX_SHAKE: 0.35,
  SHAKE_DECAY: 4.5, // intensity units lost per second
} as const;

export const WORLD = {
  SPAWN_Z_MIN: 85,
  SPAWN_Z_MAX: 135,
  DANGER_Z: 10, // enemy crossing this plane damages the player (just ahead of the jet's nose)
  PATH_END_Z: 4, // Bézier endpoint, past the danger plane so jets fly *through* it
  FOG_DENSITY: 0.0055,
  FLY_SPEED: 42, // visual world-scroll speed (ocean/islands/wisps) — the forward-flight cue
} as const;

export const PLAYER_JET = {
  // camera-local placement (chase cam): jet sits below-center, danger plane ~3 units ahead of its nose
  Z: 12,
  Y: -1.55,
  SCALE: 0.55,
  MAX_BANK: 0.62, // rad, toward crosshair X
  BANK_SMOOTHING: 5,
  PITCH_FACTOR: 0.12, // nose follows crosshair Y slightly
  DRIFT_X: 0.6, // lateral slide toward crosshair (world units, camera-local)
  DRIFT_Y: 0.32,
  DRIFT_SMOOTHING: 3.5,
  BOB_AMP: 0.05,
  BOB_FREQ: 2.1,
  KICK: 0.016, // nose-up recoil impulse per shot (rad)
  KICK_DECAY: 7,
} as const;

export const ENEMY = {
  MAX_ACTIVE: 9,
  BASE_SPEED: 21, // world units per second along the path (~5-6s approach at wave 1)
  HIT_FLASH_TIME: 0.06,
  // Spawn/end lateral placement as a fraction of the camera frustum half-extents
  SPAWN_X_SPREAD: 0.7,
  SPAWN_Y_MIN: 0.05,
  SPAWN_Y_MAX: 0.65,
  END_X_SPREAD: 0.45,
  END_Y_MIN: -0.25,
  END_Y_MAX: 0.25,
  // Hitboxes are deliberately larger than the visual mesh (mobile fairness);
  // scaled per enemy type via EnemyData.hitboxScale
  HITBOX_BODY: { w: 1.3, h: 1.3, d: 5.0 },
  HITBOX_WING: { w: 2.0, h: 0.7, d: 1.8 },
  BANK_FACTOR: 1.6, // roll (rad) per unit of normalized lateral velocity
  BANK_SMOOTHING: 6, // higher = snappier banking
} as const;

export const WAVE = {
  FIRST_DELAY: 1.6,
  LULL: 2.5, // pause between waves
  BASE_COUNT: 4,
  COUNT_PER_WAVE: 2,
  COUNT_CAP: 26,
  INTERVAL_START: 1.8, // spawn interval inside wave 1...
  INTERVAL_END: 0.8, // ...ramping to this by INTERVAL_RAMP_WAVES
  INTERVAL_RAMP_WAVES: 8,
  SPEED_PER_WAVE: 0.06,
  SPEED_CAP: 1.6,
  FAST_UNLOCK: 2, // wave that introduces fast jets
  ARMORED_UNLOCK: 4, // wave that introduces armored jets
  CLEAR_BONUS_BASE: 150,
  CLEAR_BONUS_PER_WAVE: 50,
} as const;

export const COMBO = {
  WINDOW: 3, // seconds between kills to keep the chain alive
  TIER_X2: 3, // streak thresholds
  TIER_X3: 5,
  TIER_X5: 10,
} as const;

export const NIGHT = {
  EASE: 0.08, // nightFactor units per second toward the target
  // wave → target night factor: waves 1-2 day, 3-4 dusk, 5+ full night
  TARGETS: [0, 0, 0, 0.45, 0.75, 1],
} as const;

export const WEAPON = {
  FIRE_INTERVAL: 0.13, // ~7.7 shots/s while holding
  RANGE: 200,
  DAMAGE: 1,
  RECOIL: 0.12,
  RECOIL_RECOVERY: 10,
  SHOT_SHAKE: 0.02,
} as const;

export const PLAYER = {
  MAX_HEALTH: 100,
  DAMAGE_SHAKE: 0.3,
  GUN_HIT_DAMAGE: 4, // chip damage per landed enemy burst
  MISSILE_HIT_DAMAGE: 35, // armored-jet missile that gets through
  SLIP_PAST_DAMAGE: 15, // enemy crossing the danger plane
  WAVE_CLEAR_HEAL: 12,
} as const;

// Enemy return fire: bursts of red tracers with a muzzle-flash telegraph.
// Whether a burst hits is decided once at burst time; the hit only lands when
// the tracer arrives, and dies with the shooter (killing them mid-burst saves you).
export const ENEMY_FIRE = {
  UNLOCK_WAVE: 2, // wave 1 stays the friendly intro
  Z_MIN: 30,
  Z_MAX: 85, // firing window — close enough to read, far enough to react
  BURST_TRACERS: 4,
  TRACER_SPACING: 0.09, // s between tracers within a burst
  TRACER_SPEED: 130, // world units/s toward the player
  TRACER_TIME_MIN: 0.3,
  TRACER_TIME_MAX: 0.6,
  HIT_CHANCE: 0.45, // rolled once per burst
  // global fairness limiter: after a burst lands, no burst may hit again until
  // this cooldown expires (misses still fire for pressure without damage)
  HIT_COOLDOWN_BASE: 3.0,
  HIT_COOLDOWN_PER_WAVE: 0.2,
  HIT_COOLDOWN_MIN: 1.2,
  MAX_BURSTS_EARLY: 1, // concurrent bursts before LATE_WAVE
  MAX_BURSTS_LATE: 2,
  LATE_WAVE: 4,
  MISS_OFFSET: 4, // world units miss-tracers pass beside the player
  TRACER_POOL: 12,
} as const;

export const MISSILE = {
  ENEMY_POOL: 3,
  PLAYER_POOL: 6,
  ENEMY_SPEED: 19, // ~3.5s flight from the launch window — the interception game
  ENEMY_TURN_RATE: 1.1, // rad/s of homing correction
  LAUNCH_Z_MIN: 55,
  LAUNCH_Z_MAX: 78,
  MAX_ACTIVE_EARLY: 1, // hostile missiles in flight before LATE_WAVE
  MAX_ACTIVE_LATE: 2,
  LATE_WAVE: 6,
  LAUNCH_COOLDOWN: 6, // s between hostile launches
  PROXIMITY: 1.6, // impact distance to the player jet
  LIFETIME: 6,
  INTERCEPT_SCORE: 150,
  WOBBLE_AMP: 0.35, // deterministic sine weave (phase fixed at launch)
  WOBBLE_FREQ: 3,
  HITBOX: 2.4, // oversized shootable box
  SMOKE_CADENCE: 0.05,
  PLAYER_SPEED: 60,
  PLAYER_TURN_RATE: 3.5,
  PLAYER_DAMAGE: 5, // one-shots normal/fast, dents armored
  PLAYER_FIRE_INTERVAL: 0.35,
} as const;

export const POWERUP = {
  UNLOCK_WAVE: 2,
  SPAWN_DELAY_MIN: 4, // s after wave start
  SPAWN_DELAY_MAX: 7,
  DRIFT_SPEED: 9, // ~10-12s on screen — a generous shooting window
  HITBOX: 2.6,
  COLLECT_SCORE: 50,
  HEAVY_DURATION: 10,
  HEAVY_MULT: 2,
  GHOST_DURATION: 8,
  GHOST_ALPHA_DROP: 0.65, // jet visibility = 1 - drop * ghost
  MISSILE_AMMO: 6,
  POOL: 2,
} as const;

export const STARS = {
  COUNT: 220,
  FADE_START: 0.5, // nightFactor where stars begin to appear
  // the texture wraps the whole star dome, so width drives on-screen star size
  // (512 wide ≈ 11px/texel on a phone screen — reads as blobs, not stars)
  TEX_W: 1024,
  TEX_H: 512,
} as const;

export const VFX = {
  TRACER_POOL: 14,
  TRACER_TIME: 0.07,
  EXPLOSION_SHAKE: 0.12,
  FLASH_POOL: 6,
  POPUP_POOL: 8,
} as const;

export const INPUT = {
  CROSSHAIR_SMOOTHING: 22, // higher = tighter follow
  DRAG_GAIN: 1.15, // crosshair pixels moved per finger pixel
  EDGE_MARGIN: 18, // px the crosshair keeps from screen edges
} as const;

export const DIFFICULTY_CLAMP_DT = 1 / 30; // max delta time fed to game logic

export const SAVE_KEY = "skystrike3d_save_v1";
