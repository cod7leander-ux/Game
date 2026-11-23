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
  const locale = useSettingsStore((state) => state.locale);
  const languageChosen = useSettingsStore((state) => state.languageChosen);
  const { t: tr } = useI18n();

  useEffect(() => {
    const definition = getLocaleDefinition(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = definition.dir;
    document.title = `${tr('app.name')} · ${tr('app.tagline')}`;
  }, [locale, tr]);

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
    } else {
      push(hoveredCountryId, 'cyan');
      if (selectedCountryId !== hoveredCountryId) push(selectedCountryId, 'gold');
    }
    return out;
  }, [phase, session, selectedCountryId, hoveredCountryId, locale]);

  return (
    <div className="app-shell" data-phase={phase}>
      <WorldStage
        interactive={phase !== 'menu'}
        autoRotate={phase === 'menu' ? 0.035 : 0}
        labels={labels}
        armies={phase === 'game' ? mapArmies : undefined}
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
