import type { MessageKey } from '../../i18n/locales/en';
import type { PlayerSnapshot } from '../../game/types';
import { useMemo, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

/**
 * War room: multi-country wars, fronts, command groups, operations and the
 * strategic air/naval/missile layer. Every action goes through the same
 * simulation APIs the AI uses.
 */
export function WarPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { t: tr, n, percent, decimal } = useI18n();
  const warfare = snapshot.warfare;
  const setArmyPosture = useAppStore((state) => state.setArmyPosture);
  const assignArmyToFrontline = useAppStore((state) => state.assignArmyToFrontline);
  const formArmyGroup = useAppStore((state) => state.formArmyGroup);
  const createOperationFromFront = useAppStore((state) => state.createOperationFromFront);
  const launchAirMission = useAppStore((state) => state.launchAirMission);
  const orderBlockade = useAppStore((state) => state.orderBlockade);
  const launchMissile = useAppStore((state) => state.launchMissile);
  const queueMissile = useAppStore((state) => state.queueMissile);
  const startNavalInvasion = useAppStore((state) => state.startNavalInvasion);
  const startAirlift = useAppStore((state) => state.startAirlift);
  const offerWhitePeace = useAppStore((state) => state.offerWhitePeace);
  const acceptPeace = useAppStore((state) => state.acceptPeace);
  const rejectPeace = useAppStore((state) => state.rejectPeace);

  const selectedRegionId = useAppStore((state) => state.selectedRegionId);
  const primaryFront = warfare.frontlines[0];
  const targetRegionId = selectedRegionId ?? primaryFront?.objectiveRegionId ?? null;
  const idleArmies = useMemo(
    () => snapshot.armies.filter((army) => !army.movement),
    [snapshot.armies],
  );
  const [maneuverArmyId, setManeuverArmyId] = useState(idleArmies[0]?.id ?? '');
  const maneuverArmy = idleArmies.find((army) => army.id === maneuverArmyId) ?? idleArmies[0];

  return (
    <div className="panel-content">
      <header className="panel-content__header">
        <div>
          <span className="eyebrow">{tr('panel.war')}</span>
          <h2>{tr('war.title')}</h2>
        </div>
        <div className="panel-content__headline">
          <span>{tr('war.fronts')}</span>
          <strong>{n(warfare.frontlines.length)}</strong>
        </div>
      </header>

      <p className="hint">{tr('war.subtitle')}</p>

      <div className="diplomacy-summary">
        <div>
          <span>{tr('war.activeWars')}</span>
          <strong className={warfare.wars.length > 0 ? 'is-negative' : ''}>
            {n(warfare.wars.length)}
          </strong>
        </div>
        <div>
          <span>{tr('war.operations')}</span>
          <strong>{n(warfare.operations.filter((entry) => entry.status === 'active').length)}</strong>
        </div>
        <div>
          <span>{tr('war.armyGroups')}</span>
          <strong>{n(warfare.groups.length)}</strong>
        </div>
      </div>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('war.wars')}</h3>
          <span className="count">{n(warfare.wars.length)}</span>
        </header>
        {warfare.wars.length === 0 ? (
          <p className="muted">{tr('war.none')}</p>
        ) : (
          warfare.wars.map((war) => (
            <article key={war.id} className="war-card">
              <header className="war-card__header">
                <div>
                  <h4>{war.opponentName ?? war.id}</h4>
                  <span className="muted">
                    {tr(`war.role.${war.role}` as MessageKey)} · {tr('war.battles')} {n(war.battles)}
                  </span>
                </div>
                <div className={`war-score ${war.score >= 0 ? 'is-positive' : 'is-negative'}`}>
                  <span>{tr('war.score')}</span>
                  <strong>{war.score > 0 ? '+' : ''}{decimal(war.score, 1)}</strong>
                </div>
              </header>
              <div className="meter meter--cyan">
                <span style={{ width: `${Math.round(((war.score + 100) / 200) * 100)}%` }} />
              </div>
              <div className="war-card__stats">
                <span>{tr('war.exhaustion')} {percent(war.exhaustion)}</span>
                <span>{tr('war.occupied')} {n(war.occupiedRegions)}</span>
                <span>{tr('war.fronts')} {n(war.fronts)}</span>
              </div>
              <div className="war-participants">
                {war.participants.map((participant) => (
                  <span key={participant.id} className={`chip ${participant.side === 'attacker' ? 'chip--danger' : 'chip--muted'}`}>
                    {participant.name}
                  </span>
                ))}
              </div>
              <div className="war-goals">
                {war.goals.map((goal) => (
                  <div key={goal.id} className={`war-goal status-${goal.status}`}>
                    <span>{tr(`war.goal.${goal.type}` as MessageKey)}</span>
                    <em>{goal.targetName ?? goal.ownerName}</em>
                    <div className="meter">
                      <span style={{ width: `${Math.round(goal.progress * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="army-card__targets">
                {war.canOfferPeace && (
                  <button type="button" className="btn btn--small" onClick={() => offerWhitePeace(war.id)}>
                    {tr('war.offerPeace')}
                  </button>
                )}
                {war.fronts > 0 && (
                  <button type="button" className="btn btn--small" onClick={() => createOperationFromFront(war.id)}>
                    {tr('war.createOperation')}
                  </button>
                )}
                {war.opponentId && (
                  <button type="button" className="btn btn--small" onClick={() => orderBlockade(war.opponentId!)}>
                    {tr('war.blockade')}
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('war.frontlines')}</h3>
          <span className="count">{n(warfare.frontlines.length)}</span>
        </header>
        {warfare.frontlines.length === 0 ? (
          <p className="muted">{tr('war.noFronts')}</p>
        ) : (
          warfare.frontlines.map((front) => (
            <article key={front.id} className="front-card">
              <header>
                <strong>{front.attackerName} — {front.defenderName}</strong>
                <span className={`chip ${front.status === 'stalemate' ? 'chip--muted' : 'chip--danger'}`}>
                  {front.status}
                </span>
              </header>
              <p className="muted">
                {front.regionNames.slice(0, 4).join(' · ')}
                {front.regionNames.length > 4 ? ` +${front.regionNames.length - 4}` : ''}
              </p>
              <div className="meter meter--cyan">
                <span style={{ width: `${Math.round(front.pressure * 100)}%` }} />
              </div>
              <div className="war-card__stats">
                <span>{tr('war.pressure')} {percent(front.pressure)}</span>
                <span>{tr('war.attackerStrength')} {n(front.attackerStrength)}</span>
                <span>{tr('war.defenderStrength')} {n(front.defenderStrength)}</span>
                <span>{tr('war.supply')} {percent((front.attackerSupply + front.defenderSupply) / 2)}</span>
              </div>
              <div className="army-card__targets">
                <button type="button" className="btn btn--small" onClick={() => createOperationFromFront(front.warId)}>
                  {tr('war.createOperation')}
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={idleArmies.length === 0}
                  onClick={() =>
                    idleArmies[0] &&
                    assignArmyToFrontline(
                      idleArmies[0].id,
                      front.id,
                      front.objectiveRegionId,
                    )
                  }
                >
                  {tr('war.joinFront')}
                </button>
                {front.objectiveRegionId && (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => launchAirMission('groundSupport', front.objectiveRegionId)}
                  >
                    {tr('war.launchSupport')}
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('war.armyGroups')}</h3>
          <span className="count">{n(warfare.groups.length)}</span>
        </header>
        {warfare.groups.length === 0 ? (
          <p className="muted">{tr('war.noGroups')}</p>
        ) : (
          warfare.groups.map((group) => (
            <div key={group.id} className="war-row">
              <strong>{group.name}</strong>
              <span>{group.memberNames.join(', ')}</span>
              <em>{group.objectiveName ?? tr('war.noObjective')}</em>
            </div>
          ))
        )}
        <button
          type="button"
          className="btn btn--small"
          disabled={idleArmies.length < 2}
          onClick={() => {
            const armies = idleArmies.slice(0, 3).map((army) => army.id);
            formArmyGroup(armies, tr('war.defaultGroupName'), primaryFront?.objectiveRegionId ?? null);
          }}
        >
          {tr('war.formGroup')}
        </button>
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('war.operations')}</h3>
          <span className="count">{n(warfare.operations.filter((entry) => entry.status === 'active').length)}</span>
        </header>
        {warfare.operations.length === 0 ? (
          <p className="muted">{tr('war.noOperations')}</p>
        ) : (
          warfare.operations.map((operation) => (
            <div key={operation.id} className="war-row">
              <strong>{tr(`war.operation.${operation.type}` as MessageKey)}</strong>
              <span>{operation.targetNames.join(' · ')}</span>
              <em>{percent(operation.progress)}</em>
            </div>
          ))
        )}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('war.air')}</h3>
          <span className="count">{n(warfare.air.formations)}</span>
        </header>
        <div className="war-card__stats">
          <span>{tr('war.airSuperiority')} {percent(warfare.air.superiority)}</span>
          <span>{tr('war.airReadiness')} {percent(warfare.air.readiness)}</span>
          <span>{tr('war.airCoverage')} {percent(warfare.air.coverage)}</span>
        </div>
        <div className="army-card__targets">
          <button type="button" className="btn btn--small" onClick={() => launchAirMission('groundSupport', targetRegionId)}>
            {tr('war.launchSupport')}
          </button>
          <button type="button" className="btn btn--small" onClick={() => launchAirMission('recon', targetRegionId)}>
            {tr('war.launchRecon')}
          </button>
          <button type="button" className="btn btn--small" onClick={() => launchAirMission('strategicBombing', targetRegionId)}>
            {tr('war.launchBombing')}
          </button>
        </div>
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('war.naval')}</h3>
          <span className="count">{n(warfare.naval.formations)}</span>
        </header>
        <div className="war-card__stats">
          <span>{tr('war.navalStrength')} {n(warfare.naval.strength)}</span>
          <span>{tr('war.blockadeEffect')} {percent(warfare.naval.blockadeEffect)}</span>
        </div>
        {warfare.naval.taskForces.map((force) => (
          <div key={force.id} className="war-row">
            <strong>{force.name}</strong>
            <span>{force.role} · {force.homePortName ?? '—'}</span>
            <em>{n(force.strength)}</em>
          </div>
        ))}
        {warfare.naval.blockades.map((blockade) => (
          <div key={blockade.id} className="war-row">
            <strong>{blockade.blockaderName} → {blockade.targetName}</strong>
            <span>{tr('war.blockadeEffect')} {percent(blockade.effectiveness)}</span>
          </div>
        ))}
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('maneuver.title')}</h3>
          <span className="count">
            {n(snapshot.maneuver.invasions.length + snapshot.maneuver.airlifts.length)}
          </span>
        </header>
        <div className="war-card__stats">
          <span>{tr('maneuver.transport')} {n(Math.round(snapshot.maneuver.transportCapacity))}</span>
          <span>{tr('war.air')} {n(Math.round(snapshot.maneuver.airliftCapacity))}</span>
        </div>
        {snapshot.maneuver.invasions.length === 0 && snapshot.maneuver.airlifts.length === 0 ? (
          <p className="muted">{tr('maneuver.none')}</p>
        ) : (
          <ul className="stack-list">
            {snapshot.maneuver.invasions.map((entry) => (
              <li key={entry.id}>
                <div className="stack-list__row">
                  <strong>{entry.armyName} → {entry.targetName}</strong>
                  <span>{tr(`maneuver.${entry.phase}` as MessageKey)}</span>
                </div>
                <div className="meter meter--amber">
                  <span style={{ width: `${Math.round(entry.progress * 100)}%` }} />
                </div>
                <span className="muted">{tr('production.days', { days: n(entry.daysRemaining) })}</span>
              </li>
            ))}
            {snapshot.maneuver.airlifts.map((entry) => (
              <li key={entry.id}>
                <div className="stack-list__row">
                  <strong>{entry.armyName} → {entry.targetName}</strong>
                  <span>{tr('maneuver.airlift')}</span>
                </div>
                <div className="meter meter--cyan">
                  <span style={{ width: `${Math.round(entry.progress * 100)}%` }} />
                </div>
                <span className="muted">{tr('production.days', { days: n(entry.daysRemaining) })}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="settings-row">
          <span>{tr('maneuver.army')}</span>
          <select
            className="select"
            value={maneuverArmy?.id ?? ''}
            onChange={(event) => setManeuverArmyId(event.target.value)}
          >
            {idleArmies.map((army) => (
              <option key={army.id} value={army.id}>
                {army.commander || army.id}
              </option>
            ))}
          </select>
        </div>
        <div className="army-card__targets">
          <button
            type="button"
            className="btn btn--small"
            disabled={!maneuverArmy || !targetRegionId}
            onClick={() => maneuverArmy && targetRegionId && startNavalInvasion(maneuverArmy.id, targetRegionId)}
          >
            {tr('maneuver.invade')}
          </button>
          <button
            type="button"
            className="btn btn--small"
            disabled={!maneuverArmy || !targetRegionId}
            onClick={() => maneuverArmy && targetRegionId && startAirlift(maneuverArmy.id, targetRegionId, 'redeploy')}
          >
            {tr('maneuver.airlift')}
          </button>
        </div>
      </section>

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('war.missiles')}</h3>
          <span className="count">{n(warfare.missiles.stockpile.reduce((sum, entry) => sum + entry.count, 0))}</span>
        </header>
        <div className="war-card__stats">
          <span>{tr('war.missileReadiness')} {percent(warfare.missiles.readiness)}</span>
          <span>{tr('war.cooldown')} {n(warfare.missiles.cooldownDays)}</span>
          {warfare.missiles.stockpile.map((entry) => (
            <span key={entry.type}>{entry.type} ×{n(entry.count)}</span>
          ))}
        </div>
        <div className="army-card__targets">
          <button
            type="button"
            className="btn btn--small"
            disabled={!targetRegionId}
            onClick={() => targetRegionId && launchMissile(targetRegionId, 'tactical')}
          >
            {tr('war.launchMissile')}
          </button>
          {warfare.missiles.lastTargetName && (
            <span className="muted">{tr('war.lastTarget')}: {warfare.missiles.lastTargetName}</span>
          )}
        </div>
        <div className="sub-section__header">
          <h4>{tr('missile.production')}</h4>
        </div>
        <div className="army-card__targets">
          {(['tactical', 'cruise', 'ballistic'] as const).map((type) => (
            <button
              key={type}
              type="button"
              className="btn btn--small"
              onClick={() => queueMissile(type)}
            >
              {tr('missile.queue')} · {type}
            </button>
          ))}
        </div>
        {warfare.missiles.production.map((order, index) => (
          <div key={`${order.type}-${index}`} className="meter-row">
            <span>{order.type}</span>
            <div className="meter meter--amber">
              <span
                style={{ width: `${Math.round((1 - order.daysRemaining / Math.max(1, order.totalDays)) * 100)}%` }}
              />
            </div>
            <em>{tr('missile.buildTime', { days: n(order.daysRemaining) })}</em>
          </div>
        ))}
      </section>

      {warfare.peaceOffers.length > 0 && (
        <section className="sub-section">
          <header className="sub-section__header">
            <h3>{tr('war.peaceOffers')}</h3>
          </header>
          {warfare.peaceOffers.map((offer) => (
            <div key={offer.id} className="war-row">
              <strong>{offer.proposerName} → {offer.recipientName}</strong>
              <span>{offer.terms.join(' · ') || tr('war.whitePeace')}</span>
              {offer.canAccept && (
                <span className="army-card__targets">
                  <button type="button" className="btn btn--small" onClick={() => acceptPeace(offer.id)}>
                    {tr('war.accept')}
                  </button>
                  <button type="button" className="btn btn--small" onClick={() => rejectPeace(offer.id)}>
                    {tr('war.reject')}
                  </button>
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {warfare.plans.length > 0 && (
        <section className="sub-section">
          <header className="sub-section__header">
            <h3>{tr('war.plans')}</h3>
          </header>
          {warfare.plans.map((plan) => (
            <div key={plan.id} className="war-row">
              <strong>{tr(`war.plan.${plan.kind}` as MessageKey)}</strong>
              <span>{plan.targetName ?? plan.rationale}</span>
              <em>{percent(plan.priority)}</em>
            </div>
          ))}
        </section>
      )}

      <section className="sub-section">
        <header className="sub-section__header">
          <h3>{tr('war.postures')}</h3>
        </header>
        {snapshot.armies.map((army) => (
          <div key={army.id} className="war-row">
            <strong>{army.commander || army.id}</strong>
            <span>{army.posture} · {percent(army.morale)}</span>
            <select
              className="input input--small"
              value={army.posture}
              onChange={(event) => setArmyPosture(army.id, event.target.value)}
              aria-label={tr('war.postures')}
            >
              {['attack', 'defend', 'hold', 'advance', 'support', 'reserve', 'withdraw', 'recon'].map(
                (posture) => (
                  <option key={posture} value={posture}>
                    {tr(`war.posture.${posture}` as MessageKey)}
                  </option>
                ),
              )}
            </select>
          </div>
        ))}
      </section>
    </div>
  );
}
