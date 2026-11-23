import { create } from 'zustand';
import { GameSession } from '../game/GameSession';
import { previewCountry } from '../game/preview';
import type { CountryBrief, CampaignDifficulty, PlayerSnapshot } from '../game/types';
import { saveManager } from '../save/SaveManager';
import type { SaveSlotId, SaveSummary } from '../save/types';
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
export type PanelTab = 'overview' | 'economy' | 'research' | 'military' | 'diplomacy';
export type DialogId = 'none' | 'save' | 'load' | 'settings' | 'pause' | 'leave';

export interface CameraFocusRequest {
  countryId: string;
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
  inspectedBrief: CountryBrief | null;
  session: GameSession | null;
  snapshot: PlayerSnapshot | null;
  saves: SaveSummary[];
  savesLoaded: boolean;
  busy: boolean;
  toast: Toast | null;
  cameraFocus: CameraFocusRequest | null;
  pausedFromSpeed: 1 | 2 | 4;

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
  hoverCountry: (countryId: string | null) => void;
  focusCountryCamera: (countryId: string) => void;

  startCampaign: (countryId: string, difficulty: CampaignDifficulty) => void;
  returnToMenu: () => void;
  refreshSaves: () => Promise<void>;
  continueLatest: () => Promise<void>;
  saveToSlot: (slot: SaveSlotId, silent?: boolean) => Promise<void>;
  loadFromSlot: (slot: SaveSlotId) => Promise<void>;
  deleteSlot: (slot: SaveSlotId) => Promise<void>;
  importSaveText: (text: string) => Promise<void>;
  exportSlot: (slot: SaveSlotId) => Promise<void>;

  tick: (deltaMs: number) => void;
  syncSnapshot: () => void;
  setSpeed: (speed: 0 | 1 | 2 | 4) => void;
  togglePause: () => void;
  startResearch: (techId: string) => void;
  queueUnit: (unitId: string) => void;
  marchArmy: (armyId: string, targetId: string) => void;
  declareWar: (targetId: string) => void;
  makePeace: (targetId: string) => void;

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
  inspectedBrief: null,
  session: null,
  snapshot: null,
  saves: [],
  savesLoaded: false,
  busy: false,
  toast: null,
  cameraFocus: null,
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

  hoverCountry: (hoveredCountryId) => set({ hoveredCountryId }),

  focusCountryCamera: (countryId) =>
    set({ cameraFocus: { countryId, nonce: Date.now() + Math.random() } }),

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

  saveToSlot: async (slot, silent = false) => {
    const session = get().session;
    if (!session) return;
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
    if (session.consumeAutoSaveFlag()) {
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
