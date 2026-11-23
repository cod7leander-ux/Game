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
            <button
              key={entry.id}
              type="button"
              className={`diplomacy-row status-${entry.status}`}
              onClick={() => inspect(entry)}
            >
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
          );
        })}
        {snapshot.diplomacy.length === 0 && <p className="muted">{tr('diplomacy.noRelations')}</p>}
      </div>

      <div className="locked-note">
        <span className="locked-note__glyph" aria-hidden="true">
          ⚿
        </span>
        {tr('diplomacy.actionsLocked')}
      </div>
    </div>
  );
}
