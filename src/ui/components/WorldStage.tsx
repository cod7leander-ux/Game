import { useEffect, useRef, useState } from 'react';
import { GlobeRenderer } from '../../render/GlobeRenderer';
import type { ArmyMarkerSpec } from '../../render/ArmyMarkers';
import { resolveQuality, useSettingsStore } from '../../state/settingsStore';
import { useAppStore } from '../../state/appStore';
import { useI18n } from '../hooks/useI18n';
import './world-stage.css';

export interface StageLabel {
  id: string;
  lon: number;
  lat: number;
  title: string;
  subtitle?: string;
  tone?: 'gold' | 'cyan' | 'green';
}

interface WorldStageProps {
  interactive: boolean;
  autoRotate?: number;
  labels?: StageLabel[];
  armies?: ArmyMarkerSpec[];
  className?: string;
}

/**
 * The WebGL world canvas plus its DOM label overlay.
 *
 * The renderer owns camera and picking; React only sends intent (select, hover,
 * focus) and renders crisp localised labels above the canvas.
 */
export function WorldStage({
  interactive,
  autoRotate = 0,
  labels = [],
  armies = [],
  className,
}: WorldStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const rendererRef = useRef<GlobeRenderer | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const selectedCountryId = useAppStore((state) => state.selectedCountryId);
  const hoveredCountryId = useAppStore((state) => state.hoveredCountryId);
  const selectCountry = useAppStore((state) => state.selectCountry);
  const hoverCountry = useAppStore((state) => state.hoverCountry);
  const cameraFocus = useAppStore((state) => state.cameraFocus);
  const cityMarkers = useSettingsStore((state) => state.cityMarkers);
  const graphics = useSettingsStore((state) => state.graphics);
  const t = useI18n();

  // Mount the renderer once; the globe survives every screen change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: GlobeRenderer | null = null;
    let cancelled = false;

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      try {
        renderer = new GlobeRenderer({
          canvas,
          quality: resolveQuality(graphics),
          cityMarkers,
        });
        renderer.start();
        rendererRef.current = renderer;
        setStatus('ready');
      } catch (error) {
        console.error('Failed to initialise the world renderer', error);
        setStatus('error');
      }
    }, 40);

    const observer = new ResizeObserver(() => rendererRef.current?.resize());
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
      renderer?.dispose();
      rendererRef.current = null;
    };
    // Renderer lifecycle is intentionally mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rendererRef.current?.setSelection(selectedCountryId, hoveredCountryId);
  }, [selectedCountryId, hoveredCountryId, status]);

  useEffect(() => {
    rendererRef.current?.setCityMarkers(cityMarkers);
  }, [cityMarkers, status]);

  useEffect(() => {
    rendererRef.current?.setArmies(armies);
  }, [armies, status]);

  useEffect(() => {
    rendererRef.current?.setQuality(resolveQuality(graphics));
  }, [graphics, status]);

  useEffect(() => {
    if (status !== 'ready') return;
    if (cameraFocus) rendererRef.current?.frameCountry(cameraFocus.countryId);
  }, [cameraFocus, status]);

  useEffect(() => {
    if (status !== 'ready') return;
    rendererRef.current?.rig.setAutoRotate(autoRotate);
  }, [autoRotate, status]);

  // Pointer interaction: rotate, pan, zoom, hover and select.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive || status !== 'ready') return;

    let dragging = false;
    let button = 0;
    let lastX = 0;
    let lastY = 0;
    let moved = 0;
    let hoverTimer = 0;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;

    const onPointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        dragging = false;
        return;
      }
      dragging = true;
      button = event.button;
      lastX = event.clientX;
      lastY = event.clientY;
      moved = 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0) renderer.zoom((pinchDistance - distance) * 2.4);
        pinchDistance = distance;
        return;
      }

      if (!dragging) {
        window.clearTimeout(hoverTimer);
        hoverTimer = window.setTimeout(() => {
          const id = renderer.pick(event.clientX, event.clientY);
          hoverCountry(id);
        }, 60);
        return;
      }

      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      moved += Math.abs(deltaX) + Math.abs(deltaY);

      if (button === 0) renderer.rotate(deltaX, deltaY);
      else renderer.pan(deltaX, deltaY);
    };

    const onPointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
      if (pointers.size === 0) window.clearTimeout(hoverTimer);
      if (!dragging) return;
      dragging = false;
      if (moved < 6 && event.button === 0) {
        const id = rendererRef.current?.pick(event.clientX, event.clientY) ?? null;
        selectCountry(id, false);
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      rendererRef.current?.zoom(event.deltaY);
    };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    const onLeave = () => hoverCountry(null);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);

    return () => {
      window.clearTimeout(hoverTimer);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [interactive, status, selectCountry, hoverCountry]);

  // Keep DOM labels pinned to their geographic anchors.
  useEffect(() => {
    if (status !== 'ready') return;
    const unsubscribe = rendererRef.current?.onFrame(() => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      for (const label of labels) {
        const element = labelRefs.current.get(label.id);
        if (!element) continue;
        const point = renderer.project(label.lon, label.lat, 1.03);
        if (!point.visible) {
          element.style.opacity = '0';
          continue;
        }
        element.style.opacity = '1';
        element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -140%)`;
      }
    });
    return () => unsubscribe?.();
  }, [labels, status]);

  return (
    <div ref={containerRef} className={`world-stage ${className ?? ''}`}>
      <canvas ref={canvasRef} className="world-stage__canvas" aria-label="World map" />
      <div className="world-stage__vignette" aria-hidden="true" />
      {status === 'ready' && (
        <div className="world-stage__labels">
          {labels.map((label) => (
            <div
              key={label.id}
              ref={(element) => {
                if (element) labelRefs.current.set(label.id, element);
                else labelRefs.current.delete(label.id);
              }}
              className={`stage-label stage-label--${label.tone ?? 'gold'}`}
              style={{ opacity: 0 }}
            >
              <span className="stage-label__title">{label.title}</span>
              {label.subtitle && <span className="stage-label__subtitle">{label.subtitle}</span>}
            </div>
          ))}
        </div>
      )}
      {status === 'loading' && (
        <div className="world-stage__loader">
          <div className="world-stage__spinner" />
          <div className="world-stage__loading-text">
            <strong>{t.t('common.loading')}</strong>
            <span>{t.t('common.loadingHint')}</span>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="world-stage__loader">
          <div className="world-stage__loading-text">
            <strong>{t.t('common.error')}</strong>
            <span>{t.t('common.webglError')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
