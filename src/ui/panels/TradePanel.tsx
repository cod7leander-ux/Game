import { useState } from 'react';
import type { PlayerSnapshot } from '../../game/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

/**
 * Trade and market panel. Routes are real transfers between national
 * stockpiles, not a separate abstract economy.
 */
export function TradePanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, compact, percent, decimal } = useI18n();
  const trade = snapshot.trade;
  const establish = useAppStore((state) => state.establishTradeRoute);
  const cancel = useAppStore((state) => state.cancelTradeRoute);
  const openTradeAgreement = useAppStore((state) => state.openTradeAgreement);
  const partners = trade.partners.filter((entry) => !entry.atWar);
  const [partnerId, setPartnerId] = useState(partners.find((entry) => entry.agreed)?.id ?? partners[0]?.id ?? '');
  const [resource, setResource] = useState('oil');
  const [amount, setAmount] = useState(2);
  const [contract, setContract] = useState(false);
  const selectedPartner = trade.partners.find((entry) => entry.id === partnerId);

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.trade')}</span>
          <h2>{tr('trade.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('trade.volume')}</span>
          <strong>{compact(trade.volume)}</strong>
        </div>
      </header>

      <p className="hint">{tr('trade.subtitle')}</p>

      <div className="metric-grid">
        <div className="metric">
          <span>{tr('trade.income')}</span>
          <strong className="is-positive">+{n(Math.round(trade.income))}</strong>
        </div>
        <div className="metric">
          <span>{tr('trade.expenses')}</span>
          <strong className="is-negative">−{n(Math.round(trade.expenses))}</strong>
        </div>
        <div className="metric">
          <span>{tr('trade.disruption')}</span>
          <strong className={trade.disruption > 0.35 ? 'is-negative' : ''}>
            {percent(trade.disruption)}
          </strong>
        </div>
        <div className="metric">
          <span>{tr('trade.routes')}</span>
          <strong>{n(trade.routes.length)}</strong>
        </div>
      </div>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('trade.market')}</h3>
        </header>
        <div className="project-card__cost">
          {trade.prices.map((entry) => (
            <span key={entry.id} className="chip">
              {entry.name} {decimal(entry.price, 1)}
            </span>
          ))}
        </div>
        {(trade.shortages.length > 0 || trade.surpluses.length > 0) && (
          <p className="muted">
            {tr('trade.shortages')}: {trade.shortages.join(' · ') || tr('trade.none')} ·{' '}
            {tr('trade.surpluses')}: {trade.surpluses.join(' · ') || tr('trade.none')}
          </p>
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('trade.routes')}</h3>
          <span className="count">{n(trade.routes.length)}</span>
        </header>
        {trade.routes.length === 0 ? (
          <p className="muted">{tr('trade.noRoutes')}</p>
        ) : (
          <ul className="stack-list">
            {trade.routes.map((route) => (
              <li key={route.id}>
                <div className="stack-list__row">
                  <strong>
                    {route.side === 'import' ? '←' : '→'} {route.partnerName}
                  </strong>
                  <span>{route.resourceName} {decimal(route.amount, 1)}</span>
                </div>
                <div className="war-card__stats">
                  <span>{route.kind === 'sea' ? tr('trade.sea') : route.kind === 'land' ? tr('trade.land') : tr('trade.contract')}</span>
                  <span>{tr('trade.throughput')} {percent(route.throughput)}</span>
                  <span>{tr('trade.disruption')} {percent(route.disruption)}</span>
                </div>
                <div className="meter meter--green">
                  <span style={{ width: `${Math.round(route.throughput * 100)}%` }} />
                </div>
                <button type="button" className="btn btn--small" onClick={() => cancel(route.id)}>
                  {tr('trade.cancel')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('trade.establish')}</h3>
        </header>
        <div className="settings-row">
          <span>{tr('trade.partner')}</span>
          <select className="select" value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
            {partners.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}{entry.agreed ? ` · ${tr('trade.agreement')}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <span>{tr('trade.resource')}</span>
          <select className="select" value={resource} onChange={(event) => setResource(event.target.value)}>
            {trade.prices.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <label className="allocation__row">
          <span>{tr('trade.amount')}</span>
          <input
            type="range"
            min={1}
            max={10}
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
          <em>{amount}</em>
        </label>
        <label className="settings-row settings-row--check">
          <span>
            {tr('trade.contract')}
            <em>{tr('trade.contractHint')}</em>
          </span>
          <input
            type="checkbox"
            checked={contract}
            onChange={(event) => setContract(event.target.checked)}
          />
        </label>
        {selectedPartner && !selectedPartner.agreed && (
          <p className="hint">{tr('trade.agreementHint')}</p>
        )}
        <div className="army-card__targets">
          {selectedPartner && !selectedPartner.agreed && (
            <button
              type="button"
              className="btn btn--small"
              onClick={() => openTradeAgreement(partnerId)}
            >
              {tr('trade.agreement')}
            </button>
          )}
          <button
            type="button"
            className="btn btn--small btn--primary"
            disabled={!partnerId || !selectedPartner?.agreed}
            onClick={() => establish(partnerId, resource, amount, contract)}
          >
            {tr('trade.establish')}
          </button>
        </div>
      </section>
    </div>
  );
}
