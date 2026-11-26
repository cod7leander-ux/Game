import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { DirectControlView } from '../../game/types';
import type { DirectInput } from '../../gameplay/direct/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';
import { DirectRadar } from './DirectRadar';
import './direct-control.css';

/**
 * Direct-control HUD.
 *
 * A thin projection of the direct-control state: the same actions the keyboard
 * drives, exposed as buttons for mouse and touch. No gameplay lives here.
 */
const INPUT_KEYS = new Set([
  'KeyW',
  'KeyS',
  'KeyA',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
  'KeyX',
  'KeyZ',
  'KeyC',
]);

const DOMAIN_KEY = {
  air: 'direct.domain.air',
  ground: 'direct.domain.ground',
  naval: 'direct.domain.naval',
} as const;

const KIND_KEY = {
  air: 'direct.kind.air',
  ground: 'direct.kind.ground',
} as const;

const RESET: Partial<DirectInput> = {
  throttle: 0,
  yaw: 0,
  pitch: 0,
  fire: false,
  brake: false,
  rise: false,
  dive: false,
  boost: false,
};

export function DirectControlHud({ direct }: { direct: DirectControlView | null }) {
  const { t: tr, n, percent, decimal } = useI18n();
  const setDirectInput = useAppStore((state) => state.setDirectInput);
  const exitDirectControl = useAppStore((state) => state.exitDirectControl);
  const toggleDirectCamera = useAppStore((state) => state.toggleDirectCamera);
  const cycleDirectTarget = useAppStore((state) => state.cycleDirectTarget);
  const directSelectWeapon = useAppStore((state) => state.directSelectWeapon);
  const directReturnToBase = useAppStore((state) => state.directReturnToBase);
  const held = useRef(new Set<string>());
  const unitId = direct?.unitId ?? null;

  useEffect(() => {
    if (!unitId) return;
    committedReset();
    held.current.clear();

    const commit = () => {
      const keys = held.current;
      setDirectInput({
        throttle: (keys.has('KeyW') ? 1 : 0) + (keys.has('KeyS') ? -1 : 0),
        yaw: (keys.has('KeyD') ? 1 : 0) + (keys.has('KeyA') ? -1 : 0),
        pitch: (keys.has('ArrowUp') ? 1 : 0) + (keys.has('ArrowDown') ? -1 : 0),
        fire: keys.has('Space'),
        brake: keys.has('KeyX'),
        boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
        rise: keys.has('KeyZ'),
        dive: keys.has('KeyC'),
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        exitDirectControl();
        return;
      }
      if (event.code === 'Tab') {
        event.preventDefault();
        cycleDirectTarget();
        return;
      }
      if (event.code === 'KeyV') {
        toggleDirectCamera();
        return;
      }
      if (event.code === 'KeyR') {
        directReturnToBase();
        return;
      }
      if (event.code === 'Space') event.preventDefault();
      if (event.code === 'Space' || INPUT_KEYS.has(event.code)) {
        held.current.add(event.code);
        commit();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' || INPUT_KEYS.has(event.code)) {
        held.current.delete(event.code);
        commit();
      }
    };

    const onBlur = () => {
      held.current.clear();
      commit();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      held.current.clear();
      committedReset();
    };
    // Rebind only when the controlled unit changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  function committedReset() {
    useAppStore.getState().setDirectInput(RESET);
  }

  if (!direct) return null;

  const altitudeLabel = direct.depthMetres > 1 ? tr('direct.depth') : tr('direct.altitude');
  const altitudeValue =
    direct.depthMetres > 1
      ? `${n(direct.depthMetres)} m`
      : `${n(Math.round(direct.altitudeMetres))} m`;

  const hold = (patch: Partial<DirectInput>) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDirectInput(patch);
    },
    onPointerUp: () => setDirectInput(RESET),
    onPointerCancel: () => setDirectInput(RESET),
    onPointerLeave: () => setDirectInput(RESET),
  });

  return (
    <section className="direct-hud" dir="auto" aria-label={tr('direct.title')}>
      <header className="direct-hud__header">
        <div className="direct-hud__identity">
          <span className="eyebrow">{tr('direct.title')}</span>
          <h3>{direct.name}</h3>
          <span className="direct-hud__meta">
            {direct.armyName} · {direct.countryName} · {direct.terrain}
          </span>
        </div>
        <div className="direct-hud__badges">
          <span className="direct-hud__badge">{tr(DOMAIN_KEY[direct.domain])}</span>
          <span className="direct-hud__badge">{direct.cameraMode === 'cockpit' ? tr('direct.cockpit') : tr('direct.chase')}</span>
          {direct.mode === 'returning' && (
            <span className="direct-hud__badge direct-hud__badge--warn">{tr('direct.returning')}</span>
          )}
        </div>
        <button type="button" className="btn btn--small btn--danger" onClick={exitDirectControl}>
          {tr('direct.exit')}
        </button>
      </header>

      <div className="direct-hud__body">
        <div className="direct-hud__readouts">
          <div>
            <span>{tr('direct.speed')}</span>
            <strong>{n(direct.speedKph)} km/h</strong>
          </div>
          <div>
            <span>{altitudeLabel}</span>
            <strong>{altitudeValue}</strong>
          </div>
          <div>
            <span>{tr('direct.heading')}</span>
            <strong>{n(Math.round(((direct.heading * 180) / Math.PI + 360) % 360))}°</strong>
          </div>
          <div>
            <span>{tr('direct.health')}</span>
            <strong>{percent(direct.healthRatio)}</strong>
            <span className="direct-hud__bar">
              <span style={{ width: `${Math.round(direct.healthRatio * 100)}%` }} />
            </span>
          </div>
          <div>
            <span>{tr('direct.homeDistance')}</span>
            <strong>{n(Math.round(direct.homeDistanceKm))} km</strong>
          </div>
          <div>
            <span>{tr('direct.score')}</span>
            <strong>
              {n(direct.kills)} / {n(direct.hits)} / {n(direct.shots)}
            </strong>
          </div>
        </div>

        <div className="direct-hud__target">
          <span className="direct-hud__label">{tr('direct.target')}</span>
          {direct.target ? (
            <>
              <strong>{direct.target.name}</strong>
              <span className="direct-hud__meta">
                {direct.target.countryName} · {tr('direct.distance')} {decimal(direct.target.distanceKm, 1)} km ·{' '}
                {percent(direct.target.healthRatio)}
              </span>
            </>
          ) : (
            <strong className="direct-hud__muted">{tr('direct.noTarget')}</strong>
          )}
          <button type="button" className="btn btn--small" onClick={cycleDirectTarget} disabled={direct.contacts.length === 0}>
            {tr('direct.cycleTarget')}
          </button>
        </div>

        <div className="direct-hud__weapons">
          <span className="direct-hud__label">{tr('direct.weapons')}</span>
          {direct.weapons.length === 0 ? (
            <span className="direct-hud__muted">{tr('direct.unarmed')}</span>
          ) : (
            <ul>
              {direct.weapons.map((weapon, index) => (
                <li key={weapon.id}>
                  <button
                    type="button"
                    className="direct-weapon"
                    onClick={() => directSelectWeapon(index)}
                    data-empty={weapon.ammo <= 0}
                  >
                    <span>{weapon.name}</span>
                    <em>
                      {weapon.ready > 0
                        ? tr('direct.reloading', { seconds: decimal(weapon.ready, 1) })
                        : tr('direct.ready')}{' '}
                      · {n(weapon.ammo)} {tr('direct.ammo')}
                    </em>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DirectRadar direct={direct} />

        <div className="direct-hud__contacts">
          <span className="direct-hud__label">{tr('direct.contacts')}</span>
          {direct.contacts.length === 0 ? (
            <span className="direct-hud__muted">{tr('direct.noContacts')}</span>
          ) : (
            <ul>
              {direct.contacts.slice(0, 6).map((contact) => (
                <li key={contact.id} className={direct.target?.id === contact.id ? 'is-target' : ''}>
                  <span>{contact.name}</span>
                  <em>
                    {tr(KIND_KEY[contact.kind])} · {decimal(contact.distanceKm, 1)} km
                  </em>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="direct-hud__controls">
        <div className="direct-hud__pad">
          <button type="button" className="btn btn--small" {...hold({ throttle: 1 })}>
            {tr('direct.throttleUp')}
          </button>
          <button type="button" className="btn btn--small" {...hold({ throttle: -1 })}>
            {tr('direct.throttleDown')}
          </button>
          <button type="button" className="btn btn--small" {...hold({ yaw: -1 })}>
            {tr('direct.turnLeft')}
          </button>
          <button type="button" className="btn btn--small" {...hold({ yaw: 1 })}>
            {tr('direct.turnRight')}
          </button>
          <button type="button" className="btn btn--small" {...hold({ pitch: 1 })}>
            {tr('direct.pitchUp')}
          </button>
          <button type="button" className="btn btn--small" {...hold({ pitch: -1 })}>
            {tr('direct.pitchDown')}
          </button>
          <button type="button" className="btn btn--small btn--danger" {...hold({ fire: true })}>
            {tr('direct.fire')}
          </button>
        </div>
        <div className="direct-hud__pad">
          <button type="button" className="btn btn--small" onClick={toggleDirectCamera}>
            {tr('direct.camera')}
          </button>
          <button type="button" className="btn btn--small" onClick={directReturnToBase}>
            {tr('direct.return')}
          </button>
          <button type="button" className="btn btn--small" onClick={exitDirectControl}>
            {tr('direct.strategic')}
          </button>
        </div>
        <p className="direct-hud__hint">{tr('direct.hint')}</p>
      </div>
    </section>
  );
}
