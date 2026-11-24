import { clamp, clamp01 } from '../../core/math';
import { COUNTRY_BY_ID } from '../../data/countries';
import { regionAt } from '../../data/regions';
import { REGION_GEO_BY_ID } from '../../geo';
import type { CountryState } from '../country/types';
import type { DiplomacySystem } from '../diplomacy/DiplomacySystem';
import type { SimEventSink } from '../events';
import { armyPower, armyUnits } from '../military/armies';
import {
  captureRegion,
  liberateRegion,
  regionControllerId,
  regionValue,
} from '../regions/regions';
import type { RegionState } from '../regions/types';
import type { World } from '../World';
import {
  createAirState,
  goalSide,
  isParticipant,
  warSideCountries,
  type AirState,
  type ArmyGroup,
  type Frontline,
  type Operation,
  type PeaceOffer,
  type PeaceTerm,
  type War,
  type WarGoal,
  type WarSide,
  type WarStatus,
} from './types';

/**
 * War model 2.0.
 *
 * A war is a first-class multi-country entity. It owns goals, participants,
 * fronts, score and exhaustion; it never owns geometry. Armies, occupation and
 * the tactical battlefield remain the authoritative resolvers of combat, and
 * the war layer only records and evaluates the strategic consequences.
 *
 * All evaluation runs on daily simulation ticks or explicit events. Nothing
 * here is called from the render loop.
 */
const MAX_FRONTS_PER_WAR = 12;
const MAX_HISTORY_WARS = 24;
const OCCUPATION_RATE = 0.075;
const LIBERATION_RATE = 0.045;

export interface PeaceValidation {
  ok: boolean;
  reason: string;
}

/** Finds a region state by id without assuming the original country still owns it. */
export const findRegionState = (world: World, regionId: string): RegionState | undefined => {
  for (const country of world.countries.values()) {
    const region = country.regions.find((entry) => entry.id === regionId);
    if (region) return region;
  }
  return undefined;
};

const regionStateOf = findRegionState;

export const controllerOf = (world: World, regionId: string): string | null => {
  const state = findRegionState(world, regionId);
  if (state) return regionControllerId(state);
  return regionAt(regionId)?.countryId ?? null;
};

const sideOfCountry = (war: War, countryId: string | null): WarSide | null => {
  if (!countryId) return null;
  return war.participants.find(
    (participant) => participant.countryId === countryId && participant.leftDay === null,
  )?.side ?? null;
};

const countryName = (id: string): string => COUNTRY_BY_ID[id]?.name.en ?? id;

export class WarSystem {
  /** Rebuild fronts on the next tick after territory, participants or wars change. */
  private dirty = true;

  constructor(
    private readonly events: SimEventSink,
    private readonly diplomacy: DiplomacySystem,
  ) {}

  markDirty(): void {
    this.dirty = true;
  }

  warForCountry(world: World, countryId: string): War[] {
    return Object.values(world.wars).filter(
      (war) => war.status === 'active' && isParticipant(war, countryId),
    );
  }

  findWarBetween(world: World, aId: string, bId: string): War | undefined {
    return Object.values(world.wars).find(
      (war) =>
        war.status === 'active' &&
        isParticipant(war, aId) &&
        isParticipant(war, bId) &&
        sideOfCountry(war, aId) !== sideOfCountry(war, bId),
    );
  }

  private nextWarId(world: World, aggressorId: string, day: number): string {
    let index = 1;
    while (world.wars[`war-${day}-${aggressorId}-${index}`]) index += 1;
    return `war-${day}-${aggressorId}-${index}`;
  }

  /**
   * Creates a war, or folds the declaration into an existing war between the
   * same coalitions. Allies may join; they are never forced to.
   */
  startWar(world: World, aggressor: CountryState, defender: CountryState, day: number): War {
    const existing = this.findWarBetween(world, aggressor.id, defender.id);
    if (existing) return existing;
    const war: War = {
      id: this.nextWarId(world, aggressor.id, day),
      startDay: day,
      endDay: null,
      aggressorId: aggressor.id,
      primaryDefenderId: defender.id,
      participants: [
        { countryId: aggressor.id, side: 'attacker', joinedDay: day, leftDay: null, casualties: 0 },
        { countryId: defender.id, side: 'defender', joinedDay: day, leftDay: null, casualties: 0 },
      ],
      goals: this.createGoals(world, aggressor.id, defender.id, day),
      fronts: [],
      score: 0,
      status: 'active',
      battles: 0,
      attackerBattlesWon: 0,
      defenderBattlesWon: 0,
      casualties: 0,
      occupiedRegions: [],
      economicDamage: 0,
      exhaustion: { attacker: 0, defender: 0 },
      lastScoreDay: 0,
    };
    world.wars[war.id] = war;
    this.joinAllies(world, war, day);
    this.rebuildFrontlines(world, day);
    this.events.emit({
      type: 'warStarted',
      warId: war.id,
      aggressorId: aggressor.id,
      defenderId: defender.id,
      day,
    });
    return war;
  }

  private createGoals(
    world: World,
    attackerId: string,
    defenderId: string,
    day: number,
  ): WarGoal[] {
    const defender = world.get(defenderId);
    const capital = defender?.capitalRegionId ?? null;
    const key = defender
      ? [...defender.regions].sort(
          (a, b) => regionValue(defender, b) - regionValue(defender, a),
        )[0]
      : undefined;
    const resource = defender
      ? [...defender.regions].sort((a, b) => {
          const da = regionAt(a.id)?.richness ?? {};
          const db = regionAt(b.id)?.richness ?? {};
          return (
            Object.values(db).reduce((sum, value) => sum + (value ?? 0), 0) -
            Object.values(da).reduce((sum, value) => sum + (value ?? 0), 0)
          );
        })[0]
      : undefined;
    const goals: WarGoal[] = [
      {
        id: `${attackerId}-${day}-goals-capital`,
        type: 'captureCapital',
        ownerId: attackerId,
        targetCountryId: defenderId,
        targetRegionId: capital,
        priority: 0.95,
        scoreContribution: 22,
        status: 'active',
        progress: 0,
        createdDay: day,
        completedDay: null,
      },
      {
        id: `${attackerId}-${day}-goals-region`,
        type: 'conquest',
        ownerId: attackerId,
        targetCountryId: defenderId,
        targetRegionId: key?.id ?? capital,
        priority: 0.7,
        scoreContribution: 14,
        status: 'active',
        progress: 0,
        createdDay: day,
        completedDay: null,
      },
    ];
    if (resource) {
      goals.push({
        id: `${attackerId}-${day}-goals-resource`,
        type: 'secureResource',
        ownerId: attackerId,
        targetCountryId: defenderId,
        targetRegionId: resource.id,
        priority: 0.55,
        scoreContribution: 9,
        status: 'active',
        progress: 0,
        createdDay: day,
        completedDay: null,
      });
    }
    goals.push({
      id: `${defenderId}-${day}-goals-defend`,
      type: 'defendTerritory',
      ownerId: defenderId,
      targetCountryId: attackerId,
      targetRegionId: capital,
      priority: 0.9,
      scoreContribution: 18,
      status: 'active',
      progress: 0,
      createdDay: day,
      completedDay: null,
    });
    return goals;
  }

  /**
   * Allies evaluate joining by trust, threat, proximity and exhaustion. A
   * defensive ally is more likely to honour the pact; the player's own allies
   * use the same rule, so the diplomatic world stays consistent.
   */
  private joinAllies(world: World, war: War, day: number): void {
    for (const side of ['attacker', 'defender'] as const) {
      const own = warSideCountries(war, side);
      const opponentSide: WarSide = side === 'attacker' ? 'defender' : 'attacker';
      const opponents = warSideCountries(war, opponentSide);
      for (const countryId of own) {
        const country = world.get(countryId);
        if (!country) continue;
        for (const allyId of country.diplomacy.allies) {
          if (isParticipant(war, allyId)) continue;
          const ally = world.get(allyId);
          if (!ally || ally.occupierId) continue;
          if (opponents.some((enemy) => ally.diplomacy.relations[enemy]?.atWar)) continue;
          const relation = ally.diplomacy.relations[countryId];
          const trust = relation?.trust ?? 0;
          const threat = relation?.threat ?? 0;
          const proximity = world.neighboursOf(allyId).some((id) => id === countryId) ? 0.2 : 0;
          const exhaustionPenalty = ally.warExhaustion * 0.5;
          const chance = clamp01(0.08 + trust / 220 + threat / 400 + proximity - exhaustionPenalty);
          const roll = world.rngFor(allyId, day + 31 + war.startDay).next();
          if (roll > chance) continue;
          this.joinWar(world, war, ally, side, day);
          this.events.emit({
            type: 'allyJoinedWar',
            warId: war.id,
            countryId: allyId,
            side,
            day,
          });
        }
      }
    }
  }

  /** Adds a participant and sets every bilateral war relation with the enemy side. */
  joinWar(world: World, war: War, country: CountryState, side: WarSide, day: number): void {
    if (isParticipant(war, country.id)) return;
    const existing = war.participants.find((participant) => participant.countryId === country.id);
    if (existing) {
      existing.side = side;
      existing.leftDay = null;
      existing.joinedDay = day;
    } else {
      war.participants.push({
        countryId: country.id,
        side,
        joinedDay: day,
        leftDay: null,
        casualties: 0,
      });
    }
    const enemies = warSideCountries(war, side === 'attacker' ? 'defender' : 'attacker');
    for (const enemyId of enemies) {
      const enemy = world.get(enemyId);
      if (enemy) this.diplomacy.joinWar(country, enemy, day);
    }
    this.dirty = true;
  }

  onBattle(
    world: World,
    event: {
      attackerId: string;
      defenderId: string;
      attackerWon: boolean;
      attackerLosses: number;
      defenderLosses: number;
      day: number;
    },
  ): void {
    const war = this.findWarBetween(world, event.attackerId, event.defenderId);
    if (!war) return;
    const attackerSide = sideOfCountry(war, event.attackerId);
    if (!attackerSide) return;
    war.battles += 1;
    if (attackerSide === 'attacker') {
      if (event.attackerWon) war.attackerBattlesWon += 1;
      else war.defenderBattlesWon += 1;
    } else {
      if (event.attackerWon) war.defenderBattlesWon += 1;
      else war.attackerBattlesWon += 1;
    }
    war.casualties += event.attackerLosses + event.defenderLosses;
    const attackerParticipant = war.participants.find(
      (participant) => participant.countryId === event.attackerId,
    );
    const defenderParticipant = war.participants.find(
      (participant) => participant.countryId === event.defenderId,
    );
    if (attackerParticipant) attackerParticipant.casualties += event.attackerLosses;
    if (defenderParticipant) defenderParticipant.casualties += event.defenderLosses;
    this.dirty = true;
    this.updateScore(world, war, event.day);
    this.events.emit({
      type: 'warScoreChanged',
      warId: war.id,
      score: war.score,
      day: event.day,
    });
  }

  /** One daily strategic update: control consolidation, goals, score, fronts. */
  tick(world: World, day: number): void {
    for (const war of Object.values(world.wars)) {
      if (war.status !== 'active') continue;
      this.updateRegionalControl(world, war, day);
      this.updateGoals(world, war, day);
      this.updateExhaustion(world, war);
      this.updateScore(world, war, day);
      if (war.score <= -85 || war.score >= 85) {
        this.updateOccupiedRegions(world, war);
      }
    }
    if (this.dirty || day % 2 === 0) {
      for (const war of Object.values(world.wars)) {
        if (war.status !== 'active') continue;
        this.rebuildFrontlines(world, day, war.id);
      }
      this.dirty = false;
    }
    this.maybeOfferPeace(world, day);
    this.pruneHistory(world, day);
  }

  private updateRegionalControl(world: World, war: War, day: number): void {
    const participants = new Set(war.participants.map((participant) => participant.countryId));
    for (const country of world.countries.values()) {
      for (const region of country.regions) {
        const controller = region.controllerId;
        if (!controller || controller === region.countryId) {
          region.occupationProgress = Math.max(0, region.occupationProgress - 0.05);
          if (region.controlStatus === 'liberated' && day % 10 === 0) {
            region.controlStatus = 'controlled';
          }
          region.resistance = Math.max(0, region.resistance - 0.002);
          continue;
        }
        if (!participants.has(controller) && !participants.has(region.countryId)) continue;
        const controllerSide = sideOfCountry(war, controller);
        const ownerSide = sideOfCountry(war, region.countryId);
        if (!controllerSide || !ownerSide || controllerSide === ownerSide) {
          if (!this.findWarBetween(world, controller, region.countryId)) liberateRegion(region);
          continue;
        }

        const controllerArmies: typeof country.military.armies = [];
        const defenderArmies: typeof country.military.armies = [];
        for (const armyOwner of world.countries.values()) {
          const armySide = sideOfCountry(war, armyOwner.id);
          for (const army of armyOwner.military.armies) {
            if (army.regionId !== region.id) continue;
            if (armySide === controllerSide) controllerArmies.push(army);
            else if (armySide === ownerSide) defenderArmies.push(army);
          }
        }
        const friendlyPresence = controllerArmies.reduce(
          (total, army) => total + armyUnits(army),
          0,
        );
        const enemyPresence = defenderArmies.reduce((total, army) => total + armyUnits(army), 0);

        if (friendlyPresence > 0 && enemyPresence === 0) {
          const supply = controllerArmies.reduce((total, army) => total + army.supply, 0) /
            Math.max(1, controllerArmies.length);
          region.occupationProgress = clamp01(
            region.occupationProgress +
              OCCUPATION_RATE * (0.6 + supply * 0.6) * (1 - region.resistance * 0.45),
          );
          region.control = 'contested';
          region.controlStatus = region.occupationProgress >= 1 ? 'occupied' : 'contested';
          if (region.occupationProgress >= 1) {
            captureRegion(region, controller, day);
            this.events.emit({
              type: 'regionCaptured',
              regionId: region.id,
              controllerId: controller,
              ownerId: region.countryId,
              day,
            });
          }
        } else if (enemyPresence > 0) {
          region.occupationProgress = clamp01(region.occupationProgress - 0.05);
          region.control = 'contested';
          region.controlStatus = 'contested';
          region.resistance = clamp01(region.resistance + 0.006);
        } else {
          region.occupationProgress = clamp01(
            region.occupationProgress - LIBERATION_RATE - region.resistance * 0.03,
          );
          region.resistance = clamp01(region.resistance + 0.004);
          if (region.occupationProgress <= 0) {
            liberateRegion(region);
            this.events.emit({
              type: 'regionLiberated',
              regionId: region.id,
              ownerId: region.countryId,
              day,
            });
          }
        }
      }
    }
  }

  private updateGoals(world: World, war: War, day: number): void {
    for (const goal of war.goals) {
      if (goal.status !== 'active') continue;
      const target = goal.targetRegionId ? findRegionState(world, goal.targetRegionId) : null;
      const controller = target ? regionControllerId(target) : null;
      const ownerSide = goalSide(war, goal.ownerId);
      if (!ownerSide) {
        goal.status = 'failed';
        continue;
      }
      if (goal.type === 'defendTerritory') {
        const country = world.get(goal.ownerId);
        const capital = country?.capitalRegionId
          ? findRegionState(world, country.capitalRegionId)
          : undefined;
        const held =
          country &&
          capital &&
          regionControllerId(capital) === country.id &&
          country.regions.filter((region) => regionControllerId(region) !== country.id).length <=
            Math.ceil(country.regions.length * 0.35);
        goal.progress = held ? 1 : 0.35;
        if (held && war.score < -20) {
          goal.status = 'completed';
          goal.completedDay = day;
        }
        continue;
      }
      if (goal.type === 'punitive') {
        const sideScore = ownerSide === 'attacker' ? war.score : -war.score;
        goal.progress = clamp01((sideScore + 40) / 60);
        if (sideScore >= 25) {
          goal.status = 'completed';
          goal.completedDay = day;
        }
        continue;
      }
      if (!target) {
        goal.status = 'failed';
        continue;
      }
      const achieved = controller === goal.ownerId;
      goal.progress = achieved ? 1 : controller && controller !== target.countryId ? 0.5 : 0;
      if (achieved) {
        goal.status = 'completed';
        goal.completedDay = day;
        this.events.emit({
          type: 'warGoalCompleted',
          warId: war.id,
          goalId: goal.id,
          countryId: goal.ownerId,
          day,
        });
      }
    }
  }

  private updateExhaustion(world: World, war: War): void {
    for (const side of ['attacker', 'defender'] as const) {
      const ids = warSideCountries(war, side);
      const values = ids
        .map((id) => world.get(id)?.warExhaustion ?? 0)
        .filter((value) => Number.isFinite(value));
      war.exhaustion[side] =
        values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    }
  }

  /** Deterministic attacker-perspective score in -100..100. */
  updateScore(world: World, war: War, day: number): number {
    const attackers = new Set(warSideCountries(war, 'attacker'));
    const defenders = new Set(warSideCountries(war, 'defender'));
    let attackerValue = 0;
    let defenderValue = 0;
    let attackerDamage = 0;
    let defenderDamage = 0;
    let attackerCapitals = 0;
    let defenderCapitals = 0;
    const attackerCountries = [...attackers].map((id) => world.get(id)).filter(Boolean);
    const defenderCountries = [...defenders].map((id) => world.get(id)).filter(Boolean);

    for (const country of [...attackerCountries, ...defenderCountries]) {
      if (!country) continue;
      const isAttacker = attackers.has(country.id);
      for (const region of country.regions) {
        const definition = regionAt(region.id);
        const value = 0.12 + (definition?.strategicValue ?? 0.2) + region.infrastructure * 0.08;
        const controller = regionControllerId(region);
        if (controller === country.id) {
          if (isAttacker) attackerValue += value;
          else defenderValue += value;
        } else if (
          (isAttacker && defenders.has(controller)) ||
          (!isAttacker && attackers.has(controller))
        ) {
          // Enemy control transfers the strategic value of the region to the
          // controlling side and also counts as economic damage.
          if (isAttacker) attackerValue += value;
          else defenderValue += value;
          const damage = value + region.industryBonus * 0.35 + region.infrastructure * 0.1;
          if (isAttacker) attackerDamage += damage;
          else defenderDamage += damage;
        }
      }
    }
    for (const id of attackers) {
      const country = world.get(id);
      const capital = country?.capitalRegionId ? findRegionState(world, country.capitalRegionId) : undefined;
      if (capital && regionControllerId(capital) === id) attackerCapitals += 1;
    }
    for (const id of defenders) {
      const country = world.get(id);
      const capital = country?.capitalRegionId ? findRegionState(world, country.capitalRegionId) : undefined;
      if (capital && regionControllerId(capital) === id) defenderCapitals += 1;
    }
    const total = attackerValue + defenderValue;
    const territory = total > 0 ? ((attackerValue - defenderValue) / total) * 55 : 0;
    const capitals = (attackerCapitals - defenderCapitals) * 10;
    const battleTotal = war.attackerBattlesWon + war.defenderBattlesWon;
    const battles = battleTotal > 0 ? ((war.attackerBattlesWon - war.defenderBattlesWon) / battleTotal) * 10 : 0;

    let goalScore = 0;
    for (const goal of war.goals) {
      if (goal.status !== 'completed') continue;
      const side = goalSide(war, goal.ownerId);
      if (side === 'attacker') goalScore += goal.scoreContribution;
      else if (side === 'defender') goalScore -= goal.scoreContribution;
    }
    goalScore = clamp(goalScore, -26, 26);

    const blockadeBonus = world.blockades
      .filter((blockade) => blockade.active && defenders.has(blockade.targetId))
      .reduce((sum, blockade) => sum + blockade.effectiveness * 5, 0) -
      world.blockades
        .filter((blockade) => blockade.active && attackers.has(blockade.targetId))
        .reduce((sum, blockade) => sum + blockade.effectiveness * 5, 0);
    for (const blockade of world.blockades) {
      if (!blockade.active) continue;
      if (defenders.has(blockade.targetId)) attackerDamage += blockade.effectiveness * 2;
      else if (attackers.has(blockade.targetId)) defenderDamage += blockade.effectiveness * 2;
    }
    war.economicDamage = Math.round(attackerDamage + defenderDamage);
    const damageScore = clamp((attackerDamage - defenderDamage) * 0.35, -8, 8);

    war.score = clamp(
      Math.round(
        (territory + capitals + battles + goalScore + blockadeBonus + damageScore) * 10,
      ) / 10,
      -100,
      100,
    );
    war.lastScoreDay = day;
    this.updateOccupiedRegions(world, war);
    return war.score;
  }

  private updateOccupiedRegions(world: World, war: War): void {
    const participants = new Set(war.participants.map((participant) => participant.countryId));
    const occupied: string[] = [];
    for (const country of world.countries.values()) {
      if (!participants.has(country.id)) continue;
      for (const region of country.regions) {
        if (region.controllerId && participants.has(region.controllerId)) {
          occupied.push(region.id);
        }
      }
    }
    war.occupiedRegions = occupied;
  }

  /**
   * Rebuilds one war's fronts from hostile border regions. A front is a
   * connected chain of adjacent contested/border regions; its strength and
   * supply come from the armies of the participating countries. This is the
   * only place fronts are computed, and only from ticks or explicit events.
   */
  rebuildFrontlines(world: World, day: number, onlyWarId?: string): void {
    const wars = onlyWarId
      ? Object.values(world.wars).filter((war) => war.id === onlyWarId)
      : Object.values(world.wars);
    for (const war of wars) {
      if (war.status !== 'active') continue;
      for (const [frontId, front] of Object.entries(world.frontlines)) {
        if (front.warId === war.id) delete world.frontlines[frontId];
      }
      for (const country of world.countries.values()) {
        for (const region of country.regions) {
          if (region.frontlineId && war.fronts.includes(region.frontlineId)) {
            region.frontlineId = null;
          }
        }
      }

      const attackers = new Set(warSideCountries(war, 'attacker'));
      const defenders = new Set(warSideCountries(war, 'defender'));
      const candidates = new Set<string>();

      for (const country of world.countries.values()) {
        if (!attackers.has(country.id) && !defenders.has(country.id)) continue;
        for (const region of country.regions) {
          if (
            region.controllerId &&
            region.controllerId !== region.countryId &&
            ((attackers.has(region.controllerId) && defenders.has(region.countryId)) ||
              (defenders.has(region.controllerId) && attackers.has(region.countryId)))
          ) {
            candidates.add(region.id);
          }
        }
      }

      // Sovereign borders between the two coalitions are fronts even before
      // any region has been occupied.
      for (const country of world.countries.values()) {
        if (!attackers.has(country.id) && !defenders.has(country.id)) continue;
        const ownSide = attackers.has(country.id) ? 'attacker' : 'defender';
        for (const region of country.regions) {
          const geo = REGION_GEO_BY_ID[region.id];
          if (!geo) continue;
          for (const neighbourId of geo.neighbours) {
            const neighbour = findRegionState(world, neighbourId);
            if (!neighbour) continue;
            const otherSide = sideOfCountry(war, neighbour.countryId);
            if (otherSide && otherSide !== ownSide) {
              candidates.add(region.id);
              candidates.add(neighbourId);
            }
          }
        }
      }

      for (const regionId of [...candidates]) {
        const geo = REGION_GEO_BY_ID[regionId];
        if (!geo) continue;
        for (const neighbourId of geo.neighbours) {
          const neighbour = findRegionState(world, neighbourId);
          if (!neighbour) continue;
          const a = sideOfCountry(war, regionStateOf(world, regionId)?.countryId ?? null);
          const b = sideOfCountry(war, neighbour.countryId);
          if (a && b && a !== b) {
            candidates.add(regionId);
            candidates.add(neighbourId);
          }
        }
      }

      const seen = new Set<string>();
      const groups: string[][] = [];
      for (const seed of candidates) {
        if (seen.has(seed)) continue;
        const group: string[] = [];
        const queue = [seed];
        seen.add(seed);
        while (queue.length > 0) {
          const current = queue.shift()!;
          group.push(current);
          const geo = REGION_GEO_BY_ID[current];
          if (!geo) continue;
          for (const neighbourId of geo.neighbours) {
            if (!candidates.has(neighbourId) || seen.has(neighbourId)) continue;
            seen.add(neighbourId);
            queue.push(neighbourId);
          }
        }
        if (group.length > 0) groups.push(group);
      }

      groups.sort(
        (a, b) =>
          b.reduce((sum, id) => sum + (regionAt(id)?.strategicValue ?? 0), 0) -
          a.reduce((sum, id) => sum + (regionAt(id)?.strategicValue ?? 0), 0),
      );

      for (let index = 0; index < groups.length; index += 1) {
        const regionIds = groups[index];
        const attackerId =
          warSideCountries(war, 'attacker').find((id) =>
            regionIds.some((regionId) => regionStateOf(world, regionId)?.countryId === id),
          ) ?? war.aggressorId;
        const defenderId =
          warSideCountries(war, 'defender').find((id) =>
            regionIds.some((regionId) => regionStateOf(world, regionId)?.countryId === id),
          ) ?? war.primaryDefenderId;
        const strength = (side: WarSide): { power: number; supply: number } => {
          let power = 0;
          let supply = 0;
          let count = 0;
          for (const countryId of side === 'attacker' ? attackers : defenders) {
            const country = world.get(countryId);
            if (!country) continue;
            for (const army of country.military.armies) {
              if (!regionIds.includes(army.regionId)) continue;
              power += armyPower(army, country);
              supply += army.supply;
              count += 1;
            }
          }
          return { power, supply: count > 0 ? supply / count : 0.5 };
        };
        const attacker = strength('attacker');
        const defender = strength('defender');
        const objective =
          regionIds
            .map((id) => ({ id, state: regionStateOf(world, id) }))
            .filter((entry): entry is { id: string; state: RegionState } => Boolean(entry.state))
            .filter((entry) => regionControllerId(entry.state) !== attackerId)
            .sort(
              (a, b) => (regionAt(b.id)?.strategicValue ?? 0) - (regionAt(a.id)?.strategicValue ?? 0),
            )[0]?.id ?? regionIds[0];
        const totalStrength = attacker.power + defender.power;
        const pressure = totalStrength > 0 ? attacker.power / totalStrength : 0.5;
        const front: Frontline = {
          id: `${war.id}:front:${index + 1}`,
          warId: war.id,
          attackerId,
          defenderId,
          regionIds,
          priority: clamp01(
            regionIds.reduce((sum, id) => sum + (regionAt(id)?.strategicValue ?? 0), 0) /
              Math.max(1, regionIds.length),
          ),
          attackerStrength: Math.round(attacker.power),
          defenderStrength: Math.round(defender.power),
          attackerSupply: attacker.supply,
          defenderSupply: defender.supply,
          pressure,
          activeBattles: 0,
          objectiveRegionId: objective,
          status:
            totalStrength === 0
              ? 'collapsed'
              : Math.abs(pressure - 0.5) < 0.06
                ? 'stalemate'
                : 'active',
          updatedDay: day,
        };
        if (index >= MAX_FRONTS_PER_WAR) {
          front.status = 'collapsed';
        }
        world.frontlines[front.id] = front;
        for (const regionId of regionIds) {
          const state = regionStateOf(world, regionId);
          if (state) state.frontlineId = front.id;
        }
      }
      war.fronts = groups
        .slice(0, MAX_FRONTS_PER_WAR)
        .map((_group, index) => `${war.id}:front:${index + 1}`);
    }
  }

  /** Controlled but not owned regions are returned to their sovereign. */
  releaseOccupations(world: World, war: War, day: number): void {
    const participants = new Set(war.participants.map((participant) => participant.countryId));
    for (const country of world.countries.values()) {
      if (!participants.has(country.id)) continue;
      for (const region of country.regions) {
        if (region.controllerId && participants.has(region.controllerId)) {
          liberateRegion(region);
          this.events.emit({ type: 'regionLiberated', regionId: region.id, ownerId: country.id, day });
        }
      }
    }
  }

  makeWhitePeace(world: World, war: War, day: number): boolean {
    if (war.status !== 'active') return false;
    for (const war2 of Object.values(world.wars)) {
      if (war2.id === war.id || war2.status !== 'active') continue;
      if (war2.startDay > war.startDay) continue;
      if (
        war2.participants.some((p) => war.participants.some((q) => q.countryId === p.countryId))
      ) {
        // Separate wars remain separate.
      }
    }
    for (const attackerId of warSideCountries(war, 'attacker')) {
      for (const defenderId of warSideCountries(war, 'defender')) {
        const attacker = world.get(attackerId);
        const defender = world.get(defenderId);
        if (attacker && defender) this.diplomacy.endWarPair(attacker, defender, day);
      }
    }
    this.releaseOccupations(world, war, day);
    this.endWar(world, war, day, 'whitePeace');
    return true;
  }

  private endWar(world: World, war: War, day: number, status: WarStatus): void {
    war.status = status;
    war.endDay = day;
    for (const participant of war.participants) participant.leftDay = day;
    for (const goal of war.goals) {
      if (goal.status === 'active') goal.status = 'failed';
    }
    for (const [frontId, front] of Object.entries(world.frontlines)) {
      if (front.warId === war.id) {
        front.status = 'collapsed';
        delete world.frontlines[frontId];
      }
    }
    war.fronts = [];
    this.events.emit({ type: 'warEnded', warId: war.id, status, day });
    this.dirty = true;
  }

  // ── Peace ───────────────────────────────────────────────────────────────────

  proposePeace(world: World, war: War, proposerId: string, terms: PeaceTerm[], day: number): PeaceOffer | null {
    if (war.status !== 'active') return null;
    if (!isParticipant(war, proposerId)) return null;
    const proposerSide = sideOfCountry(war, proposerId);
    if (!proposerSide) return null;
    const recipientId = warSideCountries(
      war,
      proposerSide === 'attacker' ? 'defender' : 'attacker',
    )[0];
    if (!recipientId) return null;
    const offer: PeaceOffer = {
      id: `peace-${war.id}-${day}-${world.peaceOffers.length}`,
      warId: war.id,
      proposerId,
      recipientId,
      terms,
      day,
      status: 'pending',
    };
    world.peaceOffers.push(offer);
    if (world.peaceOffers.length > 40) world.peaceOffers.splice(0, world.peaceOffers.length - 40);
    this.events.emit({ type: 'peaceOffered', offerId: offer.id, warId: war.id, day });
    // AI recipients answer immediately; offers addressed to the player stay
    // pending so the war room can present them as a decision.
    if (offer.recipientId !== world.playerCountryId && this.evaluatePeaceOffer(world, offer)) {
      this.acceptPeace(world, offer, day);
    }
    return offer;
  }

  /**
   * A losing or exhausted AI side may sue for a white peace. Offers made to the
   * player are left pending; AI-to-AI offers are evaluated deterministically.
   */
  private maybeOfferPeace(world: World, day: number): void {
    for (const war of Object.values(world.wars)) {
      if (war.status !== 'active' || day - war.startDay < 30) continue;
      if (world.peaceOffers.some((offer) => offer.warId === war.id && offer.status === 'pending')) {
        continue;
      }
      for (const side of ['attacker', 'defender'] as const) {
        if (war.exhaustion[side] < 0.32) continue;
        const perspective = side === 'attacker' ? war.score : -war.score;
        if (perspective > 5) continue;
        const proposerId = warSideCountries(war, side)[0];
        if (!proposerId) continue;
        const proposer = world.get(proposerId);
        if (!proposer) continue;
        const offer: PeaceOffer = {
          id: `peace-${war.id}-${day}-${world.peaceOffers.length}`,
          warId: war.id,
          proposerId,
          recipientId:
            warSideCountries(war, side === 'attacker' ? 'defender' : 'attacker')[0] ?? '',
          terms: [],
          day,
          status: 'pending',
        };
        if (!offer.recipientId) continue;
        world.peaceOffers.push(offer);
        if (world.peaceOffers.length > 40) {
          world.peaceOffers.splice(0, world.peaceOffers.length - 40);
        }
        this.events.emit({
          type: 'peaceOffered',
          offerId: offer.id,
          warId: war.id,
          day,
        });
        if (offer.recipientId !== world.playerCountryId && this.evaluatePeaceOffer(world, offer)) {
          this.acceptPeace(world, offer, day);
        }
        break;
      }
    }
  }

  validatePeaceOffer(world: World, offer: PeaceOffer): PeaceValidation {
    const war = world.wars[offer.warId];
    if (!war || war.status !== 'active') return { ok: false, reason: 'no-active-war' };
    if (!isParticipant(war, offer.proposerId) || !isParticipant(war, offer.recipientId)) {
      return { ok: false, reason: 'not-participant' };
    }
    const proposerSide = sideOfCountry(war, offer.proposerId);
    const recipientSide = sideOfCountry(war, offer.recipientId);
    if (!proposerSide || !recipientSide || proposerSide === recipientSide) {
      return { ok: false, reason: 'same-side' };
    }
    if (offer.terms.length === 0) return { ok: true, reason: 'white-peace' };
    for (const term of offer.terms) {
      if (term.type === 'cession') {
        for (const regionId of term.regionIds) {
          const state = findRegionState(world, regionId);
          if (!state) return { ok: false, reason: 'unknown-region' };
          const controller = regionControllerId(state);
          const sovereignOwner = state.countryId === term.fromId;
          const sellerHoldsIt = controller === term.fromId;
          // A claimant may annex a region it controls even though the defeated
          // sovereign still owns it. Every other case requires the seller to
          // actually hold the region.
          const claimantHoldsIt = sovereignOwner && controller === term.toId;
          if (!sellerHoldsIt && !claimantHoldsIt) {
            return { ok: false, reason: 'not-controlled-by-seller' };
          }
          if (regionId === world.get(term.fromId ?? '')?.capitalRegionId) {
            return { ok: false, reason: 'capital-cannot-be-ceded' };
          }
        }
        if (!term.fromId || !term.toId) return { ok: false, reason: 'missing-transfer-parties' };
        if (!isParticipant(war, term.fromId) || !isParticipant(war, term.toId)) {
          return { ok: false, reason: 'transfer-party-not-participant' };
        }
        const claimantGoals = war.goals.filter(
          (goal) => goal.ownerId === term.toId && goal.status !== 'failed',
        );
        if (
          !claimantGoals.some(
            (goal) =>
              goal.type === 'conquest' ||
              goal.type === 'captureCapital' ||
              goal.type === 'captureRegion' ||
              goal.type === 'secureResource',
          )
        ) {
          return { ok: false, reason: 'no-claim' };
        }
      }
      if (term.type === 'reparations') {
        const payer = world.get(term.fromId ?? '');
        if (!payer) return { ok: false, reason: 'unknown-payer' };
        if (term.amount < 0 || term.amount > 50_000) return { ok: false, reason: 'invalid-reparations' };
      }
    }
    return { ok: true, reason: 'valid' };
  }

  acceptPeace(world: World, offer: PeaceOffer, day: number): boolean {
    const validation = this.validatePeaceOffer(world, offer);
    if (!validation.ok) return false;
    const war = world.wars[offer.warId];
    if (!war) return false;
    for (const term of offer.terms) this.applyTerm(world, term, day);
    this.releaseOccupations(world, war, day);
    for (const attackerId of warSideCountries(war, 'attacker')) {
      for (const defenderId of warSideCountries(war, 'defender')) {
        const attacker = world.get(attackerId);
        const defender = world.get(defenderId);
        if (attacker && defender) this.diplomacy.endWarPair(attacker, defender, day);
      }
    }
    offer.status = 'accepted';
    const winner: WarStatus =
      offer.terms.some((term) => term.type === 'cession' || term.type === 'liberation')
        ? 'attackerVictory'
        : 'whitePeace';
    this.endWar(world, war, day, winner);
    this.events.emit({ type: 'peaceAccepted', offerId: offer.id, warId: war.id, day });
    return true;
  }

  rejectPeace(offer: PeaceOffer): void {
    offer.status = 'rejected';
  }

  /**
   * AI acceptance rule: the offer must be valid, and the recipient's position
   * (score, exhaustion, relative strength) must make peace preferable to war.
   */
  evaluatePeaceOffer(world: World, offer: PeaceOffer): boolean {
    const validation = this.validatePeaceOffer(world, offer);
    if (!validation.ok) return false;
    const war = world.wars[offer.warId];
    if (!war) return false;
    const side = sideOfCountry(war, offer.recipientId);
    if (!side) return false;
    const perspective = side === 'attacker' ? war.score : -war.score;
    const exhaustion = war.exhaustion[side];
    const country = world.get(offer.recipientId);
    if (!country) return false;
    const strengthRatio = relativeStrength(world, war, side);
    const desire = clamp01(
      0.38 - perspective / 140 + exhaustion * 0.55 + (1 - strengthRatio) * 0.25,
    );
    return world.rngFor(offer.recipientId, offer.day + war.startDay).next() < desire;
  }

  private applyTerm(world: World, term: PeaceTerm, day: number): void {
    switch (term.type) {
      case 'liberation':
      case 'returnOccupied': {
        for (const regionId of term.regionIds) {
          const state = findRegionState(world, regionId);
          if (!state) continue;
          if (term.fromId && regionControllerId(state) !== term.fromId) continue;
          liberateRegion(state);
          this.events.emit({ type: 'regionLiberated', regionId, ownerId: state.countryId, day });
        }
        return;
      }
      case 'cession': {
        for (const regionId of term.regionIds) {
          const state = findRegionState(world, regionId);
          if (!state || !term.fromId || !term.toId) continue;
          if (state.countryId !== term.fromId) continue;
          const controller = regionControllerId(state);
          if (controller !== term.fromId && controller !== term.toId) continue;
          this.transferRegion(world, state, term.toId, day);
        }
        return;
      }
      case 'reparations': {
        const payer = world.get(term.fromId ?? '');
        const receiver = world.get(term.toId ?? '');
        if (!payer || !receiver) return;
        const amount = Math.min(term.amount, Math.max(0, payer.economy.resources.money));
        payer.economy.resources.money -= amount;
        receiver.economy.resources.money += amount;
        return;
      }
      case 'demilitarised': {
        for (const regionId of term.regionIds) {
          const state = findRegionState(world, regionId);
          if (state) {
            state.supplyModifier = Math.min(state.supplyModifier, 0.75);
            liberateRegion(state);
          }
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Transfers sovereignty after a valid treaty. The region state moves between
   * country lists; the geographic definition remains immutable and is still
   * used for position, terrain and adjacency.
   */
  transferRegion(world: World, region: RegionState, toCountryId: string, day: number): boolean {
    const target = world.get(toCountryId);
    if (!target || region.countryId === toCountryId) return false;
    const owner = world.get(region.countryId);
    if (!owner) return false;
    if (owner.capitalRegionId === region.id) return false;
    const index = owner.regions.findIndex((entry) => entry.id === region.id);
    if (index === -1) return false;
    owner.regions.splice(index, 1);
    owner.population = Math.max(1, owner.population - region.population);
    region.countryId = toCountryId;
    region.controllerId = null;
    region.occupierId = null;
    region.control = 'sovereign';
    region.controlStatus = 'liberated';
    region.occupationProgress = 0;
    region.supplyModifier = 1;
    target.regions.push(region);
    target.population += region.population;
    this.events.emit({
      type: 'regionTransferred',
      regionId: region.id,
      fromId: owner.id,
      toId: target.id,
      day,
    });
    this.dirty = true;
    return true;
  }

  private pruneHistory(world: World, day: number): void {
    const finished = Object.values(world.wars)
      .filter((war) => war.status !== 'active')
      .sort((a, b) => (a.endDay ?? 0) - (b.endDay ?? 0));
    const excess = finished.length - MAX_HISTORY_WARS;
    for (let index = 0; index < excess; index += 1) delete world.wars[finished[index].id];
    void day;
  }
}

const relativeStrength = (world: World, war: War, side: WarSide): number => {
  const own = warSideCountries(war, side);
  const other = warSideCountries(war, side === 'attacker' ? 'defender' : 'attacker');
  const sum = (ids: string[]): number =>
    ids.reduce((total, id) => total + (world.get(id)?.military.strengthIndex ?? 0), 0);
  const ownStrength = sum(own);
  const otherStrength = sum(other);
  return ownStrength / Math.max(1, ownStrength + otherStrength);
};

/** Air state helper reused by AI and UI without duplicating defaults. */
export const ensureAirState = (state: AirState | undefined): AirState => state ?? createAirState();

/** Keeps typed imports used by this module's public surface. */
export type { ArmyGroup, Operation, AirState };
export { countryName };
