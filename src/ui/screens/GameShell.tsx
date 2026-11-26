import { useEffect, useRef } from 'react';
import { useAppStore } from '../../state/appStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useI18n } from '../hooks/useI18n';
import { TopBar } from '../components/TopBar';
import { SidePanel } from '../components/SidePanel';
import { CountryDossier } from '../components/CountryDossier';
import { MapLayerBar } from '../components/MapLayerBar';
import { NotificationsDrawer } from '../components/NotificationsDrawer';
import { BattleHud } from '../components/BattleHud';
import { DirectControlHud } from '../components/DirectControlHud';
import { WorldUnitHud } from '../components/WorldUnitHud';
import { StrategicMap } from '../components/StrategicMap';
import { CityDossier } from '../components/CityDossier';
import { BaseDossier } from '../components/BaseDossier';
import { relationStatusOf } from '../components/relation-utils';

export function GameShell() {
  const { t: tr } = useI18n();
  const snapshot = useAppStore((state) => state.snapshot);
  const session = useAppStore((state) => state.session);
  const panelOpen = useAppStore((state) => state.panelOpen);
  const togglePanel = useAppStore((state) => state.togglePanel);
  const panelSide = useSettingsStore((state) => state.panelSide);
  const showNotifications = useSettingsStore((state) => state.notifications);
  const selectedCountryId = useAppStore((state) => state.selectedCountryId);
  const selectedRegionId = useAppStore((state) => state.selectedRegionId);
  const selectedCityId = useAppStore((state) => state.selectedCityId);
  const selectedBase = useAppStore((state) => state.selectedBase);
  const brief = useAppStore((state) => state.inspectedBrief);
  const openDialog = useAppStore((state) => state.openDialog);
  const togglePause = useAppStore((state) => state.togglePause);
  const setSpeed = useAppStore((state) => state.setSpeed);
  const selectCountry = useAppStore((state) => state.selectCountry);
  const focusBattleCamera = useAppStore((state) => state.focusBattleCamera);
  const battle = snapshot?.battle ?? null;
  const lastBattleId = useRef<string | null>(null);

  // New engagement: move the existing camera down the ladder to the battlefield.
  useEffect(() => {
    if (!battle) {
      lastBattleId.current = null;
      return;
    }
    if (lastBattleId.current === battle.id) return;
    lastBattleId.current = battle.id;
    focusBattleCamera(battle.lon, battle.lat);
  }, [battle, focusBattleCamera]);

  // Fixed-step simulation driven by the browser clock.
  useEffect(() => {
    let handle = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const delta = Math.min(400, now - last);
      last = now;
      useAppStore.getState().tick(delta);
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, []);

  // Keyboard: space pauses, 1/2/3 set speed, Escape opens the pause menu.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      // Direct control owns the keyboard while a unit is under manual control.
      if (useAppStore.getState().snapshot?.direct) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePause();
      } else if (event.key === '1') setSpeed(1);
      else if (event.key === '2') setSpeed(2);
      else if (event.key === '3') setSpeed(4);
      else if (event.key === 'Escape') {
        if (useAppStore.getState().dialog === 'none') openDialog('pause');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePause, setSpeed, openDialog]);

  if (!snapshot || !session) {
    return (
      <div className="game-shell game-shell--empty">
        <div className="panel">{tr('common.loading')}</div>
      </div>
    );
  }

  const playerId = snapshot.country.id;
  const inspectingOther = brief && selectedCountryId && selectedCountryId !== playerId;
  const relation = inspectingOther && snapshot.diplomacy.find((entry) => entry.id === brief.definition.id);
  const relationSummary =
    relation && brief ? relationStatusOf(relation) : undefined;

  return (
    <div className="game-shell" data-panel-side={panelSide}>
      <TopBar snapshot={snapshot} />

      <div className={`game-shell__panel-wrap game-shell__panel-wrap--${panelSide} ${panelOpen ? 'is-open' : ''}`}>
        <SidePanel snapshot={snapshot} />
        <button
          type="button"
          className="panel-toggle"
          onClick={togglePanel}
          title={tr(panelOpen ? 'panel.collapse' : 'panel.expand')}
          aria-label={tr(panelOpen ? 'panel.collapse' : 'panel.expand')}
        >
          {panelOpen ? '‹' : '›'}
        </button>
      </div>

      {!snapshot.direct && <CityDossier snapshot={snapshot} />}
      {!snapshot.direct && <BaseDossier snapshot={snapshot} />}

      {inspectingOther && brief && !snapshot.direct && !selectedCityId && !selectedBase && (
        <aside className={`inspector ${panelSide === 'left' ? 'inspector--right' : 'inspector--left'}`}>
          <div className="panel panel--dossier">
            <button
              type="button"
              className="inspector__close"
              onClick={() => selectCountry(null)}
              aria-label={tr('common.close')}
            >
              ×
            </button>
            <CountryDossier brief={brief} relation={relationSummary} compactHeader />
            <p className="dossier__hint">{tr('country.viewBrief')}</p>
          </div>
        </aside>
      )}

      <MapLayerBar />

      <StrategicMap
        snapshot={snapshot}
        selectedRegionId={selectedRegionId}
        hidden={Boolean(snapshot.direct)}
      />

      <div className="game-shell__hint panel">
        <span>{tr('hud.zoomHint')}</span>
        <span className="game-shell__hint-divider" />
        <span>{snapshot.dateLabel}</span>
      </div>

      <WorldUnitHud snapshot={snapshot} />
      {snapshot.direct ? (
        <DirectControlHud direct={snapshot.direct} />
      ) : (
        <BattleHud snapshot={snapshot} />
      )}
      {showNotifications && <NotificationsDrawer />}
    </div>
  );
}
