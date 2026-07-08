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
  POOL_SIZE: 12,
  MAX_ACTIVE: 8,
  HEALTH: 2,
  BASE_SPEED: 21, // world units per second along the path (~5-6s approach at ramp start)
  SCORE: 100,
  HIT_FLASH_TIME: 0.06,
  // Spawn/end lateral placement as a fraction of the camera frustum half-extents
  SPAWN_X_SPREAD: 0.7,
  SPAWN_Y_MIN: 0.05,
  SPAWN_Y_MAX: 0.65,
  END_X_SPREAD: 0.45,
  END_Y_MIN: -0.25,
  END_Y_MAX: 0.25,
  // Hitboxes are deliberately larger than the visual mesh (mobile fairness)
  HITBOX_BODY: { w: 1.3, h: 1.3, d: 5.0 },
  HITBOX_WING: { w: 2.0, h: 0.7, d: 1.8 },
  BANK_FACTOR: 1.6, // roll (rad) per unit of normalized lateral velocity
  BANK_SMOOTHING: 6, // higher = snappier banking
} as const;

export const SPAWN = {
  FIRST_DELAY: 1.6,
  INTERVAL_START: 2.2,
  INTERVAL_END: 0.9,
  SPEED_SCALE_START: 1.0,
  SPEED_SCALE_END: 1.6,
  RAMP_TIME: 90, // seconds to reach full difficulty
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
  MAX_HEALTH: 3,
  DAMAGE_SHAKE: 0.3,
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

export const JOYSTICK = {
  RADIUS: 52, // base ring radius (px); the knob clamps to this
  GRAB_FACTOR: 1.8, // touches within RADIUS × this capture the stick (forgiving thumb zone)
  BOTTOM_OFFSET: 112, // base center distance from the bottom edge (px) — sits under the jet
  DEADZONE: 0.06, // deflection below this is ignored
  // Direct mapping: stick position = crosshair position (release recenters).
  EXPO: 1.3, // deflection response curve — fine aim near center, full range at the rim
  SNAP: 35, // crosshair follow speed while the stick drives (snappier than drag smoothing)
} as const;

export const DIFFICULTY_CLAMP_DT = 1 / 30; // max delta time fed to game logic

export const SAVE_KEY = "skystrike3d_save_v1";
