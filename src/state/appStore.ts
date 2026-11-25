import { create } from 'zustand';
import { GameSession } from '../game/GameSession';
import { previewCountry } from '../game/preview';
import type {
  CountryBrief,
  CampaignDifficulty,
  MapLayerId,
  PlayerSnapshot,
} from '../game/types';
import { GEOGRAPHY, normalisedCentroid } from '../geo';
import type { GameSpeed } from '../core/config';
import { saveManager } from '../save/SaveManager';
import type { SaveSlotId, SaveSummary } from '../save/types';
import type { FormationType } from '../gameplay/tactical/types';
import { useSettingsStore } from './settingsStore';
import { translate } from '../i18n';
import { formatNumber } from '../i18n/format';
import type { MessageKey } from '../i18n/locales/en';

/**
 * Application state: which screen is visible, which nation is inspected and the
 * live campaign. Simulation objects live here (never in component state) so the
 * world survives screen changes.
 */
export type AppPhase = 'menu' | 'nation' | 'game';
export type PanelTab =
  | 'overview'
  | 'economy'
  | 'production'
  | 'research'
  | 'military'
  | 'diplomacy'
  | 'logistics'
  | 'society'
  | 'trade'
  | 'intel'
  | 'policies'
  | 'territory'
  | 'war';
export type DialogId = 'none' | 'save' | 'load' | 'settings' | 'pause' | 'leave';

export interface CameraFocusRequest {
  countryId: string;
  nonce: number;
}

export interface BattleFocusRequest {
  lon: number;
  lat: number;
  nonce: number;
}

export interface ArmyFocusRequest {
  lon: number;
  lat: number;
  nonce: number;
}

export interface RegionFocusRequest {
  regionId: string;
  lon: number;
  lat: number;
  nonce: number;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
}

interface AppState {
  phase: AppPhase;
  dialog: DialogId;
  panelTab: PanelTab;
  panelOpen: boolean;
  notificationsOpen: boolean;
  selectedCountryId: string | null;
  hoveredCountryId: string | null;
  selectedRegionId: string | null;
  mapLayer: MapLayerId;
  inspectedBrief: CountryBrief | null;
  session: GameSession | null;
  snapshot: PlayerSnapshot | null;
  saves: SaveSummary[];
  savesLoaded: boolean;
  busy: boolean;
  toast: Toast | null;
  cameraFocus: CameraFocusRequest | null;
  battleFocus: BattleFocusRequest | null;
  armyFocus: ArmyFocusRequest | null;
  regionFocus: RegionFocusRequest | null;
  pausedFromSpeed: 1 | 2 | 4 | 8;

  goToMenu: () => void;
  goToNationSelect: () => void;
  openDialog: (dialog: DialogId) => void;
  closeDialog: () => void;
  resumeFromPause: () => void;
  setPanelTab: (tab: PanelTab) => void;
  togglePanel: () => void;
  toggleNotifications: () => void;
  setNotificationsOpen: (open: boolean) => void;
  clearNotifications: () => void;

  selectCountry: (countryId: string | null, focusCamera?: boolean) => void;
  selectRegion: (regionId: string | null) => void;
  hoverCountry: (countryId: string | null) => void;
  focusCountryCamera: (countryId: string) => void;
  focusRegionCamera: (regionId: string) => void;
  setMapLayer: (layer: MapLayerId) => void;

  startCampaign: (countryId: string, difficulty: CampaignDifficulty) => void;
  returnToMenu: () => void;
  refreshSaves: () => Promise<void>;
  continueLatest: () => Promise<void>;
  saveToSlot: (slot: SaveSlotId, silent?: boolean, name?: string) => Promise<void>;
  loadFromSlot: (slot: SaveSlotId) => Promise<void>;
  deleteSlot: (slot: SaveSlotId) => Promise<void>;
  importSaveText: (text: string) => Promise<void>;
  exportSlot: (slot: SaveSlotId) => Promise<void>;

  tick: (deltaMs: number) => void;
  syncSnapshot: () => void;
  setSpeed: (speed: GameSpeed) => void;
  togglePause: () => void;
  startResearch: (techId: string) => void;
  queueUnit: (unitId: string) => void;
  marchArmy: (armyId: string, targetId: string) => void;
  orderArmyMove: (armyId: string, targetId: string) => void;
  declareWar: (targetId: string) => void;
  makePeace: (targetId: string) => void;
  startConstruction: (projectId: string, regionId: string, priority?: 'low' | 'normal' | 'high') => void;
  cancelConstruction: (orderId: string) => void;
  setConstructionPriority: (orderId: string, priority: 'low' | 'normal' | 'high') => void;
  setAllocation: (allocation: { military: number; infrastructure: number; research: number }) => void;
  setPolicy: (policyId: string, enabled: boolean) => void;
  setMobilization: (level: number) => void;
  openTradeAgreement: (partnerId: string) => void;
  establishTradeRoute: (partnerId: string, resource: string, amount: number, contract?: boolean) => void;
  cancelTradeRoute: (routeId: string) => void;
  queueMissile: (type: 'tactical' | 'cruise' | 'ballistic') => void;
  startNavalInvasion: (armyId: string, targetRegionId: string) => void;
  startAirlift: (armyId: string, targetRegionId: string, kind?: 'redeploy' | 'supply') => void;
  improveRelations: (targetId: string) => void;
  formNonAggression: (targetId: string) => void;
  grantMilitaryAccess: (targetId: string) => void;
  imposeEmbargo: (targetId: string) => void;
  liftEmbargo: (targetId: string) => void;
  formAlliance: (targetId: string) => void;
  breakAlliance: (targetId: string) => void;

  setArmyPosture: (armyId: string, posture: string) => void;
  assignArmyToFrontline: (armyId: string, frontlineId: string, objectiveRegionId: string | null) => void;
  formArmyGroup: (armyIds: string[], name: string, objectiveRegionId: string | null) => void;
  createOperationFromFront: (warId: string) => void;
  launchAirMission: (type: string, targetRegionId: string | null) => void;
  orderBlockade: (targetId: string) => void;
  launchMissile: (targetRegionId: string, type: 'tactical' | 'cruise' | 'ballistic') => void;
  offerWhitePeace: (warId: string) => void;
  acceptPeace: (offerId: string) => void;
  rejectPeace: (offerId: string) => void;

  focusBattleCamera: (lon: number, lat: number) => void;
  focusArmyCamera: (lon: number, lat: number) => void;
  selectUnit: (unitId: string | null) => void;
  setBattleFormation: (formation: FormationType) => void;
  battleAdvance: () => void;
  battleHold: () => void;
  battleWithdraw: () => void;
  battleAttackSelected: () => void;
  battleHoldSelected: () => void;
  dismissBattle: () => void;

  showToast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: () => void;
}

let toastCounter = 0;
let lastSnapshotAt = 0;

const message = (key: MessageKey, values?: Record<string, string | number>): string =>
  translate(useSettingsStore.getState().locale, key, values);

export const useAppStore = create<AppState>()((set, get) => ({
  phase: 'menu',
  dialog: 'none',
  panelTab: 'overview',
  panelOpen: true,
  notificationsOpen: false,
  selectedCountryId: null,
  hoveredCountryId: null,
  selectedRegionId: null,
  mapLayer: 'political',
  inspectedBrief: null,
  session: null,
  snapshot: null,
  saves: [],
  savesLoaded: false,
  busy: false,
  toast: null,
  cameraFocus: null,
  battleFocus: null,
  armyFocus: null,
  regionFocus: null,
  pausedFromSpeed: 1,

  goToMenu: () => set({ phase: 'menu', dialog: 'none', selectedCountryId: null, hoveredCountryId: null }),
  goToNationSelect: () => set({ phase: 'nation', dialog: 'none', selectedCountryId: null, inspectedBrief: null }),

  openDialog: (dialog) => {
    if (dialog === 'pause') {
      const session = get().session;
      if (session) {
        const speed = session.clock.speed;
        if (speed !== 0) set({ pausedFromSpeed: speed });
        session.setSpeed(0);
        set({ snapshot: session.snapshot() });
      }
    }
    set({ dialog });
  },
  closeDialog: () => set({ dialog: 'none' }),
  resumeFromPause: () => {
    const session = get().session;
    if (!session) return;
    session.setSpeed(get().pausedFromSpeed || 1);
    set({ snapshot: session.snapshot() });
  },
  setPanelTab: (panelTab) => set({ panelTab, panelOpen: true }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
  toggleNotifications: () => {
    const open = !get().notificationsOpen;
    set({ notificationsOpen: open });
    if (open) {
      get().session?.markNotificationsRead();
      get().syncSnapshot();
    }
  },
  setNotificationsOpen: (open) => {
    set({ notificationsOpen: open });
    if (open) {
      get().session?.markNotificationsRead();
      get().syncSnapshot();
    }
  },
  clearNotifications: () => {
    get().session?.clearNotifications();
    get().syncSnapshot();
  },

  selectCountry: (countryId, focusCamera = false) => {
    const { phase } = get();
    if (!countryId) {
      set({ selectedCountryId: null, inspectedBrief: null });
      return;
    }
    let brief: CountryBrief | null = null;
    if (phase === 'game') {
      const session = get().session;
      const state = session?.world.get(countryId);
      if (session && state) {
        const definition = previewCountry(countryId)?.definition;
        if (definition) {
          brief = {
            definition,
            state,
            capital: previewCountry(countryId)?.capital ?? null,
            cities: previewCountry(countryId)?.cities ?? [],
            strengthClass: previewCountry(countryId)?.strengthClass ?? 'weak',
          };
        }
      }
    } else {
      brief = previewCountry(countryId);
    }
    set({ selectedCountryId: countryId, inspectedBrief: brief });
    if (focusCamera) get().focusCountryCamera(countryId);
  },

  selectRegion: (regionId) => {
    const session = get().session;
    if (session) session.selectedRegionId = regionId;
    set({ selectedRegionId: regionId, snapshot: session?.snapshot() ?? null });
  },

  hoverCountry: (hoveredCountryId) => set({ hoveredCountryId }),

  focusCountryCamera: (countryId) =>
    set({ cameraFocus: { countryId, nonce: Date.now() + Math.random() } }),

  focusRegionCamera: (regionId) => {
    const region = GEOGRAPHY.region(regionId);
    if (!region) return;
    const [lon, lat] = normalisedCentroid(region);
    set({ regionFocus: { regionId, lon, lat, nonce: Date.now() + Math.random() } });
  },

  setMapLayer: (mapLayer) => set({ mapLayer }),

  startCampaign: (countryId, difficulty) => {
    const locale = useSettingsStore.getState().locale;
    const session = GameSession.create({ countryId, locale, difficulty });
    set({
      session,
      phase: 'game',
      dialog: 'none',
      panelTab: 'overview',
      panelOpen: true,
      selectedCountryId: countryId,
      snapshot: session.snapshot(),
      cameraFocus: { countryId, nonce: Date.now() },
      battleFocus: null,
    });
    set({
      inspectedBrief: (() => {
        const state = session.world.get(countryId);
        const brief = previewCountry(countryId);
        return state && brief
          ? { ...brief, state, cities: brief.cities }
          : null;
      })(),
    });
    get().showToast(message('nation.start'), 'success');
    void get().saveToSlot('auto', true);
  },

  returnToMenu: () => {
    get().session?.dispose();
    set({
      session: null,
      snapshot: null,
      phase: 'menu',
      dialog: 'none',
      selectedCountryId: null,
      inspectedBrief: null,
    });
  },

  refreshSaves: async () => {
    const saves = await saveManager.listSlots();
    set({ saves, savesLoaded: true });
  },

  continueLatest: async () => {
    set({ busy: true });
    await get().refreshSaves();
    const latest = get().saves[0];
    set({ busy: false });
    if (!latest) {
      get().showToast(message('menu.noSave'), 'warning');
      return;
    }
    await get().loadFromSlot(latest.slot);
  },

  saveToSlot: async (slot, silent = false, name) => {
    const session = get().session;
    if (!session) return;
    if (name !== undefined) session.saveName = name.trim() || null;
    try {
      await saveManager.save(slot, session.toSavePayload());
      await get().refreshSaves();
      if (!silent) get().showToast(message('save.savedToast'), 'success');
      else get().showToast(message('notify.autosave'), 'info');
    } catch {
      get().showToast(message('save.error'), 'danger');
    }
  },

  loadFromSlot: async (slot) => {
    set({ busy: true });
    const locale = useSettingsStore.getState().locale;
    const result = await saveManager.load(slot);
    if (!result.ok) {
      set({ busy: false });
      get().showToast(
        message(
          result.error === 'incompatible'
            ? 'save.incompatible'
            : result.error === 'notFound'
              ? 'menu.noSave'
              : 'save.corrupt',
        ),
        'danger',
      );
      return;
    }
    const session = GameSession.fromSave(result.file, locale);
    useAppStore.setState({
      session,
      snapshot: session.snapshot(),
      phase: 'game',
      dialog: 'none',
      busy: false,
      selectedCountryId: session.world.playerCountryId,
      cameraFocus: { countryId: session.world.playerCountryId, nonce: Date.now() },
      battleFocus: null,
    });
    get().selectCountry(session.world.playerCountryId);
    get().showToast(message('save.loadedToast'), 'success');
  },

  deleteSlot: async (slot) => {
    await saveManager.delete(slot);
    await get().refreshSaves();
    get().showToast(message('save.deletedToast'), 'info');
  },

  importSaveText: async (text) => {
    const result = await saveManager.importFile(text);
    await get().refreshSaves();
    get().showToast(
      result.ok
        ? message('save.savedToast')
        : message(result.error === 'incompatible' ? 'save.incompatible' : 'save.corrupt'),
      result.ok ? 'success' : 'danger',
    );
  },

  exportSlot: async (slot) => {
    const result = await saveManager.load(slot);
    if (!result.ok) {
      get().showToast(message('save.corrupt'), 'danger');
      return;
    }
    saveManager.exportFile(result.file);
    get().showToast(message('save.exportedToast'), 'success');
  },

  tick: (deltaMs) => {
    const { session } = get();
    if (!session) return;
    const steps = session.advance(deltaMs);
    if (steps > 0) {
      const now = performance.now();
      if (now - lastSnapshotAt > 200) {
        lastSnapshotAt = now;
        set({ snapshot: session.snapshot() });
      }
    }
    if (session.consumeAutoSaveFlag() && useSettingsStore.getState().autosave) {
      void get().saveToSlot('auto', true);
    }
  },

  syncSnapshot: () => {
    const session = get().session;
    if (!session) return;
    set({ snapshot: session.snapshot() });
  },

  setSpeed: (speed) => {
    const session = get().session;
    if (!session) return;
    session.setSpeed(speed);
    set({ snapshot: session.snapshot() });
  },

  togglePause: () => {
    const session = get().session;
    if (!session) return;
    session.togglePause();
    set({ snapshot: session.snapshot() });
  },

  startResearch: (techId) => {
    const session = get().session;
    if (!session) return;
    const started = session.startResearch(techId);
    if (!started) {
      get().showToast(message('research.locked', { tech: '—' }), 'warning');
      return;
    }
    set({ snapshot: session.snapshot() });
  },

  queueUnit: (unitId) => {
    const session = get().session;
    if (!session) return;
    const queued = session.queueUnit(unitId);
    if (!queued) {
      get().showToast(message('military.insufficient'), 'warning');
      return;
    }
    set({ snapshot: session.snapshot() });
  },

  marchArmy: (armyId, targetId) => {
    const session = get().session;
    if (!session) return;
    const result = session.marchArmy(armyId, targetId);
    if (!result.ok) {
      get().showToast(message('military.marchFailed'), 'warning');
      return;
    }
    const locale = useSettingsStore.getState().locale;
    get().showToast(
      message('military.marchStarted', { days: formatNumber(result.days, locale) }),
      'info',
    );
    set({ snapshot: session.snapshot() });
  },

  orderArmyMove: (armyId, targetId) => {
    const session = get().session;
    if (!session) return;
    const result = session.orderArmyMove(armyId, targetId);
    if (!result.ok) {
      get().showToast(message('military.marchFailed'), 'warning');
      return;
    }
    const locale = useSettingsStore.getState().locale;
    get().showToast(
      message('military.marchStarted', { days: formatNumber(Math.max(1, result.days), locale) }),
      'info',
    );
    set({ snapshot: session.snapshot() });
  },

  declareWar: (targetId) => {
    const session = get().session;
    if (!session) return;
    if (!session.declareWar(targetId)) {
      get().showToast(message('diplomacy.actionFailed'), 'warning');
      return;
    }
    get().showToast(message('diplomacy.warDeclared'), 'danger');
    set({ snapshot: session.snapshot() });
  },

  makePeace: (targetId) => {
    const session = get().session;
    if (!session) return;
    if (!session.makePeace(targetId)) {
      get().showToast(message('diplomacy.actionFailed'), 'warning');
      return;
    }
    get().showToast(message('diplomacy.peaceMade'), 'success');
    set({ snapshot: session.snapshot() });
  },

  startConstruction: (projectId, regionId, priority = 'normal') => {
    const session = get().session;
    if (!session) return;
    if (!session.startConstruction(projectId, regionId, priority)) {
      get().showToast(message('production.failed'), 'warning');
      return;
    }
    get().showToast(message('production.started'), 'success');
    set({ snapshot: session.snapshot() });
  },

  cancelConstruction: (orderId) => {
    const session = get().session;
    if (!session?.cancelConstruction(orderId)) {
      get().showToast(message('production.failed'), 'warning');
      return;
    }
    get().showToast(message('construction.cancelled'), 'info');
    set({ snapshot: session.snapshot() });
  },

  setConstructionPriority: (orderId, priority) => {
    const session = get().session;
    if (!session?.setConstructionPriority(orderId, priority)) return;
    get().showToast(message('construction.prioritised'), 'info');
    set({ snapshot: session.snapshot() });
  },

  setAllocation: (allocation) => {
    const session = get().session;
    if (!session) return;
    session.setAllocation(allocation);
    set({ snapshot: session.snapshot() });
  },

  setPolicy: (policyId, enabled) => {
    const session = get().session;
    if (!session?.setPolicy(policyId, enabled)) {
      get().showToast(message('policy.failed'), 'warning');
      return;
    }
    get().showToast(message(enabled ? 'policy.enacted' : 'policy.repealed'), 'success');
    set({ snapshot: session.snapshot() });
  },

  setMobilization: (level) => {
    const session = get().session;
    if (!session?.setMobilization(level)) return;
    set({ snapshot: session.snapshot() });
  },

  openTradeAgreement: (partnerId) => {
    const session = get().session;
    if (!session?.openTrade(partnerId)) {
      get().showToast(message('diplomacy.actionFailed'), 'warning');
      return;
    }
    get().showToast(message('diplomacy.trade'), 'success');
    set({ snapshot: session.snapshot() });
  },

  establishTradeRoute: (partnerId, resource, amount, contract = false) => {
    const session = get().session;
    if (!session) return;
    const result = session.establishTradeRoute(partnerId, resource, amount, contract);
    if (!result.ok) {
      const key: Record<typeof result.reason, MessageKey> = {
        'unknown-country': 'trade.unknown',
        self: 'trade.failed',
        'no-agreement': 'trade.noAgreement',
        'at-war': 'trade.atWar',
        embargoed: 'trade.embargoed',
        sanctioned: 'trade.sanctioned',
        'no-route': 'trade.noRoute',
        'invalid-resource': 'trade.invalidResource',
        'insufficient-stock': 'trade.insufficient',
        'route-limit': 'trade.limit',
      };
      get().showToast(message(key[result.reason]), 'warning');
      return;
    }
    get().showToast(message('trade.opened'), 'success');
    set({ snapshot: session.snapshot() });
  },

  cancelTradeRoute: (routeId) => {
    const session = get().session;
    if (!session?.cancelTradeRoute(routeId)) return;
    get().showToast(message('trade.cancelled'), 'info');
    set({ snapshot: session.snapshot() });
  },

  queueMissile: (type) => {
    const session = get().session;
    if (!session) return;
    const result = session.queueMissile(type);
    if (!result.ok) {
      const key: Record<typeof result.reason, MessageKey> = {
        'unknown-type': 'missile.insufficient',
        'queue-full': 'missile.queueFull',
        'insufficient-resources': 'missile.insufficient',
        'no-industry': 'missile.noIndustry',
      };
      get().showToast(message(key[result.reason]), 'warning');
      return;
    }
    get().showToast(message('missile.queued'), 'success');
    set({ snapshot: session.snapshot() });
  },

  startNavalInvasion: (armyId, targetRegionId) => {
    const session = get().session;
    if (!session) return;
    const result = session.startNavalInvasion(armyId, targetRegionId);
    get().showToast(
      message(result.ok ? 'maneuver.started' : 'maneuver.failed'),
      result.ok ? 'success' : 'warning',
    );
    set({ snapshot: session.snapshot() });
  },

  startAirlift: (armyId, targetRegionId, kind = 'redeploy') => {
    const session = get().session;
    if (!session) return;
    const result = session.startAirlift(armyId, targetRegionId, kind);
    get().showToast(
      message(result.ok ? 'maneuver.started' : 'maneuver.failed'),
      result.ok ? 'success' : 'warning',
    );
    set({ snapshot: session.snapshot() });
  },

  improveRelations: (targetId) => {
    const session = get().session;
    if (!session?.improveRelations(targetId)) {
      get().showToast(message('diplomacy.actionFailed'), 'warning');
      return;
    }
    get().showToast(message('diplomacy.improved'), 'success');
    set({ snapshot: session.snapshot() });
  },

  formNonAggression: (targetId) => {
    const session = get().session;
    if (!session?.formNonAggression(targetId)) {
      get().showToast(message('diplomacy.actionFailed'), 'warning');
      return;
    }
    get().showToast(message('diplomacy.pactSigned'), 'success');
    set({ snapshot: session.snapshot() });
  },

  grantMilitaryAccess: (targetId) => {
    const session = get().session;
    if (!session?.grantMilitaryAccess(targetId)) {
      get().showToast(message('diplomacy.actionFailed'), 'warning');
      return;
    }
    get().showToast(message('diplomacy.accessGranted'), 'success');
    set({ snapshot: session.snapshot() });
  },

  imposeEmbargo: (targetId) => {
    const session = get().session;
    if (!session?.imposeEmbargo(targetId)) {
      get().showToast(message('diplomacy.actionFailed'), 'warning');
      return;
    }
    get().showToast(message('diplomacy.embargoed'), 'warning');
    set({ snapshot: session.snapshot() });
  },

  liftEmbargo: (targetId) => {
    const session = get().session;
    if (!session?.liftEmbargo(targetId)) return;
    get().showToast(message('diplomacy.embargoLifted'), 'info');
    set({ snapshot: session.snapshot() });
  },

  formAlliance: (targetId) => {
    const session = get().session;
    if (!session?.formAlliance(targetId)) {
      get().showToast(message('diplomacy.actionFailed'), 'warning');
      return;
    }
    get().showToast(message('diplomacy.allianceFormed'), 'success');
    set({ snapshot: session.snapshot() });
  },

  breakAlliance: (targetId) => {
    const session = get().session;
    if (!session?.breakAlliance(targetId)) return;
    get().showToast(message('diplomacy.allianceBroken'), 'warning');
    set({ snapshot: session.snapshot() });
  },

  setArmyPosture: (armyId, posture) => {
    const session = get().session;
    if (!session?.setArmyPosture(armyId, posture as never)) return;
    set({ snapshot: session.snapshot() });
  },

  assignArmyToFrontline: (armyId, frontlineId, objectiveRegionId) => {
    const session = get().session;
    if (!session?.assignArmyToFrontline(armyId, frontlineId, objectiveRegionId)) {
      get().showToast(message('war.actionFailed'), 'warning');
      return;
    }
    set({ snapshot: session.snapshot() });
  },

  formArmyGroup: (armyIds, name, objectiveRegionId) => {
    const session = get().session;
    if (!session?.createArmyGroup(name, armyIds, objectiveRegionId)) {
      get().showToast(message('war.actionFailed'), 'warning');
      return;
    }
    get().showToast(message('war.groupFormed'), 'success');
    set({ snapshot: session.snapshot() });
  },

  createOperationFromFront: (warId) => {
    const session = get().session;
    const snapshot = get().snapshot;
    if (!session || !snapshot) return;
    const front = snapshot.warfare.frontlines.find((entry) => entry.warId === warId);
    const armyIds = snapshot.armies.filter((army) => !army.movement).slice(0, 3).map((army) => army.id);
    if (!front?.objectiveRegionId || armyIds.length === 0) {
      get().showToast(message('war.noOperationTarget'), 'warning');
      return;
    }
    const created = session.createOperation(
      'majorOffensive',
      [front.objectiveRegionId],
      armyIds,
      warId,
    );
    get().showToast(message(created ? 'war.operationCreated' : 'war.actionFailed'), created ? 'success' : 'warning');
    set({ snapshot: session.snapshot() });
  },

  launchAirMission: (type, targetRegionId) => {
    const session = get().session;
    if (!session) return;
    const launched = session.launchAirMission(type as never, targetRegionId);
    get().showToast(
      message(launched ? 'war.airLaunched' : 'war.airUnavailable'),
      launched ? 'success' : 'warning',
    );
    set({ snapshot: session.snapshot() });
  },

  orderBlockade: (targetId) => {
    const session = get().session;
    if (!session) return;
    const ordered = session.orderBlockade(targetId);
    get().showToast(
      message(ordered ? 'war.blockadeOrdered' : 'war.blockadeUnavailable'),
      ordered ? 'success' : 'warning',
    );
    set({ snapshot: session.snapshot() });
  },

  launchMissile: (targetRegionId, type) => {
    const session = get().session;
    if (!session) return;
    const result = session.launchMissile(targetRegionId, type);
    get().showToast(
      message(result.ok ? 'war.missileLaunched' : `war.missile.${result.reason}` as MessageKey),
      result.ok ? 'success' : 'warning',
    );
    set({ snapshot: session.snapshot() });
  },

  offerWhitePeace: (warId) => {
    const session = get().session;
    if (!session) return;
    const offer = session.proposePeace(warId, []);
    get().showToast(
      message(offer ? (offer.status === 'accepted' ? 'war.peaceAccepted' : 'war.peaceOffered') : 'war.actionFailed'),
      offer ? 'success' : 'warning',
    );
    set({ snapshot: session.snapshot() });
  },

  acceptPeace: (offerId) => {
    const session = get().session;
    if (!session?.acceptPeace(offerId)) {
      get().showToast(message('war.actionFailed'), 'warning');
      return;
    }
    get().showToast(message('war.peaceAccepted'), 'success');
    set({ snapshot: session.snapshot() });
  },

  rejectPeace: (offerId) => {
    const session = get().session;
    if (!session?.rejectPeace(offerId)) return;
    set({ snapshot: session.snapshot() });
  },

  // ── Tactical layer ────────────────────────────────────────────────────────

  focusBattleCamera: (lon, lat) =>
    set({ battleFocus: { lon, lat, nonce: Date.now() + Math.random() } }),

  focusArmyCamera: (lon, lat) =>
    set({ armyFocus: { lon, lat, nonce: Date.now() + Math.random() } }),

  selectUnit: (unitId) => {
    const session = get().session;
    if (!session) return;
    session.selectUnit(unitId);
    set({ snapshot: session.snapshot() });
  },

  setBattleFormation: (formation) => {
    const session = get().session;
    if (!session) return;
    if (!session.setBattleFormation(formation)) return;
    set({ snapshot: session.snapshot() });
  },

  battleAdvance: () => {
    const session = get().session;
    if (!session) return;
    if (!session.battleAdvance()) {
      get().showToast(message('battle.noTarget'), 'warning');
      return;
    }
    set({ snapshot: session.snapshot() });
  },

  battleHold: () => {
    const session = get().session;
    if (!session) return;
    if (!session.battleHold()) return;
    set({ snapshot: session.snapshot() });
  },

  battleWithdraw: () => {
    const session = get().session;
    if (!session) return;
    if (!session.battleWithdraw()) return;
    set({ snapshot: session.snapshot() });
  },

  battleAttackSelected: () => {
    const session = get().session;
    if (!session) return;
    if (!session.battleAttackNearest()) {
      get().showToast(message('battle.noTarget'), 'warning');
      return;
    }
    set({ snapshot: session.snapshot() });
  },

  battleHoldSelected: () => {
    const session = get().session;
    if (!session) return;
    if (!session.battleHoldSelected()) return;
    set({ snapshot: session.snapshot() });
  },

  dismissBattle: () => {
    const session = get().session;
    if (!session) return;
    session.dismissBattle();
    set({ snapshot: session.snapshot() });
    get().focusCountryCamera(session.world.playerCountryId);
  },

  showToast: (text, tone = 'info') => {
    toastCounter += 1;
    set({ toast: { id: toastCounter, message: text, tone } });
    const id = toastCounter;
    window.setTimeout(() => {
      if (useAppStore.getState().toast?.id === id) set({ toast: null });
    }, 3800);
  },

  dismissToast: () => set({ toast: null }),
}));
