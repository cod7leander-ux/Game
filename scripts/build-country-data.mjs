#!/usr/bin/env node
/**
 * Builds the compact runtime country dataset from Natural Earth 1:110m
 * (public domain) admin-0 countries.
 *
 *   node scripts/build-country-data.mjs <path-to-ne_110m_admin_0_countries.geojson>
 *
 * Output: src/data/countries.json
 *
 * Only the fields the simulation and renderer need are kept. Geometry is
 * stored as MultiPolygon rings of [lon, lat] pairs, which keeps the pipeline
 * independent from any specific geo library at runtime.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] ?? '/tmp/assets/countries.geojson';
const target = resolve(here, '../src/data/countries.json');

const raw = JSON.parse(readFileSync(source, 'utf8'));

/** Fixed fallbacks for Natural Earth's occasional numeric ISO codes. */
const ISO_FIX = { '-99': null };

const round = (n, p = 4) => Number(n.toFixed(p));

const countries = [];
const shapes = [];

for (const feature of raw.features) {
  const p = feature.properties;
  const iso3 = p.ADM0_A3 && p.ADM0_A3 !== '-99' ? p.ADM0_A3 : p.SOV_A3;
  if (!iso3 || !feature.geometry) continue;
  if (p.TYPE === 'Indeterminate') continue;

  const id = String(iso3);
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates
        : [];

  const shapePolygons = [];
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const polygon of polygons) {
    const [outer, ...holes] = polygon;
    if (!outer || outer.length < 4) continue;
    const project = (ring) =>
      ring.map(([lon, lat]) => {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        return [round(lon, 4), round(lat, 4)];
      });
    shapePolygons.push({
      outer: project(outer),
      holes: holes.filter((ring) => ring.length >= 4).map(project),
    });
  }
  if (!shapePolygons.length) continue;

  countries.push({
    id,
    name: { en: p.NAME_EN || p.NAME || id, fa: p.NAME_FA || p.NAME_EN || id },
    iso2: p.ISO_A2 && p.ISO_A2 !== '-99' ? p.ISO_A2 : (ISO_FIX[p.ISO_A2] ?? null),
    continent: p.CONTINENT || 'Unknown',
    subregion: p.SUBREGION || '',
    population: Math.max(10_000, Math.round(p.POP_EST ?? 1_000_000)),
    gdpMillions: Math.max(10, Math.round(p.GDP_MD ?? 1_000)),
    capital: null,
    label: [round(p.LABEL_X ?? (minLon + maxLon) / 2, 3), round(p.LABEL_Y ?? (minLat + maxLat) / 2, 3)],
    bounds: [round(minLon, 3), round(minLat, 3), round(maxLon, 3), round(maxLat, 3)],
    rank: p.LABELRANK ?? 8,
  });
  shapes.push({ id, polygons: shapePolygons });
}

countries.sort((a, b) => a.name.en.localeCompare(b.name.en));
shapes.sort((a, b) => a.id.localeCompare(b.id));

mkdirSync(dirname(target), { recursive: true });
writeFileSync(
  target,
  JSON.stringify({
    source: 'Natural Earth 1:110m Admin-0 Countries (public domain)',
    version: 1,
    countries,
    shapes,
  }),
);

console.log(
      `wrote ${target}: ${countries.length} countries, ${shapes.reduce((n, s) => n + s.polygons.length, 0)} polygons, ` +
    `${(JSON.stringify({ countries, shapes }).length / 1024).toFixed(0)} KiB`,
);
