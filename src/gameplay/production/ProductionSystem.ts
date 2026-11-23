import { clamp, clamp01 } from '../../core/math';
import { getProject, INFRASTRUCTURE_PROJECTS } from '../../data/production';
import { regionAt } from '../../data/regions';
import type { CountryState } from '../country/types';
import type { SimEventSink } from '../events';
import type { ResourceId } from '../economy/types';
import { MAX_PRODUCTION_QUEUE } from '../military/MilitarySystem';
import type { ConstructionOrder, InfrastructureProject } from './types';

/**
 * Civilian production.
 *
 * Infrastructure is built with the same industrial capacity the army competes
 * for, so the budget allocation matters. Projects apply permanent regional
 * effects (supply capacity, output, infrastructure), which is how the map
 * visibly develops over a long campaign.
 */
const MAX_CONSTRUCTION_QUEUE = 3;

export const canAffordProject = (country: CountryState, project: InfrastructureProject): boolean => {
  for (const [resource, amount] of Object.entries(project.cost)) {
    if (country.economy.resources[resource as ResourceId] < (amount ?? 0)) return false;
  }
  return true;
};

export const projectAvailable = (
  country: CountryState,
  project: InfrastructureProject,
  regionId: string,
): boolean => {
  if (!country.research.completed && project.requiresTech.length > 0) return false;
  if (!project.requiresTech.every((tech) => country.research.completed.includes(tech))) return false;
  const region = country.regions.find((entry) => entry.id === regionId);
  if (!region) return false;
  if (project.requiresInfrastructure !== undefined && region.infrastructure < project.requiresInfrastructure) {
    return false;
  }
  if (project.effects.infrastructure !== undefined && region.infrastructure >= 0.99) return false;
  return Boolean(regionAt(regionId));
};

export type ConstructionFailure =
  | 'unknownProject'
  | 'unknownRegion'
  | 'locked'
  | 'queueFull'
  | 'unaffordable'
  | 'occupied';

export type ConstructionResult =
  | { ok: true; order: ConstructionOrder }
  | { ok: false; reason: ConstructionFailure };

export class ProductionSystem {
  constructor(private readonly events: SimEventSink) {}

  enqueue(
    country: CountryState,
    projectId: string,
    regionId: string,
    day: number,
  ): ConstructionResult {
    const project = getProject(projectId);
    if (!project) return { ok: false, reason: 'unknownProject' };
    if (!country.regions.some((region) => region.id === regionId)) {
      return { ok: false, reason: 'unknownRegion' };
    }
    if (country.occupierId) return { ok: false, reason: 'occupied' };
    if (project.requiresTech.length > 0 && !project.requiresTech.every((tech) => country.research.completed.includes(tech))) {
      return { ok: false, reason: 'locked' };
    }
    if (country.production.construction.length >= MAX_CONSTRUCTION_QUEUE) {
      return { ok: false, reason: 'queueFull' };
    }
    if (!projectAvailable(country, project, regionId)) {
      return { ok: false, reason: 'unaffordable' };
    }
    if (!canAffordProject(country, project)) return { ok: false, reason: 'unaffordable' };

    for (const [resource, amount] of Object.entries(project.cost)) {
      country.economy.resources[resource as ResourceId] -= amount ?? 0;
    }

    const order: ConstructionOrder = {
      id: `${projectId}-${regionId}-${day}-${country.production.construction.length}`,
      projectId,
      regionId,
      daysRemaining: project.days,
      totalDays: project.days,
      startedDay: day,
    };
    country.production.construction.push(order);
    this.events.emit({
      type: 'constructionStart',
      countryId: country.id,
      projectId,
      regionId,
      day,
    });
    return { ok: true, order };
  }

  /** Advances construction using the infrastructure share of industry. */
  tick(country: CountryState, day: number): void {
    if (country.occupierId) return;
    const order = country.production.construction[0];
    if (!order) return;
    const project = getProject(order.projectId);
    if (!project) {
      country.production.construction.shift();
      return;
    }

    const rate =
      country.economy.industrialCapacity *
      country.economy.allocation.infrastructure *
      0.9 *
      (1 + country.modifiers.production) *
      (0.7 + country.stability * 0.3) *
      (1 - clamp01(country.unrest) * 0.3);

    order.daysRemaining -= Math.max(0.15, rate);
    if (order.daysRemaining > 0) return;

    this.complete(country, order, project, day);
    country.production.construction.shift();
  }

  private complete(
    country: CountryState,
    order: ConstructionOrder,
    project: InfrastructureProject,
    day: number,
  ): void {
    const region = country.regions.find((entry) => entry.id === order.regionId);
    if (region) {
      region.infrastructure = clamp(region.infrastructure + (project.effects.infrastructure ?? 0), 0, 1);
      region.supplyHub = clamp(region.supplyHub + (project.effects.supply ?? 0), 0, 1.5);
      region.industryBonus = clamp(region.industryBonus + (project.effects.industry ?? 0), 0, 1);
      region.damage = Math.max(0, region.damage - 0.1);
      if (project.effects.resource) {
        for (const [resource, amount] of Object.entries(project.effects.resource)) {
          const key = resource as ResourceId;
          region.bonusOutput[key] = (region.bonusOutput[key] ?? 0) + (amount ?? 0);
        }
      }
    }
    country.stability = clamp(country.stability + (project.effects.stability ?? 0), 0, 0.98);
    country.production.completedProjects += 1;
    this.events.emit({
      type: 'constructionComplete',
      countryId: country.id,
      projectId: project.id,
      regionId: order.regionId,
      day,
    });
  }

  /** AI helper: the cheapest useful project the country can start now. */
  pickProject(country: CountryState, day: number): { projectId: string; regionId: string } | null {
    void day;
    return chooseProject(country);
  }
}

/** AI/shared helper: the cheapest useful project the country can start now. */
export const chooseProject = (
  country: CountryState,
): { projectId: string; regionId: string } | null => {
  if (country.production.construction.length >= MAX_CONSTRUCTION_QUEUE) return null;
  const region = country.regions.slice().sort((a, b) => b.infrastructure - a.infrastructure)[0];
  if (!region) return null;
  const candidates = INFRASTRUCTURE_PROJECTS.filter(
    (project) => projectAvailable(country, project, region.id) && canAffordProject(country, project),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.cost.money ?? 0) - (b.cost.money ?? 0));
  return { projectId: candidates[0].id, regionId: region.id };
};

export const MAX_CONSTRUCTION = MAX_CONSTRUCTION_QUEUE;
export { MAX_PRODUCTION_QUEUE };
