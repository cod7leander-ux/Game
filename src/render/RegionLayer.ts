import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { GAME } from '../core/config';
import { ALL_REGION_GEO, PROVINCE_BORDER_SEGMENTS, cellsOfCountry } from '../geo';
import type { MapLayerId, MapRegionView } from '../game/types';
import { subdivideTriangle, surfaceReliefAt } from './globeGeography';

/**
 * Batched province territory layer.
 *
 * All provinces are one vertex-coloured mesh (one draw call) plus one border
 * line mesh. Geometry is generated once from the geographic provider's cells;
 * changing map layer only rewrites the colour attribute, and only when the
 * derived values actually changed. Selection reuses a tiny cached geometry.
 *
 * No per-region mesh, no per-frame recomputation, no polygon scan.
 */
const R = GAME.globeRadius;
/** Overlays hug the displaced terrain: a fixed shell would float above it up close. */
const FILL_OFFSET = 0.0012;
const BORDER_OFFSET = 0.0026;
const SELECTION_OFFSET = 0.0038;
const DEG = Math.PI / 180;

const REGION_OWNER: Record<string, string> = Object.fromEntries(
  ALL_REGION_GEO.map((region) => [region.id, region.countryId]),
);

const TONE_COLORS: Record<MapRegionView['tone'], string> = {
  player: '#3ee6a8',
  ally: '#58a6ff',
  neutral: '#b9a577',
  enemy: '#ff6b5a',
  occupied: '#ff9d4d',
};

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const ramp = (value: number, from: string, to: string, out: Color): Color => {
  const a = new Color(from);
  const b = new Color(to);
  const t = Math.max(0, Math.min(1, value));
  out.setRGB(lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t));
  return out;
};

const pointToXYZ = (lon: number, lat: number, radius: number): [number, number, number] => {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  return [
    radius * Math.cos(phi) * Math.sin(lambda),
    radius * Math.sin(phi),
    radius * Math.cos(phi) * Math.cos(lambda),
  ];
};

export class RegionLayer {
  readonly object = new Group();
  private readonly fillGeometry = new BufferGeometry();
  private readonly fillMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  private readonly fillMesh: Mesh;
  private readonly borderGeometry = new BufferGeometry();
  private readonly borderMaterial = new LineBasicMaterial({
    color: '#08131f',
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  private readonly borderLines: LineSegments;
  private readonly selectionMaterial = new MeshBasicMaterial({
    color: '#ffd66b',
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  private selectionMesh: Mesh | null = null;
  private selectionGeometry: BufferGeometry | null = null;
  private readonly ranges = new Map<string, { start: number; count: number }>();
  private readonly cellTriangles = new Map<string, Float32Array>();
  private readonly color = new Color();
  private signature = '';

  constructor() {
    const positions: number[] = [];
    const colors: number[] = [];
    const borderPositions: number[] = [];

    const countryIds = Object.keys(PROVINCE_BORDER_SEGMENTS);
    for (const countryId of countryIds) {
      for (const cell of cellsOfCountry(countryId)) {
        const range = this.ranges.get(cell.regionId);
        const start = range ? range.start : positions.length / 3;
        // The same adaptive tessellation as the rendered surface, so the
        // province fill hugs every refined ridge instead of cutting through it.
        const refined = subdivideTriangle(cell.triangle);
        let triangles = this.cellTriangles.get(cell.regionId);
        if (!triangles) {
          triangles = new Float32Array(0);
          this.cellTriangles.set(cell.regionId, triangles);
        }
        const next = new Float32Array(triangles.length + refined.length);
        next.set(triangles);
        next.set(refined, triangles.length);
        this.cellTriangles.set(cell.regionId, next);

        for (let offset = 0; offset < refined.length; offset += 2) {
          const lon = refined[offset];
          const lat = refined[offset + 1];
          const [x, y, z] = pointToXYZ(
            lon,
            lat,
            R + surfaceReliefAt(countryId, lon, lat) + FILL_OFFSET,
          );
          positions.push(x, y, z);
          colors.push(0.5, 0.5, 0.5);
        }
        this.ranges.set(cell.regionId, {
          start,
          count: positions.length / 3 - start,
        });
      }
      for (const [aLon, aLat, bLon, bLat] of PROVINCE_BORDER_SEGMENTS[countryId]) {
        let previous = pointToXYZ(
          aLon,
          aLat,
          R + surfaceReliefAt(countryId, aLon, aLat) + BORDER_OFFSET,
        );
        for (let step = 1; step <= 3; step += 1) {
          const t = step / 3;
          const lon = aLon + (bLon - aLon) * t;
          const lat = aLat + (bLat - aLat) * t;
          const next = pointToXYZ(
            lon,
            lat,
            R + surfaceReliefAt(countryId, lon, lat) + BORDER_OFFSET,
          );
          borderPositions.push(...previous, ...next);
          previous = next;
        }
      }
    }

    this.fillGeometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    this.fillGeometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    this.fillGeometry.computeBoundingSphere();
    this.fillMesh = new Mesh(this.fillGeometry, this.fillMaterial);
    this.fillMesh.frustumCulled = false;
    this.fillMesh.renderOrder = 1;

    this.borderGeometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(borderPositions), 3),
    );
    this.borderGeometry.computeBoundingSphere();
    this.borderLines = new LineSegments(this.borderGeometry, this.borderMaterial);
    this.borderLines.frustumCulled = false;
    this.borderLines.renderOrder = 2;

    this.object.add(this.fillMesh, this.borderLines);
    this.object.visible = false;
  }

  setLayer(layer: MapLayerId): void {
    this.fillMaterial.opacity = layer === 'terrain' ? 0.42 : layer === 'political' ? 0.28 : 0.44;
    this.borderMaterial.opacity = layer === 'terrain' ? 0.18 : 0.26;
    this.borderMaterial.color.set(layer === 'political' ? '#08131f' : '#0b1a26');
  }

  /** Recolours only when the layer or the derived region values changed. */
  setVisuals(views: MapRegionView[], layer: MapLayerId): void {
    this.setLayer(layer);
    // No campaign yet means no provinces to tint; keep the world clean.
    this.object.visible = views.length > 0;
    const signature = `${layer}|${views.length}|${views
      .map((view) =>
        `${view.id}:${view.tone}:${view.selected ? 1 : 0}:${view.population.toFixed(2)}:${view.economy.toFixed(2)}:${view.infrastructure.toFixed(2)}:${view.supply.toFixed(2)}:${view.military.toFixed(2)}:${view.diplomacy.toFixed(2)}:${view.objectives.toFixed(2)}:${view.resourceId ?? ''}:${view.resourceIntensity.toFixed(2)}`,
      )
      .join(';')}`;
    if (signature === this.signature) return;
    this.signature = signature;

    const colors = this.fillGeometry.getAttribute('color') as BufferAttribute | undefined;
    if (!colors) return;
    for (const view of views) {
      const range = this.ranges.get(view.id);
      if (!range) continue;
      this.colorFor(view, layer, this.color);
      for (let index = range.start; index < range.start + range.count; index += 1) {
        colors.setXYZ(index, this.color.r, this.color.g, this.color.b);
      }
    }
    colors.needsUpdate = true;
  }

  private colorFor(view: MapRegionView, layer: MapLayerId, out: Color): Color {
    switch (layer) {
      case 'political':
      case 'diplomacy': {
        out.set(TONE_COLORS[view.tone]);
        if (view.controlStatus === 'contested') out.lerp(new Color('#ffd166'), 0.55);
        else if (view.controlStatus === 'recentlyCaptured') out.lerp(new Color('#ff8f4d'), 0.5);
        else if (view.occupied) out.lerp(new Color('#ff7a3d'), 0.35);
        return out;
      }
      case 'frontline': {
        if (!view.frontier) return out.set('#111821');
        const pressure = Math.max(0, Math.min(1, view.frontlinePressure));
        return out.set('#ff6b5a').lerp(new Color('#58a6ff'), pressure);
      }
      case 'terrain':
        return out.set(view.terrainColor);
      case 'population':
        return ramp(view.population, '#13202e', '#7ff0d0', out);
      case 'economy':
        return ramp(view.economy, '#241d10', '#ffd66b', out);
      case 'resources': {
        if (!view.resourceColor) return out.set('#1a2028');
        ramp(view.resourceIntensity, '#1a2028', view.resourceColor, out);
        return out;
      }
      case 'infrastructure':
        return ramp(view.infrastructure, '#141c24', '#a7dcff', out);
      case 'supply':
        return ramp(view.supply, '#4a1515', '#6dffb0', out);
      case 'military':
        return ramp(view.military, '#1a1f28', view.atWar ? '#ff6b5a' : '#ffb454', out);
      case 'objectives':
        return view.objectives > 0.5
          ? out.set('#ff4fd8').lerp(new Color('#ffd66b'), 0.35)
          : out.set('#1a1f28');
      default:
        return out.set(TONE_COLORS.neutral);
    }
  }

  setSelected(regionId: string | null): void {
    if (!regionId) {
      if (this.selectionMesh) this.selectionMesh.visible = false;
      return;
    }
    if (!this.selectionGeometry) this.selectionGeometry = new BufferGeometry();
    const triangles = this.cellTriangles.get(regionId);
    if (!triangles || triangles.length === 0) {
      if (this.selectionMesh) this.selectionMesh.visible = false;
      return;
    }
    const positions = new Float32Array(triangles.length * 1.5);
    for (let vertex = 0; vertex < triangles.length / 2; vertex += 1) {
      const lon = triangles[vertex * 2];
      const lat = triangles[vertex * 2 + 1];
      const owner = REGION_OWNER[regionId];
      const [x, y, z] = pointToXYZ(
        lon,
        lat,
        R + surfaceReliefAt(owner ?? '', lon, lat) + SELECTION_OFFSET,
      );
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = z;
    }
    this.selectionGeometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.selectionGeometry.computeBoundingSphere();
    if (!this.selectionMesh) {
      this.selectionMesh = new Mesh(this.selectionGeometry, this.selectionMaterial);
      this.selectionMesh.frustumCulled = false;
      this.selectionMesh.renderOrder = 3;
      this.object.add(this.selectionMesh);
    } else {
      this.selectionMesh.geometry = this.selectionGeometry;
    }
    this.selectionMesh.position.y = 0;
    this.selectionMesh.visible = true;
  }

  dispose(): void {
    this.fillGeometry.dispose();
    this.borderGeometry.dispose();
    this.selectionGeometry?.dispose();
    this.fillMaterial.dispose();
    this.borderMaterial.dispose();
    this.selectionMaterial.dispose();
    this.selectionMesh?.geometry.dispose();
  }
}
