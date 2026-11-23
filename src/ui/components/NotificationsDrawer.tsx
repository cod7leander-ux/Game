import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

export function NotificationsDrawer() {
  const { t: tr } = useI18n();
  const open = useAppStore((state) => state.notificationsOpen);
  const snapshot = useAppStore((state) => state.snapshot);
  const close = useAppStore((state) => state.setNotificationsOpen);
  const clear = useAppStore((state) => state.clearNotifications);

  if (!open || !snapshot) return null;

  return (
    <aside className="notifications panel">
      <header className="notifications__header">
        <div>
          <span className="eyebrow">{tr('hud.day', { day: snapshot.day })}</span>
          <h2>{tr('notifications.title')}</h2>
        </div>
        <div className="notifications__actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={clear}>
            {tr('notifications.clear')}
          </button>
          <button type="button" className="icon-btn" onClick={() => close(false)} aria-label={tr('common.close')}>
            ×
          </button>
        </div>
      </header>
      {snapshot.notifications.length === 0 ? (
        <p className="muted">{tr('notifications.empty')}</p>
      ) : (
        <ul className="notifications__list">
          {[...snapshot.notifications].reverse().map((entry) => (
            <li key={entry.id} className={`dispatch dispatch--${entry.severity}`}>
              <span className="dispatch__day">
                {tr('common.day')} {entry.day}
              </span>
              <span className="dispatch__text">{entry.message}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
