import type { PlayerSnapshot } from '../../game/types';
import { useAppStore, type PanelTab } from '../../state/appStore';
import type { MessageKey } from '../../i18n/locales/en';
import { useI18n } from '../hooks/useI18n';
import { OverviewPanel } from '../panels/OverviewPanel';
import { EconomyPanel } from '../panels/EconomyPanel';
import { ResearchPanel } from '../panels/ResearchPanel';
import { MilitaryPanel } from '../panels/MilitaryPanel';
import { DiplomacyPanel } from '../panels/DiplomacyPanel';

const TABS: Array<{ id: PanelTab; labelKey: MessageKey; glyph: string }> = [
  { id: 'overview', labelKey: 'panel.overview', glyph: '◈' },
  { id: 'economy', labelKey: 'panel.economy', glyph: '⛁' },
  { id: 'research', labelKey: 'panel.research', glyph: '⌬' },
  { id: 'military', labelKey: 'panel.military', glyph: '⚔' },
  { id: 'diplomacy', labelKey: 'panel.diplomacy', glyph: '✧' },
];

interface SidePanelProps {
  snapshot: PlayerSnapshot;
}

export function SidePanel({ snapshot }: SidePanelProps) {
  const { t: tr } = useI18n();
  const tab = useAppStore((state) => state.panelTab);
  const setPanelTab = useAppStore((state) => state.setPanelTab);

  return (
    <aside className="panel side-panel">
      <nav className="side-panel__tabs" aria-label={tr('panel.overview')}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? 'is-active' : ''}
            onClick={() => setPanelTab(entry.id)}
            title={tr(entry.labelKey)}
          >
            <span className="side-panel__glyph" aria-hidden="true">
              {entry.glyph}
            </span>
            <span className="side-panel__label">{tr(entry.labelKey)}</span>
          </button>
        ))}
      </nav>
      <div className="side-panel__body">
        {tab === 'overview' && <OverviewPanel snapshot={snapshot} />}
        {tab === 'economy' && <EconomyPanel snapshot={snapshot} />}
        {tab === 'research' && <ResearchPanel snapshot={snapshot} />}
        {tab === 'military' && <MilitaryPanel snapshot={snapshot} />}
        {tab === 'diplomacy' && <DiplomacyPanel snapshot={snapshot} />}
      </div>
    </aside>
  );
}
