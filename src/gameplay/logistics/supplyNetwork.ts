import { REGION_GEO_BY_ID, TRANSPORT, approxKm } from '../../geo';
import { TERRAIN } from '../../data/terrain';
import { capitalRegionOf, regionAt } from '../../data/regions';
import type { CountryState } from '../country/types';
import { areAllied } from '../diplomacy/helpers';
import type { World } from '../World';
import { findRegionState } from '../war/WarSystem';

/**
 * Regional supply network.
 *
 * Supply is modelled as a bounded, multi-source flow over the geographic
 * region graph rather than a single distance-to-capital formula. Hubs (the
 * capital, depots, ports, developed provinces) seed the field; supply decays
 * along roads, is throttled by terrain and infrastructure, and can cross into
 * allied or access-granted territory through land borders and sea lanes.
 *
 * This is deliberately an approximation: one Dijkstra pass per country per day,
 * capped at 90 expanded regions, not a per-convoy logistics simulation.
 */

export interface SupplyField {
  /** regionId → 0..1 supply level reachable by this country. */
  levels: Map<string, number>;
  hubs: string[];
  /** Regions reachable by the field, used by the interface. */
  reachable: number;
}

const MAX_NODES = 90;

const isSource = (regionId: string, supplyHub: number): boolean => {
  const definition = regionAt(regionId);
  if (!definition) return false;
  return definition.isCapital || definition.hasPort || supplyHub > 0.05 || definition.infrastructure > 0.62;
};

const seedLevel = (regionId: string): number => {
  const definition = regionAt(regionId);
  if (!definition) return 0.6;
  return Math.min(
    1,
    0.62 +
      definition.infrastructure * 0.28 +
      (definition.isCapital ? 0.1 : 0) +
      (definition.hasPort ? 0.05 : 0),
  );
};

const canHostSupply = (world: World, country: CountryState, regionId: string): boolean => {
  const state = findRegionState(world, regionId);
  if (!state) return false;
  const owner = world.get(state.countryId);
  if (!owner) return false;
  const controller = state.controllerId ?? owner.id;
  if (controller !== owner.id && controller !== country.id) return false;
  if (owner.id === country.id || controller === country.id) return true;
  if (areAllied(country, owner)) return true;
  if (country.diplomacy.relations[owner.id]?.militaryAccess) return true;
  return false;
};

const regionStateOf = (world: World, regionId: string) => findRegionState(world, regionId);

export const computeSupplyField = (world: World, country: CountryState): SupplyField => {
  const levels = new Map<string, number>();
  const hubs: string[] = [];
  const seedCosts = new Map<string, number>();

  for (const region of country.regions) {
    if (region.controllerId && region.controllerId !== country.id) continue;
    if (!isSource(region.id, region.supplyHub)) continue;
    hubs.push(region.id);
    const definition = regionAt(region.id);
    const level = Math.min(1, seedLevel(region.id) * (1 - region.damage * 0.45));
    levels.set(region.id, level);
    // A damaged, unrest-ridden hub starts further "away" rather than at zero.
    seedCosts.set(region.id, (1 - level) * 900 + region.unrest * 220 + region.damage * 500);
    void definition;
  }

  if (levels.size === 0) {
    const fallback = capitalRegionOf(country.id)?.id ?? country.regions[0]?.id;
    if (fallback) {
      levels.set(fallback, 0.5);
      seedCosts.set(fallback, 0);
      hubs.push(fallback);
    }
  }

  const closed = new Set<string>();
  const queue = [...seedCosts.entries()].sort((a, b) => a[1] - b[1]);
  let expanded = 0;

  while (queue.length > 0 && expanded < MAX_NODES) {
    const [regionId, cost] = queue.shift()!;
    if (closed.has(regionId)) continue;
    closed.add(regionId);
    expanded += 1;
    const region = REGION_GEO_BY_ID[regionId];
    if (!region) continue;

    const neighbours = new Set(region.neighbours);
    for (const edge of TRANSPORT.byRegion.get(regionId) ?? []) {
      if (edge.kind === 'sea' || edge.kind === 'air') neighbours.add(
        edge.fromRegionId === regionId ? edge.toRegionId : edge.fromRegionId,
      );
    }

    for (const neighbourId of neighbours) {
      if (closed.has(neighbourId)) continue;
      if (!canHostSupply(world, country, neighbourId)) continue;
      const neighbour = REGION_GEO_BY_ID[neighbourId];
      if (!neighbour) continue;
      const definition = regionAt(neighbourId);
      const state = regionStateOf(world, neighbourId);
      const terrain = TERRAIN[definition?.terrain ?? 'plains'];
      const infrastructure = state?.infrastructure ?? definition?.infrastructure ?? 0.4;
      const distance = approxKm(region.centroid, neighbour.centroid);
      const seaEdge = (TRANSPORT.byRegion.get(regionId) ?? []).some(
        (edge) =>
          (edge.kind === 'sea' || edge.kind === 'air') &&
          (edge.fromRegionId === neighbourId || edge.toRegionId === neighbourId),
      );
      const terrainFactor = 1 / Math.max(0.4, terrain.supply);
      const blockadePenalty = 1 + (country.warfare?.naval.blockadeEffect ?? 0) * 1.8;
      const step =
        (distance / 380) * terrainFactor * (1.35 - Math.min(1, infrastructure) * 0.6) *
          (seaEdge ? 2.4 * blockadePenalty : 1) +
        (state?.unrest ?? 0) * 8 +
        (state?.damage ?? 0) * 12;
      const nextCost = cost + step;
      if (nextCost >= (seedCosts.get(neighbourId) ?? Number.POSITIVE_INFINITY)) continue;
      seedCosts.set(neighbourId, nextCost);
      const decay = Math.exp(-nextCost / 3200);
      const occupation = state && state.control !== 'sovereign' ? 0.82 : 1;
      levels.set(neighbourId, Math.max(levels.get(neighbourId) ?? 0, decay * occupation));
      queue.push([neighbourId, nextCost]);
    }
    queue.sort((a, b) => a[1] - b[1]);
  }

  return { levels, hubs, reachable: levels.size };
};

/** Supply available at a country's location for a given army. */
export const supplyAtRegion = (field: SupplyField, regionId: string | undefined): number => {
  if (!regionId) return 0;
  return field.levels.get(regionId) ?? 0;
};

/** Recomputes and stores the player-visible regional supply layer. */
export const applySupplyField = (world: World, country: CountryState): SupplyField => {
  const field = computeSupplyField(world, country);
  for (const region of country.regions) {
    const level = field.levels.get(region.id) ?? 0;
    region.supplyLevel = Math.max(0, Math.min(1, level));
  }
  return field;
};
