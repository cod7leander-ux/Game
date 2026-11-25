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
const MAX_CONSTRUCTION_QUEUE = 6;
const PRIORITY_WEIGHT = { low: 0.6, normal: 1, high: 1.6 } as const;

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
    priority: ConstructionOrder['priority'] = 'normal',
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
      category: project.category,
      priority,
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

  /** Advances every queued project in parallel, weighted by priority. */
  tick(country: CountryState, day: number): void {
    if (country.occupierId || country.production.construction.length === 0) return;
    const active = country.production.construction.filter((order) => getProject(order.projectId));
    if (active.length === 0) {
      country.production.construction = [];
      return;
    }
    const totalWeight = active.reduce(
      (sum, order) => sum + PRIORITY_WEIGHT[order.priority ?? 'normal'],
      0,
    );
    const baseRate =
      country.economy.industrialCapacity *
      country.economy.allocation.infrastructure *
      0.55 *
      (1 + country.modifiers.production + (country.modifiers.civilian ?? 0)) *
      (0.7 + country.stability * 0.3) *
      (1 - clamp01(country.unrest) * 0.3) *
      (1 - clamp01(country.trade?.disruption ?? 0) * 0.2);

    const completed: ConstructionOrder[] = [];
    for (const order of active) {
      const weight = PRIORITY_WEIGHT[order.priority ?? 'normal'];
      // Each project runs on its own region's construction capacity, so
      // building in a developed region is materially faster.
      const region = country.regions.find((entry) => entry.id === order.regionId);
      const capacity = region?.constructionCapacity ?? 0.5;
      const rate = Math.max(
        0.08,
        (baseRate * capacity * weight) / Math.max(1, totalWeight),
      );
      order.daysRemaining -= rate;
      if (order.daysRemaining <= 0) completed.push(order);
    }
    for (const order of completed) {
      const project = getProject(order.projectId)!;
      this.complete(country, order, project, day);
    }
    if (completed.length > 0) {
      const ids = new Set(completed.map((order) => order.id));
      country.production.construction = country.production.construction.filter(
        (order) => !ids.has(order.id),
      );
    }
  }

  /** Cancels a project and recovers part of its material cost. */
  cancel(country: CountryState, orderId: string, day: number): boolean {
    const index = country.production.construction.findIndex((order) => order.id === orderId);
    if (index < 0) return false;
    const order = country.production.construction[index];
    const project = getProject(order.projectId);
    if (project) {
      for (const [resource, amount] of Object.entries(project.cost)) {
        country.economy.resources[resource as ResourceId] += (amount ?? 0) * 0.4;
      }
    }
    country.production.construction.splice(index, 1);
    this.events.emit({
      type: 'constructionCancelled',
      countryId: country.id,
      projectId: order.projectId,
      regionId: order.regionId,
      day,
    });
    return true;
  }

  reprioritise(
    country: CountryState,
    orderId: string,
    priority: ConstructionOrder['priority'],
  ): boolean {
    const order = country.production.construction.find((entry) => entry.id === orderId);
    if (!order) return false;
    order.priority = priority;
    return true;
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
      region.civilianIndustry = clamp01(
        (region.civilianIndustry ?? 0.2) + (project.effects.civilianIndustry ?? 0),
      );
      region.militaryIndustry = clamp01(
        (region.militaryIndustry ?? 0.1) + (project.effects.militaryIndustry ?? 0),
      );
      region.constructionCapacity = clamp(
        (region.constructionCapacity ?? 0.5) + (project.effects.constructionCapacity ?? 0),
        0.2,
        1.8,
      );
      region.airportCapacity = clamp01(
        (region.airportCapacity ?? 0) + (project.effects.airportCapacity ?? 0),
      );
      region.portCapacity = clamp01((region.portCapacity ?? 0) + (project.effects.portCapacity ?? 0));
      region.radar = clamp01((region.radar ?? 0) + (project.effects.radar ?? 0));
      region.fortification = clamp01(
        (region.fortification ?? 0) + (project.effects.fortification ?? 0),
      );
      region.populationCapacity = Math.round(
        (region.populationCapacity ?? region.population * 1.5) *
          (1 + (project.effects.populationCapacity ?? 0)),
      );
      region.development = clamp01(
        (region.infrastructure * 0.45 +
          (region.civilianIndustry ?? 0) * 0.25 +
          (region.militaryIndustry ?? 0) * 0.15 +
          (region.constructionCapacity ?? 0) * 0.15),
      );
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
