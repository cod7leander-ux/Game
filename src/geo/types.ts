import type { LocalizedText } from '../i18n/types';
import type { GeoBounds } from '../gameplay/country/types';
import type { ResourceId } from '../gameplay/economy/types';

/**
 * Geographic data model.
 *
 * This is the presentation-independent geography contract: raw GIS data is
 * normalised into these records once, gameplay references ids only, and the
 * renderer consumes the same records. Swapping the bundled provider for a
 * higher-resolution dataset therefore never touches simulation code.
 *
 * Coordinate convention: every point is `[longitude, latitude]` in degrees,
 * WGS84 / EPSG:4326. Rings are open (the closing point is added by geometry
 * helpers), exteriors are counter-clockwise by convention but every consumer
 * treats winding as irrelevant.
 */

export type GeoPoint = [number, number];
export type GeoRing = GeoPoint[];

export interface GeoPolygon {
  /** Exterior ring in [lon, lat]. */
  outer: GeoRing;
  /** Interior rings (lakes, enclaves) that must not be filled. */
  holes: GeoRing[];
}

export interface GeoShape {
  polygons: GeoPolygon[];
  /** Area-weighted centre of the shape. */
  centroid: GeoPoint;
  bounds: GeoBounds;
  /** Approximate spherical area in square kilometres. */
  areaKm2: number;
}

export type RegionGeometrySource = 'natural-earth-110m+build-province' | 'admin-1-geojson' | 'imported';

export interface RegionGeo {
  id: string;
  countryId: string;
  name: LocalizedText;
  /** Territory cells that make up this province. */
  polygons: GeoPolygon[];
  centroid: GeoPoint;
  bounds: GeoBounds;
  areaKm2: number;
  /** Adjacent regions, same country or across a border. */
  neighbours: string[];
  /** Countries bordering this region's country (for route planning). */
  neighbouringCountries: string[];
  /** Stable reference into the geographic dataset, never a geometry blob in saves. */
  geometryRef: string;
  source: RegionGeometrySource;
}

export interface CountryGeo {
  id: string;
  name: LocalizedText;
  iso2: string | null;
  capital: LocalizedText | null;
  polygons: GeoPolygon[];
  centroid: GeoPoint;
  bounds: GeoBounds;
  areaKm2: number;
  coastal: boolean;
  neighbours: string[];
  /** `capital` is the ids of the country's strategic cities, in tier order. */
  cities: string[];
  regions: string[];
  geometryRef: string;
}

export type CityCategory =
  | 'capital'
  | 'major'
  | 'industrial'
  | 'port'
  | 'airport'
  | 'normal';

export interface GeoCity {
  id: string;
  countryId: string;
  regionId: string;
  name: LocalizedText;
  position: GeoPoint;
  population: number;
  strategicValue: number;
  industrialValue: number;
  hasAirport: boolean;
  hasPort: boolean;
  isCapital: boolean;
  category: CityCategory;
}

export interface GeoAirport {
  id: string;
  regionId: string;
  countryId: string;
  name: LocalizedText;
  position: GeoPoint;
  level: number;
  capacity: number;
  military: boolean;
  cityId: string | null;
}

export interface GeoPort {
  id: string;
  regionId: string;
  countryId: string;
  name: LocalizedText;
  position: GeoPoint;
  level: number;
  capacity: number;
  navalAccess: boolean;
  cityId: string | null;
}

export type TransportKind = 'road' | 'rail' | 'sea' | 'air';

export interface TransportEdge {
  id: string;
  fromRegionId: string;
  toRegionId: string;
  kind: TransportKind;
  distanceKm: number;
  capacity: number;
  bidirectional: boolean;
}

export interface TransportNetwork {
  edges: TransportEdge[];
  /** Adjacency used by pathfinding and supply. */
  byRegion: Map<string, TransportEdge[]>;
}

export type GeoIssueSeverity = 'error' | 'warning';

export interface GeoIssue {
  severity: GeoIssueSeverity;
  code:
    | 'duplicate-id'
    | 'unknown-country'
    | 'unknown-region'
    | 'invalid-coordinate'
    | 'invalid-ring'
    | 'invalid-bounds'
    | 'invalid-centroid'
    | 'broken-adjacency'
    | 'duplicate-adjacency'
    | 'orphan-region'
    | 'missing-city'
    | 'invalid-transport';
  message: string;
  ref?: string;
}

export interface GeoValidationReport {
  issues: GeoIssue[];
  errors: number;
  warnings: number;
  countries: number;
  regions: number;
  cities: number;
  airports: number;
  ports: number;
  transportEdges: number;
  valid: boolean;
}

/**
 * The seam a real GIS dataset plugs into. Everything the simulation needs is
 * available from this interface; the bundled implementation is the fallback
 * provider (Natural Earth countries + deterministic province partition).
 */
export interface GeographicDataProvider {
  readonly id: string;
  readonly label: string;
  readonly regionSource: RegionGeometrySource;
  countries(): CountryGeo[];
  country(countryId: string): CountryGeo | undefined;
  regions(): RegionGeo[];
  regionsOf(countryId: string): RegionGeo[];
  region(regionId: string): RegionGeo | undefined;
  cities(): GeoCity[];
  city(cityId: string): GeoCity | undefined;
  airports(): GeoAirport[];
  ports(): GeoPort[];
  transport(): TransportNetwork;
  /** Country-level adjacency derived from real boundaries. */
  countryNeighbours(countryId: string): string[];
  validate(): GeoValidationReport;
  /** Cached province render cells for a country, if the provider supplies them. */
  cellsOf(countryId: string): ProvinceCell[];
}

/** One triangulated territory cell, used for batched province rendering. */
export interface ProvinceCell {
  regionId: string;
  countryId: string;
  /** Flat `[lon, lat, lon, lat, lon, lat]` triangle in unwrapped coordinates. */
  triangle: [number, number, number, number, number, number];
}

export interface RegionResourceSummary {
  id: ResourceId;
  amount: number;
  richness: number;
}
