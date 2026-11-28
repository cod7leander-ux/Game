import { useMemo, type MouseEvent } from 'react';
import { COUNTRY_GEO } from '../../geo';
import type { PlayerSnapshot } from '../../game/types';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';
import './strategic-map.css';

/**
 * Strategic minimap.
 *
 * A true equirectangular projection of the same country geometry the globe
 * renders, coloured by the live diplomatic tone of every country and overlaid
 * with the player's armies and the inspected province. It is a navigation and
 * awareness tool, not a second game map: clicking it moves the world camera.
 */
const VIEW = { x: 0, y: 6, width: 360, height: 140 };

const toPath = (ring: Array<[number, number]>): string => {
  let path = '';
  for (let index = 0; index < ring.length; index += 1) {
    const [lon, lat] = ring[index];
    const x = lon + 180;
    const y = 90 - lat;
    path += `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return `${path}Z`;
};

const COUNTRY_PATHS = COUNTRY_GEO.map((country) => ({
  id: country.id,
  d: country.polygons.map((polygon) => toPath(polygon.outer)).join(''),
}));

const TONE_FILL: Record<string, string> = {
  player: '#2f7d5d',
  ally: '#2b5f78',
  enemy: '#7a2f2c',
  occupied: '#6a5024',
  neutral: '#1b2530',
};

const TONE_STROKE: Record<string, string> = {
  player: '#7fe6b3',
  ally: '#7fd8ff',
  enemy: '#e5675f',
  occupied: '#e8b45a',
  neutral: '#37485a',
};

const ARMY_COLOR: Record<string, string> = {
  player: '#7fe6b3',
  ally: '#7fd8ff',
  enemy: '#ff7b6f',
};

export function StrategicMap({
  snapshot,
  selectedRegionId,
  hidden = false,
}: {
  snapshot: PlayerSnapshot;
  selectedRegionId: string | null;
  hidden?: boolean;
}) {
  const { t: tr } = useI18n();
  const focusPointCamera = useAppStore((state) => state.focusPointCamera);
  const cameraView = useAppStore((state) => state.cameraView);
  const selectRegion = useAppStore((state) => state.selectRegion);
  const selectCountry = useAppStore((state) => state.selectCountry);
  const setPanelTab = useAppStore((state) => state.setPanelTab);

  const tones = useMemo(() => {
    const map = new Map<string, string>();
    for (const region of snapshot.mapRegions) {
      if (!map.has(region.countryId)) map.set(region.countryId, region.tone);
    }
    return map;
  }, [snapshot.mapRegions]);

  const selected = selectedRegionId
    ? snapshot.mapRegions.find((region) => region.id === selectedRegionId)
    : undefined;

  if (hidden) return null;

  const onClick = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const lon = ((event.clientX - rect.left) / rect.width) * VIEW.width + VIEW.x - 180;
    const lat = 90 - (((event.clientY - rect.top) / rect.height) * VIEW.height + VIEW.y);
    let nearest: PlayerSnapshot['mapRegions'][number] | null = null;
    let best = 9;
    for (const region of snapshot.mapRegions) {
      const dLon = Math.abs(((region.lon - lon + 540) % 360) - 180) * Math.cos((lat * Math.PI) / 180);
      const distance = Math.hypot(dLon, region.lat - lat);
      if (distance < best) {
        best = distance;
        nearest = region;
      }
    }
    if (nearest) {
      selectRegion(nearest.id);
      selectCountry(nearest.countryId, false);
      setPanelTab('territory');
      focusPointCamera(nearest.lon, nearest.lat, 0.35);
    } else {
      focusPointCamera(lon, lat, 0.9);
    }
  };

  return (
    <aside className="strategic-map" aria-label={tr('minimap.title')}>
      <header className="strategic-map__header">
        <span className="eyebrow">{tr('minimap.title')}</span>
        <span className="strategic-map__date">{snapshot.dateLabel}</span>
      </header>
      <svg
        className="strategic-map__svg"
        viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label={tr('minimap.title')}
        onClick={onClick}
      >
        <rect x={VIEW.x} y={VIEW.y} width={VIEW.width} height={VIEW.height} className="strategic-map__sea" />
        {COUNTRY_PATHS.map((country) => {
          const tone = tones.get(country.id) ?? 'neutral';
          return (
            <path
              key={country.id}
              d={country.d}
              className="strategic-map__country"
              fill={TONE_FILL[tone] ?? TONE_FILL.neutral}
              stroke={TONE_STROKE[tone] ?? TONE_STROKE.neutral}
              strokeWidth={0.35}
            />
          );
        })}
        {selected && (
          <circle
            cx={selected.lon + 180}
            cy={90 - selected.lat}
            r={2.4}
            className="strategic-map__selection"
          />
        )}
        {cameraView && (
          <g
            className="strategic-map__camera"
            transform={`translate(${cameraView.lon + 180} ${90 - cameraView.lat})`}
          >
            <circle r={Math.min(26, 3 + cameraView.altitude * 16)} className="strategic-map__view" />
            <path d="M-2.6 0H2.6M0 -2.6V2.6" className="strategic-map__cross" />
          </g>
        )}
        {snapshot.mapArmies.map((army) => (
          <circle
            key={army.id}
            cx={army.lon + 180}
            cy={90 - army.lat}
            r={1.5 + army.strength * 1.3}
            fill={ARMY_COLOR[army.tone] ?? ARMY_COLOR.enemy}
            className="strategic-map__army"
          />
        ))}
      </svg>
      <p className="strategic-map__hint">{tr('minimap.hint')}</p>
    </aside>
  );
}
