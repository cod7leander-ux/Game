import { useMemo } from 'react';
import { hashString } from '../../core/math';

/**
 * Procedural national flag.
 *
 * All artwork is generated from a country's ISO code, so the game ships no
 * third-party flag assets and every nation still has a distinct, stable emblem.
 * Real reference flags can later replace this component without touching UI.
 */
const PALETTES = [
  ['#c8442f', '#f2e9d8', '#1f3b63'],
  ['#1f5d4a', '#f0d27a', '#111a22'],
  ['#28527a', '#e9e2cf', '#b23a35'],
  ['#7a2d3a', '#e6d3a3', '#2c3e50'],
  ['#e0a33a', '#16202a', '#3f7d63'],
  ['#3b4a6b', '#dcdcd6', '#a9373a'],
  ['#5c3b6e', '#e8c07d', '#22303c'],
  ['#0f6b6b', '#eef0e6', '#c1533d'],
];

export interface FlagProps {
  iso2: string | null;
  seed?: string;
  size?: number;
  className?: string;
  title?: string;
}

export function Flag({ iso2, seed, size = 26, className, title }: FlagProps) {
  const design = useMemo(() => {
    const key = `${iso2 ?? 'xx'}-${seed ?? ''}`;
    const hash = hashString(key);
    const palette = PALETTES[hash % PALETTES.length];
    const layout = (hash >>> 3) % 5;
    const emblem = (hash >>> 7) % 4;
    const c1 = palette[0];
    const c2 = palette[1];
    const c3 = palette[2];
    return { c1, c2, c3, layout, emblem };
  }, [iso2, seed]);

  const width = size * 1.5;
  const height = size;
  const { c1, c2, c3, layout, emblem } = design;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox="0 0 30 20"
      role="img"
      aria-label={title ?? 'flag'}
      style={{ borderRadius: Math.max(2, size * 0.09), display: 'block' }}
    >
      <defs>
        <linearGradient id={`sheen-${iso2 ?? 'x'}-${seed ?? ''}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <rect width="30" height="20" fill={c1} />
      {layout === 0 && (
        <>
          <rect y="6.6" width="30" height="6.8" fill={c2} />
          <rect y="13.4" width="30" height="6.6" fill={c3} />
        </>
      )}
      {layout === 1 && (
        <>
          <rect x="10" width="10" height="20" fill={c2} />
          <rect x="20" width="10" height="20" fill={c3} />
        </>
      )}
      {layout === 2 && (
        <>
          <polygon points="0,0 30,0 0,20" fill={c2} />
          <polygon points="0,20 30,20 30,0" fill={c3} opacity="0.9" />
        </>
      )}
      {layout === 3 && (
        <>
          <rect width="30" height="11" fill={c2} />
          <rect y="11" width="30" height="9" fill={c3} />
          <rect y="8.6" width="30" height="2.8" fill={c1} />
        </>
      )}
      {layout === 4 && (
        <>
          <rect width="6" height="20" fill={c2} />
          <rect x="6" width="24" height="20" fill={c3} />
        </>
      )}
      {emblem === 0 && <circle cx="15" cy="10" r="3.1" fill={c1} opacity="0.92" />}
      {emblem === 1 && (
        <polygon
          points="15,5.6 16.5,9 20.2,9.2 17.3,11.5 18.3,15.1 15,13.1 11.7,15.1 12.7,11.5 9.8,9.2 13.5,9"
          fill={c2}
          opacity="0.95"
        />
      )}
      {emblem === 2 && (
        <path d="M15 5.8 a4.2 4.2 0 1 1 -0.01 0 z" fill="none" stroke={c2} strokeWidth="1.1" opacity="0.9" />
      )}
      {emblem === 3 && (
        <>
          <rect x="10.5" y="7" width="9" height="6" rx="1" fill={c2} opacity="0.5" />
          <rect x="12" y="8.4" width="6" height="3.2" rx="0.6" fill={c3} opacity="0.7" />
        </>
      )}
      <rect width="30" height="20" fill={`url(#sheen-${iso2 ?? 'x'}-${seed ?? ''})`} />
      <rect x="0.35" y="0.35" width="29.3" height="19.3" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.7" />
    </svg>
  );
}
