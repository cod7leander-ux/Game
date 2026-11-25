/**
 * Population and manpower state.
 *
 * Population is tracked by region (RegionState.population). This record keeps
 * the national aggregates and the manpower pool that military recruitment
 * draws from. Manpower is measured in thousands to match unit definitions.
 */
export interface SocietyState {
  population: number;
  workingPopulation: number;
  militaryAgePopulation: number;
  /** Available recruits in thousands. Mirrors economy.availableManpower. */
  manpowerPool: number;
  /** Recruits currently embodied in formations, in thousands. */
  mobilized: number;
  /** Cumulative formations lost, expressed as thousands of people. */
  casualties: number;
  /** 0..1 recruitment pressure: how much of the pool is already committed. */
  recruitmentPressure: number;
  /** Last daily population growth rate. */
  growthRate: number;
  lastGrowthDay: number;
}

export const createSocietyState = (population: number, manpowerPool: number): SocietyState => ({
  population,
  workingPopulation: Math.round(population * 0.52),
  militaryAgePopulation: Math.round(population * 0.23),
  manpowerPool,
  mobilized: 0,
  casualties: 0,
  recruitmentPressure: 0,
  growthRate: 0,
  lastGrowthDay: 0,
});
