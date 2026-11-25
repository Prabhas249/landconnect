import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';

import type { LngLat } from '@/lib/types';
import { colors, palette } from '@/theme/tokens';

import { SLOT } from './map-basemap';
import { distanceM, formatDistance, MAP_FONT_BOLD, withAlpha } from './map-style';

type GuideProps = { label: string };
const EMPTY: GeoJSON.FeatureCollection<GeoJSON.LineString, GuideProps> = { type: 'FeatureCollection', features: [] };

/** Points along the great circle from a to b (spherical interpolation). */
function greatCircle(a: LngLat, b: LngLat, steps = 48): LngLat[] {
  const rad = Math.PI / 180;
  const [l1, p1] = [a[0] * rad, a[1] * rad];
  const [l2, p2] = [b[0] * rad, b[1] * rad];
  const d =
    2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return [a, b];
  const out: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push([Math.atan2(y, x) / rad, Math.atan2(z, Math.sqrt(x * x + y * y)) / rad]);
  }
  return out;
}

/** Shorter than this the parcel is basically where you stand; no line needed. */
const MIN_GUIDE_M = 60;

/**
 * Faint straight-line guide from the viewer to the selected parcel's public point, labelled with
 * the as-the-crow-flies distance. Road routing is handed to the phone's maps app instead.
 * The line runs under every basemap name; its label yields to them in placement.
 */
export function GuideLine({ from, to }: { from: LngLat | null; to: LngLat | null }) {
  const shape = useMemo(() => {
    if (!from || !to) return EMPTY;
    const m = distanceM(from, to);
    if (m < MIN_GUIDE_M) return EMPTY;
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: greatCircle(from, to) },
          properties: { label: `${formatDistance(m)} straight line` },
        },
      ],
    };
  }, [from, to]);

  return (
    <GeoJSONSource id="lc-guide-src" data={shape}>
      <Layer
        id="lc-guide-casing"
        type="line"
        beforeId={SLOT.lines}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{ 'line-color': withAlpha(palette.white, 0.6), 'line-width': 3 }}
      />
      <Layer
        id="lc-guide-line"
        type="line"
        beforeId={SLOT.lines}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{ 'line-color': withAlpha(palette.forest, 0.42), 'line-width': 1.6, 'line-dasharray': [1.5, 2] }}
      />
      <Layer
        id="lc-guide-label"
        type="symbol"
        beforeId={SLOT.labels}
        layout={{
          'symbol-placement': 'line-center',
          'text-field': ['get', 'label'],
          'text-font': MAP_FONT_BOLD,
          'text-size': 10.5,
          'text-letter-spacing': 0.04,
          'text-keep-upright': true,
        }}
        paint={{
          'text-color': colors.inkSecondary,
          'text-halo-color': withAlpha(palette.white, 0.95),
          'text-halo-width': 1.6,
        }}
      />
    </GeoJSONSource>
  );
}
