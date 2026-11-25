import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import type { LandType, LngLat } from '@/lib/types';
import { colors, palette } from '@/theme/tokens';

import { SLOT } from './map-basemap';
import {
  APPROX_RADIUS_M,
  circleRing,
  closeRing,
  distanceM,
  edgeRotation,
  formatDistance,
  LAND_COLORS,
  MAP_FONT_BOLD,
  MARCH_DASHES,
  withAlpha,
} from './map-style';

type Kind = 'fill' | 'inner' | 'outline' | 'node' | 'edge';
type Props = { kind: Kind; at?: number; label?: string; rotate?: number };
type Shape = GeoJSON.FeatureCollection<GeoJSON.Geometry, Props>;

export type FocusTarget = {
  id: string;
  landType: LandType;
  /** Exact boundary; `null` for listings shown only as an approximate area. */
  boundary: LngLat[] | null;
  /** Plotted point (already fuzzed when approximate). */
  center: LngLat;
  approximate: boolean;
};

const EMPTY: Shape = { type: 'FeatureCollection', features: [] };
const CLEAR = 'rgba(0,0,0,0)';
const DRAW_MS = 950;
const MARCH_MS = 75;
/** Marching stops after a while so an idle map stops repainting. */
const MARCH_FOR_MS = 24_000;
/** Longest the draw-in waits for a moving camera before it traces anyway. */
const MAX_HOLD_MS = 2400;
/** Height of the parcel slab in 3D, metres: enough to read as a raised plot beside buildings. */
const SLAB_M = 6;
const SLAB_FADE = { duration: 420, delay: 0 };

function parcelShape(ring: LngLat[]): Shape {
  const closed = closeRing(ring);
  const lengths = ring.map((p, i) => distanceM(p, ring[(i + 1) % ring.length]));
  const perimeter = lengths.reduce((a, b) => a + b, 0) || 1;
  const features: Shape['features'] = [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] }, properties: { kind: 'fill' } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: closed }, properties: { kind: 'outline' } },
  ];
  let walked = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p },
      properties: { kind: 'node', at: walked / perimeter },
    });
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] },
      properties: { kind: 'edge', label: formatDistance(lengths[i]), rotate: edgeRotation(p, q) },
    });
    walked += lengths[i];
  });
  return { type: 'FeatureCollection', features };
}

function approxShape(center: LngLat): Shape {
  const outer = circleRing(center, APPROX_RADIUS_M);
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [outer] }, properties: { kind: 'fill' } },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [circleRing(center, APPROX_RADIUS_M * 0.55)] },
        properties: { kind: 'inner' },
      },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: outer }, properties: { kind: 'outline' } },
    ],
  };
}

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/**
 * The selected listing's land, drawn as a survey would: the boundary traces itself in, corner
 * nodes pop as the line reaches them, edge lengths settle in, then a white survey tape marches
 * around the outline. Approximate listings get a soft disc with a marching ring — never the
 * true polygon. Lives in its own component so the animation re-renders only these layers.
 */
export function FocusParcel({
  target,
  pausedRef,
  idPrefix = 'lc-focus',
  march = true,
  extrude = false,
}: {
  target: FocusTarget | null;
  /** Set while the camera moves; marching pauses so gestures get every frame. */
  pausedRef?: RefObject<boolean>;
  idPrefix?: string;
  /** Off for static previews: the outline draws in once and rests. */
  march?: boolean;
  /**
   * 3D: the exact parcel rises as a low translucent slab in its land-type colour, with the drawn
   * outline on top. Approximate areas never extrude — a raised disc would imply a real boundary.
   */
  extrude?: boolean;
}) {
  const reduced = useReducedMotion();
  const [anim, setAnim] = useState<{ id: string | null; t: number; phase: number }>({ id: null, t: 0, phase: 0 });

  const key = target ? `${target.id}:${target.approximate ? 'a' : 'p'}` : null;

  const shape = useMemo<Shape>(() => {
    if (!target) return EMPTY;
    if (target.approximate) return approxShape(target.center);
    return target.boundary && target.boundary.length >= 3 ? parcelShape(target.boundary) : EMPTY;
  }, [target]);

  useEffect(() => {
    if (!key) return;
    if (reduced) {
      setAnim({ id: key, t: 1, phase: 0 });
      return;
    }
    let raf = 0;
    let prev = Date.now();
    let last = 0;
    let lastMarch = 0;
    let phase = 0;
    let drawn = 0;
    let waited = 0;
    let marched = 0;
    const tick = () => {
      const now = Date.now();
      const dt = now - prev;
      prev = now;
      // While the camera flies to the parcel, the drawing holds still: no style updates compete
      // with the flight, and the line traces in at the destination. Capped so it never stalls.
      const hold = !!pausedRef?.current && waited < MAX_HOLD_MS;
      if (drawn < DRAW_MS) {
        if (hold) {
          waited += dt;
        } else {
          drawn += dt;
          // ~30 fps is plenty for a line drawing itself and halves the bridge traffic.
          if (now - last >= 32 || drawn >= DRAW_MS) {
            last = now;
            setAnim({ id: key, t: easeInOut(Math.min(1, drawn / DRAW_MS)), phase: 0 });
          }
        }
      } else if (march && marched < MARCH_FOR_MS) {
        marched += dt;
        if (now - lastMarch >= MARCH_MS && !pausedRef?.current) {
          lastMarch = now;
          phase = (phase + 1) % MARCH_DASHES.length;
          setAnim({ id: key, t: 1, phase });
        }
      } else {
        setAnim({ id: key, t: 1, phase });
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    setAnim({ id: key, t: 0, phase: 0 });
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, reduced, pausedRef, march]);

  const t = anim.id === key ? anim.t : 0;
  const phase = anim.id === key ? anim.phase : 0;
  const drawn = t >= 1;
  const approximate = !!target?.approximate;
  const tone = LAND_COLORS[target?.landType ?? 'agricultural'];

  const slab = extrude && !approximate;
  const progress = Math.max(0.0001, Math.min(1.0001, t + 0.0001));
  const gradient = (color: string) =>
    ['step', ['line-progress'], color, progress, CLEAR] as unknown as ExpressionSpecification;

  return (
    // Fills sit under the roads, so a road crossing a synthetic boundary still reads as a road.
    // Outlines sit above roads but under every road and place name (see SLOT in map-basemap).
    <GeoJSONSource id={`${idPrefix}-src`} data={shape} lineMetrics>
      <Layer
        id={`${idPrefix}-fill`}
        type="fill"
        beforeId={SLOT.ground}
        filter={['==', ['get', 'kind'], 'fill']}
        paint={{ 'fill-color': tone.fill, 'fill-opacity': (approximate ? 0.12 : 0.24) * t }}
      />
      <Layer
        id={`${idPrefix}-inner`}
        type="fill"
        beforeId={SLOT.ground}
        filter={['==', ['get', 'kind'], 'inner']}
        paint={{ 'fill-color': tone.fill, 'fill-opacity': 0.12 * t }}
      />
      {/* Always mounted; height and opacity animate natively when 3D turns on or off. */}
      <Layer
        id={`${idPrefix}-slab`}
        type="fill-extrusion"
        beforeId={SLOT.lines}
        filter={['==', ['get', 'kind'], 'fill']}
        paint={{
          'fill-extrusion-color': tone.fill,
          'fill-extrusion-base': 0,
          'fill-extrusion-height': slab ? SLAB_M * t : 0,
          'fill-extrusion-height-transition': SLAB_FADE,
          'fill-extrusion-opacity': slab ? 0.5 : 0,
          'fill-extrusion-opacity-transition': SLAB_FADE,
        }}
      />
      {/* A thin white casing keeps the drawn line legible where it crosses a road. */}
      <Layer
        id={`${idPrefix}-casing`}
        type="line"
        beforeId={SLOT.lines}
        filter={['==', ['get', 'kind'], 'outline']}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{
          'line-gradient': gradient(withAlpha(palette.white, approximate ? 0.55 : 0.85)),
          'line-width': approximate ? 3 : 4.4,
        }}
      />
      <Layer
        id={`${idPrefix}-line`}
        type="line"
        beforeId={SLOT.lines}
        filter={['==', ['get', 'kind'], 'outline']}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{
          'line-gradient': gradient(approximate ? withAlpha(tone.ink, 0.5) : tone.ink),
          'line-width': approximate ? 1.3 : 2.2,
        }}
      />
      <Layer
        id={`${idPrefix}-march`}
        type="line"
        beforeId={SLOT.lines}
        filter={['==', ['get', 'kind'], 'outline']}
        paint={{
          'line-color': approximate ? tone.ink : palette.white,
          'line-width': approximate ? 1.8 : 1,
          'line-opacity': drawn && (march || approximate) ? (approximate ? 0.8 : 0.95) : 0,
          'line-dasharray': MARCH_DASHES[phase],
        }}
      />
      <Layer
        id={`${idPrefix}-nodes`}
        type="circle"
        beforeId={SLOT.lines}
        filter={['==', ['get', 'kind'], 'node']}
        paint={{
          'circle-radius': ['case', ['<=', ['get', 'at'], t], 3.6, 0] as unknown as ExpressionSpecification,
          'circle-color': colors.surface,
          'circle-stroke-color': tone.ink,
          'circle-stroke-width': 1.8,
          'circle-pitch-alignment': 'map',
        }}
      />
      {/* Edge lengths take part in label placement under the basemap names: where they would
          collide with a road or village name, the name wins and the length steps aside. */}
      <Layer
        id={`${idPrefix}-edges`}
        type="symbol"
        beforeId={SLOT.labels}
        minzoom={14}
        filter={['==', ['get', 'kind'], 'edge']}
        layout={{
          'text-field': ['get', 'label'],
          'text-font': MAP_FONT_BOLD,
          'text-size': 10.5,
          'text-letter-spacing': 0.04,
          'text-rotate': ['get', 'rotate'],
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'map',
          'text-padding': 1,
        }}
        paint={{
          'text-color': colors.ink,
          'text-halo-color': withAlpha(palette.white, 0.95),
          'text-halo-width': 1.6,
          'text-opacity': drawn ? 1 : 0,
          'text-opacity-transition': { duration: 320, delay: 0 },
        }}
      />
    </GeoJSONSource>
  );
}
