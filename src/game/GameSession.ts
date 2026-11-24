import { SimClock } from '../core/clock';
import { GAME, type GameSpeed } from '../core/config';
import { COUNTRY_BY_ID } from '../data/countries';
import { getTech } from '../data/research';
import { getProject } from '../data/production';
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
const DIFFICULTY: Record<CampaignDifficulty, { treasury: number; stockpile: number; stability: number }> = {
  relaxed: { treasury: 1.25, stockpile: 1.15, stability: 0.02 },
  standard: { treasury: 1, stockpile: 1, stability: 0 },
  hardened: { treasury: 0.82, stockpile: 0.9, stability: -0.03 },
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
    if (player) {
      const tuning = DIFFICULTY[difficulty];
      player.economy.resources.money *= tuning.treasury;
      for (const key of Object.keys(player.economy.resources) as Array<keyof typeof player.economy.resources>) {
        if (key === 'money') continue;
        player.economy.resources[key] *= tuning.stockpile;
      }
      player.stability = Math.min(0.95, Math.max(0.35, player.stability + tuning.stability));
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

  /** Civilian construction in one of the player's regions. */
  startConstruction(projectId: string, regionId: string): boolean {
    return this.simulation.startConstruction(
      this.world.playerCountryId,
      projectId,
      regionId,
    );
  }

  /** Adjusts the national budget split between army, construction and research. */
  setAllocation(allocation: { military: number; infrastructure: number; research: number }): boolean {
    return this.simulation.setAllocation(this.world.playerCountryId, allocation);
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
