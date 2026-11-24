import type { MapLayerId } from '../../game/types';
import type { MessageKey } from '../../i18n/locales/en';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';

/**
 * Strategic map layer switcher.
 *
 * Colour values are cached in the snapshot and written to one batched vertex
 * buffer, so switching a layer never rebuilds geometry or scans polygons.
 */
const LAYERS: Array<{ id: MapLayerId; labelKey: MessageKey; glyph: string }> = [
  { id: 'political', labelKey: 'layer.political', glyph: '▣' },
  { id: 'terrain', labelKey: 'layer.terrain', glyph: '⛰' },
  { id: 'population', labelKey: 'layer.population', glyph: '◉' },
  { id: 'economy', labelKey: 'layer.economy', glyph: '⛁' },
  { id: 'resources', labelKey: 'layer.resources', glyph: '◆' },
  { id: 'infrastructure', labelKey: 'layer.infrastructure', glyph: '⌗' },
  { id: 'supply', labelKey: 'layer.supply', glyph: '⛟' },
  { id: 'military', labelKey: 'layer.military', glyph: '⚔' },
  { id: 'diplomacy', labelKey: 'layer.diplomacy', glyph: '✧' },
  { id: 'objectives', labelKey: 'layer.objectives', glyph: '◎' },
];

export function MapLayerBar() {
  const { t } = useI18n();
  const active = useAppStore((state) => state.mapLayer);
  const setMapLayer = useAppStore((state) => state.setMapLayer);

  return (
    <div className="map-layer-bar panel" role="toolbar" aria-label={t('layer.title')}>
      <span className="map-layer-bar__label">{t('layer.title')}</span>
      <div className="map-layer-bar__items">
        {LAYERS.map((layer) => (
          <button
            key={layer.id}
            type="button"
            className={active === layer.id ? 'is-active' : ''}
            onClick={() => setMapLayer(layer.id)}
            title={t(layer.labelKey)}
            aria-pressed={active === layer.id}
          >
            <span aria-hidden="true">{layer.glyph}</span>
            <em>{t(layer.labelKey)}</em>
          </button>
        ))}
      </div>
    </div>
  );
}
