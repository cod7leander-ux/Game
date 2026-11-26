/** Central tuning constants. Gameplay numbers live here or in data files — never inline. */

export const GAME = {
  /** Title and branding. */
  title: 'Terra Dominion',
  version: '0.7.0',
  /** Bumped whenever the save payload shape changes. Migrations live in src/save/migrations.ts. */
  saveVersion: 7,
  /** World radius in scene units. All globe math is expressed as a fraction of this. */
  globeRadius: 10,
  /** Real milliseconds that make one in-game day at 1x speed. */
  msPerDay: 1600,
  /** Upper bound of days simulated in a single frame (protects slow devices). */
  maxDaysPerFrame: 16,
  /** Starting in-game date. */
  startDate: { year: 2031, month: 1, day: 1 },
  /**
   * Default world seed. Fixed so the nation preview shown before a campaign
   * matches the government, posture and army the player actually receives.
   */
  defaultSeed: 2031,
  /** Countries are evaluated by AI on a staggered schedule to keep updates cheap. */
  aiDecisionIntervalDays: 7,
  /** Autosave cadence in in-game days. */
  autosaveEveryDays: 90,
  /** Maximum notifications kept in memory. */
  notificationLimit: 60,
} as const;

export type GameSpeed = 0 | 1 | 2 | 4 | 8;

export const SPEEDS: readonly GameSpeed[] = [0, 1, 2, 4, 8];

/** Camera altitude range, expressed as a multiplier of the globe radius above the surface. */
export const CAMERA = {
  minAltitude: 0.012,
  maxAltitude: 6.2,
  startAltitude: 3.15,
  /** Altitude thresholds that switch the world view into a finer detail tier. */
  detailTiers: {
    global: 0.9,
    country: 0.28,
    region: 0.075,
    city: 0.02,
    army: 0.03,
    battlefield: 0.012,
    unit: 0.004,
    direct: 0.0006,
  },
  damping: 9,
  zoomSpeed: 0.0016,
  rotateSpeed: 0.0042,
  panSpeed: 0.0018,
  minPolar: 0.08,
  maxTilt: 1.32,
} as const;

export const QUALITY = {
  high: { pixelRatio: 2, starCount: 5200, shadows: true },
  balanced: { pixelRatio: 1.5, starCount: 3200, shadows: false },
  low: { pixelRatio: 1, starCount: 1800, shadows: false },
} as const;

export type QualityPreset = keyof typeof QUALITY;

/**
 * Tactical layer presentation constants.
 *
 * Battlefields are simulated in metres; the globe is drawn in scene units where
 * the planet radius is 10. VISUAL_SCALE converts battlefield metres into scene
 * units (a 6 km battlefield is ~0.7 units across, readable at region zoom).
 */
export const DIRECT = {
  /** Fixed simulation step for the direct-control layer, in seconds. */
  step: 1 / 30,
  /**
   * Local tactical compression: metres of weapon range per scene unit. The
   * globe is not drawn at human scale, so direct control uses the same
   * compressed local space the battlefield layer already established.
   */
  weaponScale: 0.00006,
  /** Maximum local contacts kept alive around a controlled unit. */
  maxContacts: 24,
  /** Terrain sampling interval in seconds (never per frame). */
  terrainInterval: 0.4,
  /** Contact spawn ring around the controlled unit, in scene units. */
  contactMinRange: 0.022,
  contactMaxRange: 0.1,
  /** A controlled unit is considered home within this distance. */
  homeRadius: 0.01,
  /** Damage a hostile contact deals per weapon hit, before weapon scaling. */
  retaliationScale: 0.1,
  /** Altitude above ground used by infantry, armour and artillery. */
  groundClearance: 0.00028,
  /** Ships sit just above the sea surface. */
  seaClearance: 0.00042,
  /** Maximum dive depth for submarines, in scene units below the surface. */
  maxDive: 0.0045,
} as const;

export const TACTICAL = {
  /** Scene units per battlefield metre. */
  visualScale: 0.00012,
  /** Camera altitude used when entering a battlefield (fraction of globe radius). */
  battleAltitude: 0.055,
  /** Strategic army tokens are drawn slightly larger than battle tokens. */
  mapTokenScale: 1.45,
  battleTokenScale: 1,
  /** Maximum army tokens drawn on the strategic map per army. */
  mapTokensPerArmy: 4,
} as const;
