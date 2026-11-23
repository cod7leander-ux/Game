import { useMemo } from 'react';
import type { MessageKey } from '../../i18n/locales/en';
import type { BattleUnitView, PlayerSnapshot } from '../../game/types';
import type { FormationType, UnitMotion } from '../../gameplay/tactical/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

/**
 * Tactical command HUD.
 *
 * Deliberately a thin projection of the battle snapshot: every action calls the
 * same session commands the AI uses, so there is no second command path and no
 * gameplay inside React.
 */
const MOTION_KEY: Record<UnitMotion, MessageKey> = {
  idle: 'battle.state.idle',
  moving: 'battle.state.moving',
  holding: 'battle.state.holding',
  attacking: 'battle.state.attacking',
  destroyed: 'battle.state.destroyed',
};

const FORMATIONS: FormationType[] = ['line', 'column', 'wedge'];

const FORMATION_KEY: Record<FormationType, MessageKey> = {
  line: 'battle.formation.line',
  column: 'battle.formation.column',
  wedge: 'battle.formation.wedge',
};

const ARCHETYPE_KEY: Record<BattleUnitView['archetype'], MessageKey> = {
  infantry: 'battle.type.infantry',
  tank: 'battle.type.tank',
  artillery: 'battle.type.artillery',
  aircraft: 'battle.type.aircraft',
  helicopter: 'battle.type.helicopter',
  drone: 'battle.type.drone',
  ship: 'battle.type.ship',
  installation: 'battle.type.installation',
};

export function BattleHud({ snapshot }: { snapshot: PlayerSnapshot }) {
  const battle = snapshot.battle;
  const { t: tr, n, percent, decimal } = useI18n();
  const selectedUnitId = useAppStore((state) => state.snapshot?.battleUnits.find((unit) => unit.selected)?.id ?? null);
  const selectUnit = useAppStore((state) => state.selectUnit);
  const setBattleFormation = useAppStore((state) => state.setBattleFormation);
  const battleAdvance = useAppStore((state) => state.battleAdvance);
  const battleHold = useAppStore((state) => state.battleHold);
  const battleWithdraw = useAppStore((state) => state.battleWithdraw);
  const battleAttackSelected = useAppStore((state) => state.battleAttackSelected);
  const battleHoldSelected = useAppStore((state) => state.battleHoldSelected);
  const dismissBattle = useAppStore((state) => state.dismissBattle);

  const groups = useMemo(() => {
    if (!battle) return { player: [] as BattleUnitView[], enemy: [] as BattleUnitView[] };
    const player: BattleUnitView[] = [];
    const enemy: BattleUnitView[] = [];
    for (const unit of battle.units) {
      if (unit.healthRatio <= 0) continue;
      if (unit.side === 'player') player.push(unit);
      else enemy.push(unit);
    }
    return { player, enemy };
  }, [battle]);

  if (!battle) return null;

  const selected = selectedUnitId
    ? battle.units.find((unit) => unit.id === selectedUnitId)
    : undefined;
  const total = Math.max(1, battle.playerStrength + battle.enemyStrength);
  const playerShare = Math.round((battle.playerStrength / total) * 100);

  return (
    <section className="battle-hud" data-status={battle.status} dir="auto">
      <header className="battle-hud__header">
        <div>
          <span className="eyebrow">{tr('battle.title')}</span>
          <h3>{battle.placeName}</h3>
          <span className="battle-hud__meta">
            {tr('battle.dayLabel', { day: n(battle.day) })} ·{' '}
            {battle.status === 'finished'
              ? battle.winner === 'player'
                ? tr('battle.victory')
                : battle.winner === 'enemy'
                  ? tr('battle.defeat')
                  : tr('battle.draw')
              : tr('battle.fighting')}
          </span>
        </div>
        <div className="battle-hud__close">
          {battle.status === 'finished' && (
            <button type="button" className="btn btn--small" onClick={dismissBattle}>
              {tr('battle.close')}
            </button>
          )}
        </div>
      </header>

      <div className="battle-hud__strength">
        <span>{tr('battle.yourForce')} {n(battle.playerStrength)}</span>
        <div className="battle-hud__bar" role="presentation">
          <span style={{ width: `${playerShare}%` }} />
        </div>
        <span>{n(battle.enemyStrength)} {tr('battle.enemyForce')}</span>
      </div>

      <div className="battle-hud__orders">
        <span className="battle-hud__label">{tr('battle.formation')}</span>
        {FORMATIONS.map((formation) => (
          <button
            key={formation}
            type="button"
            className="btn btn--small"
            onClick={() => setBattleFormation(formation)}
            data-active={battle.formation === formation}
          >
            {tr(FORMATION_KEY[formation])}
          </button>
        ))}
      </div>

      <div className="battle-hud__orders">
        <button type="button" className="btn btn--small" onClick={battleAdvance} disabled={battle.status === 'finished'}>
          {tr('battle.advance')}
        </button>
        <button type="button" className="btn btn--small" onClick={battleHold} disabled={battle.status === 'finished'}>
          {tr('battle.hold')}
        </button>
        <button type="button" className="btn btn--small btn--danger" onClick={battleWithdraw} disabled={battle.status === 'finished'}>
          {tr('battle.withdraw')}
        </button>
      </div>

      <div className="battle-hud__columns">
        <div className="battle-hud__units">
          <span className="battle-hud__label">{tr('battle.units')} ({n(groups.player.length)})</span>
          {groups.player.length === 0 ? (
            <p className="muted">{tr('battle.noUnits')}</p>
          ) : (
            <ul>
              {groups.player.map((unit) => (
                <li key={unit.id}>
                  <button
                    type="button"
                    className={`battle-unit ${unit.id === selectedUnitId ? 'is-selected' : ''}`}
                    onClick={() => selectUnit(unit.id)}
                  >
                    <span className="battle-unit__name">{unit.name}</span>
                    <span className="battle-unit__bar">
                      <span style={{ width: `${Math.round(unit.healthRatio * 100)}%` }} />
                    </span>
                    <span className="battle-unit__meta">
                      {tr(MOTION_KEY[unit.state])} · {percent(unit.healthRatio)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <span className="battle-hud__label">{tr('battle.enemyForce')} ({n(groups.enemy.length)})</span>
          <ul>
            {groups.enemy.map((unit) => (
              <li key={unit.id}>
                <div className="battle-unit battle-unit--enemy">
                  <span className="battle-unit__name">{unit.name}</span>
                  <span className="battle-unit__bar">
                    <span style={{ width: `${Math.round(unit.healthRatio * 100)}%` }} />
                  </span>
                  <span className="battle-unit__meta">{unit.countryName}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="battle-hud__detail">
          {!selected ? (
            <p className="muted">{tr('battle.selectPrompt')}</p>
          ) : (
            <>
              <h4>{selected.name}</h4>
              <dl className="battle-detail">
                <div>
                  <dt>{tr('battle.category')}</dt>
                  <dd>{tr(ARCHETYPE_KEY[selected.archetype])}</dd>
                </div>
                <div>
                  <dt>{tr('battle.faction')}</dt>
                  <dd>{selected.countryName}</dd>
                </div>
                <div>
                  <dt>{tr('battle.health')}</dt>
                  <dd>{n(selected.health)} / {n(selected.maxHealth)}</dd>
                </div>
                <div>
                  <dt>{tr('battle.strength')}</dt>
                  <dd>{decimal(selected.weight, 1)}</dd>
                </div>
                <div>
                  <dt>{tr('battle.stateLabel')}</dt>
                  <dd>{tr(MOTION_KEY[selected.state])}</dd>
                </div>
                <div>
                  <dt>{tr('battle.target')}</dt>
                  <dd>{selected.targetName ?? tr('battle.none')}</dd>
                </div>
                <div>
                  <dt>{tr('battle.kills')}</dt>
                  <dd>{n(selected.kills)}</dd>
                </div>
              </dl>

              {selected.weapons.length > 0 && (
                <div className="battle-weapons">
                  <span className="battle-hud__label">{tr('battle.weapons')}</span>
                  {selected.weapons.map((weapon) => (
                    <div key={weapon.name} className="battle-weapon">
                      <span>{weapon.name}</span>
                      <em>
                        {tr('battle.damage')} {n(weapon.damage)} · {tr('battle.range')} {n(weapon.range)} m ·{' '}
                        {weapon.ready > 0
                          ? tr('battle.reloading', { seconds: decimal(weapon.ready, 1) })
                          : tr('battle.ready')}
                      </em>
                    </div>
                  ))}
                </div>
              )}

              <div className="battle-hud__orders">
                <button type="button" className="btn btn--small" onClick={battleAttackSelected}>
                  {tr('battle.attackNearest')}
                </button>
                <button type="button" className="btn btn--small" onClick={battleHoldSelected}>
                  {tr('battle.holdUnit')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
