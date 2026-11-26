import { GAME } from '../core/config';
import { hashString } from '../core/math';

/**
 * Display anchor for an installation.
 *
 * Airports are catalogued at their city and ports at the coast point, so the
 * procedural field would sit under the city blocks. The renderer and the camera
 * share this deterministic tangent offset: the strategic data keeps its real
 * coordinates, while the 3D installation sits on the city outskirts.
 */
const R = GAME.globeRadius;
const DEG = Math.PI / 180;

export const baseAnchor = (
  kind: 'airport' | 'port',
  id: string,
  lon: number,
  lat: number,
): [number, number] => {
  const hash = hashString(id);
  const angle = ((hash >>> 9) % 360) * DEG;
  const apron = kind === 'airport' ? 0.034 : 0.005;
  const east = Math.cos(angle) * apron;
  const north = Math.sin(angle) * apron;
  const lonOffset = (east / (R * Math.max(0.2, Math.cos(lat * DEG)))) / DEG;
  const latOffset = north / R / DEG;
  return [lon + lonOffset, lat + latOffset];
};
