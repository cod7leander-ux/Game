import { AIDirector } from './ai/AIDirector';
import type { CountryState } from './country/types';
import { recomputeModifiers } from './country/modifiers';
import { DiplomacySystem } from './diplomacy/DiplomacySystem';
import { EconomySystem } from './economy/EconomySystem';
import { normalizeAllocation, type EconomyAllocation } from './economy/types';
import { LogisticsSystem } from './logistics/LogisticsSystem';
import { ProductionSystem } from './production/ProductionSystem';
import { StabilitySystem } from './stability/StabilitySystem';
import { pruneObjectives, reconcileObjectives } from './objectives/objectives';
import { applyOccupation } from './regions/regions';
import { SimEventBus } from './events';
import { syncMilitaryTotals } from './military/armies';
import {
  ArmySystem,
  type MarchResult,
  type StrategicMoveResult,
} from './military/ArmySystem';
import type { StrategicPath } from './pathfinding/Pathfinder';
import { WarSystem } from './war/WarSystem';
import { WarfareSystem } from './war/WarfareSystem';
import type {
  ArmyPosture,
  MissileType,
  OperationType,
  PeaceOffer,
  PeaceTerm,
  War,
} from './war/types';
import { MilitarySystem } from './military/MilitarySystem';
import { BattlefieldManager } from './tactical/BattlefieldManager';
import type { BattleCommand, SavedTacticalBattle } from './tactical/types';
import { ResearchSystem, startResearch as beginProgramme } from './research/ResearchSystem';
import { PopulationSystem } from './society/PopulationSystem';
import { createSocietyState } from './society/types';
import { TradeSystem } from './trade/TradeSystem';
import { createTradeState } from './trade/types';
import { IntelligenceSystem } from './intelligence/IntelligenceSystem';
import { createIntelligenceState } from './intelligence/types';
import { PolicySystem } from './policy/PolicySystem';
import { createPolicyState } from './policy/types';
import { ManeuverSystem } from './maneuver/ManeuverSystem';
import { createManeuverState } from './maneuver/types';
import { WorldEventSystem } from './situation/WorldEventSystem';
import { StrategicWeaponsSystem } from './strategic/StrategicWeaponsSystem';
import { createLogisticsState } from './logistics/types';
import type { World } from './World';

/**
 * The simulation facade: one day of world history.
 *
 * Tick order is fixed and documented because it is part of save determinism:
 *   1. economy (regional production, upkeep, occupation tribute)
 *   2. stability (war weariness, unrest, national morale)
 *   3. research (programme progress)
 *   4. production (civilian construction)
 *   5. military (unit production queues, readiness)
 *   6. armies (marches resolve; battles and occupations happen here)
 *   7. logistics (supply and attrition)
 *   8. diplomacy drift (weekly)
 *   9. AI decisions (staggered slice)
 *
 * All mutations go through systems; no system reaches into another's state.
 */
const OCCUPATION_TRIBUTE = 0.4;

export class Simulation {
  readonly events = new SimEventBus();
  /** Player-involved engagements represented in 3D. Strategic results stay authoritative. */
  readonly battlefields: BattlefieldManager;
  private readonly economy = new EconomySystem();
  private readonly research: ResearchSystem;
  private readonly armies: ArmySystem;
  private readonly military: MilitarySystem;
  private readonly production = new ProductionSystem(this.events);
  private readonly logistics = new LogisticsSystem();
  private readonly stability = new StabilitySystem();
  private readonly diplomacy: DiplomacySystem;
  private readonly war: WarSystem;
  private readonly warfare: WarfareSystem;
  private readonly population: PopulationSystem;
  private readonly trade: TradeSystem;
  private readonly intelligence: IntelligenceSystem;
  private readonly policies: PolicySystem;
  private readonly maneuver: ManeuverSystem;
  private readonly situations: WorldEventSystem;
  private readonly strategicWeapons: StrategicWeaponsSystem;
  private readonly ai: AIDirector;
  private readonly lowTreasuryWarned = new Set<string>();

  constructor(private readonly world: World) {
    this.research = new ResearchSystem(this.events);
    this.armies = new ArmySystem(this.events);
    this.military = new MilitarySystem(this.events, this.armies);
    this.diplomacy = new DiplomacySystem(this.events);
    this.war = new WarSystem(this.events, this.diplomacy);
    this.warfare = new WarfareSystem(this.events);
    this.population = new PopulationSystem(this.events);
    this.trade = new TradeSystem(this.events);
    this.intelligence = new IntelligenceSystem(this.events);
    this.policies = new PolicySystem(this.events);
    this.maneuver = new ManeuverSystem(this.events);
    this.situations = new WorldEventSystem(this.events);
    this.strategicWeapons = new StrategicWeaponsSystem(this.events);
    this.ai = new AIDirector(world, this.events);
    this.battlefields = new BattlefieldManager(world.playerCountryId);
    // Every strategic battle publishes its rosters; the tactical manager opens
    // a battlefield only for engagements that involve the player.
    this.events.on((event) => {
      if (event.type === 'battleResolved') {
        this.battlefields.onBattleResolved(world, event);
        this.war.onBattle(world, event);
        const attacker = world.get(event.attackerId);
        const defender = world.get(event.defenderId);
        if (attacker) this.population.registerCasualties(attacker, event.attackerLosses, event.day);
        if (defender) this.population.registerCasualties(defender, event.defenderLosses, event.day);
      }
    });
  }

  tickDay(day: number): void {
    this.world.day = day;

    for (const country of this.world.countries.values()) {
      const result = this.economy.tick(country);
      this.population.tick(country, day);
      this.stability.tick(country, day);
      this.research.tick(country, day);
      this.production.tick(country, day);
      this.military.tick(country, day);
      this.policies.tick(country, day);
      this.strategicWeapons.tick(country, day);
      this.collectOccupationTribute(country);

      if (result.lowTreasury && !this.lowTreasuryWarned.has(country.id)) {
        this.lowTreasuryWarned.add(country.id);
        if (day % 10 === 0) {
          this.events.emit({ type: 'lowTreasury', countryId: country.id, day });
        }
      } else if (!result.lowTreasury) {
        this.lowTreasuryWarned.delete(country.id);
      }
    }

    this.armies.tick(this.world, day);
    this.logistics.tick(this.world);
    this.trade.tick(this.world, day);
    this.war.tick(this.world, day);
    this.warfare.tick(this.world, day, (countryId, armyId, targetId) =>
      this.marchArmyTo(countryId, armyId, targetId).ok,
    );
    this.maneuver.tick(this.world, day);
    for (const country of this.world.countries.values()) {
      this.intelligence.tick(this.world, country, day);
    }
    this.situations.tick(this.world, day);

    if (day % 7 === 0) {
      for (const country of this.world.countries.values()) {
        this.diplomacy.drift(country, day);
        reconcileObjectives(country);
        pruneObjectives(country, day);
      }
    }

    for (const country of this.world.countries.values()) {
      if (country.id === this.world.playerCountryId || country.occupierId) continue;
      this.policies.consider(country, day);
    }
    this.maneuver.aiConsider(this.world, day);
    this.ai.onDay(day, {
      startResearch: (countryId, techId) => this.startResearch(countryId, techId),
      queueUnits: (countryId, unitId) => this.queueProduction(countryId, unitId),
      marchArmy: (countryId, armyId, targetId) =>
        this.marchArmy(countryId, armyId, targetId).ok,
      orderArmyMove: (countryId, armyId, targetId) =>
        this.marchArmyTo(countryId, armyId, targetId).ok,
      declareWar: (countryId, targetId) => this.declareWar(countryId, targetId),
      makePeace: (countryId, targetId) => this.makePeace(countryId, targetId),
      queueConstruction: (countryId, projectId, regionId) =>
        this.startConstruction(countryId, projectId, regionId),
      setAllocation: (countryId, allocation) => this.setAllocation(countryId, allocation),
      improveRelations: (countryId, targetId) => this.improveRelations(countryId, targetId),
      formNonAggression: (countryId, targetId) =>
        this.formNonAggression(countryId, targetId),
      grantMilitaryAccess: (countryId, targetId) =>
        this.grantMilitaryAccess(countryId, targetId),
      imposeEmbargo: (countryId, targetId) => this.imposeEmbargo(countryId, targetId),
      formAlliance: (countryId, targetId) => this.formAlliance(countryId, targetId),
      setArmyPosture: (countryId, armyId, posture) =>
        this.setArmyPosture(countryId, armyId, posture),
      createArmyGroup: (countryId, name, armyIds, objectiveRegionId) =>
        Boolean(this.createArmyGroup(countryId, name, armyIds, objectiveRegionId)),
      createOperation: (countryId, type, targetRegionIds, armyIds, warId) =>
        Boolean(this.createOperation(countryId, type, targetRegionIds, armyIds, warId)),
      launchAirMission: (countryId, type, targetRegionId) =>
        this.launchAirMission(countryId, type, targetRegionId),
      imposeBlockade: (countryId, targetId) =>
        this.orderBlockade(countryId, targetId),
    });
  }

  /** Advances real-time 3D battlefields while the campaign is running. */
  advanceRealtime(dtSeconds: number): void {
    this.battlefields.tick(dtSeconds);
  }

  /** Restores battlefields from a save after the strategic world is rebuilt. */
  restoreBattlefields(saved: SavedTacticalBattle[] | undefined): void {
    this.battlefields.restore(saved);
  }

  playerBattle() {
    return this.battlefields.playerBattle();
  }

  issueBattleCommand(command: BattleCommand): boolean {
    const battle = this.battlefields.playerBattle();
    if (!battle) return false;
    const accepted = battle.command(command);
    if (accepted) this.battlefields.applyFormationToArmies(this.world);
    return accepted;
  }

  dismissBattle(): void {
    const battle = this.battlefields.playerBattle();
    if (battle) this.battlefields.dismiss(battle.id);
  }

  /** A share of an occupied country's revenue goes to its occupier. */
  private collectOccupationTribute(country: CountryState): void {
    if (!country.occupierId) return;
    const occupier = this.world.get(country.occupierId);
    if (!occupier || occupier.id === country.id) {
      applyOccupation(country, null);
      return;
    }
    const tribute = Math.max(0, country.economy.income) * OCCUPATION_TRIBUTE;
    country.economy.resources.money = Math.max(
      -500,
      country.economy.resources.money - tribute,
    );
    occupier.economy.resources.money += tribute;
  }

  // ── Player/AI shared actions ────────────────────────────────────────────────

  startResearch(countryId: string, techId: string): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    const started = beginProgramme(country, techId);
    if (started) {
      this.events.emit({ type: 'researchStart', countryId, techId, day: this.world.day });
    }
    return started;
  }

  queueProduction(countryId: string, unitId: string): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    const result = this.military.enqueue(country, unitId, this.world.day);
    return result.ok;
  }

  marchArmy(countryId: string, armyId: string, targetId: string): MarchResult {
    return this.armies.march(this.world, countryId, armyId, targetId, this.world.day);
  }

  /** Multi-hop order over the geographic region graph. */
  marchArmyTo(countryId: string, armyId: string, targetId: string): StrategicMoveResult {
    return this.armies.orderStrategicMove(this.world, countryId, armyId, targetId, this.world.day);
  }

  planArmyRoute(countryId: string, armyId: string, targetId: string): StrategicPath | null {
    return this.armies.planRoute(this.world, countryId, armyId, targetId);
  }

  declareWar(aggressorId: string, defenderId: string): boolean {
    const aggressor = this.world.get(aggressorId);
    const defender = this.world.get(defenderId);
    if (!aggressor || !defender || aggressorId === defenderId) return false;
    if (aggressor.diplomacy.relations[defenderId]?.atWar) return false;
    const declared = this.diplomacy.declareWar(aggressor, defender, this.world.day);
    if (declared) this.war.startWar(this.world, aggressor, defender, this.world.day);
    return declared;
  }

  makePeace(aId: string, bId: string): boolean {
    const a = this.world.get(aId);
    const b = this.world.get(bId);
    if (!a || !b) return false;
    const existing = this.war.findWarBetween(this.world, aId, bId);
    if (existing) return this.war.makeWhitePeace(this.world, existing, this.world.day);
    const signed = this.diplomacy.signPeace(a, b, this.world.day);
    if (signed) this.releaseOccupations(a.id, b.id);
    return signed;
  }

  // ── War, fronts, operations, air, naval and missiles ───────────────────────

  wars(): War[] {
    return Object.values(this.world.wars);
  }

  warOf(countryId: string): War[] {
    return this.war.warForCountry(this.world, countryId);
  }

  setArmyPosture(countryId: string, armyId: string, posture: ArmyPosture): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    return this.warfare.setPosture(country, armyId, posture);
  }

  createArmyGroup(
    countryId: string,
    name: string,
    armyIds: string[],
    objectiveRegionId: string | null = null,
  ) {
    const country = this.world.get(countryId);
    if (!country) return null;
    return this.warfare.createArmyGroup(country, name, armyIds, this.world.day, objectiveRegionId);
  }

  assignArmyToGroup(countryId: string, armyId: string, groupId: string | null): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    return this.warfare.assignArmyToGroup(country, armyId, groupId);
  }

  assignArmyToFrontline(
    countryId: string,
    armyId: string,
    frontlineId: string | null,
    objectiveRegionId: string | null = null,
  ): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    return this.warfare.assignArmyToFrontline(country, armyId, frontlineId, objectiveRegionId);
  }

  createOperation(
    countryId: string,
    type: OperationType,
    targetRegionIds: string[],
    armyIds: string[],
    warId: string | null = null,
  ) {
    const country = this.world.get(countryId);
    if (!country) return null;
    return this.warfare.createOperation(
      country,
      type,
      targetRegionIds,
      armyIds,
      warId,
      this.world.day,
    );
  }

  launchAirMission(
    countryId: string,
    type: Parameters<WarfareSystem['launchAirMission']>[2],
    targetRegionId: string | null,
  ): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    return this.warfare.launchAirMission(this.world, country, type, targetRegionId, this.world.day);
  }

  orderBlockade(countryId: string, targetId: string): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    return this.warfare.orderBlockade(this.world, country, targetId, this.world.day);
  }

  liftBlockade(countryId: string, targetId: string): boolean {
    return this.warfare.liftBlockade(this.world, countryId, targetId);
  }

  launchMissile(
    countryId: string,
    targetRegionId: string,
    type: MissileType,
  ): ReturnType<WarfareSystem['launchMissile']> {
    const country = this.world.get(countryId);
    if (!country) return { ok: false, reason: 'unknown-target' };
    return this.warfare.launchMissile(this.world, country, targetRegionId, type, this.world.day);
  }

  proposePeace(
    countryId: string,
    warId: string,
    terms: PeaceTerm[],
  ): PeaceOffer | null {
    const country = this.world.get(countryId);
    const war = this.world.wars[warId];
    if (!country || !war) return null;
    return this.war.proposePeace(this.world, war, countryId, terms, this.world.day);
  }

  acceptPeace(offerId: string): boolean {
    const offer = this.world.peaceOffers.find((entry) => entry.id === offerId);
    if (!offer) return false;
    return this.war.acceptPeace(this.world, offer, this.world.day);
  }

  rejectPeace(offerId: string): boolean {
    const offer = this.world.peaceOffers.find((entry) => entry.id === offerId);
    if (!offer) return false;
    this.war.rejectPeace(offer);
    return true;
  }

  /** The strategic warfare service, exposed for UI projections and tests. */
  get warfareSystem(): WarfareSystem {
    return this.warfare;
  }

  get warSystem(): WarSystem {
    return this.war;
  }

  /** Peace returns occupied territory to its sovereign. */
  private releaseOccupations(aId: string, bId: string): void {
    for (const country of this.world.countries.values()) {
      if (country.occupierId !== aId && country.occupierId !== bId) continue;
      applyOccupation(country, null);
      country.stability = Math.min(0.95, country.stability + 0.04);
      this.events.emit({
        type: 'territoryLiberated',
        countryId: country.id,
        day: this.world.day,
      });
    }
  }

  formAlliance(aId: string, bId: string): boolean {
    const a = this.world.get(aId);
    const b = this.world.get(bId);
    if (!a || !b) return false;
    return this.diplomacy.formAlliance(a, b, this.world.day);
  }

  openTrade(aId: string, bId: string): boolean {
    const a = this.world.get(aId);
    const b = this.world.get(bId);
    if (!a || !b) return false;
    return this.diplomacy.openTrade(a, b, this.world.day);
  }

  /** Civilian construction through the shared production system. */
  startConstruction(
    countryId: string,
    projectId: string,
    regionId: string,
    priority: 'low' | 'normal' | 'high' = 'normal',
  ): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    return this.production.enqueue(country, projectId, regionId, this.world.day, priority).ok;
  }

  cancelConstruction(countryId: string, orderId: string): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    return this.production.cancel(country, orderId, this.world.day);
  }

  setConstructionPriority(
    countryId: string,
    orderId: string,
    priority: 'low' | 'normal' | 'high',
  ): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    return this.production.reprioritise(country, orderId, priority);
  }

  setPolicy(countryId: string, policyId: string, enabled: boolean): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    return this.policies.setPolicy(country, policyId, enabled, this.world.day);
  }

  setMobilization(countryId: string, level: number): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    return this.policies.setMobilization(country, level, this.world.day);
  }

  establishTradeRoute(
    countryId: string,
    partnerId: string,
    resource: string,
    amount: number,
    contract = false,
  ): ReturnType<TradeSystem['createRoute']> {
    return this.trade.createRoute(
      this.world,
      partnerId,
      countryId,
      resource,
      amount,
      this.world.day,
      contract,
    );
  }

  cancelTradeRoute(countryId: string, routeId: string): boolean {
    return this.trade.cancelRoute(this.world, countryId, routeId, this.world.day);
  }

  queueMissile(countryId: string, type: MissileType): ReturnType<StrategicWeaponsSystem['queue']> {
    const country = this.world.get(countryId);
    if (!country) return { ok: false, reason: 'unknown-type' };
    return this.strategicWeapons.queue(country, type, this.world.day);
  }

  startNavalInvasion(countryId: string, armyId: string, targetRegionId: string) {
    const country = this.world.get(countryId);
    if (!country) return { ok: false as const, reason: 'unknown-country' as const };
    return this.maneuver.startInvasion(this.world, country, armyId, targetRegionId, this.world.day);
  }

  startAirlift(
    countryId: string,
    armyId: string,
    targetRegionId: string,
    kind: 'redeploy' | 'supply' = 'redeploy',
  ) {
    const country = this.world.get(countryId);
    if (!country) return { ok: false as const, reason: 'unknown-country' as const };
    return this.maneuver.startAirlift(
      this.world,
      country,
      armyId,
      targetRegionId,
      kind,
      this.world.day,
    );
  }

  transportCapacity(countryId: string): number {
    const country = this.world.get(countryId);
    return country ? this.maneuver.transportCapacity(country) : 0;
  }

  /** Budget allocation, normalised so the three shares always sum to one. */
  setAllocation(countryId: string, allocation: EconomyAllocation): boolean {
    const country = this.world.get(countryId);
    if (!country) return false;
    country.economy.allocation = normalizeAllocation(allocation);
    return true;
  }

  improveRelations(countryId: string, targetId: string): boolean {
    const a = this.world.get(countryId);
    const b = this.world.get(targetId);
    if (!a || !b) return false;
    return this.diplomacy.improveRelations(a, b, this.world.day);
  }

  formNonAggression(countryId: string, targetId: string): boolean {
    const a = this.world.get(countryId);
    const b = this.world.get(targetId);
    if (!a || !b) return false;
    return this.diplomacy.formNonAggression(a, b, this.world.day);
  }

  grantMilitaryAccess(countryId: string, targetId: string): boolean {
    const a = this.world.get(countryId);
    const b = this.world.get(targetId);
    if (!a || !b) return false;
    return this.diplomacy.grantMilitaryAccess(a, b, this.world.day);
  }

  imposeEmbargo(countryId: string, targetId: string): boolean {
    const a = this.world.get(countryId);
    const b = this.world.get(targetId);
    if (!a || !b) return false;
    return this.diplomacy.imposeEmbargo(a, b, this.world.day);
  }

  liftEmbargo(countryId: string, targetId: string): boolean {
    const a = this.world.get(countryId);
    const b = this.world.get(targetId);
    if (!a || !b) return false;
    this.diplomacy.liftEmbargo(a, b, this.world.day);
    return true;
  }

  breakAlliance(countryId: string, targetId: string): boolean {
    const a = this.world.get(countryId);
    const b = this.world.get(targetId);
    if (!a || !b) return false;
    return this.diplomacy.breakAlliance(a, b, this.world.day);
  }

  /** Restores derived values after a load; never re-runs history. */
  static rehydrate(world: World): void {
    for (const country of world.countries.values()) {
      recomputeModifiers(country);
      country.research.output = 0;
      syncMilitaryTotals(country);
      country.modifiers = {
        ...country.modifiers,
        production: country.modifiers.production ?? 0,
        income: country.modifiers.income ?? 0,
        research: country.modifiers.research ?? 0,
        attack: country.modifiers.attack ?? 0,
        defence: country.modifiers.defence ?? 0,
        supply: country.modifiers.supply ?? 0,
        detection: country.modifiers.detection ?? 0,
        resource: country.modifiers.resource ?? 0,
        manpower: country.modifiers.manpower ?? 0,
        logistics: country.modifiers.logistics ?? 0,
        trade: country.modifiers.trade ?? 0,
        stability: country.modifiers.stability ?? 0,
        military: country.modifiers.military ?? 0,
        civilian: country.modifiers.civilian ?? 0,
      };
      country.society ??= createSocietyState(country.population, country.economy.availableManpower);
      country.trade ??= createTradeState();
      country.intelligence ??= createIntelligenceState();
      country.policy ??= createPolicyState();
      country.logisticsState ??= createLogisticsState();
      country.maneuver ??= createManeuverState();
      for (const region of country.regions) {
        region.workingPopulation ??= Math.round(region.population * 0.52);
        region.militaryAgePopulation ??= Math.round(region.population * 0.23);
        region.populationCapacity ??= Math.round(region.population * 1.55);
        region.civilianIndustry ??= 0.25;
        region.militaryIndustry ??= 0.12;
        region.constructionCapacity ??= 0.55;
        region.airportCapacity ??= 0;
        region.portCapacity ??= 0;
        region.extractionCapacity ??= 0.2;
        region.development ??= region.infrastructure;
        region.radar ??= 0;
        region.fortification ??= 0;
      }
      const warfare = (country as CountryState & { warfare?: unknown }).warfare;
      if (!warfare) {
        // Defensive repair for hand-built test states and pre-v6 payloads.
        country.warfare = {
          groups: [],
          operations: [],
          air: { superiority: 0.5, readiness: 0.7, coverage: 0, missions: [], lastMissionDay: 0 },
          naval: { taskForces: [], blockadeEffect: 0, lastBlockadeDay: 0 },
          missiles: {
            readiness: 0.5,
            stockpile: { tactical: 4, cruise: 2, ballistic: 1 },
            production: [],
            cooldownUntilDay: 0,
            lastStrikeDay: 0,
            lastTargetRegionId: null,
          },
          plans: [],
        };
      }
      country.warfare.missiles.production ??= [];
    }
  }

  countryOf(id: string): CountryState | undefined {
    return this.world.get(id);
  }
}
