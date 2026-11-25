import { SimClock } from '../core/clock';
import { GAME, type GameSpeed } from '../core/config';
import { COUNTRY_BY_ID } from '../data/countries';
import { getTech } from '../data/research';
import { getProject } from '../data/production';
import { getPolicy } from '../data/policies';
import { SITUATIONS } from '../data/situations';
import { RESOURCES } from '../data/resources';
import { regionAt } from '../data/regions';
import { getUnit } from '../data/units';
import { translate } from '../i18n';
import { formatGameDate, formatNumber, gameYear } from '../i18n/format';
import { localize } from '../i18n/types';
import type { LocaleCode } from '../i18n/types';
import type { CountryState, NotificationEntry } from '../gameplay/country/types';
import { Simulation } from '../gameplay/Simulation';
import type { SimEvent } from '../gameplay/events';
import type { MarchResult, StrategicMoveResult } from '../gameplay/military/ArmySystem';
import type { StrategicPath } from '../gameplay/pathfinding/Pathfinder';
import { GEOGRAPHY } from '../geo';
import type { FormationType } from '../gameplay/tactical/types';
import type {
  ArmyPosture,
  MissileType,
  OperationType,
  PeaceTerm,
} from '../gameplay/war/types';
import { World } from '../gameplay/World';
import type { MessageKey } from '../i18n/locales/en';
import type { SaveFile } from '../save/types';
import type { CampaignDifficulty, PlayerSnapshot } from './types';
import { buildPlayerSnapshot } from './snapshot';

/**
 * One running campaign.
 *
 * Owns the world, the clock and the simulation. Everything the interface does
 * goes through this object, which makes save/load and future replay support a
 * single boundary rather than a scattering of globals.
 */
const DIFFICULTY: Record<
  CampaignDifficulty,
  { treasury: number; stockpile: number; stability: number; aiIndustry: number; aiRecovery: number }
> = {
  relaxed: { treasury: 1.25, stockpile: 1.15, stability: 0.02, aiIndustry: 0.94, aiRecovery: 0.94 },
  standard: { treasury: 1, stockpile: 1, stability: 0, aiIndustry: 1, aiRecovery: 1 },
  hardened: { treasury: 0.82, stockpile: 0.9, stability: -0.03, aiIndustry: 1.08, aiRecovery: 1.07 },
};

export interface CreateCampaignOptions {
  countryId: string;
  locale: LocaleCode;
  difficulty?: CampaignDifficulty;
  seed?: number;
}

const monthLabel = (locale: LocaleCode) => (index: number) =>
  translate(locale, `time.month.${index + 1}` as MessageKey);

export class GameSession {
  readonly world: World;
  readonly clock: SimClock;
  readonly simulation: Simulation;
  readonly notifications: NotificationEntry[] = [];
  readonly createdAt: number;
  readonly difficulty: CampaignDifficulty;
  unread = 0;
  locale: LocaleCode;
  /** Player-supplied save label. */
  saveName: string | null = null;
  /** Tactical unit selected by the player (presentation state, not saved). */
  selectedUnitId: string | null = null;
  /** Province inspected by the player (presentation state, not saved). */
  selectedRegionId: string | null = null;

  private unsubscribe: () => void;
  private notifyCounter = 0;
  private lastAutosaveDay: number;
  private autoSavePending = false;

  private constructor(
    world: World,
    clock: SimClock,
    locale: LocaleCode,
    difficulty: CampaignDifficulty,
    createdAt: number,
  ) {
    this.world = world;
    this.clock = clock;
    this.locale = locale;
    this.difficulty = difficulty;
    this.createdAt = createdAt;
    this.lastAutosaveDay = clock.day;
    this.simulation = new Simulation(world);
    this.unsubscribe = this.simulation.events.on((event) => this.handleEvent(event));
  }

  static create(options: CreateCampaignOptions): GameSession {
    const seed = options.seed ?? GAME.defaultSeed;
    const world = new World({ seed, playerCountryId: options.countryId, day: 1 });
    const clock = new SimClock(GAME.msPerDay, 1);
    const difficulty = options.difficulty ?? 'standard';
    const session = new GameSession(world, clock, options.locale, difficulty, Date.now());

    const player = world.player;
    const tuning = DIFFICULTY[difficulty];
    if (player) {
      player.economy.resources.money *= tuning.treasury;
      for (const key of Object.keys(player.economy.resources) as Array<keyof typeof player.economy.resources>) {
        if (key === 'money') continue;
        player.economy.resources[key] *= tuning.stockpile;
      }
      player.stability = Math.min(0.95, Math.max(0.35, player.stability + tuning.stability));
    }
    // Difficulty changes systemic pressure, never content: AI economies and
    // recovery rates shift, but every system and nation remains available.
    for (const country of world.countries.values()) {
      if (country.id === options.countryId) continue;
      country.economy.industrialCapacity *= tuning.aiIndustry;
      country.military.readiness = Math.min(0.98, country.military.readiness * tuning.aiRecovery);
    }

    session.pushNotification({
      kind: 'system',
      message: translate(options.locale, 'nation.brief'),
      severity: 'info',
    });
    return session;
  }

  static fromSave(file: SaveFile, locale: LocaleCode): GameSession {
    const world = new World(
      {
        seed: file.world.seed,
        playerCountryId: file.world.playerCountryId,
        day: file.world.day,
      },
      file.world.countries,
      {
        wars: file.world.wars,
        frontlines: file.world.frontlines,
        blockades: file.world.blockades,
        peaceOffers: file.world.peaceOffers,
        market: file.world.market,
        tradeRoutes: file.world.tradeRoutes,
        situations: file.world.situations,
      },
    );
    const clock = new SimClock(GAME.msPerDay, file.clock.day);
    clock.restore(file.clock);
    const session = new GameSession(
      world,
      clock,
      locale,
      (file.meta.difficulty as CampaignDifficulty) ?? 'standard',
      file.createdAt ?? Date.now(),
    );
    Simulation.rehydrate(world);
    session.simulation.restoreBattlefields(file.battlefields);
    session.saveName = file.meta.customName ?? null;
    session.notifications.push(...(file.notifications ?? []).slice(-GAME.notificationLimit));
    session.unread = 0;
    session.lastAutosaveDay = clock.day;
    return session;
  }

  // ── Time ────────────────────────────────────────────────────────────────────

  advance(deltaMs: number): number {
    const startDay = this.clock.day;
    const steps = this.clock.advance(deltaMs);
    for (let index = 0; index < steps; index += 1) {
      this.simulation.tickDay(startDay + index + 1);
    }
    // Battles run in real time and pause with the campaign clock.
    if (!this.clock.isPaused) {
      this.simulation.advanceRealtime(Math.min(250, Math.max(0, deltaMs)) / 1000);
    }
    if (this.clock.day - this.lastAutosaveDay >= GAME.autosaveEveryDays) {
      this.lastAutosaveDay = this.clock.day;
      this.autoSavePending = true;
    }
    return steps;
  }

  setSpeed(speed: GameSpeed): void {
    this.clock.setSpeed(speed);
  }

  togglePause(): void {
    this.clock.togglePause();
  }

  get isPaused(): boolean {
    return this.clock.isPaused;
  }

  /** Returns true once per autosave interval. */
  consumeAutoSaveFlag(): boolean {
    if (!this.autoSavePending) return false;
    this.autoSavePending = false;
    return true;
  }

  // ── Player actions ──────────────────────────────────────────────────────────

  startResearch(techId: string): boolean {
    return this.simulation.startResearch(this.world.playerCountryId, techId);
  }

  queueUnit(unitId: string): boolean {
    return this.simulation.queueProduction(this.world.playerCountryId, unitId);
  }

  marchArmy(armyId: string, targetId: string): MarchResult {
    return this.simulation.marchArmy(this.world.playerCountryId, armyId, targetId);
  }

  /** Orders an army to a country or region along the cheapest legal route. */
  orderArmyMove(armyId: string, targetId: string): StrategicMoveResult {
    return this.simulation.marchArmyTo(this.world.playerCountryId, armyId, targetId);
  }

  planArmyRoute(armyId: string, targetId: string): StrategicPath | null {
    return this.simulation.planArmyRoute(this.world.playerCountryId, armyId, targetId);
  }

  declareWar(targetId: string): boolean {
    return this.simulation.declareWar(this.world.playerCountryId, targetId);
  }

  makePeace(targetId: string): boolean {
    return this.simulation.makePeace(this.world.playerCountryId, targetId);
  }

  // ── War management ─────────────────────────────────────────────────────────

  setArmyPosture(armyId: string, posture: ArmyPosture): boolean {
    return this.simulation.setArmyPosture(this.world.playerCountryId, armyId, posture);
  }

  createArmyGroup(
    name: string,
    armyIds: string[],
    objectiveRegionId: string | null,
  ): boolean {
    return Boolean(
      this.simulation.createArmyGroup(
        this.world.playerCountryId,
        name,
        armyIds,
        objectiveRegionId,
      ),
    );
  }

  assignArmyToGroup(armyId: string, groupId: string | null): boolean {
    return this.simulation.assignArmyToGroup(this.world.playerCountryId, armyId, groupId);
  }

  assignArmyToFrontline(
    armyId: string,
    frontlineId: string | null,
    objectiveRegionId: string | null = null,
  ): boolean {
    return this.simulation.assignArmyToFrontline(
      this.world.playerCountryId,
      armyId,
      frontlineId,
      objectiveRegionId,
    );
  }

  createOperation(
    type: OperationType,
    targetRegionIds: string[],
    armyIds: string[],
    warId: string | null,
  ): boolean {
    return Boolean(
      this.simulation.createOperation(
        this.world.playerCountryId,
        type,
        targetRegionIds,
        armyIds,
        warId,
      ),
    );
  }

  launchAirMission(
    type: 'airSuperiority' | 'interception' | 'groundSupport' | 'recon' | 'strategicBombing' | 'transport',
    targetRegionId: string | null,
  ): boolean {
    return this.simulation.launchAirMission(this.world.playerCountryId, type, targetRegionId);
  }

  orderBlockade(targetId: string): boolean {
    return this.simulation.orderBlockade(this.world.playerCountryId, targetId);
  }

  liftBlockade(targetId: string): boolean {
    return this.simulation.liftBlockade(this.world.playerCountryId, targetId);
  }

  launchMissile(targetRegionId: string, type: MissileType) {
    return this.simulation.launchMissile(this.world.playerCountryId, targetRegionId, type);
  }

  proposePeace(warId: string, terms: PeaceTerm[]) {
    return this.simulation.proposePeace(this.world.playerCountryId, warId, terms);
  }

  acceptPeace(offerId: string): boolean {
    return this.simulation.acceptPeace(offerId);
  }

  rejectPeace(offerId: string): boolean {
    return this.simulation.rejectPeace(offerId);
  }

  /** Civilian construction in one of the player's regions. */
  startConstruction(
    projectId: string,
    regionId: string,
    priority: 'low' | 'normal' | 'high' = 'normal',
  ): boolean {
    return this.simulation.startConstruction(
      this.world.playerCountryId,
      projectId,
      regionId,
      priority,
    );
  }

  /** Adjusts the national budget split between army, construction and research. */
  setAllocation(allocation: { military: number; infrastructure: number; research: number }): boolean {
    return this.simulation.setAllocation(this.world.playerCountryId, allocation);
  }

  cancelConstruction(orderId: string): boolean {
    return this.simulation.cancelConstruction(this.world.playerCountryId, orderId);
  }

  setConstructionPriority(orderId: string, priority: 'low' | 'normal' | 'high'): boolean {
    return this.simulation.setConstructionPriority(
      this.world.playerCountryId,
      orderId,
      priority,
    );
  }

  setPolicy(policyId: string, enabled: boolean): boolean {
    return this.simulation.setPolicy(this.world.playerCountryId, policyId, enabled);
  }

  setMobilization(level: number): boolean {
    return this.simulation.setMobilization(this.world.playerCountryId, level);
  }

  establishTradeRoute(
    partnerId: string,
    resource: string,
    amount: number,
    contract = false,
  ): ReturnType<Simulation['establishTradeRoute']> {
    return this.simulation.establishTradeRoute(
      this.world.playerCountryId,
      partnerId,
      resource,
      amount,
      contract,
    );
  }

  cancelTradeRoute(routeId: string): boolean {
    return this.simulation.cancelTradeRoute(this.world.playerCountryId, routeId);
  }

  queueMissile(type: MissileType): ReturnType<Simulation['queueMissile']> {
    return this.simulation.queueMissile(this.world.playerCountryId, type);
  }

  startNavalInvasion(armyId: string, targetRegionId: string) {
    return this.simulation.startNavalInvasion(
      this.world.playerCountryId,
      armyId,
      targetRegionId,
    );
  }

  startAirlift(armyId: string, targetRegionId: string, kind: 'redeploy' | 'supply' = 'redeploy') {
    return this.simulation.startAirlift(
      this.world.playerCountryId,
      armyId,
      targetRegionId,
      kind,
    );
  }

  transportCapacity(): number {
    return this.simulation.transportCapacity(this.world.playerCountryId);
  }

  openTrade(targetId: string): boolean {
    return this.simulation.openTrade(this.world.playerCountryId, targetId);
  }

  improveRelations(targetId: string): boolean {
    return this.simulation.improveRelations(this.world.playerCountryId, targetId);
  }

  formNonAggression(targetId: string): boolean {
    return this.simulation.formNonAggression(this.world.playerCountryId, targetId);
  }

  grantMilitaryAccess(targetId: string): boolean {
    return this.simulation.grantMilitaryAccess(this.world.playerCountryId, targetId);
  }

  imposeEmbargo(targetId: string): boolean {
    return this.simulation.imposeEmbargo(this.world.playerCountryId, targetId);
  }

  liftEmbargo(targetId: string): boolean {
    return this.simulation.liftEmbargo(this.world.playerCountryId, targetId);
  }

  formAlliance(targetId: string): boolean {
    return this.simulation.formAlliance(this.world.playerCountryId, targetId);
  }

  breakAlliance(targetId: string): boolean {
    return this.simulation.breakAlliance(this.world.playerCountryId, targetId);
  }

  playerCountry(): CountryState | undefined {
    return this.world.player;
  }

  // ── Tactical layer ─────────────────────────────────────────────────────────

  selectUnit(unitId: string | null): void {
    if (!unitId) {
      this.selectedUnitId = null;
      return;
    }
    const battle = this.simulation.playerBattle();
    const unit = battle?.getUnit(unitId);
    this.selectedUnitId = unit && unit.state !== 'destroyed' ? unitId : null;
  }

  setBattleFormation(formation: FormationType): boolean {
    return this.simulation.issueBattleCommand({
      kind: 'formation',
      countryId: this.world.playerCountryId,
      formation,
    });
  }

  battleAdvance(): boolean {
    return this.simulation.issueBattleCommand({
      kind: 'advance',
      countryId: this.world.playerCountryId,
    });
  }

  battleHold(): boolean {
    return this.simulation.issueBattleCommand({
      kind: 'hold-line',
      countryId: this.world.playerCountryId,
    });
  }

  battleWithdraw(): boolean {
    return this.simulation.issueBattleCommand({
      kind: 'withdraw',
      countryId: this.world.playerCountryId,
    });
  }

  battleOrderSelected(x: number, z: number): boolean {
    const unitId = this.selectedUnitId;
    if (!unitId) return false;
    return this.simulation.issueBattleCommand({ kind: 'move', unitId, x, z });
  }

  battleHoldSelected(): boolean {
    const unitId = this.selectedUnitId;
    if (!unitId) return false;
    return this.simulation.issueBattleCommand({ kind: 'hold', unitId });
  }

  /** Sends the selected unit against the nearest living enemy. */
  battleAttackNearest(): boolean {
    const battle = this.simulation.playerBattle();
    const unitId = this.selectedUnitId;
    if (!battle || !unitId) return false;
    const unit = battle.getUnit(unitId);
    if (!unit) return false;
    const target = battle
      .livingUnits()
      .filter((entry) => entry.side !== unit.side)
      .sort((a, b) => {
        const da = Math.hypot(a.position.x - unit.position.x, a.position.z - unit.position.z);
        const db = Math.hypot(b.position.x - unit.position.x, b.position.z - unit.position.z);
        return da - db;
      })[0];
    if (!target) return false;
    return this.simulation.issueBattleCommand({ kind: 'attack', unitId, targetId: target.id });
  }

  dismissBattle(): void {
    this.simulation.dismissBattle();
    this.selectedUnitId = null;
  }

  // ── Notifications ───────────────────────────────────────────────────────────

  private pushNotification(entry: Omit<NotificationEntry, 'id' | 'day'>): void {
    this.notifyCounter += 1;
    this.notifications.push({
      ...entry,
      id: `notice-${this.clock.day}-${this.notifyCounter}`,
      day: this.clock.day,
    });
    if (this.notifications.length > GAME.notificationLimit) this.notifications.shift();
    this.unread = Math.min(99, this.unread + 1);
  }

  markNotificationsRead(): void {
    this.unread = 0;
  }

  clearNotifications(): void {
    this.notifications.length = 0;
    this.unread = 0;
  }

  private handleEvent(event: SimEvent): void {
    const playerId = this.world.playerCountryId;
    const locale = this.locale;
    const countryName = (id: string): string => {
      const definition = COUNTRY_BY_ID[id];
      return definition ? localize(definition.name, locale) : id;
    };

    switch (event.type) {
      case 'researchStart': {
        if (event.countryId !== playerId) return;
        const tech = getTech(event.techId);
        if (!tech) return;
        this.pushNotification({
          kind: 'research',
          message: translate(locale, 'notify.researchStart', { tech: localize(tech.name, locale) }),
          severity: 'info',
        });
        return;
      }
      case 'researchComplete': {
        if (event.countryId !== playerId) return;
        const tech = getTech(event.techId);
        if (!tech) return;
        this.pushNotification({
          kind: 'research',
          message: translate(locale, 'notify.researchDone', { tech: localize(tech.name, locale) }),
          severity: 'success',
        });
        return;
      }
      case 'productionStart': {
        if (event.countryId !== playerId) return;
        const unit = getUnit(event.unitId);
        if (!unit) return;
        this.pushNotification({
          kind: 'production',
          message: translate(locale, 'notify.buildStart', { unit: localize(unit.name, locale) }),
          severity: 'info',
        });
        return;
      }
      case 'unitReady': {
        if (event.countryId !== playerId) return;
        const unit = getUnit(event.unitId);
        if (!unit) return;
        this.pushNotification({
          kind: 'production',
          message: translate(locale, 'notify.buildDone', { unit: localize(unit.name, locale) }),
          severity: 'success',
        });
        return;
      }
      case 'warDeclared': {
        if (event.aggressorId !== playerId && event.defenderId !== playerId) return;
        this.pushNotification({
          kind: 'war',
          message: translate(locale, 'notify.war', {
            a: countryName(event.aggressorId),
            b: countryName(event.defenderId),
          }),
          severity: 'danger',
        });
        return;
      }
      case 'peaceSigned': {
        if (event.aId !== playerId && event.bId !== playerId) return;
        this.pushNotification({
          kind: 'peace',
          message: translate(locale, 'notify.peace', {
            a: countryName(event.aId),
            b: countryName(event.bId),
          }),
          severity: 'success',
        });
        return;
      }
      case 'allianceFormed': {
        if (event.aId !== playerId && event.bId !== playerId) return;
        this.pushNotification({
          kind: 'alliance',
          message: translate(locale, 'notify.alliance', {
            a: countryName(event.aId),
            b: countryName(event.bId),
          }),
          severity: 'success',
        });
        return;
      }
      case 'constructionStart': {
        if (event.countryId !== playerId) return;
        const project = getProject(event.projectId);
        if (!project) return;
        this.pushNotification({
          kind: 'production',
          message: translate(locale, 'notify.constructionStart', {
            project: localize(project.name, locale),
          }),
          severity: 'info',
        });
        return;
      }
      case 'constructionComplete': {
        if (event.countryId !== playerId) return;
        const project = getProject(event.projectId);
        if (!project) return;
        this.pushNotification({
          kind: 'production',
          message: translate(locale, 'notify.constructionDone', {
            project: localize(project.name, locale),
          }),
          severity: 'success',
        });
        return;
      }
      case 'battleResolved': {
        if (event.attackerId !== playerId && event.defenderId !== playerId) return;
        const won = event.attackerId === playerId ? event.attackerWon : !event.attackerWon;
        const own = event.attackerId === playerId ? event.attackerLosses : event.defenderLosses;
        const enemy = event.attackerId === playerId ? event.defenderLosses : event.attackerLosses;
        this.pushNotification({
          kind: 'war',
          message: translate(locale, won ? 'notify.battleWon' : 'notify.battleLost', {
            place: countryName(event.locationId),
            own: formatNumber(own, locale),
            enemy: formatNumber(enemy, locale),
          }),
          severity: won ? 'success' : 'danger',
        });
        return;
      }
      case 'territoryOccupied': {
        if (event.occupierId === playerId) {
          this.pushNotification({
            kind: 'war',
            message: translate(locale, 'notify.occupationGained', {
              country: countryName(event.countryId),
            }),
            severity: 'success',
          });
        } else if (event.countryId === playerId) {
          this.pushNotification({
            kind: 'war',
            message: translate(locale, 'notify.occupationSuffered', {
              country: countryName(event.occupierId),
            }),
            severity: 'danger',
          });
        }
        return;
      }
      case 'territoryLiberated': {
        if (event.countryId !== playerId) return;
        this.pushNotification({
          kind: 'war',
          message: translate(locale, 'notify.liberated'),
          severity: 'success',
        });
        return;
      }
      case 'lowTreasury': {
        if (event.countryId !== playerId) return;
        this.pushNotification({
          kind: 'economy',
          message: translate(locale, 'notify.lowTreasury'),
          severity: 'warning',
        });
        return;
      }
      case 'tradeRouteOpened': {
        if (event.countryId !== playerId && event.partnerId !== playerId) return;
        const partnerId = event.countryId === playerId ? event.partnerId : event.countryId;
        const route = this.world.tradeRoutes[event.routeId];
        const resource = route ? RESOURCES[route.resource].name : null;
        this.pushNotification({
          kind: 'trade',
          message: translate(locale, 'notify.tradeRoute', {
            partner: countryName(partnerId),
            resource: resource ? localize(resource, locale) : '—',
          }),
          severity: 'success',
        });
        return;
      }
      case 'tradeDisrupted': {
        if (event.countryId !== playerId) return;
        const route = this.world.tradeRoutes[event.routeId];
        this.pushNotification({
          kind: 'trade',
          message: translate(locale, 'notify.tradeDisrupted', {
            resource: route ? localize(RESOURCES[route.resource].name, locale) : '—',
          }),
          severity: event.severity === 'severe' ? 'danger' : 'warning',
        });
        return;
      }
      case 'navalInvasionStarted': {
        if (event.countryId !== playerId) return;
        const region = regionAt(event.targetRegionId);
        this.pushNotification({
          kind: 'war',
          message: translate(locale, 'notify.invasionStarted', {
            region: region ? localize(region.name, locale) : event.targetRegionId,
          }),
          severity: 'info',
        });
        return;
      }
      case 'navalInvasionLanded': {
        if (event.countryId !== playerId) return;
        const region = regionAt(event.regionId);
        this.pushNotification({
          kind: 'war',
          message: translate(locale, 'notify.invasionLanded', {
            region: region ? localize(region.name, locale) : event.regionId,
          }),
          severity: 'success',
        });
        return;
      }
      case 'navalInvasionFailed': {
        if (event.countryId !== playerId) return;
        const region = regionAt(event.targetRegionId);
        this.pushNotification({
          kind: 'war',
          message: translate(locale, 'notify.invasionFailed', {
            region: region ? localize(region.name, locale) : event.targetRegionId,
          }),
          severity: 'danger',
        });
        return;
      }
      case 'airliftCompleted': {
        if (event.countryId !== playerId) return;
        const region = regionAt(event.targetRegionId);
        this.pushNotification({
          kind: 'production',
          message: translate(locale, 'notify.airliftDone', {
            region: region ? localize(region.name, locale) : event.targetRegionId,
          }),
          severity: 'success',
        });
        return;
      }
      case 'airliftFailed': {
        if (event.countryId !== playerId) return;
        const region = regionAt(event.targetRegionId);
        this.pushNotification({
          kind: 'war',
          message: translate(locale, 'notify.airliftFailed', {
            region: region ? localize(region.name, locale) : event.targetRegionId,
          }),
          severity: 'danger',
        });
        return;
      }
      case 'policyChanged': {
        if (event.countryId !== playerId) return;
        const policy = getPolicy(event.policyId);
        if (!policy) return;
        this.pushNotification({
          kind: 'policy',
          message: translate(locale, 'notify.policy', {
            policy: localize(policy.name, locale),
          }),
          severity: 'info',
        });
        return;
      }
      case 'situationStarted': {
        if (event.countryId !== playerId) return;
        const definition = SITUATIONS.find((entry) => entry.id === event.definitionId);
        if (!definition) return;
        this.pushNotification({
          kind: 'situation',
          message: translate(locale, 'notify.situation', {
            situation: localize(definition.name, locale),
          }),
          severity:
            event.severity === 'major'
              ? 'danger'
              : event.severity === 'moderate'
                ? 'warning'
                : 'info',
        });
        return;
      }
      case 'situationEnded': {
        if (event.countryId !== playerId) return;
        const definition = SITUATIONS.find((entry) => entry.id === event.definitionId);
        if (!definition) return;
        this.pushNotification({
          kind: 'situation',
          message: translate(locale, 'notify.situationEnded', {
            situation: localize(definition.name, locale),
          }),
          severity: 'success',
        });
        return;
      }
      case 'missileProduced': {
        if (event.countryId !== playerId) return;
        this.pushNotification({
          kind: 'production',
          message: translate(locale, 'missile.produced'),
          severity: 'success',
        });
        return;
      }
      default:
        return;
    }
  }

  // ── Outputs ─────────────────────────────────────────────────────────────────

  snapshot(): PlayerSnapshot | null {
    return buildPlayerSnapshot({
      locale: this.locale,
      world: this.world,
      day: this.clock.day,
      speed: this.clock.speed,
      paused: this.clock.isPaused,
      dayProgress: this.clock.dayProgress,
      notifications: this.notifications,
      unread: this.unread,
      battle: this.simulation.playerBattle() ?? null,
      selectedUnitId: this.selectedUnitId,
      selectedRegionId: this.selectedRegionId,
    });
  }

  dateLabel(locale: LocaleCode): string {
    return formatGameDate(this.clock.day, locale, monthLabel(locale));
  }

  toSavePayload(): Omit<SaveFile, 'slot' | 'version' | 'updatedAt'> {
    const player = this.world.player;
    const definition = COUNTRY_BY_ID[this.world.playerCountryId];
    if (!player || !definition) throw new Error('Campaign has no player country');
    return {
      id: `campaign-${this.world.seed}-${this.createdAt}`,
      createdAt: this.createdAt,
      meta: {
        customName: this.saveName ?? undefined,
        name:
          this.saveName?.trim() ||
          `${localize(definition.name, this.locale)} — ${this.dateLabel(this.locale)}`,
        countryId: player.id,
        countryName: localize(definition.name, this.locale),
        iso2: definition.iso2,
        day: this.clock.day,
        year: gameYear(this.clock.day),
        population: Math.round(player.population),
        treasury: Math.round(player.economy.resources.money),
        strength: Math.round(player.military.strengthIndex),
        difficulty: this.difficulty,
      },
      world: {
        seed: this.world.seed,
        day: this.clock.day,
        playerCountryId: this.world.playerCountryId,
        countries: [...this.world.countries.values()],
        geography: {
          provider: GEOGRAPHY.id,
          regionSource: GEOGRAPHY.regionSource,
          version: 1,
        },
        wars: Object.values(this.world.wars),
        frontlines: Object.values(this.world.frontlines),
        blockades: this.world.blockades,
        peaceOffers: this.world.peaceOffers,
        market: this.world.market,
        tradeRoutes: this.world.tradeRoutes,
        situations: this.world.situations,
      },
      clock: {
        day: this.clock.day,
        speed: this.clock.speed === 0 ? 1 : this.clock.speed,
        progress: this.clock.dayProgress,
      },
      notifications: this.notifications.slice(-GAME.notificationLimit),
      battlefields: this.simulation.battlefields.toSave(),
    };
  }

  saveSummaryLine(locale: LocaleCode): string {
    return formatGameDate(this.clock.day, locale, monthLabel(locale));
  }

  dispose(): void {
    this.unsubscribe();
    this.simulation.events.clear();
  }
}
