import type { MessageKey } from '../../i18n/locales/en';
import type { PlayerSnapshot, RegionView } from '../../game/types';
import { COUNTRY_BY_ID } from '../../data/countries';
import { localize } from '../../i18n/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';
import { Flag } from './Flag';

interface FoundBase {
  id: string;
  name: string;
  level: number;
  capacity: number;
  military: boolean;
  navalAccess: boolean;
  lon: number;
  lat: number;
  region: RegionView;
  kind: 'airport' | 'port';
}

const findBase = (
  snapshot: PlayerSnapshot,
  kind: 'airport' | 'port',
  id: string,
): FoundBase | null => {
  const regions = [snapshot.inspectedRegion, ...snapshot.regions].filter(
    (region): region is RegionView => Boolean(region),
  );
  for (const region of regions) {
    if (kind === 'airport') {
      const airport = region.airports.find((entry) => entry.id === id);
      if (airport) {
        return { ...airport, navalAccess: false, region, kind };
      }
    } else {
      const port = region.ports.find((entry) => entry.id === id);
      if (port) {
        return { ...port, military: port.navalAccess, region, kind };
      }
    }
  }
  return null;
};

/**
 * Airbase / naval base inspector.
 *
 * The 3D installation is already part of the world (runway, hangars, tower,
 * radar beacon, piers and cranes are procedural primitives). This card reports
 * the same strategic state the simulation uses and can drop the camera onto the
 * installation without leaving the globe.
 */
export function BaseDossier({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, locale, percent, n } = useI18n();
  const selectedBase = useAppStore((state) => state.selectedBase);
  const closeInspection = useAppStore((state) => state.closeInspection);
  const focusBaseCamera = useAppStore((state) => state.focusBaseCamera);
  const selected = selectedBase ? findBase(snapshot, selectedBase.kind, selectedBase.id) : null;

  if (!selected) return null;
  const region = selected.region;
  const country = COUNTRY_BY_ID[region.countryId];
  const countryName = country ? localize(country.name, locale) : region.ownerName;
  const status =
    region.damage > 0.6 ? 'disabled' : region.damage > 0.25 ? 'damaged' : 'operational';

  return (
    <aside className="inspector inspector--base">
      <div className="panel panel--dossier base-dossier">
        <button
          type="button"
          className="inspector__close"
          onClick={closeInspection}
          aria-label={tr('common.close')}
        >
          ×
        </button>

        <header className="base-dossier__header">
          <Flag iso2={country?.iso2 ?? null} seed={region.countryId} size={30} title={countryName} />
          <div>
            <span className="eyebrow">
              {selected.kind === 'airport' ? tr('base.airbase') : tr('base.navalBase')}
            </span>
            <h2>{selected.name}</h2>
            <span className="base-dossier__meta">
              {region.name} · {countryName}
            </span>
          </div>
          <span className={`chip chip--${status === 'operational' ? 'green' : 'danger'}`}>
            {tr(`base.status.${status}` as MessageKey)}
          </span>
        </header>

        <dl className="data-list">
          <div>
            <dt>{tr('base.level')}</dt>
            <dd>{n(selected.level)}</dd>
          </div>
          <div>
            <dt>{tr('base.capacity')}</dt>
            <dd>{n(selected.capacity)}</dd>
          </div>
          <div>
            <dt>{tr('base.usage')}</dt>
            <dd>
              {selected.kind === 'airport'
                ? selected.military
                  ? tr('base.military')
                  : tr('base.civilian')
                : selected.navalAccess
                  ? tr('base.naval')
                  : tr('base.civilian')}
            </dd>
          </div>
          <div>
            <dt>{tr('territory.infrastructure')}</dt>
            <dd>{percent(region.infrastructure)}</dd>
          </div>
          <div>
            <dt>{tr('base.regionalCapacity')}</dt>
            <dd>
              {percent(selected.kind === 'airport' ? region.airportCapacity : region.portCapacity)}
            </dd>
          </div>
          <div>
            <dt>{tr('territory.supply')}</dt>
            <dd>{percent(region.supplyLevel)}</dd>
          </div>
          <div>
            <dt>{tr('territory.damage')}</dt>
            <dd>{percent(region.damage)}</dd>
          </div>
        </dl>

        <div className="base-dossier__actions">
          <button
            type="button"
            className="btn btn--small btn--primary"
            onClick={() => focusBaseCamera(selected.kind, selected.id)}
          >
            {tr('base.approach')}
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={closeInspection}
          >
            {tr('common.close')}
          </button>
        </div>
        <p className="hint">{tr('base.hint')}</p>
      </div>
    </aside>
  );
}
