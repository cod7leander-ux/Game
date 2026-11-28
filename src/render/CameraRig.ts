import { PerspectiveCamera, Vector3 } from 'three';
import { CAMERA, GAME } from '../core/config';
import { clamp, damp, DEG2RAD, RAD2DEG, shortestAngle, wrapLongitude } from '../core/math';
import type { DirectCameraTarget } from '../gameplay/direct/types';

/**
 * Orbital surface camera with a direct-control follow mode.
 *
 * The rig is parameterised by a focus point on the globe (lon/lat) plus
 * altitude, heading and tilt. One continuous scale covers the whole zoom
 * ladder (world → country → region → city → battlefield → unit) without
 * swapping controllers. When the player takes a unit, the same rig blends into
 * a chase or cockpit camera at that unit: no second camera, no cut.
 */
const R = GAME.globeRadius;
const WORLD_UP = new Vector3(0, 1, 0);

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
  private readonly lookTarget = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly normal = new Vector3();
  private readonly east = new Vector3();
  private readonly north = new Vector3();
  private readonly unitPosition = new Vector3();
  private readonly smoothUnitPosition = new Vector3();
  private directUnitReady = false;
  private readonly directCameraPosition = new Vector3();
  private readonly directLookTarget = new Vector3();
  private readonly directForward = new Vector3();
  private autoRotateSpeed = 0;

  /** Direct-control follow state. */
  private directTarget: DirectCameraTarget | null = null;
  private directBlend = 0;
  private directYawOffset = 0;
  private directPitchOffset = 0;
  private directZoom = 1;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(42, aspect, 0.01, R * 120);
  }

  get altitudeRatio(): number {
    return this.altitude;
  }

  get isDirect(): boolean {
    return this.directTarget !== null;
  }

  get directZoomLevel(): number {
    return this.directZoom;
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
    if (this.directTarget) {
      // Free look around the controlled unit without losing the chase frame.
      this.directYawOffset = clamp(this.directYawOffset + deltaX * 0.005, -Math.PI, Math.PI);
      this.directPitchOffset = clamp(this.directPitchOffset + deltaY * 0.004, -0.45, 0.7);
      return;
    }
    this.targetHeading += deltaX * CAMERA.rotateSpeed;
    this.targetTilt = clamp(this.targetTilt + deltaY * CAMERA.rotateSpeed, 0.05, CAMERA.maxTilt);
  }

  pan(deltaX: number, deltaY: number): void {
    if (this.directTarget) return;
    const scale = CAMERA.panSpeed * (0.35 + this.altitude * 1.4);
    const latitudeScale = Math.max(0.35, Math.cos(this.lat * DEG2RAD));
    this.targetLon = wrapLongitude(this.targetLon - deltaX * scale / latitudeScale);
    this.targetLat = clamp(this.targetLat + deltaY * scale, -84, 84);
  }

  zoom(deltaY: number): void {
    const factor = Math.exp(deltaY * CAMERA.zoomSpeed);
    if (this.directTarget) {
      this.directZoom = clamp(this.directZoom * factor, 0.42, 2.4);
      return;
    }
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

  /** Focus actions set a presentation tilt (city approach, airfield view). */
  setTilt(tilt: number): void {
    this.targetTilt = clamp(tilt, 0.05, CAMERA.maxTilt);
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

  /**
   * Hands the rig a unit pose each frame. Passing null releases it and lets the
   * camera blend back to the strategic orbit.
   */
  setDirectTarget(target: DirectCameraTarget | null): void {
    if (target && !this.directTarget) {
      // Entering direct control: keep the orbit focus so the blend starts at
      // the spot the player was already looking at.
      this.directYawOffset = 0;
      this.directPitchOffset = 0;
      this.directZoom = 1;
      this.directUnitReady = false;
    }
    this.directTarget = target;
  }

  update(deltaSeconds: number): void {
    // Cap only pathological frames: on slow devices the camera must still
    // converge in real time rather than crawling frame by frame.
    const dt = Math.min(0.25, deltaSeconds);

    if (this.directTarget) {
      // Keep the orbit focus beneath the unit so leaving direct control lands
      // exactly where the player was flying or driving.
      this.targetLon = this.directTarget.lon;
      this.targetLat = clamp(this.directTarget.lat, -84, 84);
      // Longitudes are degrees; the angle helper works in radians.
      this.lon = wrapLongitude(
        this.lon +
          shortestAngle(this.lon * DEG2RAD, this.targetLon * DEG2RAD) * RAD2DEG *
            (1 - Math.exp(-18 * dt)),
      );
      this.lat = damp(this.lat, this.targetLat, 22, dt);
      this.directBlend = damp(this.directBlend, 1, 7, dt);
    } else {
      if (this.autoRotateSpeed !== 0) {
        this.targetLon = wrapLongitude(this.targetLon + this.autoRotateSpeed * dt);
      }
      this.lon = wrapLongitude(
        this.lon +
          shortestAngle(this.lon * DEG2RAD, this.targetLon * DEG2RAD) * RAD2DEG *
            (1 - Math.exp(-CAMERA.damping * 0.6 * dt)),
      );
      this.lat = damp(this.lat, this.targetLat, CAMERA.damping * 0.6, dt);
      this.altitude = damp(this.altitude, this.targetAltitude, CAMERA.damping, dt);
      this.heading = damp(this.heading, this.targetHeading, CAMERA.damping, dt);
      this.tilt = damp(this.tilt, this.targetTilt, CAMERA.damping, dt);
      this.directBlend = damp(this.directBlend, 0, 6, dt);
      if (this.directBlend < 0.004) this.directBlend = 0;
    }

    this.computePosition(dt);
  }

  private computePosition(dt: number): void {
    const phi = this.lat * DEG2RAD;
    const lambda = this.lon * DEG2RAD;
    const cosPhi = Math.cos(phi);
    const nx = cosPhi * Math.sin(lambda);
    const ny = Math.sin(phi);
    const nz = cosPhi * Math.cos(lambda);

    this.normal.set(nx, ny, nz);
    this.focus.set(nx * R, ny * R, nz * R);

    // East/north tangent frame at the focus point.
    this.east.set(nz, 0, -nx);
    if (this.east.lengthSq() < 1e-8) this.east.set(1, 0, 0);
    this.east.normalize();
    this.north.crossVectors(this.normal, this.east).normalize();

    const sinTilt = Math.sin(this.tilt);
    const cosTilt = Math.cos(this.tilt);
    const sinHeading = Math.sin(this.heading);
    const cosHeading = Math.cos(this.heading);

    const dirX = nx * cosTilt + (this.north.x * cosHeading + this.east.x * sinHeading) * sinTilt;
    const dirY = ny * cosTilt + (this.north.y * cosHeading + this.east.y * sinHeading) * sinTilt;
    const dirZ = nz * cosTilt + (this.north.z * cosHeading + this.east.z * sinHeading) * sinTilt;

    const altitude = this.directTarget ? this.altitude : this.altitude;
    // A small clearance keeps the camera above the surface without holding it
    // too far away to see a city block at the close end of the ladder.
    const distance = R * (altitude + 0.002);
    this.position.set(
      this.focus.x + dirX * distance,
      this.focus.y + dirY * distance,
      this.focus.z + dirZ * distance,
    );
    this.lookTarget.copy(this.focus);
    this.up.copy(WORLD_UP);

    if (this.directBlend > 0 && this.directTarget) {
      this.applyDirectFrame(dt);
    }

    this.camera.position.copy(this.position);
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.lookTarget);
    const viewDistance = this.camera.position.distanceTo(this.lookTarget);
    this.camera.near = clamp(viewDistance * 0.02, 0.00035, R * 4);
    this.camera.far = R * 120;
    this.camera.updateProjectionMatrix();
  }

  private applyDirectFrame(dt: number): void {
    const target = this.directTarget;
    if (!target) return;
    const blend = this.directBlend;

    const phi = target.lat * DEG2RAD;
    const lambda = target.lon * DEG2RAD;
    const cosPhi = Math.cos(phi);
    const nx = cosPhi * Math.sin(lambda);
    const ny = Math.sin(phi);
    const nz = cosPhi * Math.cos(lambda);

    this.normal.set(nx, ny, nz);
    this.east.set(nz, 0, -nx);
    if (this.east.lengthSq() < 1e-8) this.east.set(1, 0, 0);
    this.east.normalize();
    this.north.crossVectors(this.normal, this.east).normalize();

    this.unitPosition.copy(this.normal).multiplyScalar(R + target.altitude);
    // The follow pose arrives at HUD frequency; smooth it to the render rate so
    // the chase camera glides instead of stepping. Direct input still moves the
    // unit itself immediately — only the camera is filtered.
    if (!this.directUnitReady) {
      this.smoothUnitPosition.copy(this.unitPosition);
      this.directUnitReady = true;
    } else {
      this.smoothUnitPosition.lerp(this.unitPosition, 1 - Math.exp(-22 * Math.min(dt, 0.25)));
    }
    this.unitPosition.copy(this.smoothUnitPosition);

    // Unit forward: heading around the local vertical, pitch above the tangent
    // plane. Free-look offsets rotate this frame without moving the unit.
    const heading = target.heading + this.directYawOffset;
    const pitch = clamp(target.pitch + this.directPitchOffset, -1.2, 1.2);
    this.directForward
      .copy(this.north)
      .multiplyScalar(Math.cos(heading) * Math.cos(pitch))
      .addScaledVector(this.east, Math.sin(heading) * Math.cos(pitch))
      .addScaledVector(this.normal, Math.sin(pitch))
      .normalize();

    if (target.mode === 'cockpit') {
      this.directCameraPosition
        .copy(this.unitPosition)
        .addScaledVector(this.directForward, 0.008 * this.directZoom)
        .addScaledVector(this.normal, 0.0026);
      this.directLookTarget
        .copy(this.directCameraPosition)
        .addScaledVector(this.directForward, 0.4);
    } else {
      const chaseDistance = target.distance * this.directZoom;
      const chaseHeight = target.height * 0.62 * this.directZoom;
      this.directCameraPosition
        .copy(this.unitPosition)
        .addScaledVector(this.directForward, -chaseDistance)
        .addScaledVector(this.normal, chaseHeight);
      // Aim slightly below the unit: the aircraft then rides above the HUD
      // instead of sitting underneath it, and the horizon stays in frame.
      this.directLookTarget
        .copy(this.unitPosition)
        .addScaledVector(this.directForward, target.lookAhead * 0.45 * this.directZoom)
        .addScaledVector(this.normal, -target.distance * 0.4 * this.directZoom);
    }

    this.position.lerp(this.directCameraPosition, blend);
    this.lookTarget.lerp(this.directLookTarget, blend);
    this.up.copy(WORLD_UP).lerp(this.normal, blend).normalize();
  }
}
