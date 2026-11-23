import { useAppStore } from '../../state/appStore';
import { SPEEDS, type GameSpeed } from '../../core/config';
import type { PlayerSnapshot } from '../../game/types';
import type { MessageKey } from '../../i18n/locales/en';
import { useI18n } from '../hooks/useI18n';
import { Flag } from './Flag';

const SPEED_KEY: Record<GameSpeed, 'hud.speed.pause' | 'hud.speed.normal' | 'hud.speed.fast' | 'hud.speed.rapid'> = {
  0: 'hud.speed.pause',
  1: 'hud.speed.normal',
  2: 'hud.speed.fast',
  4: 'hud.speed.rapid',
};

interface TopBarProps {
  snapshot: PlayerSnapshot;
}

export function TopBar({ snapshot }: TopBarProps) {
  const { t: tr, n, signed, percent, compact } = useI18n();
  const setSpeed = useAppStore((state) => state.setSpeed);
  const openDialog = useAppStore((state) => state.openDialog);
  const toggleNotifications = useAppStore((state) => state.toggleNotifications);
  const notificationsOpen = useAppStore((state) => state.notificationsOpen);
  const country = snapshot.country;

  return (
    <header className="topbar panel">
      <div className="topbar__nation">
        <Flag iso2={country.iso2} seed={country.id} size={34} title={country.name} />
        <div className="topbar__nation-text">
          <span className="topbar__name">{country.name}</span>
          <span className="topbar__sub">
            {country.governmentName} · {tr('hud.day', { day: n(snapshot.day) })}
          </span>
        </div>
      </div>

      <div className="topbar__date">
        <span className="topbar__date-value">{snapshot.dateLabel}</span>
        <span className="topbar__sub">
          {tr(`focus.${country.focus}` as MessageKey)}
        </span>
      </div>

      <div className="topbar__stats">
        <div className="stat">
          <span className="stat__label">{tr('hud.treasury')}</span>
          <span className="stat__value">{compact(country.treasury)}</span>
          <span className={`stat__delta ${country.netIncome >= 0 ? 'is-positive' : 'is-negative'}`}>
            {signed(Math.round(country.netIncome))}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">{tr('hud.manpower')}</span>
          <span className="stat__value">{compact(country.manpower * 1000)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">{tr('hud.stability')}</span>
          <span className="stat__value">{percent(country.stability)}</span>
          <span className={`stat__delta stat__delta--${country.stabilityKey}`}>
            {tr(`stability.${country.stabilityKey}` as MessageKey)}
          </span>
        </div>
        <div className="stat stat--wide">
          <span className="stat__label">{tr('hud.army')}</span>
          <span className="stat__value">{n(country.strength)}</span>
          <span className="stat__delta">{n(country.armyFormations)} {tr('military.formations')}</span>
        </div>
      </div>

      <div className="topbar__controls">
        <div className="speed-control" role="group" aria-label={tr('hud.speed')}>
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              className={snapshot.speed === speed ? 'is-active' : ''}
              onClick={() => setSpeed(speed)}
              title={tr(SPEED_KEY[speed])}
            >
              {speed === 0 ? '❚❚' : speed === 1 ? '▶' : speed === 2 ? '▶▶' : '▶▶▶'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`icon-btn ${notificationsOpen ? 'is-active' : ''}`}
          onClick={toggleNotifications}
          title={tr('notifications.title')}
        >
          ✦
          {snapshot.unread > 0 && <span className="badge">{snapshot.unread}</span>}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => openDialog('pause')}
          title={tr('hud.menu')}
        >
          ☰
        </button>
      </div>
    </header>
  );
}
