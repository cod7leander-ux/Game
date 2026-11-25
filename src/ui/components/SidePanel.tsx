import type { PlayerSnapshot } from '../../game/types';
import { useAppStore, type PanelTab } from '../../state/appStore';
import type { MessageKey } from '../../i18n/locales/en';
import { useI18n } from '../hooks/useI18n';
import { OverviewPanel } from '../panels/OverviewPanel';
import { EconomyPanel } from '../panels/EconomyPanel';
import { ResearchPanel } from '../panels/ResearchPanel';
import { MilitaryPanel } from '../panels/MilitaryPanel';
import { DiplomacyPanel } from '../panels/DiplomacyPanel';
import { ProductionPanel } from '../panels/ProductionPanel';
import { LogisticsPanel } from '../panels/LogisticsPanel';
import { SocietyPanel } from '../panels/SocietyPanel';
import { TradePanel } from '../panels/TradePanel';
import { IntelPanel } from '../panels/IntelPanel';
import { PoliciesPanel } from '../panels/PoliciesPanel';
import { TerritoryPanel } from '../panels/TerritoryPanel';
import { WarPanel } from '../panels/WarPanel';

const TABS: Array<{ id: PanelTab; labelKey: MessageKey; glyph: string }> = [
  { id: 'overview', labelKey: 'panel.overview', glyph: '◈' },
  { id: 'economy', labelKey: 'panel.economy', glyph: '⛁' },
  { id: 'society', labelKey: 'panel.society', glyph: '👥' },
  { id: 'production', labelKey: 'panel.production', glyph: '⚙' },
  { id: 'research', labelKey: 'panel.research', glyph: '⌬' },
  { id: 'military', labelKey: 'panel.military', glyph: '⚔' },
  { id: 'diplomacy', labelKey: 'panel.diplomacy', glyph: '✧' },
  { id: 'trade', labelKey: 'panel.trade', glyph: '⇄' },
  { id: 'logistics', labelKey: 'panel.logistics', glyph: '⛟' },
  { id: 'intel', labelKey: 'panel.intel', glyph: '◉' },
  { id: 'policies', labelKey: 'panel.policies', glyph: '§' },
  { id: 'territory', labelKey: 'panel.territory', glyph: '▦' },
  { id: 'war', labelKey: 'panel.war', glyph: '⚑' },
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
        {tab === 'society' && <SocietyPanel snapshot={snapshot} />}
        {tab === 'production' && <ProductionPanel snapshot={snapshot} />}
        {tab === 'research' && <ResearchPanel snapshot={snapshot} />}
        {tab === 'military' && <MilitaryPanel snapshot={snapshot} />}
        {tab === 'diplomacy' && <DiplomacyPanel snapshot={snapshot} />}
        {tab === 'trade' && <TradePanel snapshot={snapshot} />}
        {tab === 'logistics' && <LogisticsPanel snapshot={snapshot} />}
        {tab === 'intel' && <IntelPanel snapshot={snapshot} />}
        {tab === 'policies' && <PoliciesPanel snapshot={snapshot} />}
        {tab === 'territory' && <TerritoryPanel snapshot={snapshot} />}
        {tab === 'war' && <WarPanel snapshot={snapshot} />}
      </div>
    </aside>
  );
}
