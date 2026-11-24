import { CITIES, capitalOf, type CityDefinition } from '../data/cities';
import { COUNTRY_BY_ID } from '../data/countries';
import {
  REGIONS,
  capitalRegionOf,
  regionsOf,
  type RegionDefinition,
} from '../data/regions';
import { approxKm } from './geometry';
import type { GeoAirport, GeoCity, GeoPoint, GeoPort, CityCategory } from './types';

/**
 * City, airport and port geography.
 *
 * The city catalogue is the hand-curated strategic layer; this module derives
 * the scalable attributes (region, population, strategic/industrial value,
 * airport and port access, category) without duplicating coordinates. Airports
 * and ports are infrastructure points owned by regions, so the production and
 * logistics systems can consume them and a future air/naval layer inherits them
 * unchanged. Only the nearest city of each kind carries the label; a region
 * still owns its infrastructure regardless.
 */

const nearestRegion = (countryId: string, point: GeoPoint): RegionDefinition | undefined => {
  const regions = regionsOf(countryId);
  if (regions.length === 0) return capitalRegionOf(countryId);
  let best = regions[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const region of regions) {
    const distance = approxKm(point, region.position);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = region;
    }
  }
  return best;
};

const cityCategory = (
  city: CityDefinition,
  region: RegionDefinition | undefined,
  hasAirport: boolean,
  hasPort: boolean,
): CityCategory => {
  if (city.tier === 1) return 'capital';
  if (hasPort) return 'port';
  if (hasAirport && (region?.strategicValue ?? 0) > 0.5) return 'airport';
  if ((region?.industryShare ?? 0) > 0.28) return 'industrial';
  if (city.tier === 2) return 'major';
  return 'normal';
};

const estimateCityPopulation = (city: CityDefinition, countryPopulation: number): number => {
  const base =
    city.tier === 1
      ? 0.09
      : city.tier === 2
        ? 0.045
        : 0.018;
  return Math.max(120_000, Math.round(countryPopulation * base));
};

export const GEO_CITIES: GeoCity[] = CITIES.flatMap((city) => {
  const country = COUNTRY_BY_ID[city.countryId];
  const region = nearestRegion(city.countryId, city.position);
  if (!country || !region) return [];
  const hasAirport = region.hasAirport || city.tier === 1;
  const hasPort = region.hasPort;
  const isCapital = capitalOf(city.countryId)?.id === city.id;
  const population = estimateCityPopulation(city, country.basePopulation);
  const strategicValue = Math.min(
    1,
    (isCapital ? 0.65 : 0.2) +
      (city.tier === 2 ? 0.15 : 0) +
      region.strategicValue * 0.25 +
      (hasPort ? 0.08 : 0),
  );
  return [
    {
      id: city.id,
      countryId: city.countryId,
      regionId: region.id,
      name: city.name,
      position: city.position,
      population,
      strategicValue,
      industrialValue: Math.min(1, region.industryShare * 1.6 + region.infrastructure * 0.2),
      hasAirport,
      hasPort,
      isCapital,
      category: cityCategory(city, region, hasAirport, hasPort),
    },
  ];
});

export const GEO_CITY_BY_ID: Record<string, GeoCity> = Object.fromEntries(
  GEO_CITIES.map((city) => [city.id, city]),
);

export const CITIES_BY_REGION: Record<string, GeoCity[]> = {};
for (const city of GEO_CITIES) {
  (CITIES_BY_REGION[city.regionId] ??= []).push(city);
}
for (const list of Object.values(CITIES_BY_REGION)) list.sort((a, b) => a.name.en.localeCompare(b.name.en));

const nearestCityOfCountry = (countryId: string, point: GeoPoint): GeoCity | undefined => {
  let best: GeoCity | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const city of GEO_CITIES) {
    if (city.countryId !== countryId) continue;
    const distance = approxKm(point, city.position);
    if (distance < bestDistance) {
      best = city;
      bestDistance = distance;
    }
  }
  return best;
};

const infrastructureName = (
  base: { en: string; fa: string },
  suffix: { en: string; fa: string },
): { en: string; fa: string } => ({
  en: `${base.en} ${suffix.en}`,
  fa: `${base.fa} ${suffix.fa}`,
});

const regionInfrastructure = (region: RegionDefinition) =>
  Math.max(0.1, Math.min(1, region.infrastructure));

export const GEO_AIRPORTS: GeoAirport[] = REGIONS.filter((region) => region.hasAirport).map(
  (region) => {
    const level = regionInfrastructure(region);
    const city = nearestCityOfCountry(region.countryId, region.position);
    return {
      id: `airport:${region.id}`,
      regionId: region.id,
      countryId: region.countryId,
      name: infrastructureName(region.name, { en: 'Airport', fa: 'فرودگاه' }),
      position: region.position,
      level: Math.max(1, Math.round(level * 5)),
      capacity: Math.round(level * 1000),
      military: region.isCapital || region.strategicValue > 0.55,
      cityId: city?.id ?? null,
    };
  },
);

export const GEO_PORTS: GeoPort[] = REGIONS.filter((region) => region.hasPort).map((region) => {
  const level = regionInfrastructure(region);
  const city = nearestCityOfCountry(region.countryId, region.position);
  return {
    id: `port:${region.id}`,
    regionId: region.id,
    countryId: region.countryId,
    name: infrastructureName(region.name, { en: 'Port', fa: 'بندر' }),
    position: region.position,
    level: Math.max(1, Math.round(level * 4)),
    capacity: Math.round(level * 1800),
    navalAccess: true,
    cityId: city?.id ?? null,
  };
});

export const AIRPORTS_BY_REGION: Record<string, GeoAirport[]> = {};
for (const airport of GEO_AIRPORTS) (AIRPORTS_BY_REGION[airport.regionId] ??= []).push(airport);

export const PORTS_BY_REGION: Record<string, GeoPort[]> = {};
for (const port of GEO_PORTS) (PORTS_BY_REGION[port.regionId] ??= []).push(port);

export const cityById = (id: string): GeoCity | undefined => GEO_CITY_BY_ID[id];

export const cityTier = (city: GeoCity): 1 | 2 | 3 =>
  city.isCapital ? 1 : city.category === 'major' || city.category === 'industrial' ? 2 : 3;

export const regionAirports = (regionId: string): GeoAirport[] => AIRPORTS_BY_REGION[regionId] ?? [];
export const regionPorts = (regionId: string): GeoPort[] => PORTS_BY_REGION[regionId] ?? [];
export const regionCities = (regionId: string): GeoCity[] => CITIES_BY_REGION[regionId] ?? [];
