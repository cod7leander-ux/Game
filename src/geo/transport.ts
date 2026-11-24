import { approxKm } from './geometry';
import type { GeoPort, RegionGeo, TransportEdge, TransportNetwork } from './types';

/**
 * Strategic transport graph.
 *
 * Edges are gameplay-relevant connections, not road centre-lines: province
 * adjacency becomes a road (or a rail link where both ends are developed),
 * adjacent coastal provinces across a border get a sea lane, and capital /
 * airport provinces connect by air. The graph is computed once from static
 * geography; infrastructure improves capacity during a campaign without
 * rebuilding node positions.
 */
const MAX_SEA_KM = 2600;
const MAX_AIR_KM = 7000;
const AIR_LINKS_PER_HUB = 3;

const addEdge = (
  edges: TransportEdge[],
  seen: Set<string>,
  from: RegionGeo,
  to: RegionGeo,
  kind: TransportEdge['kind'],
  capacity: number,
): void => {
  if (from.id === to.id) return;
  const key = `${kind}:${[from.id, to.id].sort().join('|')}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({
    id: key,
    fromRegionId: from.id,
    toRegionId: to.id,
    kind,
    distanceKm: approxKm(from.centroid, to.centroid),
    capacity,
    bidirectional: true,
  });
};

export const buildTransportNetwork = (
  regions: RegionGeo[],
  airports: Array<{ regionId: string; level: number }>,
  ports: GeoPort[],
): TransportNetwork => {
  const byId = new Map(regions.map((region) => [region.id, region]));
  const edges: TransportEdge[] = [];
  const seen = new Set<string>();
  const airportRegions = new Set(airports.map((airport) => airport.regionId));
  const portRegions = new Set(ports.map((port) => port.regionId));

  for (const region of regions) {
    for (const neighbourId of region.neighbours) {
      const neighbour = byId.get(neighbourId);
      if (!neighbour) continue;
      if (neighbourId < region.id) continue;
      const sameCountry = neighbour.countryId === region.countryId;
      const developed =
        region.areaKm2 > 0 &&
        neighbour.areaKm2 > 0 &&
        (region.bounds.maxLon - region.bounds.minLon) > 0.05;
      const kind: TransportEdge['kind'] =
        sameCountry && developed && (region.areaKm2 > 90_000 || neighbour.areaKm2 > 90_000)
          ? 'rail'
          : 'road';
      addEdge(edges, seen, region, neighbour, kind, kind === 'rail' ? 0.85 : 0.6);
    }
  }

  // Sea lanes between nearby ports of different countries.
  const portList = ports
    .map((port) => ({ port, region: byId.get(port.regionId) }))
    .filter((entry): entry is { port: GeoPort; region: RegionGeo } => Boolean(entry.region));
  for (const origin of portList) {
    const candidates = portList
      .filter(
        (entry) =>
          entry.region.countryId !== origin.region.countryId &&
          portRegions.has(entry.region.id),
      )
      .map((entry) => ({
        entry,
        distance: approxKm(origin.region.centroid, entry.region.centroid),
      }))
      .filter((entry) => entry.distance < MAX_SEA_KM)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 2);
    for (const candidate of candidates) {
      addEdge(
        edges,
        seen,
        origin.region,
        candidate.entry.region,
        'sea',
        0.55 + Math.min(0.4, candidate.entry.port.level * 0.08),
      );
    }
  }

  // Air links from each airport hub to its nearest hubs.
  const hubs = airports
    .map((airport) => byId.get(airport.regionId))
    .filter((region): region is RegionGeo => Boolean(region));
  const uniqueHubs = [...new Map(hubs.map((hub) => [hub.id, hub])).values()];
  for (const hub of uniqueHubs) {
    if (!airportRegions.has(hub.id)) continue;
    const nearest = uniqueHubs
      .filter((other) => other.id !== hub.id)
      .map((other) => ({ other, distance: approxKm(hub.centroid, other.centroid) }))
      .filter((entry) => entry.distance < MAX_AIR_KM)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, AIR_LINKS_PER_HUB);
    for (const entry of nearest) {
      addEdge(edges, seen, hub, entry.other, 'air', 0.9);
    }
  }

  const byRegion = new Map<string, TransportEdge[]>();
  for (const edge of edges) {
    (byRegion.get(edge.fromRegionId) ?? byRegion.set(edge.fromRegionId, []).get(edge.fromRegionId)!).push(edge);
    (byRegion.get(edge.toRegionId) ?? byRegion.set(edge.toRegionId, []).get(edge.toRegionId)!).push(edge);
  }

  return { edges, byRegion };
};
