import { PerspectiveCamera, Vector3 } from 'three';
import { CAMERA, GAME } from '../core/config';
import { clamp, damp, DEG2RAD, shortestAngle, wrapLongitude } from '../core/math';

/**
 * Orbital surface camera.
 *
 * The rig is parameterised by a focus point on the globe (lon/lat) plus
 * altitude, heading and tilt. One continuous scale covers the whole zoom
 * ladder (world → country → region → city) without swapping controllers, so the
 * player never experiences a camera mode switch.
 */
const R = GAME.globeRadius;

export class CameraRig {
  readonly camera: PerspectiveCamera;

  /** Rendered values (damped). */
  private lon: number = 12;
  private lat: number = 26;
  private altitude: number = CAMERA.startAltitude;
  private heading: number = 0;
  private tilt: number = 0.34;

  /** Target values. */
  private targetLon: number = 12;
  private targetLat: number = 26;
  private targetAltitude: number = CAMERA.startAltitude;
  private targetHeading: number = 0;
  private targetTilt: number = 0.34;

  private readonly focus = new Vector3();
  private readonly position = new Vector3();
  private autoRotateSpeed = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(42, aspect, 0.01, R * 120);
  }

  get altitudeRatio(): number {
    return this.altitude;
  }

  /** Slow cinematic drift used behind the main menu. */
  setAutoRotate(speed: number): void {
    this.autoRotateSpeed = speed;
  }

  get focusLonLat(): [number, number] {
    return [this.lon, this.lat];
  }

  get detailFactor(): number {
    // 0 at world scale, 1 at street scale — drives terrain shading detail.
    const normalized = clamp(1 - Math.log10(1 + this.altitude * 9) / Math.log10(1 + 9 * 1.4), 0, 1);
    return normalized;
  }

  rotate(deltaX: number, deltaY: number): void {
    this.targetHeading += deltaX * CAMERA.rotateSpeed;
    this.targetTilt = clamp(this.targetTilt + deltaY * CAMERA.rotateSpeed, 0.05, CAMERA.maxTilt);
  }

  pan(deltaX: number, deltaY: number): void {
    const scale = CAMERA.panSpeed * (0.35 + this.altitude * 1.4);
    const latitudeScale = Math.max(0.35, Math.cos(this.lat * DEG2RAD));
    this.targetLon = wrapLongitude(this.targetLon - deltaX * scale / latitudeScale);
    this.targetLat = clamp(this.targetLat + deltaY * scale, -84, 84);
  }

  zoom(deltaY: number): void {
    const factor = Math.exp(deltaY * CAMERA.zoomSpeed);
    this.targetAltitude = clamp(
      this.targetAltitude * factor,
      CAMERA.minAltitude,
      CAMERA.maxAltitude,
    );
  }

  flyTo(lon: number, lat: number, altitude = 0.16, durationHint?: number): void {
    void durationHint;
    this.targetLon = wrapLongitude(lon);
    this.targetLat = clamp(lat, -84, 84);
    this.targetAltitude = clamp(altitude, CAMERA.minAltitude, CAMERA.maxAltitude);
  }

  setAltitude(altitude: number): void {
    this.targetAltitude = clamp(altitude, CAMERA.minAltitude, CAMERA.maxAltitude);
  }

  snap(lon: number, lat: number, altitude: number): void {
    this.targetLon = lon;
    this.targetLat = lat;
    this.targetAltitude = altitude;
    this.lon = lon;
    this.lat = lat;
    this.altitude = altitude;
  }

  update(deltaSeconds: number): void {
    // Cap only pathological frames: on slow devices the camera must still
    // converge in real time rather than crawling frame by frame.
    const dt = Math.min(0.25, deltaSeconds);
    if (this.autoRotateSpeed !== 0) {
      this.targetLon = wrapLongitude(this.targetLon + this.autoRotateSpeed * dt);
    }
    this.lon = wrapLongitude(this.lon + shortestAngle(this.lon, this.targetLon) * (1 - Math.exp(-CAMERA.damping * 0.6 * dt)));
    this.lat = damp(this.lat, this.targetLat, CAMERA.damping * 0.6, dt);
    this.altitude = damp(this.altitude, this.targetAltitude, CAMERA.damping, dt);
    this.heading = damp(this.heading, this.targetHeading, CAMERA.damping, dt);
    this.tilt = damp(this.tilt, this.targetTilt, CAMERA.damping, dt);

    this.computePosition();
  }

  private computePosition(): void {
    const phi = this.lat * DEG2RAD;
    const lambda = this.lon * DEG2RAD;
    const cosPhi = Math.cos(phi);
    const nx = cosPhi * Math.sin(lambda);
    const ny = Math.sin(phi);
    const nz = cosPhi * Math.cos(lambda);

    this.focus.set(nx * R, ny * R, nz * R);

    // East/north tangent frame at the focus point.
    let eastX = nz;
    let eastY = 0;
    let eastZ = -nx;
    const eastLength = Math.hypot(eastX, eastY, eastZ) || 1;
    eastX /= eastLength;
    eastZ /= eastLength;

    const northX = ny * eastZ - nz * eastY;
    const northY = nz * eastX - nx * eastZ;
    const northZ = nx * eastY - ny * eastX;

    const sinTilt = Math.sin(this.tilt);
    const cosTilt = Math.cos(this.tilt);
    const sinHeading = Math.sin(this.heading);
    const cosHeading = Math.cos(this.heading);

    const dirX = nx * cosTilt + (northX * cosHeading + eastX * sinHeading) * sinTilt;
    const dirY = ny * cosTilt + (northY * cosHeading + eastY * sinHeading) * sinTilt;
    const dirZ = nz * cosTilt + (northZ * cosHeading + eastZ * sinHeading) * sinTilt;

    const distance = R * (this.altitude + 0.02);
    this.position.set(this.focus.x + dirX * distance, this.focus.y + dirY * distance, this.focus.z + dirZ * distance);

    this.camera.position.copy(this.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.focus);
    this.camera.near = Math.max(0.02, distance * 0.02);
    this.camera.far = R * 120;
    this.camera.updateProjectionMatrix();
  }
}
