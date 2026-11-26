import type { PlayerSnapshot, CityView, RegionView } from '../../game/types';
import { COUNTRY_BY_ID } from '../../data/countries';
import { localize } from '../../i18n/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';
import { Flag } from './Flag';

interface FoundCity {
  city: CityView;
  region: RegionView;
}

const findCity = (snapshot: PlayerSnapshot, cityId: string): FoundCity | null => {
  const regions = [snapshot.inspectedRegion, ...snapshot.regions].filter(
    (region): region is RegionView => Boolean(region),
  );
  for (const region of regions) {
    const city = region.cities.find((entry) => entry.id === cityId);
    if (city) return { city, region };
  }
  return null;
};

/**
 * City view dossier.
 *
 * Selecting a city in the province inspector opens this card and flying to the
 * city moves the same world camera down to street level, where the procedural
 * blocks, roads and landmark tower are already rendered. The city is never a
 * separate scene: it is the same strategic world, closer.
 */
export function CityDossier({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, locale, compact, percent, n } = useI18n();
  const selectedCityId = useAppStore((state) => state.selectedCityId);
  const selectCity = useAppStore((state) => state.selectCity);
  const focusCityCamera = useAppStore((state) => state.focusCityCamera);
  const selected = selectedCityId ? findCity(snapshot, selectedCityId) : null;

  if (!selected) return null;
  const { city, region } = selected;
  const country = COUNTRY_BY_ID[region.countryId];
  const countryName = country ? localize(country.name, locale) : region.ownerName;

  return (
    <aside className="inspector inspector--city">
      <div className="panel panel--dossier city-dossier">
        <button
          type="button"
          className="inspector__close"
          onClick={() => selectCity(null)}
          aria-label={tr('common.close')}
        >
          ×
        </button>

        <header className="city-dossier__header">
          <Flag iso2={country?.iso2 ?? null} seed={region.countryId} size={30} title={countryName} />
          <div>
            <span className="eyebrow">{tr('city.title')}</span>
            <h2>{city.name}</h2>
            <span className="city-dossier__meta">
              {region.name} · {countryName}
            </span>
          </div>
          {city.isCapital && <span className="chip chip--gold">{tr('territory.capital')}</span>}
        </header>

        <dl className="data-list">
          <div>
            <dt>{tr('territory.population')}</dt>
            <dd>{compact(city.population)}</dd>
          </div>
          <div>
            <dt>{tr('city.strategic')}</dt>
            <dd>{percent(city.strategicValue)}</dd>
          </div>
          <div>
            <dt>{tr('city.industry')}</dt>
            <dd>{percent(city.industrialValue)}</dd>
          </div>
          <div>
            <dt>{tr('city.development')}</dt>
            <dd>{percent(city.development)}</dd>
          </div>
          <div>
            <dt>{tr('territory.airport')}</dt>
            <dd>{city.hasAirport ? tr('common.active') : '—'}</dd>
          </div>
          <div>
            <dt>{tr('territory.port')}</dt>
            <dd>{city.hasPort ? tr('common.active') : '—'}</dd>
          </div>
          <div>
            <dt>{tr('territory.infrastructure')}</dt>
            <dd>{percent(region.infrastructure)}</dd>
          </div>
          <div>
            <dt>{tr('territory.armies')}</dt>
            <dd>{n(region.armies.reduce((total, army) => total + army.units, 0))}</dd>
          </div>
        </dl>

        <div className="city-dossier__actions">
          <button
            type="button"
            className="btn btn--small btn--primary"
            onClick={() => focusCityCamera(city.id)}
          >
            {tr('city.approach')}
          </button>
        </div>
        <p className="hint">{tr('city.hint')}</p>
      </div>
    </aside>
  );
}
