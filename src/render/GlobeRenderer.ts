import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  BackSide,
  SRGBColorSpace,
  ACESFilmicToneMapping,
} from 'three';
import { GAME, QUALITY, type QualityPreset } from '../core/config';
import { clamp } from '../core/math';
import { COUNTRY_BY_ID } from '../data/countries';
import { CITIES } from '../data/cities';
import { buildGlobeGeometry, type GlobeGeometry } from './globeGeography';
import { CameraRig } from './CameraRig';
import { PALETTE } from './theme';

/**
 * WebGL world renderer.
 *
 * One merged surface mesh, one border mesh, one ocean sphere, one atmosphere
 * shell and one point cloud for cities: the whole planet is a handful of draw
 * calls, which is what makes the world view cheap. Region and battle scenes will
 * be sibling render layers driven by the same camera rig.
 */

export interface GlobeRendererOptions {
  canvas: HTMLCanvasElement;
  quality: QualityPreset;
  cityMarkers: boolean;
}

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

const R = GAME.globeRadius;

const surfaceShaderKey = 'terra-surface-v2';

export class GlobeRenderer {
  readonly rig: CameraRig;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly geometry: GlobeGeometry;
  private readonly surfaceMesh: Mesh;
  private readonly surfaceMaterial: MeshStandardMaterial;
  private readonly baseBorders: LineSegments;
  private readonly highlightGroup = new Group();
  private readonly ocean: Mesh;
  private readonly atmosphere: ShaderMaterial;
  private readonly cityPoints: Points;
  private readonly stars: Points;
  private readonly raycaster = new Raycaster();
  private readonly pointerNdc = new Vector2();
  private readonly detailUniform = { value: 0 };
  private readonly frameCallbacks = new Set<() => void>();

  private quality: QualityPreset;
  private animationHandle = 0;
  private lastTime = 0;
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private cityMarkersEnabled: boolean;
  private disposed = false;

  constructor(options: GlobeRendererOptions) {
    this.quality = options.quality;
    this.cityMarkersEnabled = options.cityMarkers;
    this.geometry = buildGlobeGeometry();

    this.renderer = new WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].pixelRatio));
    this.renderer.setSize(options.canvas.clientWidth || 1, options.canvas.clientHeight || 1, false);

    this.scene.background = PALETTE.background;

    this.rig = new CameraRig(options.canvas.clientWidth / Math.max(1, options.canvas.clientHeight));

    this.surfaceMaterial = this.createSurfaceMaterial();
    this.surfaceMesh = new Mesh(this.geometry.surface, this.surfaceMaterial);
    this.surfaceMesh.frustumCulled = false;
    this.scene.add(this.surfaceMesh);

    this.baseBorders = new LineSegments(
      this.geometry.borders,
      new LineBasicMaterial({
        color: PALETTE.borderGlow,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    this.baseBorders.frustumCulled = false;
    this.scene.add(this.baseBorders);
    this.scene.add(this.highlightGroup);

    this.ocean = new Mesh(
      new SphereGeometry(R * 0.985, 96, 64),
      new MeshPhongMaterial({
        color: PALETTE.ocean,
        specular: PALETTE.oceanSpecular,
        shininess: 20,
        emissive: new Color('#050f19'),
        emissiveIntensity: 0.55,
      }),
    );
    this.scene.add(this.ocean);

    this.atmosphere = new ShaderMaterial({
      uniforms: { uColor: { value: PALETTE.atmosphere } },
      vertexShader: /* glsl */ `
        varying vec3 vWorldNormal;
        varying vec3 vViewDirection;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vViewDirection = normalize(cameraPosition - worldPosition.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec3 vWorldNormal;
        varying vec3 vViewDirection;
        void main() {
          float rim = 1.0 - abs(dot(normalize(vWorldNormal), normalize(vViewDirection)));
          float glow = pow(rim, 3.4);
          float edgeFade = smoothstep(0.0, 0.45, rim);
          gl_FragColor = vec4(uColor, glow * 0.42 * edgeFade);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: BackSide,
    });
    const atmosphereMesh = new Mesh(new SphereGeometry(R * 1.028, 64, 48), this.atmosphere);
    this.scene.add(atmosphereMesh);

    this.scene.add(new AmbientLight(0x8ba6c8, 0.36));
    this.scene.add(new HemisphereLight(0x9fc8ff, 0x2a2118, 0.34));
    const sun = new DirectionalLight(0xfff0d6, 1.78);
    sun.position.set(R * 5.5, R * 2.4, R * 3.8);
    this.scene.add(sun);

    this.stars = this.createStars(QUALITY[this.quality].starCount);
    this.scene.add(this.stars);

    this.cityPoints = this.createCityPoints();
    this.scene.add(this.cityPoints);

    this.rig.update(1);
  }

  // ── Scene construction ──────────────────────────────────────────────────────

  private createSurfaceMaterial(): MeshStandardMaterial {
    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.04,
      side: DoubleSide,
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = this.detailUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTerraPos;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vTerraPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          varying vec3 vTerraPos;
          uniform float uDetail;
          float terraHash(vec3 p) {
            p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23));
            p *= 17.0;
            return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
          }
          float terraNoise(vec3 x) {
            vec3 i = floor(x);
            vec3 f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(mix(terraHash(i + vec3(0.0, 0.0, 0.0)), terraHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                  mix(terraHash(i + vec3(0.0, 1.0, 0.0)), terraHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
              mix(mix(terraHash(i + vec3(0.0, 0.0, 1.0)), terraHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                  mix(terraHash(i + vec3(0.0, 1.0, 1.0)), terraHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
              f.z);
          }
          float terraFbm(vec3 p) {
            float value = 0.0;
            float amplitude = 0.5;
            for (int i = 0; i < 4; i++) {
              value += amplitude * terraNoise(p);
              p *= 2.03;
              amplitude *= 0.5;
            }
            return value;
          }`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          float relief = terraFbm(vTerraPos * 2.1) * 0.62 + terraFbm(vTerraPos * 6.7) * 0.38;
          float detail = mix(0.5, relief, uDetail);
          diffuseColor.rgb *= mix(0.9, 1.16, detail);`,
        );
    };
    material.customProgramCacheKey = () => surfaceShaderKey;
    return material;
  }

  private createStars(count: number): Points {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    let seed = 1337;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < count; index += 1) {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const radius = R * (28 + random() * 26);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.cos(phi);
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      const tint = 0.6 + random() * 0.4;
      colors[index * 3] = tint * 0.9;
      colors[index * 3 + 1] = tint * 0.95;
      colors[index * 3 + 2] = tint;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const material = new PointsMaterial({
      size: 1.5,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  private createCityPoints(): Points {
    const positions = new Float32Array(CITIES.length * 3);
    const colors = new Float32Array(CITIES.length * 3);
    const color = new Color();
    for (let index = 0; index < CITIES.length; index += 1) {
      const city = CITIES[index];
      const phi = (city.position[1] * Math.PI) / 180;
      const lambda = (city.position[0] * Math.PI) / 180;
      const radius = R * 1.016;
      positions[index * 3] = radius * Math.cos(phi) * Math.sin(lambda);
      positions[index * 3 + 1] = radius * Math.sin(phi);
      positions[index * 3 + 2] = radius * Math.cos(phi) * Math.cos(lambda);
      color.copy(city.tier === 1 ? PALETTE.cityCapital : PALETTE.city);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const material = new PointsMaterial({
      size: 0.075,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const points = new Points(geometry, material);
    points.visible = false;
    return points;
  }

  // ── Interaction ─────────────────────────────────────────────────────────────

  rotate(deltaX: number, deltaY: number): void {
    this.rig.rotate(deltaX, deltaY);
  }

  pan(deltaX: number, deltaY: number): void {
    this.rig.pan(deltaX, deltaY);
  }

  zoom(deltaY: number): void {
    this.rig.zoom(deltaY);
  }

  setQuality(preset: QualityPreset): void {
    this.quality = preset;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[preset].pixelRatio));
    this.resize();
  }

  setCityMarkers(enabled: boolean): void {
    this.cityMarkersEnabled = enabled;
  }

  setSelection(selectedId: string | null, hoveredId: string | null): void {
    if (this.selectedId === selectedId && this.hoveredId === hoveredId) return;
    this.selectedId = selectedId;
    this.hoveredId = hoveredId;
    this.rebuildHighlights();
  }

  private rebuildHighlights(): void {
    while (this.highlightGroup.children.length > 0) {
      const child = this.highlightGroup.children.pop();
      if (child instanceof Mesh || child instanceof LineSegments) child.material.dispose();
    }

    const addOverlay = (countryId: string, color: Color, opacity: number, outlineOpacity: number) => {
      const geometry = this.geometry.highlights.get(countryId);
      const outline = this.geometry.outlines.get(countryId);
      if (!geometry) return;
      const mesh = new Mesh(
        geometry,
        new MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      mesh.renderOrder = 2;
      this.highlightGroup.add(mesh);
      if (outline) {
        const lines = new LineSegments(
          outline,
          new LineBasicMaterial({
            color,
            transparent: true,
            opacity: outlineOpacity,
            depthWrite: false,
          }),
        );
        lines.renderOrder = 3;
        this.highlightGroup.add(lines);
      }
    };

    if (this.hoveredId && this.hoveredId !== this.selectedId) {
      addOverlay(this.hoveredId, PALETTE.hover, 0.16, 0.55);
    }
    if (this.selectedId) {
      addOverlay(this.selectedId, PALETTE.selection, 0.24, 0.95);
    }
  }

  /** Frames a country using its geographic extent. */
  frameCountry(countryId: string): void {
    const definition = COUNTRY_BY_ID[countryId];
    if (!definition) return;
    const { minLon, maxLon, minLat, maxLat } = definition.bounds;
    const latitude = (minLat + maxLat) / 2;
    const lonSpan = Math.abs(maxLon - minLon) * Math.max(0.25, Math.cos((latitude * Math.PI) / 180));
    const latSpan = Math.abs(maxLat - minLat);
    const span = Math.max(4, Math.hypot(lonSpan, latSpan));
    // Fit the country's extent into ~70% of the viewport height (fov 42°).
    const altitude = clamp(span / 26, 0.14, 3.4);
    const [lon, lat] = definition.label;
    const [currentLon, currentLat] = this.rig.focusLonLat;
    const angularDistance = Math.hypot(
      Math.abs(((lon - currentLon + 540) % 360) - 180),
      lat - currentLat,
    );
    // A cinematic swoop is only pleasant across short hops; when a campaign
    // loads half a world away, place the camera directly on the country.
    if (angularDistance > 20) this.rig.snap(lon, lat, altitude);
    else this.rig.flyTo(lon, lat, altitude);
  }

  pick(clientX: number, clientY: number): string | null {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.rig.camera);
    const hits = this.raycaster.intersectObject(this.surfaceMesh, false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    if (!hit.face) return null;
    const attribute = this.geometry.surface.getAttribute('countryIndex');
    if (!attribute) return null;
    const index = Math.round(attribute.getX(hit.face.a));
    return this.geometry.countryIds[index] ?? null;
  }

  /** Projects a geographic point to CSS pixel coordinates. */
  project(lon: number, lat: number, radiusFactor = 1.02): ScreenPoint {
    const phi = (lat * Math.PI) / 180;
    const lambda = (lon * Math.PI) / 180;
    const radius = R * radiusFactor;
    const position = new Vector3(
      radius * Math.cos(phi) * Math.sin(lambda),
      radius * Math.sin(phi),
      radius * Math.cos(phi) * Math.cos(lambda),
    );
    const facing = position.clone().normalize().dot(this.rig.camera.position.clone().normalize()) > 0.1;
    position.project(this.rig.camera);
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const x = (position.x * 0.5 + 0.5) * width;
    const y = (-position.y * 0.5 + 0.5) * height;
    return {
      x,
      y,
      visible: facing && position.z < 1 && x > -80 && x < width + 80 && y > -80 && y < height + 80,
    };
  }

  get camera(): PerspectiveCamera {
    return this.rig.camera;
  }

  get countryCount(): number {
    return this.geometry.countryIds.length;
  }

  get triangleCount(): number {
    return this.geometry.triangles;
  }

  onFrame(callback: () => void): () => void {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    if (this.animationHandle !== 0) return;
    this.lastTime = performance.now();
    const loop = (time: number) => {
      if (this.disposed) return;
      this.animationHandle = requestAnimationFrame(loop);
      const deltaSeconds = clamp((time - this.lastTime) / 1000, 0.001, 0.1);
      this.lastTime = time;
      this.rig.update(deltaSeconds);

      const altitude = this.rig.altitudeRatio;
      this.detailUniform.value = this.rig.detailFactor;
      this.cityPoints.visible = this.cityMarkersEnabled && altitude < 0.34;
      (this.cityPoints.material as PointsMaterial).size = clamp(0.035 + altitude * 0.12, 0.035, 0.12);
      this.ocean.lookAt(this.rig.camera.position);
      this.stars.rotation.y += deltaSeconds * 0.0025;

      this.renderer.render(this.scene, this.rig.camera);
      for (const callback of this.frameCallbacks) callback();
    };
    this.animationHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.animationHandle) cancelAnimationFrame(this.animationHandle);
    this.animationHandle = 0;
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.rig.camera.aspect = width / Math.max(1, height);
    this.rig.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.frameCallbacks.clear();
    this.geometry.surface.dispose();
    this.geometry.borders.dispose();
    for (const geometry of this.geometry.highlights.values()) geometry.dispose();
    for (const geometry of this.geometry.outlines.values()) geometry.dispose();
    this.surfaceMaterial.dispose();
    this.renderer.dispose();
  }
}
