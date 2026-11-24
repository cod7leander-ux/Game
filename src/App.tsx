import { useEffect, useMemo } from 'react';
import { WorldStage, type StageLabel } from './ui/components/WorldStage';
import { LanguageGate } from './ui/screens/LanguageGate';
import { MainMenu } from './ui/screens/MainMenu';
import { NationSelect } from './ui/screens/NationSelect';
import { GameShell } from './ui/screens/GameShell';
import { ToastHost } from './ui/components/ToastHost';
import { GameDialogs } from './ui/components/GameDialogs';
import { useAppStore } from './state/appStore';
import { useSettingsStore } from './state/settingsStore';
import { getLocaleDefinition } from './i18n/types';
import { COUNTRY_BY_ID } from './data/countries';
import { localize } from './i18n/types';
import { capitalOf } from './data/cities';
import { useI18n } from './ui/hooks/useI18n';

export function App() {
  const phase = useAppStore((state) => state.phase);
  const selectedCountryId = useAppStore((state) => state.selectedCountryId);
  const hoveredCountryId = useAppStore((state) => state.hoveredCountryId);
  const session = useAppStore((state) => state.session);
  const mapArmies = useAppStore((state) => state.snapshot?.mapArmies);
  const mapRegions = useAppStore((state) => state.snapshot?.mapRegions);
  const mapLayer = useAppStore((state) => state.mapLayer);
  const selectedRegionId = useAppStore((state) => state.selectedRegionId);
  const selectRegion = useAppStore((state) => state.selectRegion);
  const setPanelTab = useAppStore((state) => state.setPanelTab);
  const regionFocus = useAppStore((state) => state.regionFocus);
  const mapUnits = useAppStore((state) => state.snapshot?.mapUnits);
  const battleUnits = useAppStore((state) => state.snapshot?.battleUnits);
  const projectiles = useAppStore((state) => state.snapshot?.battle?.projectiles);
  const battleFocus = useAppStore((state) => state.battleFocus);
  const armyFocus = useAppStore((state) => state.armyFocus);
  const selectUnit = useAppStore((state) => state.selectUnit);
  const locale = useSettingsStore((state) => state.locale);
  const languageChosen = useSettingsStore((state) => state.languageChosen);
  const { t: tr } = useI18n();

  useEffect(() => {
    const definition = getLocaleDefinition(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = definition.dir;
    document.title = `${tr('app.name')} · ${tr('app.tagline')}`;
  }, [locale, tr]);

  const units = battleUnits && battleUnits.length > 0 ? battleUnits : (mapUnits ?? []);

  const labels = useMemo<StageLabel[]>(() => {
    const out: StageLabel[] = [];
    const push = (countryId: string | null, tone: StageLabel['tone']) => {
      if (!countryId) return;
      const definition = COUNTRY_BY_ID[countryId];
      if (!definition) return;
      const city = capitalOf(countryId);
      out.push({
        id: `country-${countryId}-${tone}`,
        lon: definition.label[0],
        lat: definition.label[1],
        title: localize(definition.name, locale),
        subtitle: city ? localize(city.name, locale) : undefined,
        tone,
      });
    };

    if (phase === 'game' && session) {
      const player = session.world.playerCountryId;
      push(player, 'green');
      if (selectedCountryId && selectedCountryId !== player) push(selectedCountryId, 'gold');
      const region = selectedRegionId
        ? mapRegions?.find((entry) => entry.id === selectedRegionId)
        : undefined;
      if (region) {
        out.push({
          id: `region-${region.id}`,
          lon: region.lon,
          lat: region.lat,
          title: region.name,
          subtitle: region.ownerName,
          tone: 'cyan',
        });
      }
    } else {
      push(hoveredCountryId, 'cyan');
      if (selectedCountryId !== hoveredCountryId) push(selectedCountryId, 'gold');
    }
    return out;
  }, [phase, session, selectedCountryId, hoveredCountryId, selectedRegionId, mapRegions, locale]);

  return (
    <div className="app-shell" data-phase={phase}>
      <WorldStage
        interactive={phase !== 'menu'}
        autoRotate={phase === 'menu' ? 0.035 : 0}
        labels={labels}
        armies={phase === 'game' ? mapArmies : undefined}
        mapRegions={phase === 'game' ? mapRegions : undefined}
        mapLayer={mapLayer}
        selectedRegionId={selectedRegionId}
        regionFocus={regionFocus}
        onRegionClick={(regionId, countryId) => {
          if (phase !== 'game') return;
          selectRegion(regionId);
          if (countryId) useAppStore.getState().selectCountry(countryId, false);
          setPanelTab('territory');
        }}
        units={phase === 'game' ? units : undefined}
        projectiles={phase === 'game' ? projectiles : undefined}
        battleFocus={battleFocus}
        armyFocus={armyFocus}
        onUnitClick={(unitId) => {
          if (phase !== 'game') return;
          if (unitId) selectUnit(unitId);
        }}
      />
      <div className="app-shell__screens">
        {!languageChosen && <LanguageGate />}
        {languageChosen && phase === 'menu' && <MainMenu />}
        {languageChosen && phase === 'nation' && <NationSelect />}
        {languageChosen && phase === 'game' && <GameShell />}
      </div>
      <GameDialogs />
      <ToastHost />
    </div>
  );
}
