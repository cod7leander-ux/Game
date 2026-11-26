import type { DirectControlView } from '../../game/types';
import { useI18n } from '../hooks/useI18n';

/**
 * Tactical radar for direct control.
 *
 * Contacts come from the same simulation state the HUD and the 3D tokens use;
 * bearing and range are projected onto a north-up scope with the controlled
 * unit at the centre. No invented contacts: an empty scope means no contacts.
 */
const SIZE = 132;
const CENTRE = SIZE / 2;

export function DirectRadar({ direct }: { direct: DirectControlView }) {
  const { t: tr, decimal } = useI18n();
  const maxKm = Math.max(
    4,
    ...direct.contacts.map((contact) => contact.distanceKm),
    ...direct.weapons.map((weapon) => weapon.range),
  );
  const rangeKm = Math.max(4, Math.ceil(maxKm * 1.15));

  return (
    <div className="direct-radar">
      <span className="direct-hud__label">{tr('direct.radar')}</span>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={tr('direct.radar')}>
        <circle cx={CENTRE} cy={CENTRE} r={CENTRE - 6} className="direct-radar__scope" />
        <circle cx={CENTRE} cy={CENTRE} r={(CENTRE - 6) * 0.66} className="direct-radar__ring" />
        <circle cx={CENTRE} cy={CENTRE} r={(CENTRE - 6) * 0.33} className="direct-radar__ring" />
        <line x1={CENTRE} y1={6} x2={CENTRE} y2={SIZE - 6} className="direct-radar__axis" />
        <line x1={6} y1={CENTRE} x2={SIZE - 6} y2={CENTRE} className="direct-radar__axis" />
        <text x={CENTRE} y={11} className="direct-radar__cardinal">N</text>

        {direct.contacts
          .filter((contact) => contact.distanceKm <= rangeKm)
          .map((contact) => {
            const angle = contact.bearing - direct.heading;
            const radius = (contact.distanceKm / rangeKm) * (CENTRE - 10);
            const x = CENTRE + Math.sin(angle) * radius;
            const y = CENTRE - Math.cos(angle) * radius;
            const isTarget = direct.target?.id === contact.id;
            return (
              <g key={contact.id} className={isTarget ? 'is-target' : ''}>
                {isTarget && <circle cx={x} cy={y} r={7} className="direct-radar__lock" />}
                <circle
                  cx={x}
                  cy={y}
                  r={2.6}
                  className={`direct-radar__contact ${isTarget ? 'is-target' : ''}`}
                />
              </g>
            );
          })}

        <polygon
          points={`${CENTRE},${CENTRE - 5} ${CENTRE - 3.4},${CENTRE + 3.2} ${CENTRE + 3.4},${CENTRE + 3.2}`}
          className="direct-radar__self"
        />
      </svg>
      <span className="direct-radar__range">{decimal(rangeKm, 0)} km</span>
    </div>
  );
}
