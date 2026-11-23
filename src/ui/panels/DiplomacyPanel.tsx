import type { MessageKey } from '../../i18n/locales/en';
import type { PlayerSnapshot, DiplomacyView } from '../../game/types';
import type { RelationStatus } from '../../gameplay/diplomacy/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';
import { Flag } from '../components/Flag';

const STATUS_KEY: Record<RelationStatus, MessageKey> = {
  war: 'diplomacy.status.war',
  hostile: 'diplomacy.status.hostile',
  strained: 'diplomacy.status.strained',
  neutral: 'diplomacy.status.neutral',
  friendly: 'diplomacy.status.friendly',
  ally: 'diplomacy.status.ally',
};

export function DiplomacyPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, signed } = useI18n();
  const selectCountry = useAppStore((state) => state.selectCountry);
  const focusCountryCamera = useAppStore((state) => state.focusCountryCamera);
  const declareWar = useAppStore((state) => state.declareWar);
  const makePeace = useAppStore((state) => state.makePeace);
  const improveRelations = useAppStore((state) => state.improveRelations);
  const formNonAggression = useAppStore((state) => state.formNonAggression);
  const imposeEmbargo = useAppStore((state) => state.imposeEmbargo);
  const liftEmbargo = useAppStore((state) => state.liftEmbargo);
  const wars = snapshot.diplomacy.filter((entry) => entry.atWar);
  const allies = snapshot.diplomacy.filter((entry) => entry.ally);
  const trade = snapshot.diplomacy.filter((entry) => entry.trade);

  const inspect = (entry: DiplomacyView) => {
    selectCountry(entry.id);
    focusCountryCamera(entry.id);
  };

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.diplomacy')}</span>
          <h2>{tr('diplomacy.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('diplomacy.relations')}</span>
          <strong>{n(snapshot.diplomacy.length)}</strong>
        </div>
      </header>

      <div className="diplomacy-summary">
        <div>
          <span>{tr('diplomacy.wars')}</span>
          <strong className={wars.length > 0 ? 'is-negative' : ''}>{n(wars.length)}</strong>
        </div>
        <div>
          <span>{tr('diplomacy.allies')}</span>
          <strong className={allies.length > 0 ? 'is-positive' : ''}>{n(allies.length)}</strong>
        </div>
        <div>
          <span>{tr('diplomacy.trade')}</span>
          <strong>{n(trade.length)}</strong>
        </div>
      </div>

      <p className="hint">{tr('diplomacy.subtitle')}</p>

      <div className="diplomacy-list">
        {snapshot.diplomacy.map((entry) => {
          const width = Math.max(2, Math.min(100, (entry.value + 100) / 2));
          return (
            <div key={entry.id} className={`diplomacy-row status-${entry.status}`}>
              <button type="button" className="diplomacy-row__main" onClick={() => inspect(entry)}>
                <Flag iso2={entry.iso2} seed={entry.id} size={22} title={entry.name} />
                <span className="diplomacy-row__name">{entry.name}</span>
                <span className={`chip chip--status status-${entry.status}`}>
                  {tr(STATUS_KEY[entry.status])}
                </span>
                <span className="diplomacy-row__meter">
                  <span style={{ width: `${width}%` }} />
                </span>
                <span className={`diplomacy-row__value ${entry.value >= 0 ? 'is-positive' : 'is-negative'}`}>
                  {signed(entry.value)}
                </span>
              </button>
              <div className="diplomacy-row__tags">
                {entry.nonAggression && <span className="chip chip--muted">{tr('diplomacy.pact')}</span>}
                {entry.militaryAccess && <span className="chip chip--muted">{tr('diplomacy.access')}</span>}
                {entry.embargo && <span className="chip chip--danger">{tr('diplomacy.embargo')}</span>}
                {entry.sanctioned && <span className="chip chip--danger">{tr('diplomacy.sanctioned')}</span>}
                <span className="chip">
                  {tr('diplomacy.trust')} {signed(Math.round(entry.trust))}
                </span>
                <span className="chip">
                  {tr('diplomacy.threat')} {n(Math.round(entry.threat))}
                </span>
              </div>
              <div className="diplomacy-row__actions">
                {(entry.canMakePeace || entry.canDeclareWar) && (
                  <button
                    type="button"
                    className={`btn btn--small ${entry.canMakePeace ? '' : 'btn--danger'}`}
                    onClick={() => (entry.canMakePeace ? makePeace(entry.id) : declareWar(entry.id))}
                  >
                    {tr(entry.canMakePeace ? 'diplomacy.action.peace' : 'diplomacy.action.war')}
                  </button>
                )}
                {!entry.atWar && (
                  <>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => improveRelations(entry.id)}
                    >
                      {tr('diplomacy.action.improve')}
                    </button>
                    {!entry.ally && !entry.nonAggression && (
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => formNonAggression(entry.id)}
                      >
                        {tr('diplomacy.action.nonAggression')}
                      </button>
                    )}
                    {entry.embargo ? (
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => liftEmbargo(entry.id)}
                      >
                        {tr('diplomacy.action.improve')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => imposeEmbargo(entry.id)}
                      >
                        {tr('diplomacy.action.embargo')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        {snapshot.diplomacy.length === 0 && <p className="muted">{tr('diplomacy.noRelations')}</p>}
      </div>


    </div>
  );
}
