import { REGION_GEO_BY_ID, approxKm, haversineKm } from '../../geo';
import { TERRAIN } from '../../data/terrain';
import { capitalRegionOf, regionAt } from '../../data/regions';
import type { CountryState } from '../country/types';
import { areAllied, areAtWar } from '../diplomacy/helpers';
import type { World } from '../World';
import type { RegionState } from '../regions/types';

/**
 * Strategic pathfinding on the geographic region graph.
 *
 * A* over region adjacency (same-country triangle borders and cross-border
 * links). Cost reflects distance, terrain, infrastructure, enemy soil and
 * occupation, so a mountain border is genuinely more expensive than a road
 * plain. Neutral territory is closed unless the mover is allied, has military
 * access, is at war with its owner, or already occupies it — the same rule the
 * army system enforces for a single hop.
 *
 * Paths are cached per mover/origin/destination/day. No frame ever runs a
 * search; callers ask when an order is issued.
 */

export interface StrategicPath {
  found: boolean;
  /** Region ids from origin (inclusive) to destination (inclusive). */
  nodes: string[];
  /** Country sequence, deduplicated. */
  countries: string[];
  cost: number;
  distanceKm: number;
  reason: 'ok' | 'same-region' | 'unreachable' | 'blocked' | 'unknown-region';
}

export interface PathRequest {
  countryId: string;
  fromRegionId: string;
  toRegionId: string;
  /** Defaults to 600 expanded regions, enough for a continental route. */
  maxNodes?: number;
}

interface QueueEntry {
  regionId: string;
  priority: number;
}

class MinHeap {
  private readonly entries: QueueEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(entry: QueueEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.entries[parent].priority <= this.entries[index].priority) break;
      [this.entries[parent], this.entries[index]] = [this.entries[index], this.entries[parent]];
      index = parent;
    }
  }

  pop(): QueueEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!last || this.entries.length === 0) return first;
    this.entries[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.entries.length && this.entries[left].priority < this.entries[smallest].priority) {
        smallest = left;
      }
      if (right < this.entries.length && this.entries[right].priority < this.entries[smallest].priority) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.entries[index], this.entries[smallest]] = [this.entries[smallest], this.entries[index]];
      index = smallest;
    }
    return first;
  }
}

const regionOwner = (world: World, regionId: string): CountryState | undefined => {
  const definition = regionAt(regionId);
  if (!definition) return undefined;
  return world.get(definition.countryId);
};

/** Whether an army belonging to `mover` may stand in this region. */
export const canTraverseRegion = (
  world: World,
  mover: CountryState,
  regionId: string,
): boolean => {
  const owner = regionOwner(world, regionId);
  if (!owner) return false;
  if (owner.id === mover.id) return true;
  if (owner.occupierId === mover.id) return true;
  if (areAllied(mover, owner)) return true;
  if (mover.diplomacy.relations[owner.id]?.militaryAccess) return true;
  if (areAtWar(mover, owner)) return true;
  // Regions occupied by an ally are reachable through that ally.
  if (owner.occupierId && areAllied(mover, world.get(owner.occupierId) ?? owner)) return true;
  return false;
};

export const strategicStepCost = (
  world: World,
  mover: CountryState,
  fromRegionId: string,
  toRegionId: string,
): number => {
  const from = REGION_GEO_BY_ID[fromRegionId];
  const to = REGION_GEO_BY_ID[toRegionId];
  if (!from || !to) return Number.POSITIVE_INFINITY;
  const definition = regionAt(toRegionId);
  const regionState: RegionState | undefined = definition
    ? world.get(definition.countryId)?.regions.find((region) => region.id === toRegionId)
    : undefined;
  const terrain = TERRAIN[definition?.terrain ?? 'plains'];
  const infrastructure = regionState?.infrastructure ?? definition?.infrastructure ?? 0.4;
  const owner = regionOwner(world, toRegionId);
  const enemy = owner ? areAtWar(mover, owner) : false;
  const occupied = (regionState?.control ?? 'sovereign') !== 'sovereign';
  const distance = approxKm(from.centroid, to.centroid);
  const terrainFactor = 1 / Math.max(0.35, terrain.march);
  const infrastructureFactor = 1.25 - Math.min(1, infrastructure) * 0.5;
  const hostility = enemy ? 1.35 : 1;
  const occupation = occupied ? 1.15 : 1;
  const damage = 1 + (regionState?.damage ?? 0) * 0.6;
  return (distance / 420) * terrainFactor * infrastructureFactor * hostility * occupation * damage;
};

const heuristic = (regionId: string, targetRegionId: string): number => {
  const from = REGION_GEO_BY_ID[regionId];
  const to = REGION_GEO_BY_ID[targetRegionId];
  if (!from || !to) return 0;
  return haversineKm(from.centroid, to.centroid) / 900;
};

export class Pathfinder {
  private readonly cache = new Map<string, { day: number; path: StrategicPath }>();

  find(world: World, request: PathRequest): StrategicPath {
    const mover = world.get(request.countryId);
    const from = REGION_GEO_BY_ID[request.fromRegionId];
    const to = REGION_GEO_BY_ID[request.toRegionId];
    if (!mover || !from || !to) {
      return {
        found: false,
        nodes: [],
        countries: [],
        cost: Number.POSITIVE_INFINITY,
        distanceKm: 0,
        reason: 'unknown-region',
      };
    }
    if (request.fromRegionId === request.toRegionId) {
      return {
        found: true,
        nodes: [request.fromRegionId],
        countries: [from.countryId],
        cost: 0,
        distanceKm: 0,
        reason: 'same-region',
      };
    }

    const cacheKey = `${request.countryId}|${request.fromRegionId}|${request.toRegionId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.day === world.day) return cached.path;

    const maxNodes = request.maxNodes ?? 600;
    const open = new MinHeap();
    const cost = new Map<string, number>([[request.fromRegionId, 0]]);
    const cameFrom = new Map<string, string>();
    const closed = new Set<string>();
    open.push({ regionId: request.fromRegionId, priority: heuristic(request.fromRegionId, request.toRegionId) });
    let expanded = 0;
    let reached = false;

    while (open.size > 0 && expanded < maxNodes) {
      const current = open.pop();
      if (!current || closed.has(current.regionId)) continue;
      if (current.regionId === request.toRegionId) {
        reached = true;
        break;
      }
      closed.add(current.regionId);
      expanded += 1;
      const region = REGION_GEO_BY_ID[current.regionId];
      if (!region) continue;
      for (const neighbourId of region.neighbours) {
        if (closed.has(neighbourId)) continue;
        if (neighbourId !== request.toRegionId && !canTraverseRegion(world, mover, neighbourId)) {
          continue;
        }
        if (neighbourId === request.toRegionId && !canTraverseRegion(world, mover, neighbourId)) {
          // An enemy target is valid only when at war; neutral closed ground is not.
          const owner = regionOwner(world, neighbourId);
          if (!owner || !areAtWar(mover, owner)) continue;
        }
        const step = strategicStepCost(world, mover, current.regionId, neighbourId);
        if (!Number.isFinite(step)) continue;
        const next = (cost.get(current.regionId) ?? Number.POSITIVE_INFINITY) + step;
        if (next < (cost.get(neighbourId) ?? Number.POSITIVE_INFINITY)) {
          cost.set(neighbourId, next);
          cameFrom.set(neighbourId, current.regionId);
          open.push({ regionId: neighbourId, priority: next + heuristic(neighbourId, request.toRegionId) });
        }
      }
    }

    if (!reached) {
      const owner = regionOwner(world, request.toRegionId);
      const blocked = owner ? !canTraverseRegion(world, mover, request.toRegionId) && !areAtWar(mover, owner) : true;
      const path: StrategicPath = {
        found: false,
        nodes: [],
        countries: [],
        cost: Number.POSITIVE_INFINITY,
        distanceKm: 0,
        reason: blocked ? 'blocked' : 'unreachable',
      };
      this.cache.set(cacheKey, { day: world.day, path });
      return path;
    }

    const nodes: string[] = [request.toRegionId];
    let cursor = request.toRegionId;
    while (cursor !== request.fromRegionId) {
      const previous = cameFrom.get(cursor);
      if (!previous) break;
      nodes.unshift(previous);
      cursor = previous;
    }
    const countries: string[] = [];
    let distanceKm = 0;
    for (let index = 0; index < nodes.length; index += 1) {
      const region = REGION_GEO_BY_ID[nodes[index]];
      if (!region) continue;
      if (countries[countries.length - 1] !== region.countryId) countries.push(region.countryId);
      if (index > 0) {
        const previous = REGION_GEO_BY_ID[nodes[index - 1]];
        if (previous) distanceKm += approxKm(previous.centroid, region.centroid);
      }
    }
    const path: StrategicPath = {
      found: true,
      nodes,
      countries,
      cost: cost.get(request.toRegionId) ?? 0,
      distanceKm,
      reason: 'ok',
    };
    this.cache.set(cacheKey, { day: world.day, path });
    if (this.cache.size > 512) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    return path;
  }

  /** Country-level hop sequence for an army order. */
  countryRoute(world: World, request: PathRequest): string[] {
    const path = this.find(world, request);
    if (!path.found) return [];
    const current = world.get(request.countryId);
    const sourceCountry = regionAt(request.fromRegionId)?.countryId;
    const route = path.countries.filter((countryId) => countryId !== sourceCountry);
    if (current && route[0] === current.id) route.shift();
    return route;
  }

  clear(): void {
    this.cache.clear();
  }

  get cachedRoutes(): number {
    return this.cache.size;
  }
}

/** Capital region id of a country, used when an order names a country. */
export const targetRegionForCountry = (countryId: string): string | undefined =>
  capitalRegionOf(countryId)?.id ?? regionAt(`${countryId}-R1`)?.id;

/** Shared instance: the simulation owns exactly one path cache. */
export const strategicPathfinder = new Pathfinder();
