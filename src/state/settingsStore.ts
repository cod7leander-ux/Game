import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { QualityPreset } from '../core/config';
import { DEFAULT_LOCALE, isLocaleCode, type LocaleCode } from '../i18n/types';
import type { CampaignDifficulty } from '../game/types';

export type GraphicsSetting = 'auto' | QualityPreset;
export type PanelSide = 'left' | 'right';

interface SettingsState {
  locale: LocaleCode;
  graphics: GraphicsSetting;
  persianNumerals: boolean;
  cityMarkers: boolean;
  panelSide: PanelSide;
  /** 0..1 interface sound level. */
  volume: number;
  /** 0.85..1.25 interface scale. */
  uiScale: number;
  notifications: boolean;
  autosave: boolean;
  defaultDifficulty: CampaignDifficulty;
  /** True once the player has made an explicit language choice. */
  languageChosen: boolean;
  setLocale: (locale: LocaleCode) => void;
  setGraphics: (graphics: GraphicsSetting) => void;
  setPersianNumerals: (enabled: boolean) => void;
  setCityMarkers: (enabled: boolean) => void;
  setPanelSide: (side: PanelSide) => void;
  setVolume: (volume: number) => void;
  setUiScale: (scale: number) => void;
  setNotifications: (enabled: boolean) => void;
  setAutosave: (enabled: boolean) => void;
  setDefaultDifficulty: (difficulty: CampaignDifficulty) => void;
  reset: () => void;
}

const defaults = {
  locale: DEFAULT_LOCALE,
  graphics: 'auto' as GraphicsSetting,
  persianNumerals: true,
  cityMarkers: true,
  panelSide: 'left' as PanelSide,
  volume: 0.6,
  uiScale: 1,
  notifications: true,
  autosave: true,
  defaultDifficulty: 'standard' as CampaignDifficulty,
  languageChosen: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      setLocale: (locale) => {
        if (!isLocaleCode(locale)) return;
        set({ locale, languageChosen: true });
      },
      setGraphics: (graphics) => set({ graphics }),
      setPersianNumerals: (persianNumerals) => set({ persianNumerals }),
      setCityMarkers: (cityMarkers) => set({ cityMarkers }),
      setPanelSide: (panelSide) => set({ panelSide }),
      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
      setUiScale: (scale) => set({ uiScale: Math.max(0.85, Math.min(1.25, scale)) }),
      setNotifications: (notifications) => set({ notifications }),
      setAutosave: (autosave) => set({ autosave }),
      setDefaultDifficulty: (defaultDifficulty) => set({ defaultDifficulty }),
      reset: () => set({ ...defaults, languageChosen: true }),
    }),
    {
      name: 'terra-dominion:settings',
      version: 1,
      partialize: (state) => ({
        locale: state.locale,
        graphics: state.graphics,
        persianNumerals: state.persianNumerals,
        cityMarkers: state.cityMarkers,
        panelSide: state.panelSide,
        volume: state.volume,
        uiScale: state.uiScale,
        notifications: state.notifications,
        autosave: state.autosave,
        defaultDifficulty: state.defaultDifficulty,
        languageChosen: state.languageChosen,
      }),
    },
  ),
);

/**
 * Software rasterisers (SwiftShader, llvmpipe, remote desktops) report plenty of
 * CPU cores, so core count alone would pick a preset that renders at a few
 * frames per second. Detect them once and drop to the low preset.
 */
let softwareRenderer: boolean | null = null;

const usesSoftwareRenderer = (): boolean => {
  if (softwareRenderer !== null) return softwareRenderer;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) {
      softwareRenderer = true;
      return true;
    }
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const name = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : '';
    softwareRenderer = /swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch {
    softwareRenderer = false;
  }
  return softwareRenderer;
};

/** Resolves the automatic graphics preset from device capability. */
export const resolveQuality = (setting: GraphicsSetting): QualityPreset => {
  if (setting !== 'auto') return setting;
  if (usesSoftwareRenderer()) return 'low';
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (cores >= 8 && memory >= 8) return 'high';
  if (cores >= 4) return 'balanced';
  return 'low';
};
