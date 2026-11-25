import type { PlayerSnapshot } from '../../game/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

/**
 * Population, manpower and regional industry. Regional cards expose the
 * industrial base that construction, trade and recruitment all draw from.
 */
export function SocietyPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, compact, percent, decimal } = useI18n();
  const setMobilization = useAppStore((state) => state.setMobilization);
  const society = snapshot.society;
  const regional = society.regions;
  const civilian = regional.reduce((sum, region) => sum + region.civilianIndustry, 0) / Math.max(1, regional.length);
  const military = regional.reduce((sum, region) => sum + region.militaryIndustry, 0) / Math.max(1, regional.length);
  const construction = regional.reduce((sum, region) => sum + region.constructionCapacity, 0) / Math.max(1, regional.length);
  const development = regional.reduce((sum, region) => sum + region.development, 0) / Math.max(1, regional.length);

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.society')}</span>
          <h2>{tr('society.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('society.population')}</span>
          <strong>{compact(society.population)}</strong>
        </div>
      </header>

      <p className="hint">{tr('society.subtitle')}</p>

      <div className="metric-grid">
        <div className="metric">
          <span>{tr('society.working')}</span>
          <strong>{compact(society.workingPopulation)}</strong>
        </div>
        <div className="metric">
          <span>{tr('society.militaryAge')}</span>
          <strong>{compact(society.militaryAgePopulation)}</strong>
        </div>
        <div className="metric">
          <span>{tr('society.manpowerPool')}</span>
          <strong>{compact(society.manpowerPool * 1000)}</strong>
        </div>
        <div className="metric">
          <span>{tr('society.mobilized')}</span>
          <strong>{compact(society.mobilized * 1000)}</strong>
        </div>
        <div className="metric">
          <span>{tr('society.pressure')}</span>
          <strong className={society.recruitmentPressure > 0.65 ? 'is-negative' : ''}>
            {percent(society.recruitmentPressure)}
          </strong>
        </div>
        <div className="metric">
          <span>{tr('society.casualties')}</span>
          <strong>{n(Math.round(society.casualties))}k</strong>
        </div>
      </div>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('society.mobilization')}</h3>
          <span className="count">{percent(society.mobilization)}</span>
        </header>
        <label className="allocation__row">
          <span>{tr('society.mobilization')}</span>
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round(society.mobilization * 100)}
            onChange={(event) => setMobilization(Number(event.target.value) / 100)}
          />
          <em>{percent(society.mobilization)}</em>
        </label>
        <p className="hint">{tr('society.mobilizationHint')}</p>
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('society.industry')}</h3>
        </header>
        <div className="metric-grid">
          <div className="metric">
            <span>{tr('industry.civilian')}</span>
            <strong>{percent(civilian)}</strong>
          </div>
          <div className="metric">
            <span>{tr('industry.military')}</span>
            <strong>{percent(military)}</strong>
          </div>
          <div className="metric">
            <span>{tr('industry.construction')}</span>
            <strong>{decimal(construction, 2)}</strong>
          </div>
          <div className="metric">
            <span>{tr('industry.development')}</span>
            <strong>{percent(development)}</strong>
          </div>
        </div>
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('society.regions')}</h3>
          <span className="count">{n(regional.length)}</span>
        </header>
        <ul className="stack-list">
          {regional.map((region) => (
            <li key={region.id}>
              <div className="stack-list__row">
                <strong>{region.name}</strong>
                <span>{compact(region.population)}</span>
              </div>
              <div className="meter-row">
                <span>{tr('society.militaryAge')}</span>
                <div className="meter meter--cyan">
                  <span
                    style={{
                      width: `${Math.round((region.militaryAgePopulation / Math.max(1, region.population)) * 100)}%`,
                    }}
                  />
                </div>
                <em>{compact(region.militaryAgePopulation)}</em>
              </div>
              <span className="muted">
                {tr('industry.civilian')} {percent(region.civilianIndustry)} ·{' '}
                {tr('industry.military')} {percent(region.militaryIndustry)} ·{' '}
                {tr('industry.construction')} {percent(region.constructionCapacity)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
