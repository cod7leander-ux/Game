import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  Points,
  PointsMaterial,
} from 'three';
import { GAME } from '../core/config';
import { GEO_AIRPORTS, GEO_CITIES, GEO_PORTS, cityTier } from '../geo';
import type { GeoPoint } from '../geo';

/**
 * City and infrastructure LOD layer.
 *
 * Three city point clouds (capital / major / minor) and two infrastructure
 * clouds (airports / ports). Visibility is a pure function of camera altitude,
 * so a planet with thousands of cities never draws thousands of labels or
 * objects. Each cloud is one draw call and static geometry.
 */
const R = GAME.globeRadius;
const DEG = Math.PI / 180;

const toXYZ = (point: GeoPoint, radius: number): [number, number, number] => {
  const phi = point[1] * DEG;
  const lambda = point[0] * DEG;
  return [
    radius * Math.cos(phi) * Math.sin(lambda),
    radius * Math.sin(phi),
    radius * Math.cos(phi) * Math.cos(lambda),
  ];
};

const makeCloud = (
  points: GeoPoint[],
  color: string,
  size: number,
  opacity: number,
): Points => {
  const positions = new Float32Array(points.length * 3);
  for (let index = 0; index < points.length; index += 1) {
    const [x, y, z] = toXYZ(points[index], R * 1.019);
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const cloud = new Points(geometry, material);
  cloud.frustumCulled = false;
  cloud.visible = false;
  return cloud;
};

export class CityLayer {
  readonly object = new Group();
  private readonly capitals = makeCloud(
    GEO_CITIES.filter((city) => cityTier(city) === 1).map((city) => city.position),
    '#ffd66b',
    0.085,
    0.95,
  );
  private readonly majors = makeCloud(
    GEO_CITIES.filter((city) => cityTier(city) === 2).map((city) => city.position),
    '#8fd8ff',
    0.06,
    0.9,
  );
  private readonly minors = makeCloud(
    GEO_CITIES.filter((city) => cityTier(city) === 3).map((city) => city.position),
    '#7fb3c9',
    0.045,
    0.8,
  );
  private readonly airports = makeCloud(
    GEO_AIRPORTS.map((airport) => airport.position),
    '#ffb454',
    0.05,
    0.9,
  );
  private readonly ports = makeCloud(
    GEO_PORTS.map((port) => port.position),
    '#58a6ff',
    0.05,
    0.9,
  );
  private readonly clouds: Points[];

  constructor() {
    this.clouds = [this.capitals, this.majors, this.minors, this.airports, this.ports];
    this.object.add(...this.clouds);
  }

  /**
   * @param altitude camera altitude ratio (fraction of globe radius)
   * @param enabled user preference for city markers
   */
  update(altitude: number, enabled: boolean): void {
    this.capitals.visible = enabled && altitude < 2.6;
    this.majors.visible = enabled && altitude < 0.95;
    this.minors.visible = enabled && altitude < 0.3;
    const infrastructure = enabled && altitude < 0.2;
    this.airports.visible = infrastructure;
    this.ports.visible = infrastructure;
    const scale = Math.min(1.6, Math.max(0.55, 0.5 + altitude * 0.9));
    for (const cloud of this.clouds) {
      (cloud.material as PointsMaterial).size =
        (cloud === this.capitals ? 0.085 : cloud === this.majors ? 0.06 : 0.045) * scale;
    }
  }

  dispose(): void {
    for (const cloud of this.clouds) {
      cloud.geometry.dispose();
      (cloud.material as PointsMaterial).dispose();
    }
  }
}
